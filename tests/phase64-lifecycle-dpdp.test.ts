import { describe, it, expect } from 'vitest';
// @ts-ignore plain JS helper
import { startFake } from '../scripts/fake-supabase.mjs';
import { _resetAuth, getAccessToken, getSession, recoveryTokenFromHash, requestPasswordReset, setNewPassword, signIn, signUp } from '../src/sync/auth';
import { claimKey, claimPatient, deleteMyAccount, eraseKeyData, newClaimPin, newSyncKey, PinError, pullSlice, pushSlice, setClaimHash, sha256Hex } from '../src/sync/client';
import { createPatientAccount } from '../src/sync/account';
import { applyDown, applyUp, downSlice, upSlice } from '../src/sync/slices';
import { CONSENT_VERSION, completeTreatment, eraseLocal, exportMyData, isActive, reopenTreatment, retentionDue, retentionEnd } from '../src/lifecycle';
import { applyManual } from '../src/engine/plan';
import { buildPatient, decodeInvite, encodeInvite } from '../src/onboarding';
import { getPack } from '../src/engine/packs';
import { clockMs, realToday, type AppState } from '../src/store';
import { t } from '../src/i18n';
import type { Patient } from '../src/types';

const NOW = Date.parse('2026-11-15T09:00:00Z');
const ctx = { nowMs: NOW, today: '2026-11-15' };
const pack = getPack('total-knee-replacement');
const mk = (): Patient => buildPatient({ name: 'Asha', age: 60, language: 'en', packId: pack.id, anchorDate: '2026-11-01', phaseId: 'p1', exercises: pack.phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: NOW, today: '2026-11-15', id: 'asha' });
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const rejects = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { return e as Error; } return null; };

describe('treatment complete and past patients (Phase 6.4)', () => {
  it('needs a note, is audit-logged, keeps the whole record, and can be reopened', () => {
    expect(() => completeTreatment(mk(), '  ', ctx)).toThrow(/note/i);
    const done = completeTreatment(mk(), 'Goals met, discharged', ctx);
    expect(done.status).toBe('completed'); expect(isActive(done)).toBe(false);
    expect(done.completedAt).toBe('2026-11-15T09:00:00.000Z');
    expect(done.audit[done.audit.length - 1]).toMatchObject({ action: 'complete-treatment', note: 'Goals met, discharged', manual: true });
    expect(done.daily).toEqual(mk().daily);
    expect(() => completeTreatment(done, 'again', ctx)).toThrow(/already/i);
    expect(() => reopenTreatment(done, '', ctx)).toThrow(/why/i);
    const back = reopenTreatment(done, 'Flare-up', ctx);
    expect(isActive(back)).toBe(true); expect(back.completedAt).toBeUndefined(); expect(back.audit).toHaveLength(mk().audit.length + 2);
    expect(() => reopenTreatment(mk(), 'x', ctx)).toThrow(/already active/i);
  });
  it('retention end is completion plus the clinic period; due only after it', () => {
    const done = completeTreatment(mk(), 'done', ctx);
    expect(retentionEnd(mk(), 3)).toBeNull();
    expect(retentionEnd(done, 3)).toBe('2029-11-15');
    expect(retentionDue(done, 3, '2029-11-14')).toBe(false);
    expect(retentionDue(done, 3, '2029-11-15')).toBe(true);
    expect(retentionDue(done, 0, '2026-11-15')).toBe(true);
  });
  it('completion reaches the patient phone, the physio note does not; reopening clears it', () => {
    const done = completeTreatment(mk(), 'private reason', ctx);
    const slice = JSON.parse(JSON.stringify(downSlice(done)));
    expect(JSON.stringify(slice)).not.toContain('private reason');
    const phone = applyDown(mk(), slice);
    expect(phone.status).toBe('completed'); expect(phone.completedAt).toBe(done.completedAt);
    const reopened = applyDown(phone, JSON.parse(JSON.stringify(downSlice(reopenTreatment(done, 'again', ctx)))));
    expect(reopened.status).toBeUndefined();
  });
});

