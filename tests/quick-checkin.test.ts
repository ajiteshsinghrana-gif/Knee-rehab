import { describe, it, expect } from 'vitest';
import { allExercisesDone, canMarkNoWarnings, isComplete, toDaily, markAllExercisesDone, markNoWarnings, newDraft, noWarningsAnswered, unansweredSigns, saveCheckIn, applyVoice } from '../src/checkin';
import { parseVoice } from '../src/voice/parser';
import { getPack } from '../src/engine/packs';
import { makeAllPatients } from '../src/demo/seed';
import { currentExercises } from '../src/engine/plan';
import { DICT } from '../src/i18n';

const ravi = makeAllPatients().find((p) => p.id === 'ravi')!;
const pack = getPack('acl-reconstruction');

describe('"I did them all" (Phase 7.4)', () => {
  it('marks every prescribed exercise done in one go, and each can still be changed afterwards', () => {
    const d = newDraft(pack, ravi);
    expect(Object.keys(d.results).length).toBeGreaterThan(1);
    expect(allExercisesDone(d)).toBe(false);
    const all = markAllExercisesDone(d);
    expect(Object.values(all.results).every((r) => r.done === true && r.reason === null)).toBe(true);
    expect(allExercisesDone(all)).toBe(true);
    const id = Object.keys(all.results)[0];
    const changed = { ...all, results: { ...all.results, [id]: { done: false, reason: 'pain' } } };
    expect(allExercisesDone(changed)).toBe(false);
  });
  it('replaces earlier "could not do" answers and their reasons, and leaves the original draft untouched', () => {
    const d = newDraft(pack, ravi);
    const id = Object.keys(d.results)[0];
    d.results[id] = { done: false, reason: 'fear' };
    const all = markAllExercisesDone(d);
    expect(all.results[id]).toEqual({ done: true, reason: null });
    expect(d.results[id]).toEqual({ done: false, reason: 'fear' });
  });
});

describe('"None of these" on the warning signs (Phase 7.4)', () => {
  it('answers every unanswered sign "no", which lets the check-in finish', () => {
    const d = newDraft(pack, ravi);
    expect(unansweredSigns(d).length).toBeGreaterThan(0);
    expect(noWarningsAnswered(d)).toBe(false);
    const none = markNoWarnings(d);
    expect(unansweredSigns(none)).toEqual([]);
    expect(Object.values(none.warnings).every((v) => v === false)).toBe(true);
    expect(noWarningsAnswered(none)).toBe(true);
  });
  it('is not offered once the patient has tapped "yes" on a sign, and never overwrites that yes', () => {
    const d = newDraft(pack, ravi);
    const [first, second] = Object.keys(d.warnings);
    d.warnings[first] = true;
    expect(canMarkNoWarnings(d)).toBe(false);
    expect(markNoWarnings(d)).toBe(d);
    expect(markNoWarnings(d).warnings[first]).toBe(true);
    expect(markNoWarnings(d).warnings[second]).toBe(null);
  });
  it('a sign voice heard as a possible "yes" stays unanswered, so the patient must confirm it by tapping', () => {
    const v = parseVoice('pain 4, swelling same, fever yes', pack, currentExercises(ravi, pack));
    let d = applyVoice(newDraft(pack, ravi), v, pack, 'x');
    expect(d.suggested.fever).toBe(true);
    d = markNoWarnings(d);
    expect(d.warnings.fever).toBe(null);
    expect(unansweredSigns(d)).toContain('fever');
    expect(Object.entries(d.warnings).filter(([k]) => k !== 'fever').every(([, v2]) => v2 === false)).toBe(true);
  });
  it('keeps signs the patient already answered "no" and does not change the draft it was given', () => {
    const d = newDraft(pack, ravi);
    const [first] = Object.keys(d.warnings);
    d.warnings[first] = false;
    const none = markNoWarnings(d);
    expect(none.warnings[first]).toBe(false);
    expect(Object.values(d.warnings).filter((v) => v === null).length).toBeGreaterThan(0); // original still has unanswered signs
  });
  it('a check-in finished with both shortcuts is complete and saves as all exercises done, no warning signs', () => {
    let d = newDraft(pack, ravi);
    for (const k of Object.keys(d.values)) d.values[k] = 2 as never;
    d.hardMovement = 'none' as never;
    for (const k of Object.keys(d.precautionBreaches)) d.precautionBreaches[k] = false;
    expect(isComplete(d)).toBe(false);
    d = markNoWarnings(markAllExercisesDone(d));
    if (!Object.keys(d.results).length) { d.exercises = 'all'; }
    expect(isComplete(d)).toBe(true);
    const e = toDaily(d, ravi, '2026-11-20');
    expect(e.exercises).toBe('all');
    expect(Object.values(e.warnings).every((v) => v === false)).toBe(true);
    expect(saveCheckIn(ravi, e).daily.some((x) => x.date === '2026-11-20')).toBe(true);
  });
});

describe('shortcut wording (Phase 7.4)', () => {
  it('exists in English, Hindi and Bengali', () => {
    for (const k of ['exAllDone', 'noneOfThese']) for (const l of ['en', 'hi', 'bn'] as const) expect(!!DICT[l][k]).toBe(true);
  });
});
