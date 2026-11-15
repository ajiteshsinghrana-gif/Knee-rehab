import { describe, it, expect } from 'vitest';
import { triage, compareWorklist, stageFor } from '../src/engine/triage';
import { evaluateGate } from '../src/engine/gates';
import { suggestedActions } from '../src/engine/actions';
import { addDays, toMs } from '../src/engine/dates';
import { DEMO_STEPS, demoStepPatient, makeAllPatients, makeRavi } from '../src/demo/seed';
import { getPack } from '../src/engine/packs';
import { ANCHOR, aclPack, clone, ids, mk, wk } from './helpers';

const pack = aclPack();
const tri = (p: ReturnType<typeof mk>, o = {}) => triage(p, pack, o);

describe('tiers', () => {
  it('quiet patient is ON_PLAN', () => {
    const r = tri(mk(10));
    expect(r.tier).toBe('ON_PLAN');
    expect(r.triggers).toHaveLength(0);
    expect(r.overdue).toBe(false);
  });
  it('highest tier wins and every triggered rule is listed', () => {
    const r = tri(mk(10, (d) => (d === 10 ? { warnings: { fever: true, givingWay: true, numbness: true } } : {})));
    expect(r.tier).toBe('SAFETY');
    expect(ids(r)).toEqual(['R1', 'R2', 'A8']);
  });
});

describe('R1 / R2: warning signs', () => {
  const safety = pack.warningSigns.filter((s) => s.tier === 'SAFETY');
  for (const s of safety) {
    it(`${s.id} alone gives SAFETY via R1`, () => {
      const r = tri(mk(10, (d) => (d === 10 ? { warnings: { [s.id]: true } } : {})));
      expect(r.tier).toBe('SAFETY');
      expect(ids(r)).toEqual(['R1']);
    });
  }
  it('chest pain or breathlessness is a SAFETY sign (Phase 0.3)', () => {
    expect(safety.map((s) => s.id)).toContain('chestPainBreathless');
  });
  for (const id of ['givingWay', 'locking']) {
    it(`${id} gives URGENT via R2`, () => {
      const r = tri(mk(10, (d) => (d === 10 ? { warnings: { [id]: true } } : {})));
      expect(r.tier).toBe('URGENT');
      expect(ids(r)).toEqual(['R2']);
    });
  }
  it('ACL numbness is amber REVIEW (A8), tagged NEEDS_PHYSIO_SIGNOFF, not red-flag (Phase 0.3)', () => {
    const n = pack.warningSigns.find((s) => s.id === 'numbness')!;
    expect(n.tier).toBe('REVIEW');
    expect(n.source).toContain('NEEDS_PHYSIO_SIGNOFF');
    const r = tri(mk(10, (d) => (d === 10 ? { warnings: { numbness: true } } : {})));
    expect(r.tier).toBe('REVIEW');
    expect(ids(r)).toEqual(['A8']);
  });
  it('a warning sign only counts on the day it is reported', () => {
    const r = tri(mk(10, (d) => (d === 9 ? { warnings: { fever: true } } : {})));
    expect(r.tier).toBe('ON_PLAN');
  });
});