describe('data rights (Phase 6.4)', () => {
  it('consent and an erasure request travel from the patient to the physio, and are bounded', () => {
    const phone = { ...mk(), consent: { version: CONSENT_VERSION, at: '2026-11-15T10:00:00.000Z' }, erasureRequestedAt: '2026-12-01T00:00:00.000Z' };
    const physio = applyUp(mk(), JSON.parse(JSON.stringify(upSlice(phone))));
    expect(physio.consent).toEqual(phone.consent); expect(physio.erasureRequestedAt).toBe(phone.erasureRequestedAt);
    const junk = applyUp(mk(), { v: 1, daily: [], periodic: [], consent: { version: 5 }, erasureRequestedAt: 7 });
    expect(junk.consent).toBeUndefined(); expect(junk.erasureRequestedAt).toBeUndefined();
    expect(applyUp(mk(), { v: 1, daily: [], periodic: [], erasureRequestedAt: 'x'.repeat(500) }).erasureRequestedAt!.length).toBe(40);
  });
  it('the physio message about keeping a record reaches the patient, capped', () => {
    const p = { ...mk(), erasureNote: 'We must keep it until 2029.' };
    expect(applyDown(mk(), JSON.parse(JSON.stringify(downSlice(p)))).erasureNote).toBe('We must keep it until 2029.');
    expect(applyDown(mk(), JSON.parse(JSON.stringify(downSlice({ ...p, erasureNote: 'y'.repeat(900) })))).erasureNote!.length).toBe(300);
  });
  it('"download my data" holds the patient\'s own data and none of the physio\'s private notes', () => {
    let p = applyManual(mk(), pack, { type: 'add-instruction', text: 'Ice twice daily' }, 'secret clinical reason', ctx);
    p = { ...p, decisions: [{ at: 'x', flagKey: null, action: 'a', status: 'approved', note: 'secret decision note' }], completionNote: 'secret completion note' };
    const out = JSON.stringify(exportMyData(p, pack.condition.en, NOW));
    expect(out).toContain('Ice twice daily'); expect(out).toContain('Asha');
    for (const secret of ['secret clinical reason', 'secret decision note', 'secret completion note']) expect(out).not.toContain(secret);
  });
  it('erasing removes the patient and logs only when, why and whether an account existed', () => {
    const a = { ...mk(), accountEmail: 'asha@example.com' };
    const s = { version: 1, patients: [a, { ...mk(), id: 'b', name: 'Bela' }], activeId: 'asha', today: '2026-11-15', demoStep: 0 } as AppState;
    const out = eraseLocal(s, 'asha', 'patient request', NOW);
    expect(out.patients.map((p) => p.id)).toEqual(['b']); expect(out.activeId).toBe('b');
    expect(out.erasureLog).toEqual([{ at: '2026-11-15T09:00:00.000Z', reason: 'patient request', hadAccount: true }]);
    expect(JSON.stringify(out.erasureLog)).not.toMatch(/asha|Asha|example/);
  });
  it('the privacy notice and the new screens exist in English, Hindi and Bengali', () => {
    for (const l of ['en', 'hi', 'bn'] as const) for (const k of ['privTitle', 'privBody1', 'privBody3', 'privRights', 'privAgree', 'myDataErase', 'myDataDownload', 'doneTitle', 'resetTitle', 'acctForgot', 'acctPin']) expect(t(l, k)).not.toBe(k);
    expect(t('en', 'privRights', { contact: '98765' })).toContain('98765');
  });
});

