/**
 * The guided session as pure logic (no timers, no network, no AI). The screen supplies the clock and the buttons.
 *
 * It reads the same exercise list the patient sees at home (currentExercises) and each exercise's dose from the library.
 * It counts what the patient taps and records it. It never decides that a movement is right or wrong and never changes a plan:
 * triage still comes only from the protocol rules. What the session records can pre-fill today's check-in.
 */
import type { AnsweredBy, Lang, Patient, ProtocolPack, SessionExerciseLog, SessionLog } from '../types';
import { currentExercises } from '../engine/plan';
import { getExercise } from '../exercises/library';
import { SESSION_CONFIG } from './config';
import { ss } from './strings';
import type { Draft } from '../checkin';

export interface Step { exerciseId: string; sets: number; /** reps per set; null for a hold-only or "as shown" exercise */ reps: number | null; holdSec: number | null }
export type SPhase = 'ready' | 'work' | 'rest' | 'pain' | 'done';
export interface SState {
  steps: Step[];
  i: number;
  /** 1-based set in progress */
  set: number;
  /** reps counted in the current set */
  rep: number;
  phase: SPhase;
  logs: SessionExerciseLog[];
  startedAt: number;
}

/** The exercises for today, with their dose from the library. A missing dose means one set, counted by one tap. */
export function planSteps(patient: Patient, pack: ProtocolPack): Step[] {
  return currentExercises(patient, pack).map((id) => {
    // The physio's own dose for this patient wins over the library dose (fix phase 3).
    const own = patient.plan.doses?.[id];
    const d = own ?? getExercise(id)?.dose;
    return { exerciseId: id, sets: Math.max(1, d?.sets ?? 1), reps: d?.reps ?? null, holdSec: d?.holdSec ?? null };
  });
}
/** Taps needed to finish one set. */
export const unitsPerSet = (s: Step): number => s.reps ?? 1;

const logFor = (s: Step): SessionExerciseLog => ({ id: s.exerciseId, setsPlanned: s.sets, setsDone: 0, repsPlanned: s.reps, repsDone: 0 });

export function startSession(steps: Step[], nowMs: number): SState {
  return { steps, i: 0, set: 1, rep: 0, phase: steps.length ? 'ready' : 'done', logs: steps.map(logFor), startedAt: nowMs };
}
const upd = (s: SState, f: (l: SessionExerciseLog) => SessionExerciseLog): SessionExerciseLog[] => s.logs.map((l, k) => (k === s.i ? f(l) : l));

export const begin = (s: SState): SState => (s.phase === 'ready' ? { ...s, phase: 'work', set: 1, rep: 0 } : s);

/** One rep (or one hold, or one "done") counted. Finishing the last rep of a set ends the set. */
export function doRep(s: SState): SState {
  if (s.phase !== 'work') return s;
  const step = s.steps[s.i];
  const rep = s.rep + 1;
  let logs = upd(s, (l) => ({ ...l, repsDone: l.repsDone + 1 }));
  if (rep < unitsPerSet(step)) return { ...s, rep, logs };
  logs = logs.map((l, k) => (k === s.i ? { ...l, setsDone: l.setsDone + 1 } : l));
  return s.set >= step.sets ? { ...s, rep, logs, phase: 'pain' } : { ...s, rep, logs, phase: 'rest' };
}
export function undoRep(s: SState): SState {
  if (s.phase !== 'work' || s.rep <= 0) return s;
  return { ...s, rep: s.rep - 1, logs: upd(s, (l) => ({ ...l, repsDone: Math.max(0, l.repsDone - 1) })) };
}
/** Rest over (or skipped): the next set starts. */
export const endRest = (s: SState): SState => (s.phase === 'rest' ? { ...s, phase: 'work', set: s.set + 1, rep: 0 } : s);

/** Stop an exercise part-way (pain, fear...) or skip it. What was done so far is kept. */
export function stopExercise(s: SState, reason: string): SState {
  if (s.phase === 'done' || s.phase === 'pain') return s;
  return { ...s, phase: 'pain', logs: upd(s, (l) => ({ ...l, stopped: reason })) };
}
export const markStruggling = (s: SState): SState => (s.phase === 'done' ? s : { ...s, logs: upd(s, (l) => ({ ...l, struggling: true })) });

