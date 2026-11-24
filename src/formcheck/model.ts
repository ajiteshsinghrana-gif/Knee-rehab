/**
 * Camera form check as patient-record logic: saving a check, the review rules, the physio's limits and consent.
 *
 *   F1  The same measured fault in 3 of the last 5 reliable checks of one exercise: a REVIEW item for the physio.
 *   F3  The camera could not see enough: nothing is flagged and the patient is asked to try again.
 *   PAUSE  A loss of steadiness or a limit the physio set was crossed: the phone asks the patient to pause and the physio is told.
 *
 * None of these changes a triage tier, a plan or a phase. They raise a form-check request (the same worklist item the video
 * requests use) that the physio reads and answers. A form fault never raises SAFETY or URGENT on its own: a single phone camera
 * can be wrong, so those tiers stay with the patient's own answers and the protocol rules.
 * NEEDS_PHYSIO_SIGNOFF: the F1 numbers (3 of 5) and every threshold in config.ts.
 */
import type { AnsweredBy, FormCheckLog, FormClip, FormLimit, FormRequest, Patient } from '../types';
import { addDays } from '../engine/dates';
import { withAuditNote, type Ctx } from '../engine/plan';
import { FORM_CONFIG, newFormRequest } from '../forms/model';
import { FORM_CHECK, formKindFor, unitOf } from './config';
import type { FormSummary } from './analyze';

export const hasConsent = (p: Patient): boolean => p.formCheckConsent?.version === FORM_CHECK.consentVersion;
export const giveConsent = (p: Patient, by: AnsweredBy, at: string): Patient => ({ ...p, formCheckConsent: { by, at, version: FORM_CHECK.consentVersion } });
export const withdrawConsent = (p: Patient): Patient => { const { formCheckConsent: _c, ...rest } = p; return rest; };

export const limitFor = (p: Patient, exerciseId: string): FormLimit | undefined => p.formLimits?.[exerciseId];

export function newCheckLog(a: { id: string; date: string; startedAt: number; endedAt: number; exerciseId: string; summary: FormSummary; by: AnsweredBy; limit?: FormLimit }): FormCheckLog {
  const kind = formKindFor(a.exerciseId);
  if (!kind) throw new Error(`No camera check for ${a.exerciseId}`);
  return {
    id: a.id, date: a.date, startedAt: a.startedAt, endedAt: a.endedAt, exerciseId: a.exerciseId, kind,
    repsCounted: a.summary.reps, faults: a.summary.faults, usable: a.summary.usable, reliable: a.summary.reliable, paused: a.summary.paused,
    answeredBy: a.by, ...(a.limit ? { limit: a.limit } : {}),
  };
}

/** A fault is "present" in a check when it was seen in at least `presentReps` reps (or in the only rep when just one was counted). */
export const present = (c: FormCheckLog, faultId: string): boolean => {
  const need = Math.min(FORM_CHECK.presentReps, Math.max(1, c.repsCounted));
  return c.faults.some((f) => f.id === faultId && f.reps.length >= need);
};

/** Rule F1: fault ids seen in at least `f1.checks` of the last `f1.window` reliable checks of this exercise, counting `current`. */
export function f1Faults(history: FormCheckLog[], current: FormCheckLog): string[] {
  if (!current.reliable) return [];
  const prior = history.filter((c) => c.exerciseId === current.exerciseId && c.reliable && c.id !== current.id).sort((a, b) => a.startedAt - b.startedAt);
  const window = [...prior.slice(-(FORM_CHECK.f1.window - 1)), current];
  const ids = new Set(current.faults.map((f) => f.id));
  return [...ids].filter((id) => present(current, id) && window.filter((c) => present(c, id)).length >= FORM_CHECK.f1.checks).sort();
}

export type RaiseReason = 'F1' | 'PAUSE';
export interface Assessment { f1: string[]; paused: boolean; raise: RaiseReason | null; /** F3: the camera could not see enough, so nothing is flagged */ unreliable: boolean }
export function assess(p: Patient, log: FormCheckLog): Assessment {
  if (!log.reliable) return { f1: [], paused: false, raise: null, unreliable: true };
  const f1 = f1Faults(p.formChecks ?? [], log);
  return { f1, paused: log.paused, raise: log.paused ? 'PAUSE' : f1.length ? 'F1' : null, unreliable: false };
}

