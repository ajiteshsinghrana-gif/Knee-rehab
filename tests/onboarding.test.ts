import { describe, it, expect } from 'vitest';
import { buildPatient, decodeInvite, encodeInvite, inviteUrl, validateOnboard, type OnboardDraft } from '../src/onboarding';
import { currentExercises, currentFollowUp } from '../src/engine/plan';
import { triage } from '../src/engine/triage';
import { qrMatrix, qrSvg } from '../src/qr';
import { getPack } from '../src/engine/packs';
import { toMs } from '../src/engine/dates';

const NOW = toMs('2026-11-15') + 9 * 3_600_000;
const base: OnboardDraft = { name: 'Asha', age: 41, language: 'hi', packId: 'total-knee-replacement', anchorDate: '2026-11-01', phaseId: 'p1', exercises: ['heel-slides', 'quad-set', 'walking-aid', 'ankle-pumps', 'ice-elevation', 'straight-leg-raise'], checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] };
const pack = getPack('total-knee-replacement');

describe('onboarding (Phase 3.1)', () => {
  it('validates the form', () => {
    expect(validateOnboard({ ...base, name: ' ' }, '2026-11-15')).toContain('Enter the patient name');
    expect(validateOnboard({ ...base, anchorDate: '2027-01-01' }, '2026-11-15').join()).toMatch(/future/);
    expect(validateOnboard({ ...base, exercises: [] }, '2026-11-15').join()).toMatch(/at least one/);
    expect(validateOnboard(base, '2026-11-15')).toEqual([]);
  });
  it('a default pack gives a plain plan, an empty history and an ON_PLAN start', () => {
    const p = buildPatient(base, { nowMs: NOW, today: '2026-11-15' });
    expect(currentExercises(p, pack)).toEqual(pack.phases[0].exercises);
    expect(p.daily).toEqual([]);
    expect(p.notices).toEqual([]);
    expect(triage(p, pack, { nowMs: NOW }).tier).toBe('ON_PLAN');
    expect(p.audit[0].action).toBe('onboard');
  });
  it('exercise, follow-up and threshold adjustments go through the audited actions', () => {
    const p = buildPatient({ ...base, exercises: ['heel-slides', 'quad-set', 'cycling'], checkInEveryDays: 2, reviewEveryDays: 3, overrides: [{ target: 'rule:R3:stage:0', value: 8, reason: 'high baseline pain' }] }, { nowMs: NOW, today: '2026-11-15' });
    expect(currentExercises(p, pack).sort()).toEqual(['cycling', 'heel-slides', 'quad-set']);
    expect(currentFollowUp(p, pack, '2026-11-15')).toMatchObject({ checkInEveryDays: 2, nextReviewDate: '2026-11-18' });
    expect(p.plan.overrides[0]).toMatchObject({ value: 8, reason: 'high baseline pain' });
    expect(p.audit.map((a) => a.action)).toEqual(['onboard', 'set-exercises', 'change-follow-up', 'set-override']);
    expect(p.notices).toEqual([]);
  });
});

describe('invite link and QR (Phase 3.1)', () => {
  it('round-trips the patient and plan, in Hindi', () => {
    const p = buildPatient({ ...base, name: 'आशा', exercises: ['heel-slides', 'cycling'] }, { nowMs: NOW, today: '2026-11-15' });
    const url = inviteUrl(p, 'https://x.github.io/Knee-rehab/');
    const back = decodeInvite(url.split('#join=')[1])!.patient;
    expect(back.name).toBe('आशा');
    expect(back.id).toBe(p.id);
    expect(currentExercises(back, pack).sort()).toEqual(['cycling', 'heel-slides']);
    expect(back.daily).toEqual([]);
  });
  it('rejects damaged links and unknown conditions', () => {
    expect(decodeInvite('not-base64!!')).toBeNull();
    expect(decodeInvite(encodeInvite({ ...buildPatient(base, { nowMs: NOW, today: '2026-11-15' }), packId: 'nope' }))).toBeNull();
  });
  it('the QR code is a square matrix with finder patterns, and fits a real invite', () => {
    const p = buildPatient(base, { nowMs: NOW, today: '2026-11-15' });
    const m = qrMatrix(inviteUrl(p, 'https://ajiteshsinghrana-gif.github.io/Knee-rehab/'));
    expect(m.length).toBe(m[0].length);
    expect(m[0][0] && m[0][6] && m[6][0] && m[3][3]).toBe(true);
    expect(qrSvg('hello').startsWith('<svg')).toBe(true);
    expect(() => qrMatrix('x'.repeat(5000))).toThrow();
  });
});
