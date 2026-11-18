import { describe, it, expect } from 'vitest';
// @ts-ignore plain JS helper
import { startFake } from '../scripts/fake-supabase.mjs';
import { _resetAuth, getAccessToken, getSession, setAuthScope, signIn, signUp } from '../src/sync/auth';
import { claimKey, claimPatient, LinkTakenError, listPatientLinks, newSyncKey, pullSlice, pushSlice, resetPatientLink } from '../src/sync/client';
import { getSyncStatus, syncOnce, type Env, type Memo } from '../src/sync/engine';
import { createPatientAccount, signInPatient } from '../src/sync/account';
import { applyUp, upSlice } from '../src/sync/slices';
import { applyManual } from '../src/engine/plan';
import { buildPatient, decodeInvite, encodeInvite } from '../src/onboarding';
import { getPack } from '../src/engine/packs';
import { dailyEntry } from '../src/demo/seed';
import { saveCheckIn } from '../src/checkin';
import type { Patient } from '../src/types';
import type { AppState } from '../src/store';

const NOW = Date.parse('2026-11-15T09:00:00Z');
const pack = getPack('total-knee-replacement');
const mkPatient = (): Patient => buildPatient({ name: 'Asha', age: 60, language: 'hi', packId: pack.id, anchorDate: '2026-11-01', phaseId: 'p1', exercises: pack.phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: NOW, today: '2026-11-15', id: 'asha' });
const device = (ps: Patient[]) => { let st = { version: 1, patients: ps, activeId: ps[0]?.id ?? '', today: '2026-11-15', demoStep: 0 } as AppState; return { get: () => st, set: (s: AppState) => { st = s; }, p: (i = 0) => st.patients[i] }; };
const memo = (): Memo => ({ pushed: new Map(), pulled: new Map() });
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m }; };
const rejects = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { return (e as Error).message; } return ''; };
const checkIn = (date: string, pain: number, recordedAt?: number) => ({ ...dailyEntry(pack, { date, pain, swelling: 'same', ex: 'all', per: 2, hard: 'none' }), ...(recordedAt !== undefined ? { recordedAt } : {}) });

async function world() {
  _resetAuth();
  const fake = await startFake(0);
  const cfg = { url: `http://127.0.0.1:${fake.port}`, anonKey: 'anon', auth: true };
  // physio account and a registered patient
  const physioStore = memStore();
  const physio = await signUp(cfg, 'dr@clinic.in', 'correct-horse', fetch, physioStore, NOW).then(() => getSession()!);
  const key = newSyncKey();
  const base = { ...mkPatient(), syncKey: key, syncRole: 'physio' as const };
  await claimKey(cfg, key, physio.accessToken);
  const invite = encodeInvite(base);
  return { fake, cfg, physio, key, base, invite };
}

describe('merge, not replace (Phase 6.3)', () => {
  it('an empty or older copy never erases history; the later recording of the same day wins', () => {
    const p = mkPatient();
    const a = { ...p, daily: [checkIn('2026-11-10', 3, 100), checkIn('2026-11-11', 4, 200)] };
    expect(applyUp(a, { ...upSlice(p), daily: [], periodic: [] }).daily).toHaveLength(2);
    const newer = applyUp(a, { ...upSlice(p), daily: [checkIn('2026-11-11', 6, 300), checkIn('2026-11-12', 2, 50)] });
    expect(newer.daily.map((d) => [d.date, d.values.pain])).toEqual([['2026-11-10', 3], ['2026-11-11', 6], ['2026-11-12', 2]]);
    const older = applyUp(a, { ...upSlice(p), daily: [checkIn('2026-11-11', 9, 10)] });
    expect(older.daily.find((d) => d.date === '2026-11-11')!.values.pain).toBe(4);
  });
  it('a weekly test and a monthly questionnaire on the same date are both kept', () => {
    const p = mkPatient();
    const up = { ...upSlice(p), periodic: [{ date: '2026-11-10', values: { flexionDeg: 90 } }, { date: '2026-11-10', values: { tsk11: 20 } }] };
    expect(applyUp(p, up).periodic).toHaveLength(2);
    expect(applyUp(applyUp(p, up), up).periodic).toHaveLength(2); // applying twice changes nothing
  });
});

