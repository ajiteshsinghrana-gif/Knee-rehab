/**
 * Live sync loop (Phase 6.1). The physio's computer pushes the "down" slice and pulls "up"; the patient's phone does the opposite.
 * Polls every few seconds and also soon after any change. If the network or server is unavailable the app keeps working on
 * the saved data and tries again next time.
 */
import type { Patient } from '../types';
import type { AppState } from '../store';
import { applyDown, applyUp, downSlice, sliceKey, upSlice } from './slices';
import { claimKey, deleteMyAccount, eraseKeyData, newClaimPin, setClaimHash, sha256Hex, listPatientLinks, loadConfig, pullSlice, pushSlice, resetPatientLink, type FetchFn, type SyncConfig } from './client';
import { createPatientAccount, signInPatient, type Restored } from './account';
import { requestPasswordReset, setNewPassword, getAccessToken, getSession, signIn, signOut, signUp, subscribeAuth } from './auth';

/** state 'login': sign-in is required (Phase 6.2) and nobody is signed in, so the physio's patients are not syncing yet. */
export interface SyncStatus {
  enabled: boolean; state: 'off' | 'ok' | 'error' | 'login'; lastOkAt: number | null; error: string | null; patients: number; auth: boolean; user: string | null;
  /** False until sync.json has been read (so screens do not flash the wrong thing). */
  ready: boolean;
  /** Physio side (6.3): patient key -> email of the account that claimed it. A key that is absent has no patient account yet. */
  links: Record<string, string>;
}
let status: SyncStatus = { enabled: false, state: 'off', lastOkAt: null, error: null, patients: 0, auth: false, user: null, ready: false, links: {} };
const subs = new Set<() => void>();
export const getSyncStatus = (): SyncStatus => status;
export const subscribeSync = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const setStatus = (s: Partial<SyncStatus>) => { status = { ...status, ...s }; subs.forEach((f) => f()); };

/** Physio sign-in, present only when sync.json has auth: true. */
export interface AuthEnv { token: () => Promise<string | null>; email: () => string | null }

export interface Env {
  getState: () => AppState;
  setState: (s: AppState) => void;
  config: SyncConfig;
  fetchFn?: FetchFn;
  intervalMs?: number;
  auth?: AuthEnv;
}
export interface Memo { pushed: Map<string, string>; pulled: Map<string, string>; claimed?: Set<string>; restored?: Set<string>; linksAt?: number }

