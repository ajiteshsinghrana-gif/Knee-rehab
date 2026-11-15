import { describe, it, expect } from 'vitest';
import { blankBi, blankDraft, buildConditionPack, placeholderAlerts, restoreAuthoredPack, validateDraft, type ConditionDraft } from '../src/author/condition';
import { PACKS, getPack } from '../src/engine/packs';
import { getExercise, unregisterExercise, LIBRARY } from '../src/exercises/library';
import { validatePack } from '../src/engine/validator';
import { collectSignoffs } from '../src/engine/signoff';
import { buildPatient, decodeInvite, encodeInvite } from '../src/onboarding';
import { evaluateGate } from '../src/engine/gates';
import { triage } from '../src/engine/triage';
import { currentExercises } from '../src/engine/plan';
import { dailyEntry } from '../src/demo/seed';
import { addDays, toMs } from '../src/engine/dates';
import { ids } from './helpers';
import type { Patient } from '../src/types';

// A made-up protocol used only as a test fixture. None of these numbers is clinical guidance.
const NOW = toMs('2026-11-15') + 9 * 3_600_000;
const draft = (id = 'custom-test1'): ConditionDraft => ({
  ...blankDraft(id),
  condition: { en: 'Test condition', hi: 'परीक्षण स्थिति' },
  anchorLabel: { en: 'after the injury', hi: 'चोट के बाद' },
  exercises: [{ id: `${id}-e1`, name: { en: 'Seated march', hi: 'बैठकर मार्च' } }, { id: `${id}-e2`, name: { en: 'Wall lean', hi: 'दीवार पर झुकना' }, doseText: { en: '10 times, twice a day', hi: 'दिन में दो बार 10 बार' } }],
  phases: [
    { name: { en: 'Phase 1', hi: 'चरण 1' }, exercises: [`${id}-e1`, 'ankle-pumps'], sessionsPerDay: 2, followUpEveryDays: 7, weeksMin: 0, weeksMax: 4 },
    { name: { en: 'Phase 2', hi: 'चरण 2' }, exercises: [`${id}-e2`], sessionsPerDay: 1, followUpEveryDays: 14, weeksMin: 0, weeksMax: null },
  ],
  measures: [{ id: 'm1', label: { en: 'Walking distance', hi: 'चलने की दूरी' }, unit: 'm', min: 0, max: 500, step: 10 }],
  gates: [{ from: 0, criteria: [{ measure: 'm1', operator: '>=', value: 50 }] }],
  rules: [{ measure: 'pain', operator: '>=', value: 6, tier: 'URGENT' }],
  precautions: [{ label: { en: 'Twisting', hi: 'मुड़ना' }, question: { en: 'Did you twist your body?', hi: 'क्या आपने शरीर को मोड़ा?' }, phases: [0] }],
  signs: [{ label: { en: 'Dizziness', hi: 'चक्कर' }, tier: 'REVIEW' }],
  alerts: placeholderAlerts(),
});
const cleanup = (id: string) => { delete PACKS[id]; for (const e of [...LIBRARY]) if (e.id.startsWith(id)) unregisterExercise(e.id); };
const patientOn = (packId: string): Patient => buildPatient({ name: 'Test', age: 50, language: 'en', packId, anchorDate: '2026-11-01', phaseId: 'p1', exercises: getPack(packId).phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: NOW, today: '2026-11-15', id: 'tp' });
const withDays = (p: Patient, n: number, f: (d: number) => { pain?: number; warnings?: Record<string, boolean> } = () => ({})): Patient => ({
  ...p, daily: Array.from({ length: n }, (_, i) => dailyEntry(getPack(p.packId), { date: addDays('2026-11-14', i + 1 - n), pain: f(i + 1).pain ?? 2, swelling: 'less', ex: 'all', per: 2, hard: 'none', warnings: f(i + 1).warnings })),
});