const dateOf = (iso: string) => iso.slice(0, 10);
/** An auto-raised request for this exercise that the physio has not answered yet, from the last few days. */
const pendingAuto = (p: Patient, exerciseId: string, reason: RaiseReason, atIso: string): boolean =>
  (p.formRequests ?? []).some((r) => r.auto?.reason === reason && r.exerciseId === exerciseId && !r.reply && dateOf(r.at) >= addDays(dateOf(atIso), -FORM_CHECK.dedupeDays));

export const requestIdFor = (checkId: string) => `fc${checkId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);

/**
 * Save a finished check. When F1 or a pause applies, raise one form-check request for the physio (numbers only, no clip).
 * The check is always kept, so the physio can open the record whenever needed.
 */
export function recordCheck(p: Patient, log: FormCheckLog, atIso: string): { patient: Patient; assessment: Assessment; requestId: string | null } {
  const a = assess(p, log);
  let next: Patient = p;
  let requestId: string | null = null;
  let kept = log;
  if (a.raise && !pendingAuto(p, log.exerciseId, a.raise, atIso)) {
    requestId = requestIdFor(log.id);
    const faultIds = a.raise === 'F1' ? a.f1 : log.faults.filter((f) => FORM_CHECK.pauseOn.includes(f.kind)).map((f) => f.id);
    const by = log.answeredBy ?? 'patient';
    const req: FormRequest = { ...newFormRequest({ id: requestId, exerciseId: log.exerciseId, at: atIso, note: '', by, clip: null, via: 'app' }), consent: { by, at: atIso, version: FORM_CHECK.consentVersion }, auto: { checkId: log.id, reason: a.raise, faults: faultIds.slice(0, 8) } };
    next = { ...next, formRequests: [...(next.formRequests ?? []).filter((x) => x.id !== req.id), req] };
    kept = { ...log, requestId };
  }
  next = { ...next, formChecks: [...(next.formChecks ?? []).filter((x) => x.id !== kept.id), kept].sort((x, y) => x.startedAt - y.startedAt).slice(-FORM_CHECK.keepChecks) };
  return { patient: next, assessment: a, requestId };
}

/** The patient chose to send the video of a flagged set: attach it to the request the check raised. */
export const attachClip = (p: Patient, requestId: string, clip: Omit<FormClip, 'deleteAfter'>, atIso: string): Patient => ({
  ...p, formRequests: (p.formRequests ?? []).map((r) => (r.id === requestId ? { ...r, clip: { ...clip, deleteAfter: addDays(dateOf(atIso), FORM_CONFIG.clipKeepDays) }, clipGone: undefined } : r)),
});

/** Pending physio review items raised by the camera check (the worklist counts them with the video requests). */
export const pendingChecks = (p: Patient): FormRequest[] => (p.formRequests ?? []).filter((r) => r.auto && !r.reply);

/** The physio sets a limit for one patient and one exercise, with a reason. Recorded in the audit log. */
export function setFormLimit(p: Patient, exerciseId: string, v: { max?: number; min?: number }, reason: string, ctx: Ctx): Patient {
  const kind = formKindFor(exerciseId);
  if (!kind || !reason.trim()) return p;
  const top = unitOf(kind) === 'deg' ? 180 : 100;
  const ok = (n: number | undefined) => n === undefined || (Number.isFinite(n) && n >= 0 && n <= top);
  if (!ok(v.max) || !ok(v.min)) return p;
  if (v.max !== undefined && v.min !== undefined && v.min >= v.max) return p;
  const before = p.formLimits?.[exerciseId] ?? null;
  const limits = { ...(p.formLimits ?? {}) };
  const who = ctx.who ?? 'physio';
  if (v.max === undefined && v.min === undefined) delete limits[exerciseId];
  else limits[exerciseId] = { ...(v.max !== undefined ? { max: v.max } : {}), ...(v.min !== undefined ? { min: v.min } : {}), at: new Date(ctx.nowMs).toISOString(), by: who };
  // An empty object (not undefined) is kept after the last limit is removed, so the removal travels to the patient's phone.
  const next: Patient = { ...p, formLimits: limits };
  return withAuditNote(next, 'form-limit', `Camera form check limit for ${exerciseId}: ${v.max === undefined && v.min === undefined ? 'removed' : `${v.min !== undefined ? `min ${v.min}` : ''}${v.min !== undefined && v.max !== undefined ? ', ' : ''}${v.max !== undefined ? `max ${v.max}` : ''}`}`, before, limits[exerciseId] ?? null, reason.trim().slice(0, 300), ctx);
}