/** One pass over every synced patient. Returns when done. Exported so tests can drive it without timers. */
export async function syncOnce(env: Env, memo: Memo): Promise<void> {
  const f = env.fetchFn ?? fetch;
  const targets = env.getState().patients.filter((p) => p.syncKey && p.syncRole);
  let failed: string | null = null;
  // Physio sign-in (Phase 6.2): the physio's side needs a token. The patient's phone never does.
  const wantAuth = !!env.config.auth && !!env.auth;
  const token = wantAuth ? await env.auth!.token() : null;
  const user = wantAuth ? env.auth!.email() : null;
  let waitingForLogin = false;
  for (const t of targets) {
    try {
      const physioSide = t.syncRole === 'physio';
      // A patient who has made an account (6.3) must sign in; a patient on the plain secret link does not.
      const accountSide = !physioSide && wantAuth && !!t.accountEmail;
      if ((physioSide || accountSide) && wantAuth && !token) { waitingForLogin = true; continue; }
      const tok = (physioSide || accountSide) && wantAuth ? token! : undefined;
      if (physioSide && tok) {
        const claimId = `${user}|${t.syncKey}`;
        memo.claimed ??= new Set();
        if (!memo.claimed.has(claimId)) { await claimKey(env.config, t.syncKey!, tok, f, t.claimPin ? await sha256Hex(t.claimPin) : undefined); memo.claimed.add(claimId); } // one-time: this physio now owns the patient
      }
      // A patient's phone first fetches its own earlier answers (new phone, cleared browser) and merges them, before it sends anything.
      memo.restored ??= new Set();
      if (!physioSide && !memo.restored.has(t.id)) {
        const old = await pullSlice(env.config, t.syncKey!, 'up', f, tok);
        if (old) {
          const st0 = env.getState();
          const cur0 = st0.patients.find((p) => p.id === t.id);
          if (cur0) { const merged = applyUp(cur0, old.data); if (merged !== cur0) env.setState({ ...st0, patients: st0.patients.map((p) => (p.id === t.id ? merged : p)) }); }
        }
        memo.restored.add(t.id);
      }
      const mine = physioSide ? 'down' : 'up';
      const theirs = physioSide ? 'up' : 'down';
      const latest = env.getState().patients.find((p) => p.id === t.id) ?? t;
      const body = physioSide ? downSlice(latest) : upSlice(latest);
      const k = sliceKey(body);
      if (memo.pushed.get(t.id) !== k) { await pushSlice(env.config, t.syncKey!, mine, body, f, tok); memo.pushed.set(t.id, k); }
      const row = await pullSlice(env.config, t.syncKey!, theirs, f, tok);
      if (row && memo.pulled.get(t.id) !== row.updated_at + sliceKey(row.data)) {
        const st = env.getState(); // read again: the person may have answered while we waited
        const cur = st.patients.find((p) => p.id === t.id);
        if (cur) {
          const next: Patient = t.syncRole === 'physio' ? applyUp(cur, row.data) : applyDown(cur, row.data);
          if (next !== cur) env.setState({ ...st, patients: st.patients.map((p) => (p.id === t.id ? next : p)) });
        }
        memo.pulled.set(t.id, row.updated_at + sliceKey(row.data));
      }
    } catch (e) { failed = (e as Error).message; }
  }
  // Physio: who has made a patient account (6.3). Read every ~15 s, not on every pass.
  if (wantAuth && token && targets.some((t) => t.syncRole === 'physio') && Date.now() - (memo.linksAt ?? 0) > 15_000) {
    try {
      const links = await listPatientLinks(env.config, token, f);
      const owned = new Set(targets.filter((t) => t.syncRole === 'physio').map((t) => t.syncKey));
      const map: Record<string, string> = {};
      for (const l of links) if (owned.has(l.sync_key)) map[l.sync_key] = l.email ?? '(unknown email)';
      memo.linksAt = Date.now();
      status = { ...status, links: map };
    } catch { /* the badge just stays as it was */ }
  }
  const who = { auth: wantAuth, user: token ? user : null, ready: true };
  if (failed) setStatus({ ...who, state: 'error', error: failed, patients: targets.length });
  else if (waitingForLogin) setStatus({ ...who, state: 'login', error: null, patients: targets.length });
  else setStatus({ ...who, state: targets.length ? 'ok' : 'off', lastOkAt: targets.length ? Date.now() : status.lastOkAt, error: null, patients: targets.length });
}

let activeConfig: SyncConfig | null = null;
export const getActiveConfig = (): SyncConfig | null => activeConfig;
let kick: () => void = () => {};
/** Used by the sign-in card. Each throws an Error with a message that is safe to show. */
export async function physioSignIn(email: string, password: string): Promise<void> {
  if (!activeConfig) throw new Error('Live sync is not set up');
  await signIn(activeConfig, email.trim(), password); kick();
}
export async function physioSignUp(email: string, password: string): Promise<'signed-in' | 'confirm-email'> {
  if (!activeConfig) throw new Error('Live sync is not set up');
  const r = await signUp(activeConfig, email.trim(), password); kick(); return r;
}
export async function physioSignOut(): Promise<void> {
  if (!activeConfig) return;
  await signOut(activeConfig); kick();
}
/** Physio: let the patient make a new account from the invite link (use when the wrong person claimed it). */
export async function physioResetPatientLink(key: string): Promise<void> {
  if (!activeConfig) throw new Error('Live sync is not set up');
  const token = await getAccessToken(activeConfig);
  if (!token) throw new Error('Sign in first');
  await resetPatientLink(activeConfig, key, token);
  const { [key]: _gone, ...rest } = status.links;
  setStatus({ links: rest });
  kick();
}

