import { describe, it, expect } from 'vitest';
import { exerciseCard, goalCard, kneeCard, legLine, painCard } from '../src/progress';
import { makeAllPatients } from '../src/demo/seed';
import { getPack } from '../src/engine/packs';
import { triage } from '../src/engine/triage';

const today = '2026-11-15';
const by = (id: string) => makeAllPatients().find((p) => p.id === id)!;

describe('My progress (patient)', () => {
  it('Ravi and Kamla have all four cards', () => {
    for (const id of ['ravi', 'kamla']) {
      const p = by(id);
      expect(painCard(p, today), id).not.toBeNull();
      expect(exerciseCard(p, today), id).not.toBeNull();
      expect(kneeCard(p), id).not.toBeNull();
      expect(goalCard(p), id).not.toBeNull();
    }
  });
  it('Sana is a clearly improving example', () => {
    const s = by('sana');
    expect(painCard(s, today)).toMatchObject({ first: 3, now: 1, trend: 'better' });
    expect(kneeCard(s)).toMatchObject({ first: 72, now: 140, trend: 'better' });
    expect(goalCard(s)).toMatchObject({ first: 20, now: 85, trend: 'better' });
    expect(legLine(s, getPack(s.packId))).toMatchObject({ now: 97, earlier: 84 });
  });
  it('knee bend keeps home and clinic readings apart, and the other leg as its own line', () => {
    const k = kneeCard(by('kamla'))!;
    expect(k.clinic.length).toBe(1);
    expect(k.home.length).toBe(4);
    expect(k.other.length).toBe(2);
    expect(legLine(by('kamla'), getPack('total-knee-replacement'))).toMatchObject({ measure: 'flexionDeg', now: 54, earlier: 50 });
  });
  it('a card with fewer than two data points is not shown', () => {
    const p = { ...by('imran'), periodic: [], goalProgress: [] };
    expect(kneeCard(p)).toBeNull();
    expect(goalCard(p)).toBeNull();
  });
  it('the demo tiers are unchanged by the progress data', () => {
    const nowMs = Date.parse(`${today}T09:00:00Z`);
    const tiers = Object.fromEntries(makeAllPatients().map((p) => [p.id, triage(p, getPack(p.packId), { nowMs }).tier]));
    expect(tiers).toEqual({ ravi: 'ON_PLAN', meera: 'SAFETY', arjun: 'REVIEW', sana: 'ON_PLAN', kamla: 'REVIEW', imran: 'REVIEW' });
  });
});