describe('physio-written condition (Phase 3.3)', () => {
  it('a complete draft builds a pack that passes the same validator as the shipped packs', () => {
    const d = draft('custom-t1');
    expect(validateDraft(d)).toEqual([]);
    const pack = buildConditionPack(d);
    expect(validatePack(pack)).toEqual([]);
    expect(PACKS['custom-t1']).toBe(pack);
    expect(getExercise('custom-t1-e1')?.name.hi).toBe('बैठकर मार्च');
    expect(pack.phases.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(pack.gates).toHaveLength(1);
    cleanup('custom-t1');
  });
  it('the universal red-flag signs are always present and cannot be left out', () => {
    const pack = buildConditionPack(draft('custom-t2'));
    const safety = pack.warningSigns.filter((s) => s.tier === 'SAFETY').map((s) => s.id);
    expect(safety).toEqual(['calfPainOrRedness', 'fever', 'woundDischarge', 'spreadingRedness', 'chestPainBreathless']);
    expect(pack.warningSigns.find((s) => s.id === 'extra1')).toMatchObject({ tier: 'REVIEW', ruleId: 'X1' });
    const p = withDays(patientOn('custom-t2'), 3, (d) => ({ warnings: d === 3 ? { fever: true } : {} }));
    expect(triage(p, pack, { nowMs: NOW }).tier).toBe('SAFETY');
    cleanup('custom-t2');
  });
  it('a threshold the physio wrote fires, with its own source tag', () => {
    const pack = buildConditionPack(draft('custom-t3'));
    const p = withDays(patientOn('custom-t3'), 3, (d) => ({ pain: d === 3 ? 7 : 2 }));
    const r = triage(p, pack, { nowMs: NOW });
    expect(r.tier).toBe('URGENT');
    expect(r.triggers.find((t) => t.ruleId === 'T1')?.source).toBe('PHYSIO_AUTHORED');
    cleanup('custom-t3');
  });
  it('a gate on the physio\'s own measure lets the physio sign off only when it is met', () => {
    const pack = buildConditionPack(draft('custom-t4'));
    let p = withDays(patientOn('custom-t4'), 2);
    expect(evaluateGate(p, pack, '2026-11-14')?.canSignOff).toBe(false);
    p = { ...p, periodic: [{ date: '2026-11-14', values: { m1: 80 } }] };
    expect(evaluateGate(p, pack, '2026-11-14')?.canSignOff).toBe(true);
    expect(currentExercises(p, pack)).toEqual(['custom-t4-e1', 'ankle-pumps']);
    cleanup('custom-t4');
  });
  it('placeholders are tagged NEEDS_PHYSIO_SIGNOFF; numbers the physio typed are not', () => {
    const d = draft('custom-t5');
    d.alerts = { ...placeholderAlerts(), hours: { SAFETY: 1, URGENT: 12, REVIEW: 48 } };
    d.alerts.source.hours = 'physio';
    const pack = buildConditionPack(d);
    expect(pack.responseHours.URGENT).toEqual({ hours: 12, source: 'PHYSIO_AUTHORED' });
    expect(pack.followUpProposal.source).toBe('NEEDS_PHYSIO_SIGNOFF');
    const list = collectSignoffs(pack);
    expect(list.filter((x) => x.needsSignoff).length).toBeGreaterThan(0);
    expect(list.find((x) => x.where.includes('responseHours.URGENT'))?.needsSignoff).toBe(false);
    expect(getExercise('custom-t5-e1')?.dose.source).toBe('NEEDS_PHYSIO_SIGNOFF'); // no dose written: generic wording, still to confirm
    expect(getExercise('custom-t5-e2')?.dose.source).toBe('PHYSIO_AUTHORED');
    cleanup('custom-t5');
  });
  it('says what is missing in plain words, including Hindi', () => {
    const d = draft('custom-t6');
    d.condition.hi = '';
    d.gates = [];
    d.alerts = null;
    d.phases[1].exercises = [];
    const e = validateDraft(d).join(' | ');
    expect(e).toMatch(/Name the condition in English and Hindi/);
    expect(e).toMatch(/Phase 1 to 2: add at least one criterion/);
    expect(e).toMatch(/Set the alert timings/);
    expect(e).toMatch(/Phase 2: choose at least one exercise/);
    expect(() => buildConditionPack(d)).toThrow();
    expect(PACKS['custom-t6']).toBeUndefined();
    expect(getExercise('custom-t6-e1')).toBeUndefined(); // nothing is left behind by a refused build
  });
  it('a pack the validator refuses leaves no exercises behind', () => {
    const d = draft('custom-t7');
    d.rules = [{ measure: 'nope', operator: '>=', value: 1, tier: 'REVIEW' }];
    expect(validateDraft(d).join()).toMatch(/choose a measure/);
    expect(() => buildConditionPack(d)).toThrow();
    expect(getExercise('custom-t7-e1')).toBeUndefined();
  });
  it('an invite for a patient on this condition rebuilds the condition on another device', () => {
    const pack = buildConditionPack(draft('custom-t8'));
    const code = encodeInvite(patientOn('custom-t8'));
    cleanup('custom-t8'); // the other device has never seen this condition
    expect(PACKS['custom-t8']).toBeUndefined();
    const inv = decodeInvite(code)!;
    expect(inv.pack?.id).toBe('custom-t8');
    expect(PACKS['custom-t8']).toBeDefined();
    expect(getExercise('custom-t8-e1')?.name.en).toBe('Seated march');
    expect(currentExercises(inv.patient, PACKS['custom-t8'])).toEqual(['custom-t8-e1', 'ankle-pumps']);
    expect(pack.authored).toBeDefined();
    cleanup('custom-t8');
  });
  it('a saved pack restores its own exercises when the app reloads', () => {
    const pack = JSON.parse(JSON.stringify(buildConditionPack(draft('custom-t9'))));
    cleanup('custom-t9');
    restoreAuthoredPack(pack);
    expect(PACKS['custom-t9']).toBeDefined();
    expect(getExercise('custom-t9-e2')).toBeDefined();
    cleanup('custom-t9');
  });
  it('a condition with one phase and no gates is allowed', () => {
    const d = draft('custom-t10');
    d.phases = [d.phases[0]]; d.gates = [];
    const rules = buildConditionPack(d).rules.map((r) => r.id);
    expect(rules).not.toContain('A6');
    expect(rules).toContain('P1');
    cleanup('custom-t10');
  });
  it('a tampered invite is refused by the validator, not trusted', () => {
    buildConditionPack(draft('custom-t11'));
    const code = encodeInvite(patientOn('custom-t11'));
    cleanup('custom-t11');
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    json.ca.alerts = null;
    const bad = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(json)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeInvite(bad)).toBeNull();
    expect(PACKS['custom-t11']).toBeUndefined();
    expect(getExercise('custom-t11-e1')).toBeUndefined();
  });
});