/** Patient side (6.3): make an account for this patient / sign in on this phone / sign out. Errors carry a message that is safe to show. */
export async function patientCreateAccount(patient: Patient, email: string, password: string, pin?: string): Promise<'done' | 'confirm-email'> {
  if (!activeConfig) throw new Error('Live sync is not set up');
  const r = await createPatientAccount(activeConfig, patient, email, password, fetch, undefined, Date.now(), pin); kick(); return r;
}
export async function patientSignIn(email: string, password: string, current?: Patient, pin?: string): Promise<Restored> {
  if (!activeConfig) throw new Error('Live sync is not set up');
  const r = await signInPatient(activeConfig, email, password, current, fetch, undefined, Date.now(), pin); kick(); return r;
}
export async function patientSignOut(): Promise<void> {
  if (!activeConfig) return;
  await signOut(activeConfig); kick();
}

/** Anyone: email a password-reset link. Works for physio and patient accounts alike. */
export async function sendPasswordReset(email: string): Promise<void> {
  if (!activeConfig) throw new Error('Live sync is not set up');
  await requestPasswordReset(activeConfig, email, window.location.href.split('#')[0]);
}
/** Finish a password reset: the one-time token comes from the reset email's link. */
export async function finishPasswordReset(token: string, password: string): Promise<void> {
  if (!activeConfig) throw new Error('Still loading. Try again in a moment.');
  await setNewPassword(activeConfig, token, password);
}
/** Patient: delete my login. The clinic keeps its treatment record until the physio erases it. */
export async function patientDeleteAccount(): Promise<void> {
  if (!activeConfig) throw new Error('Live sync is not set up');
  const token = await getAccessToken(activeConfig);
  if (!token) throw new Error('Sign in first');
  await deleteMyAccount(activeConfig, token);
  await signOut(activeConfig); kick();
}
/** Physio: erase this patient's cloud copy. Local removal is done by the caller (lifecycle.eraseLocal). */
export async function physioErasePatient(key: string): Promise<void> {
  if (!activeConfig) return;
  const token = await getAccessToken(activeConfig);
  if (!token) throw new Error('Sign in first so the cloud copy can be erased too.');
  await eraseKeyData(activeConfig, key, token);
  const { [key]: _gone, ...rest } = status.links;
  setStatus({ links: rest });
}
/** Physio: make a new claim PIN for a patient (replaces any older one) and return it to show. */
export async function physioNewClaimPin(key: string): Promise<string> {
  if (!activeConfig) throw new Error('Live sync is not set up');
  const token = await getAccessToken(activeConfig);
  if (!token) throw new Error('Sign in first');
  const pin = newClaimPin();
  await setClaimHash(activeConfig, key, await sha256Hex(pin), token);
  return pin;
}

/** Start syncing. Returns a stop function. Does nothing (and returns a no-op) when sync is not configured. */
export async function startSync(getState: Env['getState'], setState: Env['setState'], subscribeStore: (f: () => void) => () => void, fetchFn: FetchFn = fetch): Promise<() => void> {
  const config = await loadConfig(fetchFn);
  if (!config) { setStatus({ ready: true }); return () => {}; }
  activeConfig = config;
  setStatus({ enabled: true, ready: true, auth: !!config.auth, user: config.auth ? getSession()?.email ?? null : null });
  const memo: Memo = { pushed: new Map<string, string>(), pulled: new Map<string, string>() };
  const env: Env = { getState, setState, config, fetchFn, ...(config.auth ? { auth: { token: () => getAccessToken(config, fetchFn), email: () => getSession()?.email ?? null } } : {}) };
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => { if (busy) return; busy = true; try { await syncOnce(env, memo); } finally { busy = false; } };
  const soon = () => { clearTimeout(timer); timer = setTimeout(run, 800); }; // after any change
  const unsub = subscribeStore(soon);
  kick = () => { void run(); };
  const unsubAuth = subscribeAuth(() => { memo.pushed.clear(); memo.pulled.clear(); memo.linksAt = 0; soon(); }); // signing in or out: start over cleanly
  const iv = setInterval(run, 5000);
  void run();
  return () => { clearInterval(iv); clearTimeout(timer); unsub(); unsubAuth(); kick = () => {}; };
}
