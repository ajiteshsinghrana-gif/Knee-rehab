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
import type { DailyCheckIn, ExerciseDemo, Notice, Patient, PeriodicEntry, Plan, SessionLog, SyncedDemo } from '../types';
import { cleanSyncedDemos, demosForPatient } from '../exercises/demos';
import { isLang } from '../types';
import { getPack } from '../engine/packs';

export interface UpSlice { v: 1; daily: DailyCheckIn[]; periodic: PeriodicEntry[]; language: string; caregiverMode: boolean; seen: string[]; sessions?: SessionLog[]; consent?: { version: string; at: string }; erasureRequestedAt?: string }
export interface DownSlice {
  v: 1; name: string; age: number; anchorDate: string; enrolledOn?: string; currentPhase: string; phaseStartDate: string;
  sessionsPrescribedPerDay: number; plan: Plan; notices: Notice[];
  status?: 'completed'; completedAt?: string; erasureNote?: string; clinicContact?: string;
  /** Demonstration links and cloud videos for this patient's exercises (Phase 7.2). Teaching material only; never affects triage. */
  demos?: Record<string, SyncedDemo>;
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


// ---- guided sessions (patient-owned, merged by id, newest 60 kept) ----
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const cleanSession = (raw: unknown): SessionLog | null => {
  if (!isObj(raw) || !str(raw.id, 40) || !str(raw.date, 10) || !num(raw.startedAt) || !num(raw.endedAt) || !Array.isArray(raw.exercises)) return null;
  const exercises = raw.exercises.slice(0, 40).flatMap((x: unknown) => {
    if (!isObj(x) || !str(x.id, 60) || !num(x.setsPlanned) || !num(x.setsDone) || !num(x.repsDone)) return [];
    return [{ id: x.id, setsPlanned: x.setsPlanned, setsDone: x.setsDone, repsPlanned: num(x.repsPlanned) ? x.repsPlanned : null, repsDone: x.repsDone,
      ...(str(x.stopped, 30) ? { stopped: x.stopped } : {}), ...(num(x.pain) ? { pain: Math.max(0, Math.min(10, x.pain)) } : {}), ...(x.struggling === true ? { struggling: true } : {}) }];
  });
  return { id: raw.id, date: raw.date, startedAt: raw.startedAt, endedAt: raw.endedAt, exercises,
    ...(raw.answeredBy === 'patient' || raw.answeredBy === 'caregiver' ? { answeredBy: raw.answeredBy } : {}), ...(raw.via === 'app' || raw.via === 'whatsapp' ? { via: raw.via } : {}) };
};
const mergeSessions = (local: SessionLog[] | undefined, raw: unknown): SessionLog[] | undefined => {
  const incoming = (Array.isArray(raw) ? raw : []).map(cleanSession).filter((x): x is SessionLog => !!x);
  if (!local?.length && !incoming.length) return local;
  const m = new Map<string, SessionLog>((local ?? []).map((x) => [x.id, x]));
  for (const x of incoming) m.set(x.id, x);
  return [...m.values()].sort((a, b) => a.startedAt - b.startedAt).slice(-60);
};

// ---------------- patient -> physio ----------------
export function upSlice(p: Patient): UpSlice {
  return { v: 1, daily: p.daily, periodic: p.periodic, language: p.language, caregiverMode: !!p.caregiverMode, seen: p.notices.filter((n) => n.seen).map((n) => n.id), ...(p.sessions?.length ? { sessions: p.sessions.slice(-60) } : {}), ...(p.consent ? { consent: p.consent } : {}), ...(p.erasureRequestedAt ? { erasureRequestedAt: p.erasureRequestedAt } : {}) };
}
const stamp = (e: object): number => (e as { recordedAt?: number }).recordedAt ?? 0;
/** Same day: the later recording wins; an entry is never lost because the other side has fewer. */
function mergeBy<T extends object>(local: T[], incoming: T[], key: (e: T) => string): T[] {
  const m = new Map<string, T>(local.map((e) => [key(e), e]));
  for (const e of incoming) { const cur = m.get(key(e)); if (!cur || stamp(e) >= stamp(cur)) m.set(key(e), e); }
  return [...m.values()];
}
const dailyKey = (e: DailyCheckIn) => e.date;
const periodicKey = (e: PeriodicEntry) => `${e.date}|${Object.keys(e.values).sort().join(',')}`; // a weekly test and a monthly questionnaire can share a date

/** Receives the patient's answers (the physio's computer, or the patient's own new phone restoring its history).
 *  Answers are merged by date, never replaced, so an empty or older copy can never erase history. The plan is never touched. */
export function applyUp(p: Patient, raw: unknown): Patient {
  if (!isObj(raw) || raw.v !== 1) return p;
  const inDaily = (Array.isArray(raw.daily) ? raw.daily : []).filter(validDaily).map(cleanDaily);
  const inPeriodic = (Array.isArray(raw.periodic) ? raw.periodic : []).filter(validPeriodic).map(cleanPeriodic);
  const daily = mergeBy(p.daily, inDaily, dailyKey).sort((a, b) => a.date.localeCompare(b.date));
  const periodic = mergeBy(p.periodic, inPeriodic, periodicKey).sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set((Array.isArray(raw.seen) ? raw.seen : []).filter((x): x is string => typeof x === 'string'));
  return {
    ...p, daily, periodic, language: isLang(raw.language) ? raw.language : p.language,
    ...(() => { const ss = mergeSessions(p.sessions, raw.sessions); return ss ? { sessions: ss } : {}; })(),
    ...(raw.caregiverMode === true ? { caregiverMode: true } : { caregiverMode: false }),
    notices: p.notices.map((n) => (seen.has(n.id) ? { ...n, seen: true } : n)),
    ...(isObj(raw.consent) && typeof raw.consent.version === 'string' && typeof raw.consent.at === 'string' ? { consent: { version: raw.consent.version.slice(0, 40), at: raw.consent.at.slice(0, 40) } } : {}),
    ...(typeof raw.erasureRequestedAt === 'string' ? { erasureRequestedAt: raw.erasureRequestedAt.slice(0, 40) } : {}),
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
/** Exercises in the patient's protocol phases. A pack that cannot be found has none (the slice then carries no demos). */
const phaseExercises = (p: Patient): string[] => { try { return getPack(p.packId).phases.flatMap((x) => x.exercises); } catch { return []; } };
export function downSlice(p: Patient, clinicDemos?: Record<string, ExerciseDemo>): DownSlice {
  const demos = demosForPatient(p, phaseExercises(p), clinicDemos);
  return {
    v: 1, name: p.name, age: p.age, anchorDate: p.anchorDate, ...(p.enrolledOn ? { enrolledOn: p.enrolledOn } : {}), currentPhase: p.currentPhase, phaseStartDate: p.phaseStartDate,
    sessionsPrescribedPerDay: p.sessionsPrescribedPerDay, plan: redactPlan(p.plan), notices: p.notices,
    ...(p.status === 'completed' ? { status: 'completed' as const, ...(p.completedAt ? { completedAt: p.completedAt } : {}) } : {}), ...(p.erasureNote ? { erasureNote: p.erasureNote } : {}), ...(p.clinicContact ? { clinicContact: p.clinicContact } : {}),
    ...(clinicDemos ? { demos } : {}),
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
    status: raw.status === 'completed' ? 'completed' : undefined,
    completedAt: raw.status === 'completed' && typeof raw.completedAt === 'string' ? raw.completedAt.slice(0, 40) : undefined,
    erasureNote: typeof raw.erasureNote === 'string' ? raw.erasureNote.slice(0, 300) : undefined,
    clinicContact: typeof raw.clinicContact === 'string' ? raw.clinicContact.slice(0, 120) : p.clinicContact,
    // An older physio build sends no demos: keep what this phone has. Otherwise take exactly what the physio sent, so a removed video disappears.
    ...(raw.demos !== undefined ? { demos: cleanSyncedDemos(raw.demos) } : {}),
  };
}

export const sliceKey = (x: unknown): string => JSON.stringify(x);
