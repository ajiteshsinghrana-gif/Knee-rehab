import { describe, it, expect } from 'vitest';
import { combineReadings, meanVec, tiltBetween } from '../src/goniometer';
import { getPack, PACK_LIST } from '../src/engine/packs';
import { triage } from '../src/engine/triage';
import { makeAllPatients } from '../src/demo/seed';

const g = 9.81;
const at = (deg: number) => ({ x: 0, y: g * Math.sin((deg * Math.PI) / 180), z: g * Math.cos((deg * Math.PI) / 180) });

describe('phone goniometer (physio feedback phase 5)', () => {
  it('the knee bend is the tilt between the straight-leg and bent-leg gravity directions', () => {
    expect(tiltBetween(at(0), at(90))).toBe(90);
    expect(tiltBetween(at(10), at(105))).toBe(95);
  });
  it('averages a burst of samples and ignores broken ones', () => {
    expect(meanVec([at(0), at(0), { x: NaN, y: 0, z: 0 }])).toEqual(at(0));
    expect(meanVec([{ x: 0, y: 0, z: 0 }])).toBeNull();
  });
  it('two readings are averaged; far apart they must be measured again', () => {
    expect(combineReadings(88, 94)).toEqual({ ok: true, deg: 91 });
    expect(combineReadings(60, 95).ok).toBe(false);
  });
});

describe('a single home reading never flags on its own (physio feedback phase 5)', () => {
  const kamla = () => makeAllPatients().find((p) => p.id === 'kamla')!;
  const pack = getPack('total-knee-replacement');
  it('two home tests in a row below the band: REVIEW (C1)', () => {
    const r = triage(kamla(), pack);
    expect(r.triggers.find((t) => t.ruleId === 'C1')?.tier).toBe('REVIEW');
  });
  it('only the latest home test below the band: no flag', () => {
    const k = kamla();
    const fixed = { ...k, periodic: k.periodic.map((e, i, a) => (i === a.length - 2 ? { ...e, values: { ...e.values, flexionDeg: 82 } } : e)) };
    expect(triage(fixed, pack).triggers.map((t) => t.ruleId)).not.toContain('C1');
  });
  it('the same single low reading taken in clinic does count', () => {
    const k = kamla();
    const fixed = { ...k, periodic: k.periodic.map((e, i, a) => (i === a.length - 2 ? { ...e, values: { ...e.values, flexionDeg: 82 } } : i === a.length - 1 ? { ...e, where: 'clinic' as const } : e)) };
    expect(triage(fixed, pack).triggers.map((t) => t.ruleId)).toContain('C1');
  });
  it('no protocol has a SAFETY or URGENT rule on knee bend', () => {
    for (const p of PACK_LIST) expect(p.rules.filter((r) => 'measure' in r && r.measure === 'flexionDeg' && r.tier !== 'REVIEW')).toEqual([]);
  });
});
