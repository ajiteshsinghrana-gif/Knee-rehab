/**
 * Pure check-in logic, generated from the patient's pack (Phase 1.4). No React here so it is unit-tested.
 */
import type { AnsweredBy, DailyCheckIn, Exercises, Patient, ProtocolPack, Value } from './types';
import type { VoiceResult } from './voice/parser';
import { currentExercises } from './engine/plan';

export interface Draft {
  values: Record<string, Value | null>;
  /** Per prescribed exercise: done / couldn't, and why (Phase 2.2). */
  results: Record<string, { done: boolean | null; reason: string | null }>;
  exercises: Exercises | null;
  skipReason: string | null;
  hardMovement: string | null;
  /** Tapped answers only. Voice never writes here (Phase 0.2). */
  warnings: Record<string, boolean | null>;
  /** What voice heard, shown as a suggestion until the patient taps. */
  suggested: Record<string, boolean>;
  precautionBreaches: Record<string, boolean | null>;
  heard?: string;
}

/** "I did them all": every prescribed exercise done. Individual answers can still be changed afterwards. */
export const markAllExercisesDone = (d: Draft): Draft => ({ ...d, results: Object.fromEntries(Object.keys(d.results).map((id) => [id, { done: true, reason: null }])) });
export const allExercisesDone = (d: Draft): boolean => { const ids = Object.keys(d.results); return ids.length > 0 && ids.every((id) => d.results[id].done === true); };

/**
 * "None of these" on the warning signs: answers "no" for every sign still unanswered.
 * Safety first: a sign the patient already tapped "yes" is never changed (and the shortcut is not offered then), and a sign that voice
 * heard as a possible "yes" stays unanswered, so the patient has to confirm that one by tapping it.
 */
export const canMarkNoWarnings = (d: Draft): boolean => Object.values(d.warnings).every((v) => v !== true);
export const markNoWarnings = (d: Draft): Draft => canMarkNoWarnings(d)
  ? { ...d, warnings: Object.fromEntries(Object.entries(d.warnings).map(([id, v]) => [id, v === null && d.suggested[id] !== true ? false : v])) }
  : d;
export const noWarningsAnswered = (d: Draft): boolean => { const v = Object.values(d.warnings); return v.length > 0 && v.every((x) => x === false); };

export const activePrecautions = (pack: ProtocolPack, p: Patient) => pack.precautions.filter((x) => x.phases.includes(p.currentPhase));

export function newDraft(pack: ProtocolPack, p: Patient): Draft {
  return {
    values: Object.fromEntries(pack.checkIn.dailyMeasures.map((id) => [id, null])),
    results: Object.fromEntries(currentExercises(p, pack).map((id) => [id, { done: null, reason: null }])),
    exercises: null,
    skipReason: null,
    hardMovement: null,
    warnings: Object.fromEntries(pack.warningSigns.map((s) => [s.id, null])),
    suggested: {},
    precautionBreaches: Object.fromEntries(activePrecautions(pack, p).map((x) => [x.id, null])),
  };
}

export function draftFromEntry(pack: ProtocolPack, p: Patient, e: DailyCheckIn): Draft {
  const d = newDraft(pack, p);
  for (const id of pack.checkIn.dailyMeasures) d.values[id] = e.values[id] ?? null;
  d.exercises = e.exercises;
  d.skipReason = e.skipReason ?? null;
  if (e.exerciseResults) for (const r of e.exerciseResults) d.results[r.id] = { done: r.done, reason: r.reason ?? null };
  else {
    // Older entries only recorded all / some / none for the day.
    const ids = Object.keys(d.results);
    const doneCount = e.exercises === 'all' ? ids.length : e.exercises === 'none' ? 0 : Math.ceil(ids.length / 2);
    ids.forEach((id, i) => (d.results[id] = i < doneCount ? { done: true, reason: null } : { done: false, reason: e.skipReason ?? 'time' }));
  }
  d.hardMovement = e.hardMovement;
  for (const s of pack.warningSigns) d.warnings[s.id] = e.warnings[s.id] ?? null;
  for (const k of Object.keys(d.precautionBreaches)) d.precautionBreaches[k] = e.precautionBreaches?.[k] ?? null;
  return d;
}

