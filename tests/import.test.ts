import { describe, it, expect } from 'vitest';
import { buildTemplate, extract, parseExerciseList } from '../src/import/extract';
import { buildImportedPack } from '../src/import/apply';
import { PACKS, getPack } from '../src/engine/packs';
import { collectSignoffs } from '../src/engine/signoff';
import { triage } from '../src/engine/triage';
import { aclPack, mk, ids } from './helpers';

const pack = aclPack();

describe('protocol import (Phase 3.2)', () => {
  it('reads the template it generates: unchanged values propose nothing', () => {
    const r = extract(pack, buildTemplate(pack), 'template.txt');
    expect(r.proposals).toEqual([]);
    expect(r.rejected).toEqual([]);
  });
  it('proposes only changed values, shows default next to imported, and keeps the source line', () => {
    const t = buildTemplate(pack).replace('[rule:R3:stage:0]: 7', '[rule:R3:stage:0]: 8');
    expect(t).toContain('[rule:R3:stage:0]: 8');
    const r = extract(pack, t, 'p.txt');
    const p = r.proposals.find((x) => x.target === 'rule:R3:stage:0');
    expect(p).toMatchObject({ current: 7, proposed: 8 });
    expect(p!.line).toContain('[rule:R3:stage:0]');
  });
  it('reads plain wording too: rule id or name, with weeks to choose the stage', () => {
    const r = extract(pack, 'R3 high pain from week 0-2: 9\nUrgent response within 12 hours\nPhase 1 follow-up every 3 days');
    const t = Object.fromEntries(r.proposals.map((x) => [x.target, x.proposed]));
    expect(t['rule:R3:stage:0']).toBe(9);
    expect(t['hours:URGENT']).toBe(12);
    expect(t['phase:p1:followUp']).toBe(3);
  });
  it('a line that fits several fields is not guessed: the physio chooses', () => {
    const r = extract(pack, 'High pain: 9');
    expect(r.proposals).toEqual([]);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].candidates.length).toBeGreaterThan(1);
  });
  it('rejects out-of-range numbers and unknown exercises instead of dropping them silently', () => {
    const r = extract(pack, 'Pain rising [rule:A1:window]: 1\nUrgent response within 5000 hours\nPhase 1 exercises: quad sets, unicorn dance');
    expect(r.rejected.some((x) => /outside/.test(x.why))).toBe(true);
    expect(r.rejected.some((x) => /unicorn/.test(x.why))).toBe(true);
    expect(r.proposals.find((x) => x.target === 'phase:p1:exercises')?.proposed).toEqual(['quad-set']);
  });
  it('JSON in the same shape is reviewed the same way; unknown keys are rejected', () => {
    const r = extract(pack, JSON.stringify({ 'rule:R3:stage:1': 8, 'phase:p1:exercises': ['quad-set', 'nope'], 'made:up': 1 }), 'x.json');
    expect(r.proposals.map((p) => p.target).sort()).toEqual(['phase:p1:exercises', 'rule:R3:stage:1']);
    expect(r.rejected.length).toBe(2);
    expect(extract(pack, '{ not json', 'x.json').rejected[0].why).toMatch(/not valid JSON/);
  });
  it('exercise lists match English or Hindi names and flag unknown ones', () => {
    expect(parseExerciseList('exercises: Heel slides, quad set, wall slide')).toEqual({ ids: ['heel-slides', 'quad-set', 'wall-slide'], unknown: [] });
    expect(parseExerciseList('exercises: pogo stick').unknown).toEqual(['pogo stick']);
  });
});

describe('approved fields only become a new, valid, tagged pack', () => {
  it('untouched fields keep the default; imported ones carry PHYSIO_IMPORTED with the file name', () => {
    const r = extract(pack, 'R3 high pain weeks 0-2 [rule:R3:stage:0]: 8\nUrgent response within 12 hours', 'clinic-protocol.pdf');
    const only = r.proposals.filter((p) => p.target === 'rule:R3:stage:0'); // physio approves one of the two
    const custom = buildImportedPack(pack, only, 'clinic-protocol.pdf', 'acl-reconstruction-custom-1');
    expect(PACKS['acl-reconstruction-custom-1']).toBe(custom);
    const r3 = custom.rules.find((x) => x.id === 'R3') as any;
    expect(r3.stages[0].value).toBe(8);
    expect(r3.stages[0].source).toBe('PHYSIO_IMPORTED: clinic-protocol.pdf');
    expect(r3.stages[1]).toEqual((pack.rules.find((x) => x.id === 'R3') as any).stages[1]);
    expect(custom.responseHours.URGENT).toEqual(pack.responseHours.URGENT);
    expect(custom.basedOn).toBe('acl-reconstruction');
    expect(pack.rules.find((x) => x.id === 'R3')).toEqual(aclPack().rules.find((x) => x.id === 'R3')); // default untouched
    // the imported value is no longer an unsigned placeholder
    expect(collectSignoffs(custom).filter((s) => s.needsSignoff).length).toBe(collectSignoffs(pack).filter((s) => s.needsSignoff).length - 1);
  });
  it('the custom pack drives triage', () => {
    const custom = getPack('acl-reconstruction-custom-1');
    const p = { ...mk(10, (d) => ({ pain: d === 10 ? 7 : 2 })), packId: custom.id };
    expect(ids(triage(p, custom))).not.toContain('R3');
    expect(ids(triage(mk(10, (d) => ({ pain: d === 10 ? 7 : 2 })), pack))).toContain('R3');
  });
  it('an import that breaks the validator is refused', () => {
    expect(() => buildImportedPack(pack, [{ target: 'phase:p1:exercises', label: '', kind: 'exercises', current: [], proposed: ['not-in-library'], line: '' }], 'x', 'bad-1')).toThrow();
    expect(PACKS['bad-1']).toBeUndefined();
  });
});

describe('invite for a patient on an imported pack', () => {
  it('rebuilds the same pack on another device from the small invite code', async () => {
    const { buildPatient, encodeInvite, decodeInvite } = await import('../src/onboarding');
    const r = extract(pack, 'R3 high pain weeks 0-2 [rule:R3:stage:0]: 9', 'clinic.pdf');
    const custom = buildImportedPack(pack, r.proposals, 'clinic.pdf', 'acl-reconstruction-custom-9');
    const p = buildPatient({ name: 'Sunita', age: 30, language: 'en', packId: custom.id, anchorDate: '2026-11-01', phaseId: 'p1', exercises: custom.phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: Date.parse('2026-11-15T09:00:00Z'), today: '2026-11-15' });
    const code = encodeInvite(p);
    expect(code.length).toBeLessThan(2000);
    delete (PACKS as Record<string, unknown>)[custom.id]; // as if on a device that has never seen this pack
    const back = decodeInvite(code)!;
    expect(back.pack?.id).toBe(custom.id);
    expect((back.pack!.rules.find((x) => x.id === 'R3') as any).stages[0]).toMatchObject({ value: 9, source: 'PHYSIO_IMPORTED: clinic.pdf' });
    expect(PACKS[custom.id]).toBeTruthy();
  });
});