describe('patient accounts (Phase 6.3)', () => {
  it('the first person with the link claims the patient; the link alone then stops working; the physio keeps access', async () => {
    const { fake, cfg, physio, key, base, invite } = await world();
    await pushSlice(cfg, key, 'down', { v: 1, plan: 'real' }, fetch, physio.accessToken);
    expect((await pullSlice(cfg, key, 'down'))!.data).toEqual({ v: 1, plan: 'real' }); // before: the link works

    const store = memStore();
    const phone = decodeInvite(invite)!.patient;
    expect(await createPatientAccount(cfg, phone, 'asha@mail.in', 'long-password', fetch, store, NOW)).toBe('done');
    expect(fake.patients.get(key)!.email).toBe('asha@mail.in');

    expect(await pullSlice(cfg, key, 'down')).toBeNull(); // the bare link is shut out
    expect(await rejects(() => pushSlice(cfg, key, 'up', { v: 1 }))).toMatch(/403/);
    const tok = (await getAccessToken(cfg, fetch, store, NOW))!;
    expect((await pullSlice(cfg, key, 'down', fetch, tok))!.data).toEqual({ v: 1, plan: 'real' }); // the patient's account reads the plan
    await pushSlice(cfg, key, 'up', { v: 1, answers: 1 }, fetch, tok); // and writes its answers
    expect(await rejects(() => pushSlice(cfg, key, 'down', { v: 1, plan: 'evil' }, fetch, tok))).toMatch(/403/); // but never the plan
    expect((await pullSlice(cfg, key, 'up', fetch, physio.accessToken))!.data).toEqual({ v: 1, answers: 1 }); // the physio still sees answers
    await pushSlice(cfg, key, 'down', { v: 1, plan: 'newer' }, fetch, physio.accessToken);
    await fake.close();
    void base;
  });

  it('a link can be claimed once; strangers and wrong keys are refused; the same account can ask again', async () => {
    const { fake, cfg, key, invite } = await world();
    const phone = decodeInvite(invite)!.patient;
    const s1 = memStore();
    await createPatientAccount(cfg, phone, 'asha@mail.in', 'long-password', fetch, s1, NOW);
    const t1 = (await getAccessToken(cfg, fetch, s1, NOW))!;
    await claimPatient(cfg, key, invite, t1); // the same account again: fine
    _resetAuth();
    const s2 = memStore();
    const other = await signUp(cfg, 'eve@mail.in', 'long-password', fetch, s2, NOW).then(() => getSession()!);
    await expect_throw(() => claimPatient(cfg, key, invite, other.accessToken), LinkTakenError);
    const key2 = newSyncKey();
    expect(await rejects(() => claimPatient(cfg, key2, invite, other.accessToken, ((u: any, i: any) => fetch(u, { ...i, headers: { ...i.headers, 'x-sync-key': key } })) as typeof fetch))).toMatch(/403/); // claim needs that patient's own link
    await fake.close();
  });

  it('sign in on a brand new phone: the patient and their whole history come back', async () => {
    const { fake, cfg, physio, key, base, invite } = await world();
    const phoneA = device([{ ...decodeInvite(invite)!.patient }]);
    const storeA = memStore();
    await createPatientAccount(cfg, phoneA.p(), 'asha@mail.in', 'long-password', fetch, storeA, NOW);
    phoneA.set({ ...phoneA.get(), patients: [{ ...phoneA.p(), accountEmail: 'asha@mail.in' }] });
    for (const [d, pain] of [['2026-11-12', 3], ['2026-11-13', 4]] as const) phoneA.set({ ...phoneA.get(), patients: [saveCheckIn(phoneA.p(), checkIn(d, pain, NOW))] });
    const authA = { token: () => getAccessToken(cfg, fetch, storeA, NOW), email: () => 'asha@mail.in' };
    await syncOnce({ getState: phoneA.get, setState: phoneA.set, config: cfg, auth: authA }, memo());

    // phone A is lost. A new phone, nothing on it:
    _resetAuth();
    const storeB = memStore();
    const restored = await signInPatient(cfg, 'asha@mail.in', 'long-password', undefined, fetch, storeB, NOW);
    expect(restored.patients).toHaveLength(1);
    expect(restored.patients[0].name).toBe('Asha');
    expect(restored.patients[0].accountEmail).toBe('asha@mail.in');
    const phoneB = device(restored.patients);
    const authB = { token: () => getAccessToken(cfg, fetch, storeB, NOW), email: () => 'asha@mail.in' };
    await syncOnce({ getState: phoneB.get, setState: phoneB.set, config: cfg, auth: authB }, memo());
    expect(phoneB.p().daily.map((d) => d.date)).toEqual(['2026-11-12', '2026-11-13']);
    // and the physio's copy was never emptied
    const row = await pullSlice(cfg, key, 'up', fetch, physio.accessToken);
    expect((row!.data as any).daily).toHaveLength(2);
    await fake.close();
    void base;
  });

  it('a patient already on a link-only phone does not lose history when the phone is reset and the link is opened again', async () => {
    const { fake, cfg, physio, key, base } = await world();
    const inviteLink = encodeInvite(base);
    const old = device([decodeInvite(inviteLink)!.patient]);
    old.set({ ...old.get(), patients: [saveCheckIn(old.p(), checkIn('2026-11-12', 5, NOW))] });
    await syncOnce({ getState: old.get, setState: old.set, config: cfg }, memo());
    // browser data cleared; the link is opened again on an empty phone
    const fresh = device([decodeInvite(inviteLink)!.patient]);
    expect(fresh.p().daily).toHaveLength(0);
    await syncOnce({ getState: fresh.get, setState: fresh.set, config: cfg }, memo());
    expect(fresh.p().daily).toHaveLength(1); // restored first
    const row = await pullSlice(cfg, key, 'up', fetch, physio.accessToken);
    expect((row!.data as any).daily).toHaveLength(1); // and the server's copy was not overwritten with nothing
    await fake.close();
  });

  it('a patient who already has an account can add a second link by signing in with it', async () => {
    const { fake, cfg, physio, invite } = await world();
    await createPatientAccount(cfg, decodeInvite(invite)!.patient, 'asha@mail.in', 'long-password', fetch, memStore(), NOW);
    const key2 = newSyncKey();
    await claimKey(cfg, key2, physio.accessToken);
    const second = decodeInvite(encodeInvite({ ...mkPatient(), id: 'asha2', name: 'Asha (shoulder)', syncKey: key2, syncRole: 'physio' }))!.patient;
    _resetAuth();
    const r = await signInPatient(cfg, 'asha@mail.in', 'long-password', second, fetch, memStore(), NOW);
    expect(r.patients.map((p) => p.name).sort()).toEqual(['Asha', 'Asha (shoulder)']);
    await fake.close();
  });

  it('wrong password restores nothing', async () => {
    const { fake, cfg, invite } = await world();
    await createPatientAccount(cfg, decodeInvite(invite)!.patient, 'asha@mail.in', 'long-password', fetch, memStore(), NOW);
    _resetAuth();
    expect(await rejects(() => signInPatient(cfg, 'asha@mail.in', 'wrong-password', undefined, fetch, memStore(), NOW))).toBe('Wrong email or password');
    await fake.close();
  });

  it('the physio sees who made the account, and can reset it (only for their own patients)', async () => {
    const { fake, cfg, physio, key, invite } = await world();
    expect(await listPatientLinks(cfg, physio.accessToken)).toHaveLength(0);
    await createPatientAccount(cfg, decodeInvite(invite)!.patient, 'asha@mail.in', 'long-password', fetch, memStore(), NOW);
    const seen = await listPatientLinks(cfg, physio.accessToken);
    expect(seen.map((l) => [l.sync_key, l.email])).toEqual([[key, 'asha@mail.in']]);
    // another physio can neither see nor reset it
    _resetAuth();
    const other = await signUp(cfg, 'dr2@clinic.in', 'correct-horse', fetch, memStore(), NOW).then(() => getSession()!);
    expect(await listPatientLinks(cfg, other.accessToken)).toHaveLength(0);
    await resetPatientLink(cfg, key, other.accessToken);
    expect(fake.patients.has(key)).toBe(true);
    // the owner resets: the link works again for a new account
    await resetPatientLink(cfg, key, physio.accessToken);
    expect(fake.patients.has(key)).toBe(false);
    expect(await listPatientLinks(cfg, physio.accessToken)).toHaveLength(0);
    await fake.close();
  });

  it('the engine: a patient with an account syncs only while signed in; the physio badge shows the email', async () => {
    const { fake, cfg, physio, key, base, invite } = await world();
    const store = memStore();
    const phone = device([decodeInvite(invite)!.patient]);
    await createPatientAccount(cfg, phone.p(), 'asha@mail.in', 'long-password', fetch, store, NOW);
    phone.set({ ...phone.get(), patients: [{ ...phone.p(), accountEmail: 'asha@mail.in' }] });
    const tokenOf = () => getAccessToken(cfg, fetch, store, NOW);
    const penv: Env = { getState: phone.get, setState: phone.set, config: cfg, auth: { token: tokenOf, email: () => 'asha@mail.in' } };
    phone.set({ ...phone.get(), patients: [saveCheckIn(phone.p(), checkIn('2026-11-15', 6, NOW))] });
    const m = memo();
    await syncOnce(penv, m);
    expect(getSyncStatus().state).toBe('ok');

    const doc = device([base]);
    const dstore = memStore();
    _resetAuth();
    await signIn(cfg, 'dr@clinic.in', 'correct-horse', fetch, dstore, NOW);
    const denv: Env = { getState: doc.get, setState: doc.set, config: cfg, auth: { token: () => getAccessToken(cfg, fetch, dstore, NOW), email: () => 'dr@clinic.in' } };
    await syncOnce(denv, memo());
    expect(doc.p().daily).toHaveLength(1);
    expect(getSyncStatus().links[key]).toBe('asha@mail.in');

    // physio changes the plan; the account phone receives it
    doc.set({ ...doc.get(), patients: [applyManual(doc.p(), pack, { type: 'set-exercises', add: ['swimming'] }, 'why', { nowMs: NOW, today: '2026-11-15' })] });
    await syncOnce(denv, memo());
    await syncOnce(penv, m);
    expect(phone.p().plan.added).toContain('swimming');

    // signed out: nothing is sent and the status says to sign in
    const offline: Env = { ...penv, auth: { token: async () => null, email: () => null } };
    phone.set({ ...phone.get(), patients: [saveCheckIn(phone.p(), checkIn('2026-11-16', 2, NOW + 1))] });
    const before = fake.log.filter((x: string) => x.startsWith('POST')).length;
    await syncOnce(offline, m);
    expect(getSyncStatus().state).toBe('login');
    expect(fake.log.filter((x: string) => x.startsWith('POST')).length).toBe(before);
    await fake.close();
  });

  it('patient and physio sessions live under different storage keys', async () => {
    _resetAuth();
    const fake = await startFake(0);
    const cfg = { url: `http://127.0.0.1:${fake.port}`, anonKey: 'anon', auth: true };
    const store = memStore();
    await signUp(cfg, 'dr@clinic.in', 'correct-horse', fetch, store, NOW);
    setAuthScope('patient');
    expect(getSession()).toBeNull(); // the physio's session is not the patient's
    await signUp(cfg, 'asha@mail.in', 'long-password', fetch, store, NOW);
    expect([...store.m.keys()].sort()).toEqual(['rehabpath-session', 'rehabpath-session-patient']);
    setAuthScope('physio');
    expect(getSession()).toBeNull(); // memory reset on switch; reloading reads the right key
    await fake.close();
  });
});

async function expect_throw(f: () => Promise<unknown>, ctor: new (...a: any[]) => Error) {
  let err: unknown = null;
  try { await f(); } catch (e) { err = e; }
  expect(err instanceof ctor).toBe(true);
}
