import { describe, it, expect } from 'vitest';
import { applyAction, currentExercises, currentFollowUp, pendingProposal } from '../src/engine/plan';
import { effectivePack, listOverridable } from '../src/engine/overrides';
import { evaluateGate } from '../src/engine/gates';
import { suggestedActions } from '../src/engine/actions';
import { triage } from '../src/engine/triage';
import { validateLibrary } from '../src/engine/validator';
import { LIBRARY, getExercise } from '../src/exercises/library';
import { PACK_LIST } from '../src/engine/packs';
import { readFileSync } from 'node:fs';
import { collectLibrarySignoffs } from '../src/engine/signoff';
import { noticeText } from '../src/notices';
import { DICT } from '../src/i18n';
import { aclPack, clone, ANCHOR, mk, wk, ids } from './helpers';
import { addDays } from '../src/engine/dates';
import { makeAllPatients } from '../src/demo/seed';
import { toMs } from '../src/engine/dates';

const pack = aclPack();
const NOW = toMs('2026-02-01') + 9 * 3_600_000;
const ctx = { nowMs: NOW, today: '2026-02-01' };
const p2 = () => mk(30, () => ({}), { phase: 'p2', phaseStart: 20 });

describe('exercise library (Phase 2.1)', () => {
  it('is valid against every pack', () => expect(validateLibrary(LIBRARY, PACK_LIST)).toEqual([]));
  it('every exercise has en and hi names, a picture, a dose and a source tag', () => {
    for (const e of LIBRARY) {
      expect(e.name.en && e.name.hi && e.picture && e.dose.text.en && e.dose.text.hi && e.dose.source).toBeTruthy();
    }
  });
  it('catches a missing regression, a loop, and a wrong usedIn', () => {
    const bad = clone(LIBRARY);
    bad.find((e) => e.id === 'lunges')!.regressionId = 'nope';
    expect(validateLibrary(bad, PACK_LIST).join()).toMatch(/does not exist/);
    const loop = clone(LIBRARY);
    loop.find((e) => e.id === 'mini-squats')!.regressionId = 'squats';
    expect(validateLibrary(loop, PACK_LIST).join()).toMatch(/loop/);
    const wrong = clone(LIBRARY);
    wrong.find((e) => e.id === 'quad-set')!.usedIn = { 'acl-reconstruction': ['p3'] };
    expect(validateLibrary(wrong, PACK_LIST).length).toBeGreaterThan(0);
  });
});