describe('R3: stage-aware pain threshold (Phase 0.5)', () => {
  it('stages are a list of week ranges in config, all tagged NEEDS_PHYSIO_SIGNOFF', () => {
    const r3 = pack.rules.find((r) => r.id === 'R3') as any;
    expect(r3.stages.length).toBeGreaterThan(1);
    for (const s of r3.stages) expect(s.source).toContain('NEEDS_PHYSIO_SIGNOFF');
  });
  it('pain 7 is URGENT, pain 6 is not (placeholder values)', () => {
    expect(ids(tri(mk(30, (d) => (d === 30 ? { pain: 7 } : {}))))).toContain('R3');
    expect(ids(tri(mk(30, (d) => (d === 30 ? { pain: 6 } : {}))))).not.toContain('R3');
  });
  it('different thresholds apply in different post-op weeks', () => {
    const p2 = clone(pack);
    (p2.rules.find((r) => r.id === 'R3') as any).stages = [
      { minWeek: 0, maxWeek: 2, value: 9, source: 'TEST' },
      { minWeek: 2, maxWeek: null, value: 6, source: 'TEST' },
    ];
    const early = mk(10, (d) => (d === 10 ? { pain: 7 } : {}));
    const late = mk(30, (d) => (d === 30 ? { pain: 7 } : {}));
    expect(ids(triage(early, p2))).not.toContain('R3');
    expect(ids(triage(late, p2))).toContain('R3');
  });
  it('stageFor handles inclusive/exclusive edges', () => {
    const st = [{ minWeek: 3, minExclusive: true, maxWeek: null, value: 1, source: 'x' }];
    expect(stageFor(st, 3)).toBeUndefined();
    expect(stageFor(st, 3.01)?.value).toBe(1);
    const st2 = [{ minWeek: 2, maxWeek: 3, maxInclusive: true, value: 1, source: 'x' }];
    expect(stageFor(st2, 3)?.value).toBe(1);
    expect(stageFor(st2, 3.01)).toBeUndefined();
  });
});

describe('R4 / A5: extension deficit', () => {
  it('R4: week > 3 and deficit > 1 cm is URGENT', () => {
    const r = tri(mk(30, () => ({}), { periodic: [wk(28, { extensionDeficitCm: 1.5 })] }));
    expect(ids(r)).toContain('R4');
    expect(r.tier).toBe('URGENT');
  });
  it('R4 does not fire at exactly 1 cm or at exactly week 3', () => {
    expect(ids(tri(mk(30, () => ({}), { periodic: [wk(28, { extensionDeficitCm: 1 })] })))).not.toContain('R4');
    expect(ids(tri(mk(21, () => ({}), { periodic: [wk(20, { extensionDeficitCm: 2 })] })))).not.toContain('R4');
  });
  it('A5: weeks 2-3, deficit > 1 cm and not improving vs previous week', () => {
    const r = tri(mk(18, () => ({}), { periodic: [wk(7, { extensionDeficitCm: 2 }), wk(14, { extensionDeficitCm: 2 })] }));
    expect(ids(r)).toContain('A5');
    expect(r.tier).toBe('REVIEW');
  });
  it('A5 does not fire when improving, or with only one weekly entry', () => {
    expect(ids(tri(mk(18, () => ({}), { periodic: [wk(7, { extensionDeficitCm: 3 }), wk(14, { extensionDeficitCm: 2 })] })))).not.toContain('A5');
    expect(ids(tri(mk(18, () => ({}), { periodic: [wk(14, { extensionDeficitCm: 2 })] })))).not.toContain('A5');
  });
});

