import { describe, it, expect } from 'vitest';
import { buildPatient, decodeInvite, encodeInvite, inviteUrl, validateOnboard, type OnboardDraft } from '../src/onboarding';
import { cameraOn } from '../src/formcheck/model';
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
    expect(validateOnboard({ ...base, exercises: [] }, '2026-11-15')).toEqual([]); // a phase may prescribe no listed exercises (Phase 6.8)
    expect(validateOnboard(base, '2026-11-15')).toEqual([]);
  });
  it('a default pack gives a plain plan, an empty history and an ON_PLAN start', () => {
    const p = buildPatient(base, { nowMs: NOW, today: '2026-11-15' });
    expect(currentExercises(p, pack)).toEqual(pack.phases[0].exercises);
    expect(p.daily).toEqual([]);
    expect(p.notices).toEqual([]);
    expect(triage(p, pack, { nowMs: NOW }).tier).toBe('ON_PLAN');
    expect(p.audit[0].action).toBe('onboard');
    expect(cameraOn(p)).toBe(true); // the camera check is on for new patients
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

describe('General (no surgery) patient (fix phase 5)', () => {
  it('can be added with exercises the physio types freely', async () => {
    const { buildPatient } = await import('../src/onboarding');
    const p = buildPatient({ name: 'Test', age: 50, language: 'en', packId: 'general', anchorDate: '2026-11-01', phaseId: 'p1', exercises: ['walking'], checkInEveryDays: 1, reviewEveryDays: 7, overrides: [], ownExercises: 'Wall push-ups: 2 x 10\n\nWalk 15 minutes after lunch', details: { diagnosis: 'Frozen shoulder' } }, { nowMs: Date.parse('2026-11-15T09:00:00Z'), today: '2026-11-15' });
    expect(p.packId).toBe('general');
    expect((p.plan.instructions ?? []).map((x) => x.text)).toEqual(['Wall push-ups: 2 x 10', 'Walk 15 minutes after lunch']);
    expect(p.notices).toEqual([]);
  });
});

describe('add any patient quickly (physio feedback phase 2)', () => {
  const base = { name: 'Asha', age: 0, language: 'en' as const, packId: 'general', anchorDate: '2026-11-01', phaseId: 'p1', exercises: ['walking'], checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] };
  const ctx = { nowMs: Date.parse('2026-11-15T09:00:00Z'), today: '2026-11-15' };
  it('General needs a typed diagnosis; age is optional', async () => {
    const { buildPatient, validateOnboard } = await import('../src/onboarding');
    expect(validateOnboard(base, ctx.today)).toContain('Type the diagnosis');
    const p = buildPatient({ ...base, details: { diagnosis: 'Low back pain', phone: '+91 00000 00009', diabetes: true, goal: 'Walk to the temple' } }, ctx);
    expect(p.age).toBe(0);
    expect(p.details).toMatchObject({ diagnosis: 'Low back pain', diabetes: true, goal: 'Walk to the temple' });
  });
  it('starting from a template copies its doses and notes and says so in the audit log', async () => {
    const { buildPatient } = await import('../src/onboarding');
    const p = buildPatient({ ...base, details: { diagnosis: 'Knee OA' }, advice: 'Ice 15 minutes after exercise.', template: { name: 'Knee OA starter', doses: { walking: { sets: 1, reps: null, holdSec: null, perDay: 2 } }, exerciseNotes: { walking: 'Flat ground only.' } } }, ctx);
    expect(p.plan.doses?.walking).toMatchObject({ perDay: 2 });
    expect(p.plan.exerciseNotes?.walking?.text).toBe('Flat ground only.');
    expect(p.plan.advice?.text).toBe('Ice 15 minutes after exercise.');
    expect(p.audit[0].note).toContain('Knee OA starter');
    expect(p.notices).toEqual([]);
  });
});
