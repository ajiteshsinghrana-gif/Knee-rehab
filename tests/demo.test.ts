import { describe, it, expect } from 'vitest';
import { DEMO_STEPS, DEMO_TODAY_LAST, demoStepPatient, makeAllPatients } from '../src/demo/seed';
import { getPack } from '../src/engine/packs';
import { triage } from '../src/engine/triage';
import { applyManual, pendingProposal } from '../src/engine/plan';

const now = Date.parse(`${DEMO_TODAY_LAST}T20:00:00Z`);
const by = (id: string) => makeAllPatients().find((p) => p.id === id)!;
const tier = (id: string) => { const p = by(id); return triage(p, getPack(p.packId), { nowMs: now }); };

describe('demo patients (Phase 7)', () => {
  it('the demo bar still works: Ravi ends URGENT via R5, Meera is SAFETY', () => {
    let ravi = by('ravi');
    expect(tier('ravi').tier).toBe('ON_PLAN');
    for (let i = 0; i < DEMO_STEPS.length; i++) ravi = demoStepPatient(ravi, i);
    const r = triage(ravi, getPack(ravi.packId), { nowMs: now + 3 * 86_400_000 });
    expect(r.tier).toBe('URGENT');
    expect(r.triggers.some((t) => t.ruleId === 'R5')).toBe(true);
    expect(tier('meera').tier).toBe('SAFETY');
  });
  it('Kamla is answered by her carer, in Hindi, and is below the expected knee-bend curve', () => {
    const k = by('kamla');
    expect(k.language).toBe('hi');
    expect(k.caregiverMode).toBe(true);
    expect(k.daily.every((d) => d.answeredBy === 'caregiver')).toBe(true);
    const r = tier('kamla');
    expect(r.tier).toBe('REVIEW');
    expect(r.triggers.map((t) => t.ruleId)).toContain('C1');
  });
  it('Imran is in the sling phase, reads Bengali, and took his arm out of the sling yesterday', () => {
    const i = by('imran');
    expect(i.packId).toBe('rotator-cuff-repair');
    expect(i.currentPhase).toBe('p1');
    expect(i.language).toBe('bn');
    const r = tier('imran');
    expect(r.tier).toBe('REVIEW');
    expect(r.triggers.map((t) => t.ruleId)).toContain('P1');
  });
  it('the live demo move works on Kamla: the physio adds an exercise with a reason and she is told', () => {
    const k = by('kamla'); const pack = getPack(k.packId);
    const p = applyManual(k, pack, { type: 'set-exercises', add: ['swimming'] }, 'Extra bending work, knee below the curve', { nowMs: now, today: DEMO_TODAY_LAST });
    expect(p.notices.at(-1)?.changes[0]).toMatchObject({ kind: 'exercises', added: ['swimming'] });
    expect(p.audit.at(-1)?.manual).toBe(true);
  });
  it('triage never reads who answered: Kamla with the carer flag removed gets the same flags', () => {
    const k = by('kamla'); const pack = getPack(k.packId);
    const plain = { ...k, caregiverMode: false, daily: k.daily.map((d) => ({ ...d, answeredBy: 'patient' as const })) };
    expect(triage(plain, pack, { nowMs: now }).triggers.map((t) => t.ruleId)).toEqual(triage(k, pack, { nowMs: now }).triggers.map((t) => t.ruleId));
  });
});

describe('demo fast-forward in the app (calendar stays put)', () => {
  const today = '2026-11-15'; // the demo's "today": DEMO_TODAY_LAST + 1
  const nowMs = Date.parse(`${today}T09:00:00Z`);
  const run = () => {
    const all = makeAllPatients();
    let ravi = all.find((p) => p.id === 'ravi')!;
    for (let i = 0; i < DEMO_STEPS.length; i++) ravi = demoStepPatient(ravi, i, today);
    return { all, ravi };
  };
  it('Ravi ends URGENT via R5 on the third press, with A1, A3 and A4 firing', () => {
    const { ravi } = run();
    const r = triage(ravi, getPack(ravi.packId), { nowMs });
    expect(r.tier).toBe('URGENT');
    expect(r.triggers.map((t) => t.ruleId)).toEqual(expect.arrayContaining(['R5', 'A1', 'A3', 'A4']));
    expect(ravi.daily.at(-1)!.date).toBe(today);
  });
  it('only Ravi changes: nobody else goes silent and their tiers stay as seeded', () => {
    const { all } = run();
    for (const p of all.filter((x) => x.id !== 'ravi')) {
      const r = triage(p, getPack(p.packId), { nowMs });
      expect(r.triggers.map((t) => t.ruleId)).not.toContain('S1');
    }
    const tiers = Object.fromEntries(all.filter((x) => x.id !== 'ravi').map((p) => [p.id, triage(p, getPack(p.packId), { nowMs }).tier]));
    expect(tiers).toEqual({ meera: 'SAFETY', arjun: 'REVIEW', sana: 'ON_PLAN', kamla: 'REVIEW', imran: 'REVIEW' });
    const meera = all.find((p) => p.id === 'meera')!;
    const m = triage(meera, getPack(meera.packId), { nowMs });
    expect(m.tier).toBe('SAFETY');
    expect((nowMs - m.dueByMs!) / 3_600_000).toBeLessThan(24); // not dozens of hours past deadline
  });
  it('the proposal visibly tightens Ravi from every 3 days to daily for 7 days', () => {
    const { ravi } = run();
    const pack = getPack(ravi.packId);
    const r = triage(ravi, pack, { nowMs });
    const prop = pendingProposal(ravi, pack, r, today, nowMs)!;
    expect(prop.before.checkInEveryDays).toBe(3);
    expect(prop.after.checkInEveryDays).toBe(1);
    expect(prop.after.forDays).toBe(7);
  });
});

