import { describe, it, expect } from 'vitest';
import { makeAllPatients, DEMO_TODAY_LAST } from '../src/demo/seed';
import { getPack } from '../src/engine/packs';
import { addDays } from '../src/engine/dates';
import { newDraft } from '../src/checkin';
import { SESSION_STRINGS } from '../src/session/strings';
import { addSession, answerPain, begin, doRep, encouragement, endRest, exerciseFinished, markStruggling, planSteps, prefillFromSessions, startSession, stopExercise, toSessionLog, todaysResults, undoRep, unitsPerSet, type SState, type Step } from '../src/session/engine';

const patients = makeAllPatients();
const p0 = patients[0];
const pack = getPack(p0.packId);
const today = addDays(DEMO_TODAY_LAST, 1);
const steps: Step[] = [
  { exerciseId: 'a', sets: 2, reps: 3, holdSec: null },
  { exerciseId: 'b', sets: 1, reps: null, holdSec: 5 },
];
const reps = (s: SState, n: number) => { for (let k = 0; k < n; k++) s = doRep(s); return s; };

describe('guided session engine', () => {
  it('plans steps from the patient\'s exercises', () => {
    const st = planSteps(p0, pack);
    expect(st.length > 0).toBe(true);
    for (const s of st) expect(s.sets >= 1).toBe(true);
  });
  it('counts reps, rests between sets, then asks pain', () => {
    let s = begin(startSession(steps, 1000));
    expect(s.phase).toBe('work');
    s = reps(s, 3);
    expect(s.phase).toBe('rest');
    expect(s.logs[0].setsDone).toBe(1);
    s = endRest(s);
    expect(s.set).toBe(2);
    expect(s.rep).toBe(0);
    s = reps(s, 3);
    expect(s.phase).toBe('pain');
    expect(exerciseFinished(s.logs[0])).toBe(true);
    s = answerPain(s, 3);
    expect(s.logs[0].pain).toBe(3);
    expect(s.i).toBe(1);
    expect(s.phase).toBe('ready');
  });
  it('a hold-only exercise is one tap per set', () => {
    expect(unitsPerSet(steps[1])).toBe(1);
  });
  it('undo takes one rep back but never below zero', () => {
    let s = begin(startSession(steps, 0));
    s = undoRep(s);
    expect(s.rep).toBe(0);
    s = undoRep(reps(s, 2));
    expect(s.rep).toBe(1);
    expect(s.logs[0].repsDone).toBe(1);
  });
  it('stopping keeps what was done and records the reason', () => {
    let s = begin(startSession(steps, 0));
    s = stopExercise(reps(s, 2), 'pain');
    expect(s.phase).toBe('pain');
    expect(s.logs[0].stopped).toBe('pain');
    expect(s.logs[0].repsDone).toBe(2);
    expect(exerciseFinished(s.logs[0])).toBe(false);
  });
  it('pain is clamped and can be skipped; the session ends after the last exercise', () => {
    let s = begin(startSession(steps, 0));
    s = answerPain(stopExercise(s, 'tired'), 99);
    expect(s.logs[0].pain).toBe(10);
    s = answerPain(stopExercise(begin(s), 'tired'), null);
    expect(s.logs[1].pain === undefined).toBe(true);
    expect(s.phase).toBe('done');
  });
  it('struggling is flagged on the current exercise only', () => {
    const s = markStruggling(begin(startSession(steps, 0)));
    expect(s.logs[0].struggling).toBe(true);
    expect(s.logs[1].struggling === undefined).toBe(true);
  });
  it('summary leaves out exercises never reached', () => {
    let s = begin(startSession(steps, 5));
    s = stopExercise(reps(s, 1), 'pain');
    const log = toSessionLog(s, today, 99, 'patient');
    expect(log.exercises.length).toBe(1);
    expect(log.via).toBe('app');
  });
  it('keeps the newest sessions and replaces one with the same id', () => {
    let p = p0;
    for (let k = 0; k < 70; k++) p = addSession(p, { id: 's' + k, date: today, startedAt: k, endedAt: k + 1, exercises: [] });
    expect((p.sessions ?? []).length).toBe(60);
    p = addSession(p, { id: 's69', date: today, startedAt: 69, endedAt: 80, exercises: [] });
    expect((p.sessions ?? []).filter((x) => x.id === 's69').length).toBe(1);
  });
  it('pre-fills the check-in only where the patient has not answered', () => {
    const ids = planSteps(p0, pack).map((s) => s.exerciseId);
    const d = newDraft(pack, p0);
    const first = ids.find((id) => id in d.results);
    if (!first) return;
    const p = addSession(p0, { id: 'x', date: today, startedAt: 1, endedAt: 2, exercises: [{ id: first, setsPlanned: 1, setsDone: 1, repsPlanned: null, repsDone: 1 }] });
    expect(todaysResults(p, today)[first].done).toBe(true);
    const filled = prefillFromSessions({ ...d, results: { ...d.results, [first]: { done: null, reason: null } } }, p, today);
    expect(filled.results[first].done).toBe(true);
    const kept = prefillFromSessions({ ...d, results: { ...d.results, [first]: { done: false, reason: 'pain' } } }, p, today);
    expect(kept.results[first].done).toBe(false);
  });
  it('encouragement is deterministic and never says a movement is correct', () => {
    let s = begin(startSession([{ exerciseId: 'a', sets: 1, reps: 6, holdSec: null }], 0));
    const seen: string[] = [];
    for (let k = 0; k < 5; k++) { s = doRep(s); seen.push(encouragement(s, 'en')); }
    expect(seen.join(' ')).toBe(seen.join(' '));
    for (const m of seen) expect(/correct|perfect|right form|good form/i.test(m)).toBe(false);
  });
  it('en, hi and bn have the same keys', () => {
    const keys = Object.keys(SESSION_STRINGS.en).sort().join();
    expect(Object.keys(SESSION_STRINGS.hi).sort().join()).toBe(keys);
    expect(Object.keys(SESSION_STRINGS.bn).sort().join()).toBe(keys);
  });
});

describe('what a guided session saves (physio feedback phase 3)', () => {
  it('"I need help" before any rep is still saved', async () => {
    const { startSession, markStruggling, toSessionLog } = await import('../src/session/engine');
    const s = markStruggling(startSession([{ exerciseId: 'a', sets: 2, reps: 5, holdSec: null }], 0));
    expect(toSessionLog(s, '2026-11-15', 1, 'patient').exercises[0].struggling).toBe(true);
  });
});
