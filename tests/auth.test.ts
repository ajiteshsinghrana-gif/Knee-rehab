import { describe, it, expect } from 'vitest';
// @ts-ignore plain JS helper
import { startFake } from '../scripts/fake-supabase.mjs';
import { _resetAuth, getAccessToken, getSession, loadSession, signIn, signOut, signUp } from '../src/sync/auth';
import { claimKey, loadConfig, newSyncKey, pullSlice, pushSlice } from '../src/sync/client';
import { getSyncStatus, syncOnce, type Env, type Memo } from '../src/sync/engine';
import { downSlice } from '../src/sync/slices';
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
const device = (p: Patient, role: 'physio' | 'patient', key: string) => {
  let st = { version: 1, patients: [{ ...p, syncKey: key, syncRole: role }], activeId: p.id, today: '2026-11-15', demoStep: 0 } as AppState;
  return { get: () => st, set: (s: AppState) => { st = s; }, p: () => st.patients[0] };
};
const memo = (): Memo => ({ pushed: new Map(), pulled: new Map() });
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m }; };
const rejects = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { return (e as Error).message; } return ''; };
const posts = (log: string[]) => log.filter((x) => x.startsWith('POST')).length;

async function setup(opts: Record<string, unknown> = {}) {
  _resetAuth();
  const fake = await startFake(0, opts);
  const cfg = { url: `http://127.0.0.1:${fake.port}`, anonKey: 'anon', auth: true };
  const store = memStore();
  return { fake, cfg, store };
}

describe('physio sign-in (Phase 6.2)', () => {
  it('sign up, sign out, wrong password, sign in; the session is saved and survives a reload', async () => {
    const { fake, cfg, store } = await setup();
    expect(await signUp(cfg, 'dr@clinic.in', 'correct-horse', fetch, store, NOW)).toBe('signed-in');
    expect(getSession()?.email).toBe('dr@clinic.in');
    await signOut(cfg, fetch, store);
    expect(getSession()).toBeNull();
    expect(store.m.size).toBe(0);
    expect(await rejects(() => signIn(cfg, 'dr@clinic.in', 'wrong', fetch, store, NOW))).toBe('Wrong email or password');
    expect(getSession()).toBeNull();
    await signIn(cfg, 'dr@clinic.in', 'correct-horse', fetch, store, NOW);
    expect(store.m.size).toBe(1);
    _resetAuth(); // as if the page was reloaded
    expect(loadSession(store)?.email).toBe('dr@clinic.in');
    await fake.close();
  });

  it('when the project requires email confirmation, sign-up says so and nobody is signed in', async () => {
    const { fake, cfg, store } = await setup({ confirmEmail: true });
    expect(await signUp(cfg, 'new@clinic.in', 'correct-horse', fetch, store, NOW)).toBe('confirm-email');
    expect(getSession()).toBeNull();
    expect(await rejects(() => signUp(cfg, 'new@clinic.in', 'correct-horse', fetch, store, NOW))).toMatch(/already registered/);
    expect(await rejects(() => signUp(cfg, 'x@clinic.in', 'abc', fetch, store, NOW))).toMatch(/at least 6/);
    await fake.close();
  });

  it('the access token is renewed shortly before it expires, and kept when offline', async () => {
    const { fake, cfg, store } = await setup();
    const s = await signIn(cfg, 'dr@clinic.in', 'x', fetch, store, NOW).catch(async () => { await signUp(cfg, 'dr@clinic.in', 'correct-horse', fetch, store, NOW); return getSession()!; });
    expect(await getAccessToken(cfg, fetch, store, NOW + 60_000)).toBe(s.accessToken); // plenty of time left: no refresh
    expect(fake.log.includes('REFRESH')).toBe(false);
    const fresh = await getAccessToken(cfg, fetch, store, NOW + 3600_000 - 30_000); // inside the last minute
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(s.accessToken);
    expect(fake.log.filter((x: string) => x === 'REFRESH')).toHaveLength(1);
    // offline: no token this time, but the session is kept for the next try
    const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await getAccessToken(cfg, offline, store, NOW + 3 * 3600_000)).toBeNull();
    expect(getSession()).not.toBeNull();
    // the server says the refresh token is no longer valid: sign in again
    const rejected = (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch;
    expect(await getAccessToken(cfg, rejected, store, NOW + 3 * 3600_000)).toBeNull();
    expect(getSession()).toBeNull();
    await fake.close();
  });

  it('sync.json: auth is off unless it is exactly true', async () => {
    const j = (o: unknown) => (async () => new Response(JSON.stringify(o), { status: 200 })) as unknown as typeof fetch;
    expect((await loadConfig(j({ url: 'https://x.supabase.co', anonKey: 'k' })))!.auth).toBe(false);
    expect((await loadConfig(j({ url: 'https://x.supabase.co', anonKey: 'k', auth: 'yes' })))!.auth).toBe(false);
    expect((await loadConfig(j({ url: 'https://x.supabase.co', anonKey: 'k', auth: true })))!.auth).toBe(true);
  });
});

