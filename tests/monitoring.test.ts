import { describe, it, expect } from 'vitest';
import { angleAt, photoAngle } from '../src/angle';
import { saveWeekly } from '../src/checkin';
import { evaluateGate } from '../src/engine/gates';
import { triage } from '../src/engine/triage';
import { validatePack } from '../src/engine/validator';
import { collectSignoffs } from '../src/engine/signoff';
import { PACK_LIST, PACKS, getPack } from '../src/engine/packs';
import { blankDraft, buildConditionPack, placeholderAlerts, validateDraft, type ConditionDraft } from '../src/author/condition';
import { buildPatient } from '../src/onboarding';
import { dailyEntry } from '../src/demo/seed';
import { addDays, toMs } from '../src/engine/dates';
import { DICT } from '../src/i18n';
import { aclPack, clone, mk, wk, ids } from './helpers';
import { LIBRARY, unregisterExercise } from '../src/exercises/library';

describe('photo angle (Phase 4.1)', () => {
  it('measures known angles', () => {
    expect(angleAt({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90, 6);
    expect(angleAt({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(180, 6);
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 6);
  });
  it('knee bend is how far a straight leg has been bent; arm raise is the angle at the shoulder', () => {
    // hip above knee, ankle straight below: straight leg = 0 degrees of bend
    expect(photoAngle('deviation', { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 100, y: 400 })).toBe(0);
    // ankle level with the knee: 90 degrees of bend
    expect(photoAngle('deviation', { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 300, y: 200 })).toBe(90);
    // arm hanging beside the trunk = 0, arm out sideways = 90, arm overhead = 180
    expect(photoAngle('between', { x: 100, y: 400 }, { x: 100, y: 200 }, { x: 100, y: 400 })).toBe(0);
    expect(photoAngle('between', { x: 100, y: 400 }, { x: 100, y: 200 }, { x: 300, y: 200 })).toBe(90);
    expect(photoAngle('between', { x: 100, y: 400 }, { x: 100, y: 200 }, { x: 100, y: 0 })).toBe(180);
  });
  it('refuses points on top of each other', () => {
    expect(photoAngle('between', { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 })).toBeNull();
  });
  it('the knee and shoulder packs declare which three points to tap, in both languages', () => {
    for (const [pid, m, kind] of [['acl-reconstruction', 'flexionDeg', 'deviation'], ['total-knee-replacement', 'flexionDeg', 'deviation'], ['rotator-cuff-repair', 'armRaiseDeg', 'between']] as const) {
      const meas = getPack(pid).measures.find((x) => x.id === m)!;
      expect(meas.photoAngle?.reading).toBe(kind);
      expect(meas.photoAngle?.points.every((p) => p.en && p.hi)).toBe(true);
    }
  });
  it('the validator refuses a photo angle on a measure that cannot have one', () => {
    const p = clone(aclPack());
    p.measures.find((m) => m.id === 'pain')!.photoAngle = { reading: 'between', points: [{ en: 'a', hi: 'क' }, { en: 'b', hi: 'ख' }, { en: 'c', hi: 'ग' }] };
    expect(validatePack(p).join()).toMatch(/can only be measured on a photo/);
    const q = clone(aclPack());
    q.measures.find((m) => m.id === 'flexionDeg')!.photoAngle!.points[1].hi = '';
    expect(validatePack(q).join()).toMatch(/three points in en and hi/);
  });
  it('a reading measured on a photo is remembered and shown to the physio', () => {
    const pack = aclPack();
    const p = mk(20, () => ({}));
    const vals = { extensionDeficitCm: 0, flexionDeg: 130, kneeCircumferenceDiffCm: 0, slrLag: false };
    const done = saveWeekly(pack, p, '2026-01-20', vals, {}, { flexionDeg: 'photo', extensionDeficitCm: 'photo' });
    expect(done.periodic[0].methods).toEqual({ flexionDeg: 'photo', extensionDeficitCm: 'photo' });
    const row = evaluateGate(done, pack, '2026-01-20')!.criteria.find((c) => c.measure === 'flexionDeg')!;
    expect(row.actual).toContain('(measured on photo)');
    const typed = saveWeekly(pack, p, '2026-01-20', vals);
    expect(typed.periodic[0].methods).toBeUndefined();
    expect(evaluateGate(typed, pack, '2026-01-20')!.criteria.find((c) => c.measure === 'flexionDeg')!.actual).not.toContain('photo');
  });
  it('every new patient-facing string exists in English and Hindi', () => {
    for (const k of Object.keys(DICT.en).filter((x) => x.startsWith('angle'))) expect(DICT.hi[k]).toBeTruthy();
  });
});

describe('silence rule (Phase 4.3)', () => {
  const NOW = (day: number) => toMs(addDays('2026-01-01', day)) + 9 * 3_600_000;
  it('every shipped pack has it, with a placeholder tagged for sign-off', () => {
    for (const p of PACK_LIST) {
      const r = p.rules.find((x) => x.type === 'silence');
      expect(r).toBeTruthy();
      expect((r as any).hoursSource).toContain('NEEDS_PHYSIO_SIGNOFF');
    }
  });
  it('says how many days, in both languages, and not before the time is up', () => {
    const pack = aclPack();
    const p = mk(10);
    expect(ids(triage(p, pack, { nowMs: NOW(11) }))).not.toContain('S1'); // checked in yesterday
    const r = triage(p, pack, { nowMs: NOW(14) });
    const t = r.triggers.find((x) => x.ruleId === 'S1')!;
    expect(t.label.en).toBe('No check-in for 3 days');
    expect(t.label.hi).toBe('3 दिन से कोई चेक-इन नहीं');
    expect(t.tier).toBe('REVIEW');
    expect(r.tier).toBe('REVIEW');
  });
});

describe('questionnaires (Phase 4.2)', () => {
  const NOW = toMs('2026-11-15') + 9 * 3_600_000;
  const qdraft = (id: string): ConditionDraft => ({
    ...blankDraft(id), condition: { en: 'Test', hi: 'परीक्षण' },
    phases: [{ name: { en: 'P1', hi: 'च1' }, exercises: ['ankle-pumps'], sessionsPerDay: 2, followUpEveryDays: 7, weeksMin: 0, weeksMax: null }],
    alerts: placeholderAlerts(),
    questionnaire: { title: { en: 'My score', hi: 'मेरा स्कोर' }, intro: { en: 'Answer each', hi: 'हर एक का उत्तर दें' }, items: [{ en: 'Q one', hi: 'प्रश्न एक' }, { en: 'Q two', hi: 'प्रश्न दो' }], options: [{ value: 0, label: { en: 'No', hi: 'नहीं' } }, { value: 1, label: { en: 'Yes', hi: 'हाँ' } }, { value: 2, label: { en: 'Very', hi: 'बहुत' } }], credit: 'Written by the treating physio for this clinic.', permission: true, alert: { operator: '>=', value: 3 } },
  });
  it('TSK-11 names its authors and shows that permission is still to be confirmed', () => {
    const q = aclPack().questionnaires[0];
    expect(q.credit).toContain('Woby');
    expect(q.licenceConfirmed).toBe(false);
    const item = collectSignoffs(aclPack()).find((x) => x.where.includes('tsk11 permission to use'))!;
    expect(item.needsSignoff).toBe(true);
  });
  it('a questionnaire with no credit line is refused', () => {
    const p = clone(aclPack());
    p.questionnaires[0].credit = '';
    expect(validatePack(p).join()).toMatch(/needs a credit line/);
  });
  it('a physio-supplied questionnaire builds, is scored by summing, and its alert fires', () => {
    const d = qdraft('custom-q1');
    expect(validateDraft(d)).toEqual([]);
    const pack = buildConditionPack(d);
    expect(pack.questionnaires[0]).toMatchObject({ measure: 'qscore', scoring: 'sum', credit: 'Written by the treating physio for this clinic.', licenceConfirmed: true });
    const base = buildPatient({ name: 'T', age: 40, language: 'en', packId: pack.id, anchorDate: '2026-11-01', phaseId: 'p1', exercises: ['ankle-pumps'], checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: NOW, today: '2026-11-15', id: 'q' });
    const withDays = { ...base, daily: Array.from({ length: 3 }, (_, i) => dailyEntry(pack, { date: addDays('2026-11-14', i - 2), pain: 2, swelling: 'less', ex: 'all', per: 2, hard: 'none' })) };
    const low = { ...withDays, periodic: [wk(0, {})].map(() => ({ date: '2026-11-14', values: { qscore: 2 } })) };
    const high = { ...withDays, periodic: [{ date: '2026-11-14', values: { qscore: 4 } }] };
    expect(ids(triage(low, pack, { nowMs: NOW }))).not.toContain('Q1');
    expect(ids(triage(high, pack, { nowMs: NOW }))).toContain('Q1');
    delete PACKS['custom-q1'];
  });
  it('is refused without permission, credit, or Hindi', () => {
    const d = qdraft('custom-q2');
    d.questionnaire!.permission = false; d.questionnaire!.credit = ' '; d.questionnaire!.items[1].hi = ''; d.questionnaire!.options = [d.questionnaire!.options[0]];
    const e = validateDraft(d).join(' | ');
    expect(e).toMatch(/tick that you have permission/);
    expect(e).toMatch(/credit line/);
    expect(e).toMatch(/question 2: write it in English and Hindi/);
    expect(e).toMatch(/at least two answer options/);
    expect(() => buildConditionPack(d)).toThrow();
  });
  it('the app does not bundle licensed questionnaires', () => {
    for (const p of PACK_LIST) for (const q of p.questionnaires) expect(q.id).not.toMatch(/oxford|oks|oss/i);
  });
  it('cleanup', () => { for (const e of [...LIBRARY]) if (e.id.startsWith('custom-')) unregisterExercise(e.id); });
});
