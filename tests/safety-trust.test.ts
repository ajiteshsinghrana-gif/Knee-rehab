import { describe, it, expect } from 'vitest';
import { getPack } from '../src/engine/packs';
import { triage } from '../src/engine/triage';
import { suggestedActions } from '../src/engine/actions';
import { addWorkingHours } from '../src/engine/hours';
import { ruleHitRates } from '../src/engine/feedback';
import { makeAllPatients } from '../src/demo/seed';

const pack = getPack('acl-reconstruction');
const meera = () => makeAllPatients().find((p) => p.id === 'meera')!;

describe('red flags suggest medical escalation only (fix phase 4)', () => {
  it('Meera (calf pain + fever): call the patient and refer to the surgeon or doctor, nothing else', () => {
    const p = meera();
    const r = triage(p, pack);
    expect(r.tier).toBe('SAFETY');
    expect(suggestedActions(r.triggers, pack, p, r.asOf)).toEqual(['call-patient', 'refer-doctor']);
  });
});

describe('working hours (fix phase 4)', () => {
  const wh = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }; // Monday to Friday
  it('counts only open hours', () => {
    const fri17 = new Date(2026, 10, 13, 17, 0).getTime(); // Friday 13 Nov 2026, 17:00 local
    // 1 h left on Friday, then Monday from 09:00: 3 working hours ends Monday 11:00
    expect(new Date(addWorkingHours(fri17, 3, wh)).toString()).toBe(new Date(2026, 10, 16, 11, 0).toString());
  });
  it('REVIEW and URGENT deadlines use them; SAFETY never pauses', () => {
    const p = meera();
    const always = triage(p, pack, { nowMs: Date.now() });
    const hours = triage(p, pack, { nowMs: Date.now(), workingHours: { start: '10:00', end: '11:00', days: [1] } });
    expect(hours.dueByMs).toBe(always.dueByMs);
    const k = makeAllPatients().find((x) => x.id === 'kamla')!;
    const kp = getPack(k.packId);
    expect(triage(k, kp, { workingHours: { start: '10:00', end: '11:00', days: [1] } }).dueByMs).toBeGreaterThan(triage(k, kp).dueByMs!);
  });
});

describe('flag usefulness (fix phase 4)', () => {
  it('hit rate per rule = useful answers / rated flags', () => {
    const p = { ...meera(), flagFeedback: { a: { useful: true, at: 'x', rules: ['R1', 'A1'] }, b: { useful: false, at: 'y', rules: ['A1'] } } };
    expect(ruleHitRates([p])).toEqual([{ ruleId: 'A1', rated: 2, useful: 1 }, { ruleId: 'R1', rated: 1, useful: 1 }]);
  });
});
