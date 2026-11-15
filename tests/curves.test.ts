import { describe, it, expect, afterEach } from 'vitest';
import { applyAction } from '../src/engine/plan';
import { clinicCurvesFor, curveOrigin, setClinicCurves, validateCurve } from '../src/engine/curves';
import { effectivePack } from '../src/engine/overrides';
import { triage } from '../src/engine/triage';
import { getPack } from '../src/engine/packs';
import { DEMO_TODAY_LAST, makeAllPatients } from '../src/demo/seed';
import { getState, removeClinicCurve, resetState, setClinicCurve, setState } from '../src/store';

const now = Date.parse(`${DEMO_TODAY_LAST}T20:00:00Z`);
const ctx = { nowMs: now, today: DEMO_TODAY_LAST };
const by = (id: string) => makeAllPatients().find((p) => p.id === id)!;
const pack = getPack('total-knee-replacement');
const ids = (p: ReturnType<typeof by>) => triage(p, getPack(p.packId), { nowMs: now }).triggers.map((t) => t.ruleId);
afterEach(() => { setClinicCurves({}); resetState(); });

describe('replacing expected curves (Phase 7.1)', () => {
  it('every built-in curve is marked as a placeholder awaiting sign-off', () => {
    for (const id of ['acl-reconstruction', 'total-knee-replacement', 'rotator-cuff-repair']) for (const c of getPack(id).expectedCurves) expect(curveOrigin(c)).toBe('placeholder');
  });
  it('a bad curve is refused', () => {
    expect(validateCurve([[0, 10]], 5)).toMatch(/two points/);
    expect(validateCurve([[0, 10], [0, 20]], 5)).toMatch(/go up/);
    expect(validateCurve([[2, 10], [1, 20]], 5)).toMatch(/go up/);
    expect(validateCurve([[0, 10], [1, NaN]], 5)).toMatch(/number/);
    expect(validateCurve([[-1, 10], [1, 20]], 5)).toMatch(/negative/);
    expect(validateCurve([[0, 10], [1, 20]], 0)).toMatch(/more than 0/);
    expect(validateCurve([[0, 10], [1, 20]], 5)).toBeNull();
  });
  it("a patient's own curve needs a reason, changes the verdict, and is logged", () => {
    const kamla = by('kamla');
    expect(ids(kamla)).toContain('C1'); // 68 deg at week 5 vs placeholder curve
    expect(() => applyAction(kamla, pack, { type: 'set-curve', measure: 'flexionDeg', points: [[0, 40], [6, 70]], tolerance: 10, reason: ' ' }, ctx)).toThrow(/reason/);
    const p = applyAction(kamla, pack, { type: 'set-curve', measure: 'flexionDeg', points: [[0, 40], [6, 70]], tolerance: 10, reason: 'Surgeon protocol, week 6 goal 70 deg' }, ctx);
    expect(ids(p)).not.toContain('C1');
    const eff = effectivePack(p, pack).expectedCurves.find((c) => c.measure === 'flexionDeg')!;
    expect(curveOrigin(eff)).toBe('patient');
    expect(eff.source).toMatch(/Surgeon protocol/);
    const a = p.audit.at(-1)!;
    expect(a.action).toBe('set-curve');
    expect(a.note).toBe('Surgeon protocol, week 6 goal 70 deg');
    expect(pack.expectedCurves[0].points.length).toBe(4); // the shipped pack is untouched
  });
  it('removing the patient curve goes back to the protocol curve', () => {
    let p = applyAction(by('kamla'), pack, { type: 'set-curve', measure: 'flexionDeg', points: [[0, 40], [6, 70]], tolerance: 10, reason: 'r' }, ctx);
    p = applyAction(p, pack, { type: 'remove-curve', measure: 'flexionDeg', reason: 'back' }, ctx);
    expect(ids(p)).toContain('C1');
    expect(() => applyAction(p, pack, { type: 'remove-curve', measure: 'flexionDeg' }, ctx)).toThrow();
  });
  it('a measure with no curve cannot get one', () => {
    expect(() => applyAction(by('kamla'), pack, { type: 'set-curve', measure: 'nope', points: [[0, 1], [1, 2]], tolerance: 1, reason: 'r' }, ctx)).toThrow(/no expected curve/);
  });
  it('a clinic default reaches every patient of the condition, none of another, and logs each', () => {
    resetState();
    const before = getState().patients;
    setClinicCurve('total-knee-replacement', 'flexionDeg', [[0, 40], [6, 70]], 10, 'Clinic protocol 2026');
    const st = getState();
    expect(clinicCurvesFor('total-knee-replacement')).toHaveLength(1);
    const k = st.patients.find((p) => p.id === 'kamla')!;
    expect(ids(k)).not.toContain('C1');
    expect(k.audit.at(-1)).toMatchObject({ action: 'set-clinic-curve', note: 'Clinic protocol 2026', manual: true });
    for (const p of st.patients.filter((x) => x.packId !== 'total-knee-replacement')) expect(p.audit.length).toBe(before.find((b) => b.id === p.id)!.audit.length);
    expect(curveOrigin(effectivePack(k, pack).expectedCurves[0])).toBe('clinic');
  });
  it("a patient's own curve wins over the clinic default", () => {
    resetState();
    setClinicCurve('total-knee-replacement', 'flexionDeg', [[0, 40], [6, 70]], 10, 'clinic');
    let k = getState().patients.find((p) => p.id === 'kamla')!;
    k = applyAction(k, pack, { type: 'set-curve', measure: 'flexionDeg', points: [[0, 90], [6, 120]], tolerance: 5, reason: 'she is a fast healer' }, ctx);
    expect(ids(k)).toContain('C1');
    expect(curveOrigin(effectivePack(k, pack).expectedCurves[0])).toBe('patient');
  });
  it('a clinic default needs a reason and can be removed', () => {
    resetState();
    expect(() => setClinicCurve('total-knee-replacement', 'flexionDeg', [[0, 40], [6, 70]], 10, '')).toThrow(/reason/);
    expect(() => setClinicCurve('total-knee-replacement', 'flexionDeg', [[0, 40]], 10, 'r')).toThrow(/two points/);
    setClinicCurve('total-knee-replacement', 'flexionDeg', [[0, 40], [6, 70]], 10, 'r');
    expect(() => removeClinicCurve('total-knee-replacement', 'flexionDeg', '')).toThrow(/reason/);
    removeClinicCurve('total-knee-replacement', 'flexionDeg', 'changed my mind');
    expect(clinicCurvesFor('total-knee-replacement')).toHaveLength(0);
    expect(ids(getState().patients.find((p) => p.id === 'kamla')!)).toContain('C1');
  });
  it('saved clinic curves survive a reload of the saved state', () => {
    resetState();
    setClinicCurve('total-knee-replacement', 'flexionDeg', [[0, 40], [6, 70]], 10, 'r');
    const saved = JSON.stringify(getState());
    setClinicCurves({});
    setState(JSON.parse(saved));
    expect(clinicCurvesFor('total-knee-replacement')).toHaveLength(1);
  });
});