describe('REVIEW rules A1-A8', () => {
  it('A1: pain up 2+ across last 3 check-ins', () => {
    const r = tri(mk(10, (d) => ({ pain: d === 8 ? 3 : d === 9 ? 4 : d === 10 ? 5 : 2 })));
    expect(ids(r)).toContain('A1');
    expect(ids(tri(mk(10, (d) => ({ pain: d === 8 ? 2 : d === 9 ? 3 : d === 10 ? 3 : 2 }))))).not.toContain('A1');
  });
  it('A2: swelling "more" two days running (not just one)', () => {
    expect(ids(tri(mk(10, (d) => (d >= 9 ? { swelling: 'more' } : {}))))).toContain('A2');
    expect(ids(tri(mk(10, (d) => (d === 10 ? { swelling: 'more' } : {}))))).not.toContain('A2');
    expect(ids(tri(mk(10, (d) => (d === 8 || d === 10 ? { swelling: 'more' } : {}))))).not.toContain('A2');
  });
  it('A3: two missed days in a row', () => {
    expect(ids(tri(mk(10, (d) => (d >= 9 ? { ex: 'none' as const } : {}))))).toContain('A3');
    expect(ids(tri(mk(10, (d) => (d === 10 ? { ex: 'none' as const } : {}))))).not.toContain('A3');
  });
  it('A3: weekly adherence below 60%', () => {
    const r = tri(mk(10, (d) => (d === 4 || d === 6 || d === 8 || d === 10 ? { ex: 'none' as const } : d === 5 || d === 7 || d === 9 ? { ex: 'some' as const } : {})));
    expect(ids(r)).toContain('A3');
  });
  it('A4: same hard movement on 3+ of the last 7 days', () => {
    expect(ids(tri(mk(10, (d) => (d === 4 || d === 7 || d === 10 ? { hard: 'squat' } : {}))))).toContain('A4');
    expect(ids(tri(mk(10, (d) => (d === 7 || d === 10 ? { hard: 'squat' } : {}))))).not.toContain('A4');
  });
  it('A6: phase over its window with the gate unmet', () => {
    const p = mk(60, () => ({}), { periodic: [wk(56, { extensionDeficitCm: 0, flexionDeg: 100, kneeCircumferenceDiffCm: 0, slrLag: false })] });
    const r = tri(p);
    expect(ids(r)).toContain('A6');
    expect(r.triggers.find((t) => t.ruleId === 'A6')!.evidence).toContain('Bending');
  });
  it('A6 does not fire when the gate is met', () => {
    const p = mk(60, () => ({}), { periodic: [wk(56, { extensionDeficitCm: 0, flexionDeg: 130, kneeCircumferenceDiffCm: 0, slrLag: false })] });
    expect(ids(tri(p))).not.toContain('A6');
  });
  it('A7: TSK-11 above 18', () => {
    expect(ids(tri(mk(10, () => ({}), { periodic: [wk(5, { tsk11: 19 })] })))).toContain('A7');
    expect(ids(tri(mk(10, () => ({}), { periodic: [wk(5, { tsk11: 18 })] })))).not.toContain('A7');
  });
});

describe('R5: combination of review-tier rules', () => {
  it('two distinct review rules in 3 days make URGENT and name the rules', () => {
    const r = tri(mk(10, (d) => (d >= 8 ? { pain: d - 5, ex: d >= 9 ? ('none' as const) : ('all' as const) } : {})));
    expect(ids(r)).toContain('R5');
    expect(r.tier).toBe('URGENT');
    const r5 = r.triggers.find((t) => t.ruleId === 'R5')!;
    expect(r5.combinedFrom).toContain('A1');
    expect(r5.combinedFrom).toContain('A3');
  });
  it('one review rule alone stays REVIEW', () => {
    const r = tri(mk(10, (d) => ({ pain: d === 8 ? 3 : d === 9 ? 4 : d === 10 ? 5 : 2 })));
    expect(r.tier).toBe('REVIEW');
    expect(ids(r)).not.toContain('R5');
  });
});

describe('suggested actions are never auto-applied', () => {
  it('maps rules and skip reasons to actions', () => {
    const p = mk(10, (d) => (d >= 9 ? { ex: 'none' as const, skip: 'fear' } : {}));
    const r = tri(p);
    const a = suggestedActions(r.triggers, pack, p, r.asOf);
    expect(a).toContain('call-patient');
    expect(a).toContain('send-tsk11');
  });
});

describe('defining scenario: Ravi fast-forward', () => {
  it('starts quiet and ends URGENT via R5', () => {
    let p = makeRavi();
    expect(triage(p, pack).tier).not.toBe('URGENT');
    for (let i = 0; i < DEMO_STEPS.length; i++) p = demoStepPatient(p, i);
    const r = triage(p, pack);
    expect(r.tier).toBe('URGENT');
    expect(ids(r)).toContain('R5');
    expect(ids(r)).not.toContain('R3');
    expect(ids(r)).not.toContain('R1');
    const r5 = r.triggers.find((t) => t.ruleId === 'R5')!;
    expect(r5.combinedFrom!.length).toBeGreaterThan(1);
  });
  it('the physio sees the evidence behind each rule', () => {
    let p = makeRavi();
    for (let i = 0; i < DEMO_STEPS.length; i++) p = demoStepPatient(p, i);
    const r = triage(p, pack);
    expect(r.triggers.find((t) => t.ruleId === 'A1')!.evidence).toContain('3 -> 4 -> 5');
  });
});