describe('personalisation in the demo (fix phase 3)', () => {
  const nowMs = Date.parse('2026-11-15T09:00:00Z');
  it('Sana is offered fewer check-ins; nobody else is', async () => {
    const { scheduleSuggestion } = await import('../src/engine/schedule');
    const all = makeAllPatients();
    const got = Object.fromEntries(all.map((p) => { const pk = getPack(p.packId); return [p.id, scheduleSuggestion(p, pk, triage(p, pk, { nowMs }), '2026-11-15', nowMs)?.kind ?? null]; }));
    expect(got).toEqual({ ravi: null, meera: null, arjun: null, sana: 'reduce', kamla: null, imran: null });
  });
  it('Kamla\'s usual pain is about 5 and an ordinary day is not flagged as pain above usual', async () => {
    const { usualValue } = await import('../src/engine/triage');
    const k = by('kamla');
    expect(usualValue(k, 'pain', k.daily.at(-1)!.date)!.usual).toBe(5);
    expect(tier('kamla').triggers.map((t) => t.ruleId)).not.toContain('A8');
  });
  it('Ravi and Sana have the same surgery and phase but different personal doses', () => {
    const r = by('ravi'), s = by('sana');
    expect(r.packId).toBe(s.packId);
    expect(r.currentPhase).toBe(s.currentPhase);
    expect(r.plan.doses?.squats).not.toEqual(s.plan.doses?.squats);
  });
});

describe('missed check-in reminders (fix phase 5, simulated)', () => {
  it('Kamla missed 2 check-ins: patient reminded, then the carer; not yet silent enough for S1', async () => {
    const { missedCheckIns } = await import('../src/reminders');
    const k = by('kamla');
    const m = missedCheckIns(k, getPack(k.packId), '2026-11-15');
    expect(m.missed).toBe(2);
    expect(m.steps.map((s) => s.kind)).toEqual(['patient', 'carer']);
    const r = triage(k, getPack(k.packId), { nowMs: Date.parse('2026-11-15T09:00:00Z') });
    expect(r.triggers.map((t) => t.ruleId)).not.toContain('S1');
    expect(r.tier).toBe('REVIEW');
  });
  it('everyone else is up to date', async () => {
    const { missedCheckIns } = await import('../src/reminders');
    for (const p of makeAllPatients().filter((x) => x.id !== 'kamla')) expect(missedCheckIns(p, getPack(p.packId), '2026-11-15').missed).toBe(0);
  });
});

describe('per-exercise record (physio feedback phase 3)', () => {
  it('combines guided sessions and check-ins: done, skipped, stopped because it hurt', async () => {
    const { exerciseRecord } = await import('../src/exerciseRecord');
    const r = by('ravi');
    const d = DEMO_TODAY_LAST;
    const rec = exerciseRecord(r, ['lunges', 'step-ups', 'squats'], [d]);
    expect(rec.lunges[d].status).toBe('done');
    expect(rec['step-ups'][d]).toMatchObject({ status: 'skipped', reason: 'skipped' });
    expect(rec.squats[d]).toMatchObject({ status: 'hurt', pain: 5 });
    expect(rec.squats[d].lines.join(' ')).toContain('struggling');
  });
  it('fast-forward moves Ravi\'s sessions with his days, and he still ends URGENT via R5', () => {
    let ravi = by('ravi');
    for (let i = 0; i < DEMO_STEPS.length; i++) ravi = demoStepPatient(ravi, i, '2026-11-15');
    // The session from his original last check-in day moves back with that day (two presses shift the history by one day each).
    const day = ravi.sessions!.at(-1)!.date;
    expect(day).toBe('2026-11-12');
    expect(ravi.daily.find((e) => e.date === day)?.values.pain).toBe(2);
    const r = triage(ravi, getPack(ravi.packId), { nowMs: Date.parse('2026-11-15T09:00:00Z') });
    expect(r.tier).toBe('URGENT');
    expect(r.triggers.map((t) => t.ruleId)).toContain('R5');
  });
});