/**
 * Voice pre-fills measures, exercises and hardest movement, and only SUGGESTS warning-sign answers.
 * The patient must tap every sign (see isComplete).
 */
export function applyVoice(d: Draft, v: VoiceResult, pack: ProtocolPack, heard: string): Draft {
  const out: Draft = { ...d, results: { ...d.results }, values: { ...d.values }, warnings: { ...d.warnings }, suggested: {}, precautionBreaches: { ...d.precautionBreaches }, heard };
  if (v.pain !== undefined && 'pain' in out.values) out.values.pain = v.pain;
  if (v.swelling !== undefined && 'swelling' in out.values) out.values.swelling = v.swelling;
  if (v.exercises) {
    out.exercises = v.exercises;
    // Voice can say "all done" for the whole list; "none" still needs a tapped reason for each.
    if (v.exercises === 'all') for (const id of Object.keys(out.results)) out.results[id] = { done: true, reason: null };
    if (v.exercises === 'none') for (const id of Object.keys(out.results)) out.results[id] = { done: false, reason: null };
  }
  if (v.hardMovement) out.hardMovement = v.hardMovement;
  for (const s of pack.warningSigns) if (v.warnings[s.id] !== undefined) out.suggested[s.id] = v.warnings[s.id];
  // Voice never confirms a sign: any previously tapped answer is cleared so the patient re-confirms.
  for (const s of pack.warningSigns) out.warnings[s.id] = null;
  return out;
}

export const unansweredSigns = (d: Draft): string[] => Object.entries(d.warnings).filter(([, v]) => v === null).map(([k]) => k);

export function isComplete(d: Draft): boolean {
  if (Object.values(d.values).some((v) => v === null)) return false;
  if (d.hardMovement === null) return false;
  if (Object.keys(d.results).length) {
    for (const r of Object.values(d.results)) if (r.done === null || (r.done === false && r.reason === null)) return false;
  } else {
    if (d.exercises === null) return false;
    if (d.exercises !== 'all' && d.skipReason === null) return false;
  }
  if (unansweredSigns(d).length) return false;
  if (Object.values(d.precautionBreaches).some((v) => v === null)) return false;
  return true;
}

export function toDaily(d: Draft, p: Patient, date: string, opts: { answeredBy?: 'patient' | 'caregiver'; recordedAt?: number } = {}): DailyCheckIn {
  if (!isComplete(d)) throw new Error('Check-in incomplete');
  const per = p.sessionsPrescribedPerDay;
  const rs = Object.entries(d.results);
  const ex: Exercises = rs.length ? (rs.every(([, r]) => r.done) ? 'all' : rs.every(([, r]) => !r.done) ? 'none' : 'some') : d.exercises!;
  const firstReason = rs.find(([, r]) => r.done === false)?.[1].reason ?? d.skipReason;
  return {
    date,
    values: Object.fromEntries(Object.entries(d.values).map(([k, v]) => [k, v as Value])),
    exercises: ex,
    sessionsPrescribed: per,
    sessionsDone: ex === 'all' ? per : ex === 'some' ? Math.min(per, Math.max(1, per - 1)) : 0,
    ...(ex !== 'all' && firstReason ? { skipReason: firstReason } : {}),
    ...(rs.length ? { exerciseResults: rs.map(([id, r]) => ({ id, done: r.done === true, ...(r.done === false && r.reason ? { reason: r.reason } : {}) })) } : {}),
    hardMovement: d.hardMovement!,
    warnings: Object.fromEntries(Object.entries(d.warnings).map(([k, v]) => [k, v === true])),
    ...(Object.keys(d.precautionBreaches).length ? { precautionBreaches: Object.fromEntries(Object.entries(d.precautionBreaches).map(([k, v]) => [k, v === true])) } : {}),
    answeredBy: opts.answeredBy ?? 'patient',
    ...(opts.recordedAt !== undefined ? { recordedAt: opts.recordedAt } : {}),
  };
}

export function saveCheckIn(p: Patient, e: DailyCheckIn): Patient {
  return { ...p, daily: [...p.daily.filter((x) => x.date !== e.date), e].sort((a, b) => a.date.localeCompare(b.date)) };
}

