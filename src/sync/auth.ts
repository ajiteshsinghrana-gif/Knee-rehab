/**
 * Physio sign-in (Phase 6.2). Talks to Supabase Auth (GoTrue) with plain fetch, no library.
 * Only the physio's computer signs in. Patients never have an account: their phone keeps using its secret key.
 * The session (tokens) is kept in this browser's localStorage, like the sync keys.
 */
import type { FetchFn, SyncConfig } from './client';

export interface Session { accessToken: string; refreshToken: string; expiresAt: number; userId: string; email: string }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'rehabpath-session';
const SKEW_MS = 60_000; // refresh a minute before the token runs out

let session: Session | null = null;
let loaded = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
export const subscribeAuth = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const defaultStore = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

function persist(s: Session | null, store: Store | null) {
  try { if (!store) return; if (s) store.setItem(KEY, JSON.stringify(s)); else store.removeItem(KEY); } catch { /* storage unavailable: the session just lasts until the page closes */ }
}

const isSession = (x: unknown): x is Session => {
  const s = x as Session;
  return !!s && typeof s.accessToken === 'string' && s.accessToken !== '' && typeof s.refreshToken === 'string' && typeof s.expiresAt === 'number' && typeof s.userId === 'string' && typeof s.email === 'string';
};

/** Read a saved session (once). Safe to call many times. */
export function loadSession(store: Store | null = defaultStore()): Session | null {
  if (loaded) return session;
  loaded = true;
  try { const raw = store?.getItem(KEY); const s = raw ? JSON.parse(raw) : null; session = isSession(s) ? s : null; } catch { session = null; }
  return session;
}
export const getSession = (): Session | null => loadSession();
/** For tests: forget everything held in memory. */
export function _resetAuth() { session = null; loaded = false; }

const authHeaders = (c: SyncConfig, bearer?: string) => ({ apikey: c.anonKey, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) });

function fromTokenResponse(j: any, nowMs: number): Session | null {
  if (!j || typeof j.access_token !== 'string' || typeof j.refresh_token !== 'string') return null;
  const expiresIn = Number(j.expires_in);
  const email = typeof j.user?.email === 'string' ? j.user.email : '';
  const userId = typeof j.user?.id === 'string' ? j.user.id : '';
  if (!userId) return null;
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: nowMs + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000, userId, email };
}

async function errorText(r: Response, fallback: string): Promise<string> {
  try { const j = await r.json() as any; const m = j?.error_description ?? j?.msg ?? j?.message ?? j?.error; if (typeof m === 'string' && m) return m; } catch { /* no body */ }
  return `${fallback} (${r.status})`;
}

/** Sign in with email and password. Throws an Error whose message is safe to show. */
export async function signIn(c: SyncConfig, email: string, password: string, fetchFn: FetchFn = fetch, store: Store | null = defaultStore(), nowMs = Date.now()): Promise<Session> {
  const r = await fetchFn(`${c.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authHeaders(c), body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(r.status === 400 ? 'Wrong email or password' : await errorText(r, 'Sign-in failed'));
  const s = fromTokenResponse(await r.json(), nowMs);
  if (!s) throw new Error('Sign-in failed: unexpected reply from the server');
  loaded = true; session = s; persist(s, store); notify();
  return s;
}

/** Create a physio account. Returns 'signed-in', or 'confirm-email' when the project requires the email to be confirmed first. */
export async function signUp(c: SyncConfig, email: string, password: string, fetchFn: FetchFn = fetch, store: Store | null = defaultStore(), nowMs = Date.now()): Promise<'signed-in' | 'confirm-email'> {
  const r = await fetchFn(`${c.url}/auth/v1/signup`, { method: 'POST', headers: authHeaders(c), body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(await errorText(r, 'Could not create the account'));
  const s = fromTokenResponse(await r.json(), nowMs);
  if (!s) return 'confirm-email';
  loaded = true; session = s; persist(s, store); notify();
  return 'signed-in';
}

/** Always clears the local session, even if the server cannot be reached. */
export async function signOut(c: SyncConfig, fetchFn: FetchFn = fetch, store: Store | null = defaultStore()): Promise<void> {
  const s = loadSession(store);
  session = null; persist(null, store); notify();
  if (s) { try { await fetchFn(`${c.url}/auth/v1/logout`, { method: 'POST', headers: authHeaders(c, s.accessToken) }); } catch { /* already signed out here */ } }
}

/** A valid access token, refreshed when it is about to expire. Null when nobody is signed in or the session can no longer be renewed. */
export async function getAccessToken(c: SyncConfig, fetchFn: FetchFn = fetch, store: Store | null = defaultStore(), nowMs = Date.now()): Promise<string | null> {
  const s = loadSession(store);
  if (!s) return null;
  if (s.expiresAt - SKEW_MS > nowMs) return s.accessToken;
  try {
    const r = await fetchFn(`${c.url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: authHeaders(c), body: JSON.stringify({ refresh_token: s.refreshToken }) });
    if (r.ok) {
      const n = fromTokenResponse(await r.json(), nowMs);
      if (n) { session = n; persist(n, store); notify(); return n.accessToken; }
    }
    if (r.status === 400 || r.status === 401 || r.status === 403) { session = null; persist(null, store); notify(); } // refresh token no longer valid: sign in again
  } catch { /* offline: keep the session, try again later */ }
  return null;
}
