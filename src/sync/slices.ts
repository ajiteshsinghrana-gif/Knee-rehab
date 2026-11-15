/**
 * What travels between the patient's phone and the physio's computer (Phase 6.1).
 *
 * Each side OWNS one slice and never writes the other's:
 *   "up"   (patient owns): check-ins, weekly/monthly entries, language, caregiver tick, which notices were seen.
 *   "down" (physio owns):  the plan, phase, notices, follow-up, and the patient's basic details.
 * So a check-in can never change a plan (safety rule 2), and nothing can conflict.
 *
 * Everything that arrives is checked and copied field by field. Unknown fields are dropped, so a damaged or
 * tampered row cannot change anything it should not, and the physio's private reasons never leave his computer.
 */
import type { DailyCheckIn, Notice, Patient, PeriodicEntry, Plan } from '../types';
import { isLang } from '../types';
import { getPack } from '../engine/packs';

export interface UpSlice { v: 1; daily: DailyCheckIn[]; periodic: PeriodicEntry[]; language: string; caregiverMode: boolean; seen: string[] }
export interface DownSlice {
  v: 1; name: string; age: number; anchorDate: string; enrolledOn?: string; currentPhase: string; phaseStartDate: string;
  sessionsPrescribedPerDay: number; plan: Plan; notices: Notice[];
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isVal = (v: unknown) => typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' || typeof v === 'boolean';
const isValues = (x: unknown): x is Record<string, string | number | boolean> => isObj(x) && Object.values(x).every(isVal);
const isBoolMap = (x: unknown): x is Record<string, boolean> => isObj(x) && Object.values(x).every((v) => typeof v === 'boolean');

export const validDaily = (e: unknown): e is DailyCheckIn => isObj(e) && isDate(e.date) && isValues(e.values) && ['all', 'some', 'none'].includes(e.exercises as string)
  && Number.isFinite(e.sessionsPrescribed) && Number.isFinite(e.sessionsDone) && typeof e.hardMovement === 'string' && isBoolMap(e.warnings)
  && (e.precautionBreaches === undefined || isBoolMap(e.precautionBreaches))
  && (e.exerciseResults === undefined || (Array.isArray(e.exerciseResults) && e.exerciseResults.every((r) => isObj(r) && typeof r.id === 'string' && typeof r.done === 'boolean')))
  && (e.answeredBy === undefined || e.answeredBy === 'patient' || e.answeredBy === 'caregiver')
  && (e.skipReason === undefined || typeof e.skipReason === 'string') && (e.recordedAt === undefined || Number.isFinite(e.recordedAt));
export const validPeriodic = (e: unknown): e is PeriodicEntry => isObj(e) && isDate(e.date) && isValues(e.values)
  && (e.answeredBy === undefined || e.answeredBy === 'patient' || e.answeredBy === 'caregiver')
  && (e.photos === undefined || (isObj(e.photos) && Object.values(e.photos).every((v) => typeof v === 'string')))
  && (e.methods === undefined || (isObj(e.methods) && Object.values(e.methods).every((v) => v === 'photo')));

// copy only known fields
const cleanDaily = (e: DailyCheckIn): DailyCheckIn => ({
  date: e.date, values: { ...e.values }, exercises: e.exercises, sessionsPrescribed: e.sessionsPrescribed, sessionsDone: e.sessionsDone, hardMovement: e.hardMovement, warnings: { ...e.warnings },
  ...(e.skipReason !== undefined ? { skipReason: e.skipReason } : {}), ...(e.exerciseResults ? { exerciseResults: e.exerciseResults.map((r) => ({ id: r.id, done: r.done, ...(typeof r.reason === 'string' ? { reason: r.reason } : {}) })) } : {}),
  ...(e.precautionBreaches ? { precautionBreaches: { ...e.precautionBreaches } } : {}), ...(e.answeredBy ? { answeredBy: e.answeredBy } : {}), ...(e.recordedAt !== undefined ? { recordedAt: e.recordedAt } : {}),
});
const cleanPeriodic = (e: PeriodicEntry): PeriodicEntry => ({
  date: e.date, values: { ...e.values }, ...(e.photos ? { photos: { ...e.photos } } : {}), ...(e.methods ? { methods: { ...e.methods } } : {}), ...(e.answeredBy ? { answeredBy: e.answeredBy } : {}),
});

// ---------------- patient -> physio ----------------
export function upSlice(p: Patient): UpSlice {
  return { v: 1, daily: p.daily, periodic: p.periodic, language: p.language, caregiverMode: !!p.caregiverMode, seen: p.notices.filter((n) => n.seen).map((n) => n.id) };
}
/** Physio's computer receives the patient's answers. Only answer fields change; the plan is never touched. */
export function applyUp(p: Patient, raw: unknown): Patient {
  if (!isObj(raw) || raw.v !== 1) return p;
  const daily = (Array.isArray(raw.daily) ? raw.daily : []).filter(validDaily).map(cleanDaily).sort((a, b) => a.date.localeCompare(b.date));
  const periodic = (Array.isArray(raw.periodic) ? raw.periodic : []).filter(validPeriodic).map(cleanPeriodic).sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set((Array.isArray(raw.seen) ? raw.seen : []).filter((x): x is string => typeof x === 'string'));
  return {
    ...p, daily, periodic, language: isLang(raw.language) ? raw.language : p.language,
    ...(raw.caregiverMode === true ? { caregiverMode: true } : { caregiverMode: false }),
    notices: p.notices.map((n) => (seen.has(n.id) ? { ...n, seen: true } : n)),
  };
}

// ---------------- physio -> patient ----------------
/** Reasons the physio wrote are for his audit log only; they are stripped before anything leaves his computer. */
const redactPlan = (pl: Plan): Plan => ({
  ...pl,
  hold: pl.hold ? { at: pl.hold.at, by: pl.hold.by } : null,
  overrides: pl.overrides.map((o) => ({ ...o, reason: '' })),
  ...(pl.curveOverrides ? { curveOverrides: pl.curveOverrides.map((c) => ({ ...c, reason: '' })) } : {}),
});
export function downSlice(p: Patient): DownSlice {
  return {
    v: 1, name: p.name, age: p.age, anchorDate: p.anchorDate, ...(p.enrolledOn ? { enrolledOn: p.enrolledOn } : {}), currentPhase: p.currentPhase, phaseStartDate: p.phaseStartDate,
    sessionsPrescribedPerDay: p.sessionsPrescribedPerDay, plan: redactPlan(p.plan), notices: p.notices,
  };
}
const validNotice = (n: unknown): n is Notice => isObj(n) && typeof n.id === 'string' && typeof n.at === 'string' && typeof n.seen === 'boolean' && Array.isArray(n.changes) && n.changes.every((c) => isObj(c) && typeof c.kind === 'string');
const validPlan = (x: unknown): x is Plan => isObj(x) && isObj(x.swaps) && Array.isArray(x.added) && Array.isArray(x.removed) && Array.isArray(x.overrides)
  && (x.hold === null || isObj(x.hold)) && (x.followUp === null || isObj(x.followUp));

/** Patient's phone receives what the physio decided. Notices already seen here stay seen. */
export function applyDown(p: Patient, raw: unknown): Patient {
  if (!isObj(raw) || raw.v !== 1 || !validPlan(raw.plan)) return p;
  let phases: string[] = [];
  try { phases = getPack(p.packId).phases.map((x) => x.id); } catch { return p; }
  if (typeof raw.currentPhase !== 'string' || !phases.includes(raw.currentPhase) || !isDate(raw.phaseStartDate) || !isDate(raw.anchorDate)) return p;
  const here = new Map(p.notices.map((n) => [n.id, n.seen]));
  const notices = (Array.isArray(raw.notices) ? raw.notices : []).filter(validNotice).map((n) => ({ ...n, seen: n.seen || !!here.get(n.id) }));
  return {
    ...p,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : p.name, age: Number.isFinite(raw.age) ? Number(raw.age) : p.age,
    anchorDate: raw.anchorDate, ...(isDate(raw.enrolledOn) ? { enrolledOn: raw.enrolledOn } : {}), currentPhase: raw.currentPhase, phaseStartDate: raw.phaseStartDate,
    sessionsPrescribedPerDay: Number.isFinite(raw.sessionsPrescribedPerDay) ? Number(raw.sessionsPrescribedPerDay) : p.sessionsPrescribedPerDay,
    plan: raw.plan as Plan, notices,
  };
}

export const sliceKey = (x: unknown): string => JSON.stringify(x);