describe('real date and clock (Phase 6.4)', () => {
  it('live mode uses the device clock; demo mode keeps the demo clock', () => {
    const s = { version: 1, patients: [], activeId: '', today: '2026-11-15', demoStep: 0 } as AppState;
    expect(clockMs(s)).toBe(Date.parse('2026-11-15T09:00:00Z'));
    expect(Math.abs(clockMs({ ...s, live: true }) - Date.now())).toBeLessThan(1000);
    expect(realToday(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

async function world() {
  _resetAuth();
  const fake = await startFake(0);
  const cfg = { url: `http://127.0.0.1:${fake.port}`, anonKey: 'anon', auth: true };
  const physioStore = memStore();
  await signUp(cfg, 'dr@clinic.in', 'correct-horse', fetch, physioStore, NOW);
  const physio = getSession()!;
  const key = newSyncKey();
  return { fake, cfg, physio, key, base: { ...mk(), syncKey: key, syncRole: 'physio' as const } };
}

describe('claim PIN (Phase 6.4)', () => {
  it('a link with a PIN cannot be claimed without it; the right PIN works; the PIN is never stored', async () => {
    const { fake, cfg, physio, key, base } = await world();
    const pin = newClaimPin();
    expect(pin).toMatch(/^\d{8}$/);
    await claimKey(cfg, key, physio.accessToken, fetch, await sha256Hex(pin));
    expect(fake.claimHashes.get(key)).toBe(await sha256Hex(pin));
    expect(JSON.stringify([...fake.claimHashes])).not.toContain(pin);
    const patientStore = memStore();
    const none = await rejects(() => createPatientAccount(cfg, { ...base, syncRole: 'patient' }, 'a@x.in', 'longenough1', fetch, patientStore, NOW));
    expect(none instanceof PinError).toBe(true);
    const wrong = await rejects(() => createPatientAccount(cfg, { ...base, syncRole: 'patient' }, 'a@x.in', 'longenough1', fetch, patientStore, NOW, '00000000'));
    expect(wrong instanceof PinError).toBe(true);
    expect(fake.patients.size).toBe(0);
    await signIn(cfg, 'a@x.in', 'longenough1', fetch, patientStore, NOW);
    const tok = (await getAccessToken(cfg, fetch, patientStore, NOW))!;
    await claimPatient(cfg, key, encodeInvite(base), tok, fetch, pin);
    expect(fake.patients.size).toBe(1);
    await fake.close();
  });
  it('a link with no PIN still works, and the physio can set a new PIN later', async () => {
    const { fake, cfg, physio, key, base } = await world();
    await claimKey(cfg, key, physio.accessToken);
    const p2 = newSyncKey(); await claimKey(cfg, p2, physio.accessToken);
    const pin = newClaimPin();
    await setClaimHash(cfg, p2, await sha256Hex(pin), physio.accessToken);
    expect(fake.claimHashes.get(p2)).toBe(await sha256Hex(pin));
    const store = memStore();
    expect(await createPatientAccount(cfg, { ...base, syncRole: 'patient' }, 'b@x.in', 'longenough1', fetch, store, NOW)).toBe('done');
    await fake.close();
  });
  it('another physio cannot change somebody else\'s PIN', async () => {
    const { fake, cfg, physio, key } = await world();
    await claimKey(cfg, key, physio.accessToken, fetch, await sha256Hex('11112222'));
    const other = memStore();
    await signUp(cfg, 'dr2@clinic.in', 'correct-horse', fetch, other, NOW);
    const tok2 = (await getAccessToken(cfg, fetch, other, NOW))!;
    await setClaimHash(cfg, key, await sha256Hex('99999999'), tok2).catch(() => {});
    expect(fake.claimHashes.get(key)).toBe(await sha256Hex('11112222'));
    await fake.close();
  });
});

describe('erasing from the cloud (Phase 6.4)', () => {
  it('the owning physio erases rows, claim and ownership; anyone else erases nothing', async () => {
    const { fake, cfg, physio, key, base } = await world();
    await claimKey(cfg, key, physio.accessToken);
    await pushSlice(cfg, key, 'down', downSlice(base), fetch, physio.accessToken);
    const store = memStore();
    await createPatientAccount(cfg, { ...base, syncRole: 'patient' }, 'c@x.in', 'longenough1', fetch, store, NOW);
    const ptok = (await getAccessToken(cfg, fetch, store, NOW))!;
    await pushSlice(cfg, key, 'up', upSlice(base), fetch, ptok);
    expect(fake.rows.size).toBe(2);
    await eraseKeyData(cfg, key, ptok).catch(() => {}); // the patient is not the owner
    expect(fake.rows.size).toBe(2); expect(fake.patients.size).toBe(1);
    await eraseKeyData(cfg, key, physio.accessToken);
    expect(fake.rows.size).toBe(0); expect(fake.patients.size).toBe(0); expect(fake.owners.size).toBe(0);
    expect(await pullSlice(cfg, key, 'up', fetch, physio.accessToken)).toBeNull();
    await fake.close();
  });
  it('a patient can delete their own login; the login no longer works', async () => {
    const { fake, cfg, key, base, physio } = await world();
    await claimKey(cfg, key, physio.accessToken);
    const store = memStore();
    await createPatientAccount(cfg, { ...base, syncRole: 'patient' }, 'd@x.in', 'longenough1', fetch, store, NOW);
    await deleteMyAccount(cfg, (await getAccessToken(cfg, fetch, store, NOW))!);
    expect(fake.patients.size).toBe(0);
    expect((await rejects(() => signIn(cfg, 'd@x.in', 'longenough1', fetch, memStore(), NOW)))?.message).toMatch(/wrong email or password/i);
    await fake.close();
  });
});

describe('password reset (Phase 6.4)', () => {
  it('asks for a reset email, sets a new password from the emailed token, and the old password stops working', async () => {
    const { fake, cfg } = await world();
    await requestPasswordReset(cfg, 'dr@clinic.in', 'https://example.test/app/');
    expect(fake.log).toContain('RECOVER dr@clinic.in');
    // the emailed link carries a one-time token; in the fake, any live access token stands in for it
    const tok = (await getAccessToken(cfg, fetch, memStore(), NOW)) ?? [...fake.access.keys()][0];
    expect((await rejects(() => setNewPassword(cfg, tok, 'short')))?.message).toMatch(/8 characters/);
    await setNewPassword(cfg, tok, 'brand-new-pass');
    await signIn(cfg, 'dr@clinic.in', 'brand-new-pass', fetch, memStore(), NOW);
    expect((await rejects(() => signIn(cfg, 'dr@clinic.in', 'correct-horse', fetch, memStore(), NOW)))?.message).toMatch(/wrong email or password/i);
    await fake.close();
  });
  it('reads the token only from a recovery link', () => {
    expect(recoveryTokenFromHash('#access_token=abc&refresh_token=r&type=recovery')).toBe('abc');
    expect(recoveryTokenFromHash('#access_token=abc&type=signup')).toBeNull();
    expect(recoveryTokenFromHash('#join=xyz')).toBeNull();
    expect(recoveryTokenFromHash('')).toBeNull();
  });
});

describe('the invite carries the clinic contact, not the PIN', () => {
  it('contact is in the link; the claim PIN is not', () => {
    const p = { ...mk(), clinicContact: '98765 43210', claimPin: '12345678', syncKey: newSyncKey(), syncRole: 'physio' as const };
    const code = encodeInvite(p);
    expect(decodeInvite(code)!.patient.clinicContact).toBe('98765 43210');
    expect(Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1')).not.toContain('12345678');
    expect(JSON.stringify(decodeInvite(code)!.patient)).not.toContain('12345678');
  });
});
