/**
 * Live sync loop (Phase 6.1). The physio's computer pushes the "down" slice and pulls "up"; the patient's phone does the opposite.
 * Polls every few seconds and also soon after any change. If the network or server is unavailable the app keeps working on
 * the saved data and tries again next time.
 */
import type { Patient } from '../types';
import type { AppState } from '../store';
import { applyDown, applyUp, downSlice, sliceKey, upSlice } from './slices';
import { loadConfig, pullSlice, pushSlice, type FetchFn, type SyncConfig } from './client';

export interface SyncStatus { enabled: boolean; state: 'off' | 'ok' | 'error'; lastOkAt: number | null; error: string | null; patients: number }
let status: SyncStatus = { enabled: false, state: 'off', lastOkAt: null, error: null, patients: 0 };
const subs = new Set<() => void>();
export const getSyncStatus = (): SyncStatus => status;
export const subscribeSync = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const setStatus = (s: Partial<SyncStatus>) => { status = { ...status, ...s }; subs.forEach((f) => f()); };

export interface Env {
  getState: () => AppState;
  setState: (s: AppState) => void;
  config: SyncConfig;
  fetchFn?: FetchFn;
  intervalMs?: number;
}

/** One pass over every synced patient. Returns when done. Exported so tests can drive it without timers. */
export async function syncOnce(env: Env, memo: { pushed: Map<string, string>; pulled: Map<string, string> }): Promise<void> {
  const f = env.fetchFn ?? fetch;
  const targets = env.getState().patients.filter((p) => p.syncKey && p.syncRole);
  let failed: string | null = null;
  for (const t of targets) {
    try {
      const mine = t.syncRole === 'physio' ? 'down' : 'up';
      const theirs = t.syncRole === 'physio' ? 'up' : 'down';
      const body = t.syncRole === 'physio' ? downSlice(t) : upSlice(t);
      const k = sliceKey(body);
      if (memo.pushed.get(t.id) !== k) { await pushSlice(env.config, t.syncKey!, mine, body, f); memo.pushed.set(t.id, k); }
      const row = await pullSlice(env.config, t.syncKey!, theirs, f);
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
  if (failed) setStatus({ state: 'error', error: failed, patients: targets.length });
  else setStatus({ state: targets.length ? 'ok' : 'off', lastOkAt: targets.length ? Date.now() : status.lastOkAt, error: null, patients: targets.length });
}

/** Start syncing. Returns a stop function. Does nothing (and returns a no-op) when sync is not configured. */
export async function startSync(getState: Env['getState'], setState: Env['setState'], subscribeStore: (f: () => void) => () => void, fetchFn: FetchFn = fetch): Promise<() => void> {
  const config = await loadConfig(fetchFn);
  if (!config) return () => {};
  setStatus({ enabled: true });
  const memo = { pushed: new Map<string, string>(), pulled: new Map<string, string>() };
  const env: Env = { getState, setState, config, fetchFn };
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => { if (busy) return; busy = true; try { await syncOnce(env, memo); } finally { busy = false; } };
  const soon = () => { clearTimeout(timer); timer = setTimeout(run, 800); }; // after any change
  const unsub = subscribeStore(soon);
  const iv = setInterval(run, 5000);
  void run();
  return () => { clearInterval(iv); clearTimeout(timer); unsub(); };
}