describe('Meera: calf pain + fever ends SAFETY', () => {
  it('SAFETY via R1', () => {
    const meera = makeAllPatients().find((x) => x.id === 'meera')!;
    const r = triage(meera, pack);
    expect(r.tier).toBe('SAFETY');
    expect(ids(r)).toContain('R1');
    expect(r.triggers.find((t) => t.ruleId === 'R1')!.evidence).toContain('Calf pain');
    expect(r.triggers.find((t) => t.ruleId === 'R1')!.evidence).toContain('Fever');
  });
});

describe('response times and the Overdue state (Phase 0.4)', () => {
  const sp = () => mk(10, (d) => (d === 10 ? { warnings: { fever: true } } : {}));
  const raised = toMs(addDays(ANCHOR, 10)) + 12 * 3_600_000;
  it('each tier has its own response time in config', () => {
    expect(pack.responseHours.SAFETY.hours).toBe(2);
    expect(pack.responseHours.URGENT.hours).toBe(24);
    expect(pack.responseHours.REVIEW.hours).toBe(72);
    expect(pack.responseHours.SAFETY.source).toContain('NEEDS_PHYSIO_SIGNOFF');
  });
  it('SAFETY is not overdue inside 2 h, overdue after', () => {
    expect(triage(sp(), pack, { nowMs: raised + 1 * 3_600_000 }).overdue).toBe(false);
    expect(triage(sp(), pack, { nowMs: raised + 3 * 3_600_000 }).overdue).toBe(true);
  });
  it('reviewing the flag clears Overdue', () => {
    const p = sp();
    const r = triage(p, pack, { nowMs: raised + 5 * 3_600_000 });
    expect(r.overdue).toBe(true);
    p.reviewed[r.flagKey!] = new Date(raised + 6 * 3_600_000).toISOString();
    const r2 = triage(p, pack, { nowMs: raised + 7 * 3_600_000 });
    expect(r2.overdue).toBe(false);
    expect(r2.reviewedAt).toBeTruthy();
  });
  it('URGENT uses 24 h and REVIEW 72 h', () => {
    const u = mk(10, (d) => (d === 10 ? { warnings: { givingWay: true } } : {}));
    expect(triage(u, pack, { nowMs: raised + 23 * 3_600_000 }).overdue).toBe(false);
    expect(triage(u, pack, { nowMs: raised + 25 * 3_600_000 }).overdue).toBe(true);
    const rv = mk(10, (d) => (d === 10 ? { warnings: { numbness: true } } : {}));
    expect(triage(rv, pack, { nowMs: raised + 71 * 3_600_000 }).overdue).toBe(false);
    expect(triage(rv, pack, { nowMs: raised + 73 * 3_600_000 }).overdue).toBe(true);
  });
  it('the clock starts at the beginning of the flag episode, not the latest check-in', () => {
    const p = mk(10, (d) => (d >= 9 ? { warnings: { givingWay: true } } : {}));
    const r = triage(p, pack, { nowMs: toMs(addDays(ANCHOR, 9)) + 12 * 3_600_000 + 25 * 3_600_000 });
    expect(r.overdue).toBe(true);
  });
  it('worklist: overdue sorts first within its tier; tiers still dominate', () => {
    const now = raised + 30 * 3_600_000;
    const a = triage(mk(10, (d) => (d === 10 ? { warnings: { givingWay: true } } : {})), pack, { nowMs: now });
    const b = triage(mk(10, (d) => (d === 10 ? { warnings: { locking: true } } : {})), pack, { nowMs: raised - 3_600_000 });
    const s = triage(sp(), pack, { nowMs: raised });
    expect(a.overdue).toBe(true);
    expect(b.overdue).toBe(false);
    expect([b, a].sort(compareWorklist)[0]).toBe(a);
    expect([a, s].sort(compareWorklist)[0]).toBe(s);
  });
});

