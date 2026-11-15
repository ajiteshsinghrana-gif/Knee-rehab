import { describe, it, expect } from 'vitest';
import { saveQuestionnaire, saveWeekly, toDaily, newDraft, saveCheckIn } from '../src/checkin';
import { buildPatient, decodeInvite, encodeInvite } from '../src/onboarding';
import { DICT } from '../src/i18n';
import { triage } from '../src/engine/triage';
import { getPack } from '../src/engine/packs';
import { aclPack } from './helpers';

const full = (p: ReturnType<typeof buildPatient>, signId?: string) => {
  const pack = getPack(p.packId);
  const d = newDraft(pack, p);
  return {
    ...d,
    values: Object.fromEntries(Object.keys(d.values).map((k) => [k, k === 'pain' ? 3 : 'same'])),
    results: Object.fromEntries(Object.keys(d.results).map((k) => [k, { done: true, reason: null }])),
    hardMovement: 'none',
    warnings: Object.fromEntries(pack.warningSigns.map((w) => [w.id, w.id === signId])),
    precautionBreaches: Object.fromEntries(Object.keys(d.precautionBreaches).map((k) => [k, false])),
  } as typeof d;
};
const mk = (caregiver?: boolean) => buildPatient({ name: 'Kamla', age: 67, language: 'hi', packId: 'total-knee-replacement', anchorDate: '2026-11-01', phaseId: 'p1', exercises: getPack('total-knee-replacement').phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [], ...(caregiver !== undefined ? { caregiver } : {}) }, { nowMs: Date.parse('2026-11-15T09:00:00Z'), today: '2026-11-15', id: 'k' });

describe('caregiver mode (Phase 5.3)', () => {
  it('the physio can set it at onboarding and it travels in the invite', () => {
    expect(mk(true).caregiverMode).toBe(true);
    expect(mk().caregiverMode).toBeUndefined();
    expect(decodeInvite(encodeInvite(mk(true)))?.patient.caregiverMode).toBe(true);
    expect(decodeInvite(encodeInvite(mk()))?.patient.caregiverMode).toBeUndefined();
  });
  it('a daily check-in records who answered', () => {
    const p = mk(true); const pack = getPack(p.packId);
    const d = full(p);
    expect(toDaily(d, p, '2026-11-15', { answeredBy: 'caregiver' }).answeredBy).toBe('caregiver');
    expect(toDaily(d, p, '2026-11-15').answeredBy).toBe('patient');
  });
  it('weekly and monthly entries record a caregiver, and leave patient entries unmarked', () => {
    const base = aclPack();
    const p = buildPatient({ name: 'A', age: 30, language: 'en', packId: base.id, anchorDate: '2026-10-01', phaseId: 'p1', exercises: base.phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: Date.parse('2026-11-15T09:00:00Z'), today: '2026-11-15', id: 'a' });
    const q = base.questionnaires[0];
    const withQ = saveQuestionnaire(base, p, q.id, '2026-11-15', q.items.map(() => 1), 'caregiver');
    expect(withQ.periodic.at(-1)?.answeredBy).toBe('caregiver');
    const own = saveQuestionnaire(base, p, q.id, '2026-11-15', q.items.map(() => 1));
    expect(own.periodic.at(-1)?.answeredBy).toBeUndefined();
  });
  it('triage ignores who answered: a carer reporting a warning sign still gives SAFETY', () => {
    const p = mk(true); const pack = getPack(p.packId);
    const sign = pack.warningSigns.find((w) => w.tier === 'SAFETY')!;
    const e = toDaily(full(p, sign.id), p, '2026-11-15', { answeredBy: 'caregiver', recordedAt: Date.parse('2026-11-15T09:00:00Z') });
    expect(triage(saveCheckIn(p, e), pack).tier).toBe('SAFETY');
  });
  it('caregiver strings exist in every language', () => {
    for (const l of ['en', 'hi', 'bn'] as const) for (const k of ['caregiverToggle', 'caregiverHint', 'caregiverBanner']) expect(DICT[l][k]).toBeDefined();
    expect(DICT.hi.caregiverToggle).toMatch(/\{name\}/);
    expect(DICT.bn.caregiverBanner).toMatch(/\{name\}/);
  });
});
