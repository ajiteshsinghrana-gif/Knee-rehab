/**
 * Live sync loop (Phase 6.1). The physio's computer pushes the "down" slice and pulls "up"; the patient's phone does the opposite.
 * Polls every few seconds and also soon after any change. If the network or server is unavailable the app keeps working on
 * the saved data and tries again next time.
 */
import type { Patient } from '../types';
import type { AppState } from '../store';
import { applyDown, applyUp, downSlice, sliceKey, upSlice } from './slices';
import { claimKey, loadConfig, pullSlice, pushSlice, type FetchFn, type SyncConfig } from './client';
import { getAccessToken, getSession, signIn, signOut, signUp, subscribeAuth } from './auth';

/** state 'login': sign-in is required (Phase 6.2) and nobody is signed in, so the physio's patients are not syncing yet. */
export interface SyncStatus { enabled: boolean; state: 'off' | 'ok' | 'error' | 'login'; lastOkAt: number | null; error: string | null; patients: number; auth: boolean; user: string | null }
let status: SyncStatus = { enabled: false, state: 'off', lastOkAt: null, error: null, patients: 0, auth: false, user: null };
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
export interface Memo { pushed: Map<string, string>; pulled: Map<string, string>; claimed?: Set<string> }

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
      if (physioSide && wantAuth && !token) { waitingForLogin = true; continue; }
      const tok = physioSide && wantAuth ? token! : undefined;
      if (tok) {
        const claimId = `${user}|${t.syncKey}`;
        memo.claimed ??= new Set();
        if (!memo.claimed.has(claimId)) { await claimKey(env.config, t.syncKey!, tok, f); memo.claimed.add(claimId); } // one-time: this physio now owns the patient
      }
      const mine = physioSide ? 'down' : 'up';
      const theirs = physioSide ? 'up' : 'down';
      const body = physioSide ? downSlice(t) : upSlice(t);
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
  const who = { auth: wantAuth, user: token ? user : null };
  if (failed) setStatus({ ...who, state: 'error', error: failed, patients: targets.length });
  else if (waitingForLogin) setStatus({ ...who, state: 'login', error: null, patients: targets.length });
  else setStatus({ ...who, state: targets.length ? 'ok' : 'off', lastOkAt: targets.length ? Date.now() : status.lastOkAt, error: null, patients: targets.length });
}

let activeConfig: SyncConfig | null = null;
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

/** Start syncing. Returns a stop function. Does nothing (and returns a no-op) when sync is not configured. */
export async function startSync(getState: Env['getState'], setState: Env['setState'], subscribeStore: (f: () => void) => () => void, fetchFn: FetchFn = fetch): Promise<() => void> {
  const config = await loadConfig(fetchFn);
  if (!config) return () => {};
  activeConfig = config;
  setStatus({ enabled: true, auth: !!config.auth, user: config.auth ? getSession()?.email ?? null : null });
  const memo: Memo = { pushed: new Map<string, string>(), pulled: new Map<string, string>() };
  const env: Env = { getState, setState, config, fetchFn, ...(config.auth ? { auth: { token: () => getAccessToken(config, fetchFn), email: () => getSession()?.email ?? null } } : {}) };
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => { if (busy) return; busy = true; try { await syncOnce(env, memo); } finally { busy = false; } };
  const soon = () => { clearTimeout(timer); timer = setTimeout(run, 800); }; // after any change
  const unsub = subscribeStore(soon);
  kick = () => { void run(); };
  const unsubAuth = subscribeAuth(() => { memo.pushed.clear(); memo.pulled.clear(); soon(); }); // signing in or out: start over cleanly
  const iv = setInterval(run, 5000);
  void run();
  return () => { clearInterval(iv); clearTimeout(timer); unsub(); unsubAuth(); kick = () => {}; };
}