// ---------------- weekly self-test, generated from measures ----------------
export const weeklyMeasures = (pack: ProtocolPack, p: Patient) => {
  const order = pack.phases.find((x) => x.id === p.currentPhase)?.order ?? 1;
  return pack.measures.filter((m) => m.frequency === 'weekly' && !m.setBy && !m.derived && !m.pairOf && (m.fromPhaseOrder ?? 1) <= order);
};

export function weeklyComplete(pack: ProtocolPack, p: Patient, vals: Record<string, Value | null>): boolean {
  for (const m of weeklyMeasures(pack, p)) {
    if (vals[m.id] === null || vals[m.id] === undefined) return false;
    const partner = pack.measures.find((x) => x.pairOf === m.id);
    if (partner && (vals[partner.id] === null || vals[partner.id] === undefined || Number(vals[partner.id]) <= 0)) return false;
  }
  return true;
}

/** Adds derived limb-symmetry values. */
export function withDerived(pack: ProtocolPack, vals: Record<string, Value>): Record<string, Value> {
  const out = { ...vals };
  for (const m of pack.measures) {
    if (!m.derived) continue;
    const a = Number(out[m.derived.operated]), b = Number(out[m.derived.other]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) out[m.id] = Math.round((a / b) * 100);
  }
  return out;
}

export function saveWeekly(pack: ProtocolPack, p: Patient, date: string, vals: Record<string, Value | null>, photos: Record<string, string> = {}, methods: Record<string, 'photo'> = {}, answeredBy: AnsweredBy = 'patient'): Patient {
  if (!weeklyComplete(pack, p, vals)) throw new Error('Weekly test incomplete');
  const clean = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== null && v !== undefined)) as Record<string, Value>;
  // a method is only kept for a number that was actually saved
  const kept = Object.fromEntries(Object.entries(methods).filter(([k]) => clean[k] !== undefined));
  const entry = { date, values: withDerived(pack, clean), ...(Object.keys(photos).length ? { photos } : {}), ...(Object.keys(kept).length ? { methods: kept } : {}), ...(answeredBy === 'caregiver' ? { answeredBy } : {}) };
  return { ...p, periodic: [...p.periodic.filter((x) => !(x.date === date && x.values.tsk11 === undefined)), entry].sort((a, b) => a.date.localeCompare(b.date)) };
}

export function saveQuestionnaire(pack: ProtocolPack, p: Patient, qid: string, date: string, answers: (number | null)[], answeredBy: AnsweredBy = 'patient'): Patient {
  const q = pack.questionnaires.find((x) => x.id === qid);
  if (!q || answers.length !== q.items.length || answers.some((a) => a === null)) throw new Error('Questionnaire incomplete');
  const total = (answers as number[]).reduce((a, b) => a + b, 0);
  return { ...p, periodic: [...p.periodic.filter((x) => !(x.date === date && x.values[q.measure] !== undefined)), { date, values: { [q.measure]: total }, ...(answeredBy === 'caregiver' ? { answeredBy } : {}) }].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Due state for the weekly self-test and each questionnaire. */
export function dueState(pack: ProtocolPack, p: Patient, today: string, daysBetween: (a: string, b: string) => number) {
  const weeklyIds = new Set(weeklyMeasures(pack, p).map((m) => m.id));
  const lastWeekly = [...p.periodic].reverse().find((e) => Object.keys(e.values).some((k) => weeklyIds.has(k)));
  const weeklyDaysAgo = lastWeekly ? daysBetween(today, lastWeekly.date) : Infinity;
  const q = pack.questionnaires[0];
  const lastQ = q ? [...p.periodic].reverse().find((e) => e.values[q.measure] !== undefined) : undefined;
  const qDaysAgo = lastQ ? daysBetween(today, lastQ.date) : Infinity;
  return {
    weeklyDue: weeklyIds.size > 0 && weeklyDaysAgo >= 7,
    weeklyNextIn: weeklyDaysAgo === Infinity ? 0 : Math.max(0, 7 - weeklyDaysAgo),
    questionnaireDue: !!q && qDaysAgo >= 30,
    questionnaireNextIn: qDaysAgo === Infinity ? 0 : Math.max(0, 30 - qDaysAgo),
  };
}
