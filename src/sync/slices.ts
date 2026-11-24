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
import type { ClinicVisit, DailyCheckIn, ExerciseDemo, Notice, Patient, PeriodicEntry, Plan, SessionLog, SyncedDemo, FormRequest, FormReply, FormCheckLog, FormFault, FormFaultKind, FormLimit } from '../types';
import { cleanSyncedDemos, demosForPatient } from '../exercises/demos';
import { isLang } from '../types';
import { getPack } from '../engine/packs';

export interface UpSlice { v: 1; daily: DailyCheckIn[]; periodic: PeriodicEntry[]; language: string; caregiverMode: boolean; seen: string[]; sessions?: SessionLog[]; forms?: FormRequest[]; checks?: FormCheckLog[]; consent?: { version: string; at: string }; erasureRequestedAt?: string }
export interface DownSlice {
  v: 1; name: string; age: number; anchorDate: string; enrolledOn?: string; currentPhase: string; phaseStartDate: string;
  sessionsPrescribedPerDay: number; plan: Plan; notices: Notice[];
  status?: 'completed'; completedAt?: string; erasureNote?: string; clinicContact?: string;
  /** Demonstration links and cloud videos for this patient's exercises (Phase 7.2). Teaching material only; never affects triage. */
  demos?: Record<string, SyncedDemo>;
  /** The physio's replies to form-check videos, and clips he deleted, keyed by request id. */
  forms?: Record<string, { reply?: FormReply; clipGone?: string; deleteAfter?: string }>;
  /** Clinic sessions the physio planned or marked (physio feedback round). */
  visits?: ClinicVisit[];
  /** For the patient's "My progress": their goal, the physio's progress notes toward it, and readings taken in clinic. */
  goal?: string;
  goalProgress?: { date: string; pct: number }[];
  clinicReadings?: PeriodicEntry[];
  /** The physio's range limits for the camera form check, keyed by exercise. The patient's phone uses them; they are physio-owned. */
  formLimits?: Record<string, FormLimit>;
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
  && (e.methods === undefined || (isObj(e.methods) && Object.values(e.methods).every((v) => v === 'photo' || v === 'phone' || v === 'manual')))
  && (e.where === undefined || e.where === 'home' || e.where === 'clinic')
  && (e.photoRefs === undefined || (isObj(e.photoRefs) && Object.values(e.photoRefs).every((v) => isObj(v) && (v.where === 'device' || v.where === 'cloud') && typeof v.ref === 'string' && v.ref.length <= 200)));

// copy only known fields
const cleanDaily = (e: DailyCheckIn): DailyCheckIn => ({
  date: e.date, values: { ...e.values }, exercises: e.exercises, sessionsPrescribed: e.sessionsPrescribed, sessionsDone: e.sessionsDone, hardMovement: e.hardMovement, warnings: { ...e.warnings },
  ...(e.skipReason !== undefined ? { skipReason: e.skipReason } : {}), ...(e.exerciseResults ? { exerciseResults: e.exerciseResults.map((r) => ({ id: r.id, done: r.done, ...(typeof r.reason === 'string' ? { reason: r.reason } : {}) })) } : {}),
  ...(e.precautionBreaches ? { precautionBreaches: { ...e.precautionBreaches } } : {}), ...(e.answeredBy ? { answeredBy: e.answeredBy } : {}), ...(e.recordedAt !== undefined ? { recordedAt: e.recordedAt } : {}),
});
const cleanPeriodic = (e: PeriodicEntry): PeriodicEntry => ({
  date: e.date, values: { ...e.values }, ...(e.photos ? { photos: { ...e.photos } } : {}), ...(e.methods ? { methods: { ...e.methods } } : {}), ...(e.answeredBy ? { answeredBy: e.answeredBy } : {}),
  ...(e.where ? { where: e.where } : {}), ...(e.photoRefs ? { photoRefs: Object.fromEntries(Object.entries(e.photoRefs).map(([k, v]) => [k, { where: v.where, ref: v.ref }])) } : {}),
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

// ---- form-check video requests (patient-owned request; physio-owned reply) ----
const ISO = /^\d{4}-\d{2}-\d{2}/;
const cleanReply = (raw: unknown): FormReply | undefined => {
  if (!isObj(raw) || !str(raw.at, 40) || !str(raw.by, 80) || !str(raw.text, 1000) || !Array.isArray(raw.points)) return undefined;
  return { at: raw.at, by: raw.by, text: raw.text, points: raw.points.filter((x): x is string => typeof x === 'string' && x.length <= 30).slice(0, 12) };
};
const cleanForm = (raw: unknown): FormRequest | null => {
  if (!isObj(raw) || !str(raw.id, 60) || !/^[A-Za-z0-9_-]{4,60}$/.test(raw.id) || !str(raw.exerciseId, 60) || !str(raw.at, 40) || !ISO.test(raw.at) || !str(raw.note, 500)) return null;
  const c = raw.consent;
  if (!isObj(c) || (c.by !== 'patient' && c.by !== 'caregiver') || !str(c.at, 40) || !str(c.version, 40)) return null;
  let clip: FormRequest['clip'] = null;
  const k = raw.clip;
  if (isObj(k) && (k.where === 'device' || k.where === 'cloud') && str(k.ref, 200) && str(k.mime, 60) && num(k.size) && str(k.deleteAfter, 10) && ISO.test(k.deleteAfter)) {
    clip = { where: k.where, ref: k.ref, mime: k.mime, size: k.size, durationSec: num(k.durationSec) ? k.durationSec : null, deleteAfter: k.deleteAfter };
  }
  return { id: raw.id, exerciseId: raw.exerciseId, at: raw.at, note: raw.note, consent: { by: c.by, at: c.at, version: c.version },
    ...(raw.via === 'app' || raw.via === 'whatsapp' ? { via: raw.via } : {}), clip,
    ...(str(raw.clipGone, 40) ? { clipGone: raw.clipGone } : {}), ...(str(raw.replySeenAt, 40) ? { replySeenAt: raw.replySeenAt } : {}),
    ...(() => { const a = raw.auto; return isObj(a) && str(a.checkId, 40) && (a.reason === 'F1' || a.reason === 'PAUSE') && Array.isArray(a.faults) ? { auto: { checkId: a.checkId, reason: a.reason, faults: a.faults.filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(0, 8) } } : {}; })() };
};
/** The patient's request without the physio's reply (which the patient's phone only ever receives, never sends back). */
const formUp = (r: FormRequest): FormRequest => { const { reply: _r, ...rest } = r; return rest; };
/** Physio side: take the patient's requests. A deletion on either side wins: a clip is never brought back. The physio's reply is kept. */
const mergeFormsUp = (local: FormRequest[] | undefined, raw: unknown): FormRequest[] | undefined => {
  const incoming = (Array.isArray(raw) ? raw : []).slice(0, 200).map(cleanForm).filter((x): x is FormRequest => !!x);
  if (!local?.length && !incoming.length) return local;
  const m = new Map<string, FormRequest>((local ?? []).map((x) => [x.id, x]));
  for (const inc of incoming) {
    const cur = m.get(inc.id);
    const gone = cur?.clipGone ?? inc.clipGone;
    const clip = gone ? null : inc.clip && cur?.clip && cur.clip.deleteAfter < inc.clip.deleteAfter ? { ...inc.clip, deleteAfter: cur.clip.deleteAfter } : inc.clip;
    m.set(inc.id, { ...inc, clip, ...(gone ? { clipGone: gone } : {}), ...(cur?.reply ? { reply: cur.reply } : {}) });
  }
  return [...m.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-200);
};
/** What the physio sends down about each request. */
const formsDown = (p: Patient): Record<string, { reply?: FormReply; clipGone?: string; deleteAfter?: string }> | undefined => {
  const rs = (p.formRequests ?? []).filter((r) => r.reply || r.clipGone);
  if (!rs.length) return undefined;
  return Object.fromEntries(rs.map((r) => [r.id, { ...(r.reply ? { reply: r.reply } : {}), ...(r.clipGone ? { clipGone: r.clipGone } : {}), ...(r.clip ? { deleteAfter: r.clip.deleteAfter } : {}) }]));
};
/** Patient side: take the physio's replies and deletions. A clip the physio deleted is marked due now, so the phone's clean-up removes the file. */
const applyForms = (local: FormRequest[] | undefined, raw: unknown): FormRequest[] | undefined => {
  if (!local?.length || !isObj(raw)) return local;
  return local.map((r) => {
    const d = raw[r.id];
    if (!isObj(d)) return r;
    const reply = cleanReply(d.reply);
    const gone = str(d.clipGone, 40) ? d.clipGone : undefined;
    let clip = r.clip;
    if (clip && gone) clip = { ...clip, deleteAfter: '1970-01-01' };
    else if (clip && str(d.deleteAfter, 10) && ISO.test(d.deleteAfter) && d.deleteAfter < clip.deleteAfter) clip = { ...clip, deleteAfter: d.deleteAfter };
    return { ...r, ...(reply ? { reply } : {}), ...(gone ? { clipGone: gone } : {}), clip };
  });
};

// ---------------- patient -> physio ----------------
export function upSlice(p: Patient): UpSlice {
  return { v: 1, daily: p.daily, periodic: p.periodic.filter((e) => e.where !== 'clinic'), language: p.language, caregiverMode: !!p.caregiverMode, seen: p.notices.filter((n) => n.seen).map((n) => n.id), ...(p.sessions?.length ? { sessions: p.sessions.slice(-60) } : {}), ...(p.formRequests?.length ? { forms: p.formRequests.slice(-200).map(formUp) } : {}), ...(p.formChecks?.length ? { checks: p.formChecks.slice(-60) } : {}), ...(p.consent ? { consent: p.consent } : {}), ...(p.erasureRequestedAt ? { erasureRequestedAt: p.erasureRequestedAt } : {}) };
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
  // A patient's phone only ever sends home readings: anything claiming to be a clinic reading is dropped.
  const inPeriodic = (Array.isArray(raw.periodic) ? raw.periodic : []).filter(validPeriodic).filter((e) => e.where !== 'clinic').map(cleanPeriodic);
  const daily = mergeBy(p.daily, inDaily, dailyKey).sort((a, b) => a.date.localeCompare(b.date));
  const periodic = mergeBy(p.periodic, inPeriodic, periodicKey).sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set((Array.isArray(raw.seen) ? raw.seen : []).filter((x): x is string => typeof x === 'string'));
  return {
    ...p, daily, periodic, language: isLang(raw.language) ? raw.language : p.language,
    ...(() => { const ss = mergeSessions(p.sessions, raw.sessions); return ss ? { sessions: ss } : {}; })(),
    ...(() => { const ff = mergeFormsUp(p.formRequests, raw.forms); return ff ? { formRequests: ff } : {}; })(),
    ...(() => { const cc = mergeChecks(p.formChecks, raw.checks); return cc ? { formChecks: cc } : {}; })(),
    ...(raw.caregiverMode === true ? { caregiverMode: true } : { caregiverMode: false }),
    notices: p.notices.map((n) => (seen.has(n.id) ? { ...n, seen: true } : n)),
    ...(isObj(raw.consent) && typeof raw.consent.version === 'string' && typeof raw.consent.at === 'string' ? { consent: { version: raw.consent.version.slice(0, 40), at: raw.consent.at.slice(0, 40) } } : {}),
    ...(typeof raw.erasureRequestedAt === 'string' ? { erasureRequestedAt: raw.erasureRequestedAt.slice(0, 40) } : {}),
  };
}

// ---- camera form checks (patient-owned, merged by id, newest 60 kept) ----
const FAULT_KINDS: FormFaultKind[] = ['posture', 'compensation', 'stability', 'range', 'control', 'precaution'];
const FAULT_UNITS = ['deg', 'pct', 'degps', 'pctps', 's'] as const;
const cleanLimit = (raw: unknown): FormLimit | undefined => {
  if (!isObj(raw) || !str(raw.at, 40) || !str(raw.by, 80)) return undefined;
  const max = num(raw.max) ? raw.max : undefined, min = num(raw.min) ? raw.min : undefined;
  if (max === undefined && min === undefined) return undefined;
  return { ...(max !== undefined ? { max: Math.max(0, Math.min(180, max)) } : {}), ...(min !== undefined ? { min: Math.max(0, Math.min(180, min)) } : {}), at: raw.at, by: raw.by };
};
const cleanFault = (raw: unknown): FormFault | null => {
  if (!isObj(raw) || !str(raw.id, 40) || !FAULT_KINDS.includes(raw.kind as FormFaultKind) || !Array.isArray(raw.reps) || !num(raw.peak) || !num(raw.firstSec)) return null;
  const unit = FAULT_UNITS.find((u) => u === raw.unit);
  if (!unit) return null;
  return { id: raw.id, kind: raw.kind as FormFaultKind, reps: raw.reps.filter(num).slice(0, 60), peak: raw.peak, unit, firstSec: raw.firstSec };
};
const cleanCheck = (raw: unknown): FormCheckLog | null => {
  if (!isObj(raw) || !str(raw.id, 40) || !/^[A-Za-z0-9_-]{2,40}$/.test(raw.id) || !str(raw.date, 10) || !num(raw.startedAt) || !num(raw.endedAt) || !str(raw.exerciseId, 60) || !str(raw.kind, 30)
    || !num(raw.repsCounted) || !Array.isArray(raw.faults) || !num(raw.usable) || typeof raw.reliable !== 'boolean' || typeof raw.paused !== 'boolean') return null;
  const limit = cleanLimit(raw.limit);
  return { id: raw.id, date: raw.date, startedAt: raw.startedAt, endedAt: raw.endedAt, exerciseId: raw.exerciseId, kind: raw.kind, repsCounted: raw.repsCounted,
    ...(num(raw.cadence) && raw.cadence >= 0 && raw.cadence <= 400 ? { cadence: Math.round(raw.cadence) } : {}),
    ...(Array.isArray(raw.holds) && raw.holds.length ? { holds: raw.holds.filter((h): h is number => num(h) && h >= 0 && h <= 3600).slice(0, 30) } : {}),
    faults: raw.faults.slice(0, 12).map(cleanFault).filter((x): x is FormFault => !!x), usable: Math.max(0, Math.min(1, raw.usable)), reliable: raw.reliable, paused: raw.paused,
    ...(raw.answeredBy === 'patient' || raw.answeredBy === 'caregiver' ? { answeredBy: raw.answeredBy } : {}), ...(str(raw.requestId, 60) ? { requestId: raw.requestId } : {}), ...(limit ? { limit } : {}) };
};
const mergeChecks = (local: FormCheckLog[] | undefined, raw: unknown): FormCheckLog[] | undefined => {
  const incoming = (Array.isArray(raw) ? raw : []).slice(0, 60).map(cleanCheck).filter((x): x is FormCheckLog => !!x);
  if (!local?.length && !incoming.length) return local;
  const m = new Map<string, FormCheckLog>((local ?? []).map((x) => [x.id, x]));
  for (const x of incoming) m.set(x.id, x);
  return [...m.values()].sort((a, b) => a.startedAt - b.startedAt).slice(-60);
};
const cleanLimits = (raw: unknown): Record<string, FormLimit> | undefined => {
  if (!isObj(raw)) return undefined;
  const out: Record<string, FormLimit> = {};
  for (const [k, v] of Object.entries(raw).slice(0, 40)) { const l = cleanLimit(v); if (l && k.length <= 60) out[k] = l; }
  return Object.keys(out).length ? out : undefined;
};

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
    ...(formsDown(p) ? { forms: formsDown(p) } : {}),
    ...(p.visits ? { visits: p.visits.map((v) => ({ id: v.id, at: v.at, status: v.status })) } : {}),
    ...(p.details?.goal ? { goal: p.details.goal } : {}),
    ...(p.goalProgress?.length ? { goalProgress: p.goalProgress.map((g) => ({ date: g.date, pct: g.pct })) } : {}),
    ...(p.formLimits ? { formLimits: p.formLimits } : {}),
    ...(p.periodic.some((e) => e.where === 'clinic') ? { clinicReadings: p.periodic.filter((e) => e.where === 'clinic').map(cleanPeriodic) } : {}),
  };
}
const validVisit = (v: unknown): v is ClinicVisit => isObj(v) && typeof v.id === 'string' && v.id.length <= 40 && typeof v.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.at)
  && (v.status === 'planned' || v.status === 'attended' || v.status === 'missed');
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
    ...(Array.isArray(raw.visits) ? { visits: raw.visits.filter(validVisit).slice(0, 100).map((v) => ({ id: v.id, at: v.at, status: v.status })) } : {}),
    ...(typeof raw.goal === 'string' ? { details: { ...(p.details ?? {}), goal: raw.goal.slice(0, 200) } } : {}),
    ...(Array.isArray(raw.goalProgress) ? { goalProgress: raw.goalProgress.filter((g: unknown) => isObj(g) && isDate(g.date) && Number.isFinite(g.pct)).slice(0, 100).map((g: Record<string, unknown>) => ({ date: g.date as string, pct: Math.max(0, Math.min(100, Number(g.pct))), at: '', by: '' })) } : {}),
    // Clinic readings come only from the physio: they replace this phone's copy; the patient's own home readings stay as they are.
    ...(Array.isArray(raw.clinicReadings) ? { periodic: [...p.periodic.filter((e) => e.where !== 'clinic'), ...raw.clinicReadings.filter(validPeriodic).map((e: PeriodicEntry) => ({ ...cleanPeriodic(e), where: 'clinic' as const }))].sort((a, b) => a.date.localeCompare(b.date)) } : {}),
    ...(() => { const ff = applyForms(p.formRequests, raw.forms); return ff ? { formRequests: ff } : {}; })(),
    // The physio's limits replace this phone's copy (an older physio build sends none: keep what is here). Removing the last one sends an empty object.
    ...(raw.formLimits !== undefined ? { formLimits: cleanLimits(raw.formLimits) } : {}),
  };
}

export const sliceKey = (x: unknown): string => JSON.stringify(x);