/** After an exercise: record pain (or null to skip) and move on. */
export function answerPain(s: SState, pain: number | null): SState {
  if (s.phase !== 'pain') return s;
  const logs = upd(s, (l) => (pain === null ? l : { ...l, pain: Math.max(0, Math.min(10, Math.round(pain))) }));
  const i = s.i + 1;
  return i >= s.steps.length ? { ...s, logs, phase: 'done' } : { ...s, logs, i, set: 1, rep: 0, phase: 'ready' };
}
/** For chat sessions: the patient says the whole exercise is done. */
export function completeExercise(s: SState): SState {
  if (s.phase === 'done' || s.phase === 'pain') return s;
  const st = s.steps[s.i];
  return { ...s, phase: 'pain', logs: upd(s, (l) => ({ ...l, setsDone: st.sets, repsDone: st.sets * unitsPerSet(st) })) };
}

export const exerciseFinished = (l: SessionExerciseLog): boolean => !l.stopped && l.setsDone >= l.setsPlanned;

/** The record kept on the patient. Exercises not reached are left out. */
export function toSessionLog(s: SState, date: string, endedAt: number, by: AnsweredBy, via: 'app' | 'whatsapp' = 'app'): SessionLog {
  const reached = s.logs.filter((l, k) => k < s.i || (k === s.i && (l.repsDone > 0 || l.stopped || s.phase === 'done')) || (s.phase === 'done'));
  return { id: `s${s.startedAt.toString(36)}`, date, startedAt: s.startedAt, endedAt, exercises: reached.map((l) => ({ ...l })), answeredBy: by, via };
}

/** Append a session, keeping the newest ones. */
export function addSession(p: Patient, log: SessionLog): Patient {
  const rest = (p.sessions ?? []).filter((x) => x.id !== log.id);
  return { ...p, sessions: [...rest, log].sort((a, b) => a.startedAt - b.startedAt).slice(-SESSION_CONFIG.keepSessions) };
}

/** What today's sessions say about each exercise (the latest session wins). Used to pre-fill the check-in. */
export function todaysResults(p: Patient, date: string): Record<string, { done: boolean; reason: string | null }> {
  const out: Record<string, { done: boolean; reason: string | null }> = {};
  for (const sess of (p.sessions ?? []).filter((x) => x.date === date)) {
    for (const l of sess.exercises) out[l.id] = { done: exerciseFinished(l), reason: l.stopped ?? null };
  }
  return out;
}
/** Fills the check-in's exercise answers from today's sessions, only where the patient has not answered yet. */
export function prefillFromSessions(d: Draft, p: Patient, date: string): Draft {
  const t = todaysResults(p, date);
  const results = { ...d.results };
  let changed = false;
  for (const id of Object.keys(results)) {
    if (results[id].done === null && t[id]) { results[id] = { done: t[id].done, reason: t[id].done ? null : t[id].reason }; changed = true; }
  }
  return changed ? { ...d, results } : d;
}

/** Plain-text line for a step (for the screen and for chat). */
export function doseText(st: Step, lang: Lang): string {
  if (st.reps !== null && st.holdSec !== null) return ss(lang, 'sDoseHold', { sets: st.sets, reps: st.reps, sec: st.holdSec });
  if (st.reps !== null) return ss(lang, 'sDose', { sets: st.sets, reps: st.reps });
  if (st.holdSec !== null) return ss(lang, 'sDoseHoldOnly', { sets: st.sets, sec: st.holdSec });
  return ss(lang, 'sDoseSetsOnly', { sets: st.sets });
}

/** A short, general encouragement for the moment. Deterministic so it can be tested. It never judges the movement. */
export function encouragement(s: SState, lang: Lang): string {
  switch (s.phase) {
    case 'ready': return s.i === 0 ? ss(lang, 'eStart') : '';
    case 'rest': return ss(lang, 'eRest');
    case 'pain': return ss(lang, 'eExDone');
    case 'done': return ss(lang, 'eAll');
    case 'work': {
      const st = s.steps[s.i];
      const n = unitsPerSet(st);
      if (s.rep === 0) return '';
      if (s.rep === n - 1 && n > 1) return ss(lang, 'eLast');
      if (n >= 4 && s.rep === Math.floor(n / 2)) return ss(lang, 'eHalf');
      return ss(lang, s.rep % 2 ? 'eGood1' : 'eGood2');
    }
  }
}