describe('gates (criteria-driven, never auto-advance)', () => {
  it('gate 1 -> 2 lists every criterion with source tags', () => {
    const p = mk(30, () => ({}), { periodic: [wk(28, { extensionDeficitCm: 0, flexionDeg: 130, kneeCircumferenceDiffCm: 0.5, slrLag: false })] });
    const g = evaluateGate(p, pack, addDays(ANCHOR, 30))!;
    expect(g.allMet).toBe(true);
    for (const c of g.criteria) expect(c.source.length).toBeGreaterThan(0);
  });
  it('unmeasured criteria are unmet', () => {
    const g = evaluateGate(mk(30), pack, addDays(ANCHOR, 30))!;
    expect(g.allMet).toBe(false);
  });
  it('Sana is ready for phase 3 and nothing changed her phase', () => {
    const sana = makeAllPatients().find((x) => x.id === 'sana')!;
    const g = evaluateGate(sana, pack, sana.daily[sana.daily.length - 1].date)!;
    expect(g.allMet).toBe(true);
    expect(sana.currentPhase).toBe('p2');
  });
});

describe('generic rule types in other packs', () => {
  it('silence: no check-in for N hours (fixture rule)', () => {
    const p2 = clone(pack);
    p2.rules.push({ id: 'S1', type: 'silence', hours: 72, hoursSource: 'TEST', tier: 'REVIEW', source: 'TEST', label: { en: 'No check-in for N days', hi: 'x' } } as any);
    const p = mk(10);
    const lastMs = toMs(addDays(ANCHOR, 10)) + 86_400_000 - 1;
    expect(ids(triage(p, p2, { nowMs: lastMs + 71 * 3_600_000 }))).not.toContain('S1');
    const r = triage(p, p2, { nowMs: lastMs + 4 * 24 * 3_600_000 });
    expect(ids(r)).toContain('S1');
    expect(r.triggers.find((t) => t.ruleId === 'S1')!.evidence).toContain('No check-in for 4 days');
  });
  it('trend "down" direction (fixture rule)', () => {
    const p2 = clone(pack);
    p2.rules.push({ id: 'T1', type: 'trend', measure: 'pain', direction: 'down', delta: 2, window: 3, deltaSource: 'TEST', tier: 'REVIEW', source: 'TEST', label: { en: 't', hi: 't' } } as any);
    const p = mk(10, (d) => ({ pain: d === 8 ? 5 : d === 9 ? 4 : d === 10 ? 3 : 2 }));
    expect(ids(triage(p, p2))).toContain('T1');
  });
  it('belowCurve: knee replacement patient drifting below the expected curve', () => {
    const kamla = makeAllPatients().find((x) => x.id === 'kamla')!;
    const tk = getPack('total-knee-replacement');
    const r = triage(kamla, tk);
    expect(ids(r)).toContain('C1');
    expect(r.tier).toBe('REVIEW');
  });
  it('belowCurve does not fire inside the tolerance band', () => {
    const kamla = makeAllPatients().find((x) => x.id === 'kamla')!;
    const tk = getPack('total-knee-replacement');
    kamla.periodic = kamla.periodic.map((e) => ({ ...e, values: { ...e.values, flexionDeg: 100 } }));
    expect(ids(triage(kamla, tk))).not.toContain('C1');
  });
  it('precautionBreach: sling breach in phase 1 only (rotator cuff)', () => {
    const rc = getPack('rotator-cuff-repair');
    const imran = makeAllPatients().find((x) => x.id === 'imran')!;
    expect(ids(triage(imran, rc))).not.toContain('P1');
    const breach = clone(imran);
    breach.daily[breach.daily.length - 1].precautionBreaches = { 'sling-off': true };
    const r = triage(breach, rc);
    expect(ids(r)).toContain('P1');
    expect(r.tier).toBe('REVIEW');
    breach.currentPhase = 'p2';
    expect(ids(triage(breach, rc))).not.toContain('P1');
  });
  it('a shoulder patient is triaged by the same engine with no code change', () => {
    const rc = getPack('rotator-cuff-repair');
    const imran = makeAllPatients().find((x) => x.id === 'imran')!;
    imran.daily[imran.daily.length - 1].warnings.chestPainBreathless = true;
    expect(triage(imran, rc).tier).toBe('SAFETY');
  });
});