describe('approving an action changes the plan (Phase 2.4)', () => {
  it('regress swaps the exercise for its easier version, logs who/when/what/note, and tells the patient', () => {
    const p = p2();
    expect(currentExercises(p, pack)).toContain('squats');
    const out = applyAction(p, pack, { type: 'regress-exercise', exerciseId: 'squats', note: 'knee pain on squat' }, ctx);
    expect(currentExercises(out, pack)).not.toContain('squats');
    expect(currentExercises(out, pack)).toContain('mini-squats');
    expect(out.audit).toHaveLength(1);
    expect(out.audit[0]).toMatchObject({ who: 'Demo physio', at: new Date(NOW).toISOString(), note: 'knee pain on squat', before: { exercise: 'squats' }, after: { exercise: 'mini-squats' } });
    expect(out.notices).toHaveLength(1);
    expect(p.audit).toHaveLength(0); // input is not mutated
  });
  it('cannot regress an exercise with no easier version, or one not in the plan', () => {
    expect(() => applyAction(p2(), pack, { type: 'regress-exercise', exerciseId: 'walking' }, ctx)).toThrow(/easier/);
    expect(() => applyAction(p2(), pack, { type: 'regress-exercise', exerciseId: 'quad-set' }, ctx)).toThrow(/not in the current plan/);
  });
  it('a swap can be restored', () => {
    const a = applyAction(p2(), pack, { type: 'regress-exercise', exerciseId: 'lunges' }, ctx);
    const b = applyAction(a, pack, { type: 'restore-exercise', exerciseId: 'mini-squats' }, ctx);
    expect(currentExercises(b, pack)).toContain('lunges');
    expect(b.audit).toHaveLength(2);
  });
  it('hold blocks phase sign-off until it is removed', () => {
    const p = mk(30, () => ({}), { periodic: [wk(20, { extensionDeficitCm: 0, kneeCircumferenceDiffCm: 0.5, slrLag: false, flexionDeg: 130 })] });
    const asOf = addDays(ANCHOR, 30);
    expect(evaluateGate(p, pack, asOf)?.canSignOff).toBe(true);
    const held = applyAction(p, pack, { type: 'hold-progression', note: 'swelling' }, ctx);
    const g = evaluateGate(held, pack, asOf)!;
    expect(g.allMet).toBe(true);
    expect(g.held).toBe(true);
    expect(g.canSignOff).toBe(false);
    expect(() => applyAction(held, pack, { type: 'sign-off-phase' }, ctx)).toThrow(/hold/);
    const released = applyAction(held, pack, { type: 'release-hold' }, ctx);
    const signed = applyAction(released, pack, { type: 'sign-off-phase' }, { ...ctx, today: asOf });
    expect(signed.currentPhase).toBe('p2');
    expect(signed.audit.map((a) => a.action)).toEqual(['hold-progression', 'release-hold', 'sign-off-phase']);
  });
  it('change follow-up updates check-in frequency and next review date', () => {
    const out = applyAction(p2(), pack, { type: 'change-follow-up', checkInEveryDays: 1, nextReviewDate: '2026-02-03' }, ctx);
    expect(currentFollowUp(out, pack, '2026-02-01')).toMatchObject({ checkInEveryDays: 1, nextReviewDate: '2026-02-03' });
    expect(out.notices[0].changes[0]).toMatchObject({ kind: 'followUp', nextReviewDate: '2026-02-03' });
  });
  it('triage and suggested actions never change the plan (safety rule 2)', () => {
    const p = mk(10, (d) => ({ pain: 2 + (d > 7 ? d - 7 : 0), warnings: d === 10 ? { fever: true } : {} }));
    const before = JSON.stringify(p);
    triage(p, pack, { nowMs: NOW });
    suggestedActions(triage(p, pack).triggers, pack, p, addDays(ANCHOR, 10));
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('follow-up proposal for a combination URGENT (Phase 2.5)', () => {
  const ravi = () => makeAllPatients().find((x) => x.id === 'ravi')!;
  const urgent = () => {
    const base = ravi();
    const last = base.daily[base.daily.length - 1].date;
    const rp = { ...base, daily: base.daily.map((e, i, a) => (i >= a.length - 3 ? { ...e, values: { ...e.values, pain: 4 + (i - (a.length - 3)) }, exercises: 'none' as const, skipReason: 'pain', hardMovement: 'squats' } : e)) };
    return { p: rp, last };
  };
  it('is proposed only when URGENT came from a combination, and only once decided', () => {
    const { p } = urgent();
    const tri = triage(p, pack, { nowMs: NOW });
    if (tri.tier === 'URGENT' && tri.triggers.some((t) => t.combinedFrom)) {
      const pr = pendingProposal(p, pack, tri, '2026-02-01', NOW)!;
      expect(pr.after).toMatchObject({ teleReviewWithinHours: 48, checkInEveryDays: 1, forDays: 7 });
      const approved = applyAction(p, pack, { type: 'change-follow-up', checkInEveryDays: pr.after.checkInEveryDays, nextReviewDate: pr.after.teleReviewBy, until: pr.after.until, flagKey: pr.flagKey, proposalStatus: 'approved' }, ctx);
      expect(pendingProposal(approved, pack, tri, '2026-02-01', NOW)).toBeNull();
      expect(approved.plan.followUp?.until).toBe(pr.after.until);
      const rejected = applyAction(p, pack, { type: 'reject-proposal', flagKey: pr.flagKey, note: 'will phone instead' }, ctx);
      expect(rejected.plan.followUp).toBeNull(); // rejecting leaves the plan alone
      expect(rejected.notices).toHaveLength(0);
      expect(rejected.audit[0].note).toBe('will phone instead');
    } else throw new Error('fixture did not produce a combination URGENT');
  });
  it('no proposal for a non-combination flag', () => {
    const p = mk(10, (d) => ({ warnings: d === 10 ? { numbness: true } : {} }));
    const tri = triage(p, pack, { nowMs: NOW });
    expect(pendingProposal(p, pack, tri, '2026-02-01', NOW)).toBeNull();
  });
});

describe('per-patient overrides (Phase 2.7)', () => {
  const p = () => mk(10, (d) => ({ pain: d === 10 ? 8 : 2 }));
  it('require a reason', () => {
    const t = listOverridable(pack).find((x) => x.target.startsWith('rule:R3'))!;
    expect(() => applyAction(p(), pack, { type: 'set-override', target: t.target, value: 9, reason: '  ' }, ctx)).toThrow(/reason/);
  });
  it('change only this patient, are logged, and show a PHYSIO_OVERRIDE source on the firing rule', () => {
    const stages = listOverridable(pack).filter((x) => x.target.startsWith('rule:R3:stage'));
    let q = p();
    const before = triage(q, pack, { nowMs: NOW });
    expect(ids(before)).toContain('R3');
    for (const s of stages) q = applyAction(q, pack, { type: 'set-override', target: s.target, value: 9, reason: 'chronic pain baseline' }, ctx);
    const after = triage(q, pack, { nowMs: NOW });
    expect(ids(after)).not.toContain('R3');
    expect(q.audit).toHaveLength(stages.length);
    expect(q.audit[0].note).toBe('chronic pain baseline');
    // the shared pack and another patient are untouched
    expect(ids(triage(p(), pack, { nowMs: NOW }))).toContain('R3');
    expect(pack.rules.find((r) => r.id === 'R3')).toEqual(aclPack().rules.find((r) => r.id === 'R3'));
  });
  it('a lowered threshold fires earlier and the evidence carries the override tag', () => {
    const target = listOverridable(pack).find((x) => x.target === 'rule:A1:delta')!;
    let q = mk(6, (d) => ({ pain: d === 6 ? 3 : 2 }));
    expect(ids(triage(q, pack))).not.toContain('A1');
    q = applyAction(q, pack, { type: 'set-override', target: target.target, value: 1, reason: 'post-op day-4 flare' }, ctx);
    const r = triage(q, pack);
    const a1 = r.triggers.find((t) => t.ruleId === 'A1');
    expect(a1?.source).toContain('PHYSIO_OVERRIDE: post-op day-4 flare');
  });
  it('removing an override restores the pack value; gate values can be overridden too', () => {
    const gateT = listOverridable(pack).find((x) => x.target === 'gate:g1.flexion')!;
    let q = applyAction(p(), pack, { type: 'set-override', target: gateT.target, value: 110, reason: 'agreed with surgeon' }, ctx);
    expect(effectivePack(q, pack).gates[0].criteria.find((c) => c.id === 'g1.flexion')!.value).toBe(110);
    q = applyAction(q, pack, { type: 'remove-override', id: q.plan.overrides[0].id }, ctx);
    expect(effectivePack(q, pack).gates[0].criteria.find((c) => c.id === 'g1.flexion')!.value).toBe(125);
  });
  it('warning-sign tiers cannot be overridden', () => {
    expect(listOverridable(pack).some((x) => /warning|SAFETY|fever/i.test(x.label))).toBe(false);
  });
});

describe('patient notice (Phase 2.6)', () => {
  it('is written in English and Hindi and mentions the date and what changed', () => {
    const out = applyAction(p2(), pack, { type: 'regress-exercise', exerciseId: 'squats' }, ctx);
    const en = noticeText(out.notices[0], 'en', pack);
    const hi = noticeText(out.notices[0], 'hi', pack);
    expect(en).toContain('01/02/2026');
    expect(en).toContain(getExercise('mini-squats')!.name.en);
    expect(hi).toContain('01/02/2026');
    expect(hi).toContain(getExercise('mini-squats')!.name.hi);
    expect(/[ऀ-ॿ]/.test(hi)).toBe(true);
    expect(en).not.toMatch(/\{|\}/);
    expect(hi).not.toMatch(/\{|\}/);
  });
  it('phase-2 strings exist in both languages', () => {
    for (const k of ['exTodayTitle', 'exDone', 'exCouldnt', 'exWhy', 'skip_understand', 'noticeLine', 'readAloud']) {
      expect(DICT.en[k]).toBeTruthy();
      expect(DICT.hi[k]).toBeTruthy();
    }
  });
});

describe('README lists library placeholders (rule 3)', () => {
  it('every exercise dose and regression needing sign-off is in README.md', () => {
    const readme = readFileSync('README.md', 'utf8');
    const items = collectLibrarySignoffs(LIBRARY).filter((x) => x.needsSignoff);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(readme.includes(i.where)).toBe(true);
  });
});