describe('per-patient access (Phase 6.2)', () => {
  it('with sign-in on: check-in reaches the signed-in physio, plan change reaches the phone, the physio is recorded as owner', async () => {
    const { fake, cfg, store } = await setup();
    await signUp(cfg, 'dr@clinic.in', 'correct-horse', fetch, store, NOW);
    const key = newSyncKey();
    const base = mkPatient();
    const physio = device(base, 'physio', key);
    const phone = device(decodeInvite(encodeInvite({ ...base, syncKey: key, syncRole: 'physio' }))!.patient, 'patient', key);
    const auth = { token: () => getAccessToken(cfg, fetch, store), email: () => getSession()?.email ?? null };
    const penv: Env = { getState: physio.get, setState: physio.set, config: cfg, auth };
    const henv: Env = { getState: phone.get, setState: phone.set, config: cfg }; // the phone has no account and no auth
    const mP = memo(), mH = memo();

    const entry = dailyEntry(pack, { date: '2026-11-15', pain: 6, swelling: 'more', ex: 'some', per: 2, hard: 'stairs' });
    phone.set({ ...phone.get(), patients: [saveCheckIn(phone.p(), entry)] });
    await syncOnce(henv, mH);
    await syncOnce(penv, mP);
    expect(physio.p().daily).toHaveLength(1);
    expect(fake.owners.get(key)).toBe(getSession()!.userId);
    expect(getSyncStatus()).toMatchObject({ state: 'ok', auth: true, user: 'dr@clinic.in' });

    physio.set({ ...physio.get(), patients: [applyManual(physio.p(), pack, { type: 'set-exercises', add: ['swimming'] }, 'PRIVATE reason', { nowMs: NOW, today: '2026-11-15' })] });
    await syncOnce(penv, mP);
    await syncOnce(henv, mH);
    expect(phone.p().plan.added).toContain('swimming');
    expect(JSON.stringify([...fake.rows.values()])).not.toContain('PRIVATE reason');

    // the ownership claim is sent once, not on every pass
    await syncOnce(penv, mP); await syncOnce(penv, mP);
    expect(fake.log.filter((x: string) => x === 'CLAIM')).toHaveLength(1);
    await fake.close();
  });

  it('once owned, the phone can still send answers but can no longer overwrite the plan; strangers see and change nothing', async () => {
    const { fake, cfg, store } = await setup();
    const a = await signUp(cfg, 'a@clinic.in', 'correct-horse', fetch, store, NOW).then(() => getSession()!);
    const key = newSyncKey();
    await claimKey(cfg, key, a.accessToken);
    await pushSlice(cfg, key, 'down', { v: 1, plan: 'real' }, fetch, a.accessToken);

    // the phone (anon + secret key): reads the plan, writes answers, cannot replace the plan
    expect((await pullSlice(cfg, key, 'down'))!.data).toEqual({ v: 1, plan: 'real' });
    await pushSlice(cfg, key, 'up', { v: 1, answers: 1 });
    expect(await rejects(() => pushSlice(cfg, key, 'down', { v: 1, plan: 'evil' }))).toMatch(/403/);
    expect((await pullSlice(cfg, key, 'down'))!.data).toEqual({ v: 1, plan: 'real' });

    // the physio cannot write the patient's answers
    expect(await rejects(() => pushSlice(cfg, key, 'up', { v: 1, answers: 'fake' }, fetch, a.accessToken))).toMatch(/403/);

    // the owner sees the answers
    expect((await pullSlice(cfg, key, 'up', fetch, a.accessToken))!.data).toEqual({ v: 1, answers: 1 });

    // a second physio account: sees nothing, cannot write, cannot take the patient over
    await signOut(cfg, fetch, store);
    const b = await signUp(cfg, 'b@clinic.in', 'correct-horse', fetch, store, NOW).then(() => getSession()!);
    expect(await pullSlice(cfg, key, 'up', fetch, b.accessToken)).toBeNull();
    expect(await pullSlice(cfg, key, 'down', fetch, b.accessToken)).toBeNull();
    expect(await rejects(() => pushSlice(cfg, key, 'down', { v: 1, plan: 'b' }, fetch, b.accessToken))).toMatch(/403/);
    await claimKey(cfg, key, b.accessToken); // the request is accepted but changes nothing
    expect(fake.owners.get(key)).toBe(a.userId);
    expect(await rejects(() => pushSlice(cfg, key, 'down', { v: 1, plan: 'b' }, fetch, b.accessToken))).toMatch(/403/);

    // an anonymous visitor cannot claim a patient or list owners
    expect(await rejects(() => claimKey(cfg, newSyncKey(), '', fetch))).toMatch(/401/);
    await fake.close();
  });

  it('not signed in: the physio side waits (nothing is sent) and says so; a signed-out physio stops syncing', async () => {
    const { fake, cfg, store } = await setup();
    const key = newSyncKey();
    const physio = device(mkPatient(), 'physio', key);
    const auth = { token: () => getAccessToken(cfg, fetch, store), email: () => getSession()?.email ?? null };
    const penv: Env = { getState: physio.get, setState: physio.set, config: cfg, auth };
    const m = memo();
    await syncOnce(penv, m);
    expect(getSyncStatus()).toMatchObject({ state: 'login', auth: true, user: null });
    expect(posts(fake.log)).toBe(0);
    expect(fake.owners.size).toBe(0);

    await signUp(cfg, 'dr@clinic.in', 'correct-horse', fetch, store, NOW);
    await syncOnce(penv, m);
    expect(getSyncStatus().state).toBe('ok');
    expect(posts(fake.log)).toBe(1);

    await signOut(cfg, fetch, store);
    physio.set({ ...physio.get(), patients: [{ ...physio.p(), name: 'Asha K' }] });
    await syncOnce(penv, m);
    expect(getSyncStatus().state).toBe('login');
    expect(posts(fake.log)).toBe(1); // the change stayed on this computer
    await fake.close();
  });

  it('a patient phone never needs sign-in, even when the clinic has turned it on', async () => {
    const { fake, cfg } = await setup();
    const key = newSyncKey();
    const phone = device(mkPatient(), 'patient', key);
    await syncOnce({ getState: phone.get, setState: phone.set, config: cfg }, memo());
    expect(getSyncStatus().state).toBe('ok');
    expect(fake.rows.has(`${key}|up`)).toBe(true);
    await fake.close();
  });

  it('patients created before login existed (unclaimed keys) keep working with the old behaviour', async () => {
    const { fake } = await setup();
    const cfg = { url: `http://127.0.0.1:${fake.port}`, anonKey: 'anon' }; // v1 config: no auth
    const key = newSyncKey();
    await pushSlice(cfg, key, 'down', downSlice(mkPatient()));
    expect((await pullSlice(cfg, key, 'down'))).not.toBeNull();
    await fake.close();
  });
});
