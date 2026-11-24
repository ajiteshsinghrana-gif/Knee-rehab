/**
 * Patient lifecycle and data rights (Phase 6.4).
 *
 * Active -> treatment complete ("past patient", read-only record kept for the retention period) -> erased.
 * Designed around India's DPDP Act 2023 and Rules 2025 (substantive duties start 13 May 2027). This is software support,
 * not legal advice: the clinic's own lawyer decides the retention period and the wording of the notice.
 */
import type { Patient } from './types';
import type { AppState } from './store';
import { withAuditNote } from './engine/plan';

/** Bump when the privacy notice text changes; the version is stored with each patient's consent. */
export const CONSENT_VERSION = '2026-11-v1';
/** Medical-record rules point to about 3 years as a floor (some guidance says up to 7). The clinic sets its own. */
export const DEFAULT_RETENTION_YEARS = 3;

export const isActive = (p: Patient): boolean => p.status !== 'completed';

export function completeTreatment(p: Patient, note: string, ctx: { nowMs: number; today: string }): Patient {
  if (p.status === 'completed') throw new Error('Treatment is already marked complete');
  const why = (note ?? '').trim();
  if (!why) throw new Error('Write a short note on why treatment is complete (for example: goals met, discharged, patient left)');
  const at = new Date(ctx.nowMs).toISOString();
  const logged = withAuditNote(p, 'complete-treatment', 'Treatment marked complete', { status: 'active' }, { status: 'completed' }, why, ctx);
  return { ...logged, status: 'completed', completedAt: at, completionNote: why };
}

export function reopenTreatment(p: Patient, note: string, ctx: { nowMs: number; today: string }): Patient {
  if (p.status !== 'completed') throw new Error('This patient is already active');
  const why = (note ?? '').trim();
  if (!why) throw new Error('Write why treatment is starting again');
  const logged = withAuditNote(p, 'reopen-treatment', 'Treatment reopened', { status: 'completed' }, { status: 'active' }, why, ctx);
  const { status: _s, completedAt: _c, completionNote: _n, ...rest } = logged;
  return rest;
}

/** The day records can be reviewed for erasure: completion date plus the clinic's retention period. Null while treatment is active. */
export function retentionEnd(p: Patient, years: number): string | null {
  if (p.status !== 'completed' || !p.completedAt) return null;
  const d = new Date(p.completedAt);
  d.setUTCFullYear(d.getUTCFullYear() + Math.max(0, Math.round(years)));
  return d.toISOString().slice(0, 10);
}
export const retentionDue = (p: Patient, years: number, today: string): boolean => { const e = retentionEnd(p, years); return !!e && e <= today; };

/**
 * Remove a patient from this device and write an erasure log entry that holds no personal data.
 * The cloud copy is removed separately (sync engine) because it needs a network call.
 */
export function eraseLocal(s: AppState, id: string, reason: string, nowMs: number): AppState {
  const p = s.patients.find((x) => x.id === id);
  if (!p) return s;
  const patients = s.patients.filter((x) => x.id !== id);
  return { ...s, patients, activeId: patients.some((x) => x.id === s.activeId) ? s.activeId : patients[0]?.id ?? '', erasureLog: [...(s.erasureLog ?? []), { at: new Date(nowMs).toISOString(), reason: reason.slice(0, 80), hadAccount: !!p.accountEmail || !!p.consent }] };
}

/** "Download my data" (right of access): everything the patient entered or was prescribed, without the physio's private notes. */
export function exportMyData(p: Patient, packName: string, nowMs: number) {
  return {
    exportedAt: new Date(nowMs).toISOString(),
    about: 'A copy of the data RehabPath holds about you. Your physio\'s private notes and reasons are not part of this file.',
    you: { name: p.name, age: p.age, language: p.language, email: p.accountEmail ?? null },
    treatment: { condition: packName, anchorDate: p.anchorDate, currentPhase: p.currentPhase, status: p.status ?? 'active', completedAt: p.completedAt ?? null, instructionsFromPhysio: (p.plan.instructions ?? []).map((x) => x.text) },
    consent: p.consent ?? null,
    dailyCheckIns: p.daily,
    guidedSessions: p.sessions ?? [],
    cameraFormChecks: (p.formChecks ?? []).map((c) => ({ date: c.date, exercise: c.exerciseId, repsCounted: c.repsCounted, measuredFaults: c.faults, cameraCouldSeeEnough: c.reliable, askedToPause: c.paused })),
    cameraConsent: p.formCheckConsent ?? null,
    videoRequests: (p.formRequests ?? []).map((r) => ({ sent: r.at, exercise: r.exerciseId, yourNote: r.note, consentGiven: r.consent, videoDeleted: r.clipGone ?? null, videoStoredUntil: r.clip?.deleteAfter ?? null, physioReply: r.reply ? { at: r.reply.at, text: r.reply.text, points: r.reply.points } : null })),
    periodicEntries: p.periodic,
    changesToYourPlan: p.notices.map((n) => ({ at: n.at, changes: n.changes })),
  };
}
