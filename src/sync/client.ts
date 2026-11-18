/** Talks to Supabase's REST interface with plain fetch (no library). Nothing here runs unless sync.json has a URL and key. */
/** auth: true turns on physio sign-in (Phase 6.2; needs supabase/schema-v2.sql). Absent or false keeps the secret-key-only behaviour. */
export interface SyncConfig { url: string; anonKey: string; auth?: boolean }
export type FetchFn = typeof fetch;
export type Slice = 'up' | 'down';
export interface Row { data: unknown; updated_at: string }

export async function loadConfig(fetchFn: FetchFn = fetch, path = 'sync.json'): Promise<SyncConfig | null> {
  try {
    const r = await fetchFn(path, { cache: 'no-store' });
    if (!r.ok) return null;
    const c = (await r.json()) as Partial<SyncConfig>;
    return typeof c.url === 'string' && /^https?:\/\//.test(c.url) && typeof c.anonKey === 'string' && c.anonKey ? { url: c.url.replace(/\/+$/, ''), anonKey: c.anonKey, auth: c.auth === true } : null;
  } catch { return null; }
}

/** token: the physio's access token. Without it the request is the patient phone's (anon role plus the secret key). */
const headers = (c: SyncConfig, key: string, extra: Record<string, string> = {}, token?: string) => ({ apikey: c.anonKey, ...(token ? { Authorization: `Bearer ${token}` } : c.anonKey.startsWith('eyJ') ? { Authorization: `Bearer ${c.anonKey}` } : {}), 'x-sync-key': key, 'Content-Type': 'application/json', ...extra });

/** Write one slice. The database only accepts it when the x-sync-key header matches the row's key. */
export async function pushSlice(c: SyncConfig, key: string, slice: Slice, data: unknown, fetchFn: FetchFn = fetch, token?: string): Promise<void> {
  const r = await fetchFn(`${c.url}/rest/v1/rehab_sync?on_conflict=sync_key,slice`, {
    method: 'POST', headers: headers(c, key, { Prefer: 'resolution=merge-duplicates,return=minimal' }, token),
    body: JSON.stringify({ sync_key: key, slice, data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`sync write failed (${r.status})`);
}

export async function pullSlice(c: SyncConfig, key: string, slice: Slice, fetchFn: FetchFn = fetch, token?: string): Promise<Row | null> {
  const r = await fetchFn(`${c.url}/rest/v1/rehab_sync?sync_key=eq.${encodeURIComponent(key)}&slice=eq.${slice}&select=data,updated_at`, { headers: headers(c, key, {}, token), cache: 'no-store' });
  if (!r.ok) throw new Error(`sync read failed (${r.status})`);
  const rows = (await r.json()) as Row[];
  return rows[0] ?? null;
}

/** Register the signed-in physio as the owner of this patient key. Does nothing if the key is already claimed (by anyone). */
export async function claimKey(c: SyncConfig, key: string, token: string, fetchFn: FetchFn = fetch, claimHash?: string): Promise<void> {
  const r = await fetchFn(`${c.url}/rest/v1/rehab_owner?on_conflict=sync_key`, {
    method: 'POST', headers: headers(c, key, { Prefer: 'resolution=ignore-duplicates,return=minimal' }, token),
    body: JSON.stringify({ sync_key: key, ...(claimHash ? { claim_hash: claimHash } : {}) }),
  });
  if (!r.ok) throw new Error(`could not register this patient (${r.status})`);
}

/** SHA-256 of a claim PIN as hex. The database stores only this, never the PIN. */
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}
/** 8 random digits, shown to the physio and given to the patient by voice or message. */
export function newClaimPin(): string {
  const b = new Uint32Array(1);
  let n = 0;
  do { crypto.getRandomValues(b); n = b[0]; } while (n >= 4_294_967_000); // no modulo bias
  return String(n % 100_000_000).padStart(8, '0');
}
/** Physio: set (or replace) the PIN a patient must enter to claim the link. */
export async function setClaimHash(c: SyncConfig, key: string, hash: string, token: string, fetchFn: FetchFn = fetch): Promise<void> {
  const r = await fetchFn(`${c.url}/rest/v1/rehab_owner?sync_key=eq.${encodeURIComponent(key)}`, { method: 'PATCH', headers: headers(c, key, { Prefer: 'return=minimal' }, token), body: JSON.stringify({ claim_hash: hash }) });
  if (!r.ok) throw new Error(`could not set the claim PIN (${r.status})`);
}

/** Physio: erase everything held in the cloud for this patient (answers, plan, account link, ownership). Needs schema-v4.sql. */
export async function eraseKeyData(c: SyncConfig, key: string, token: string, fetchFn: FetchFn = fetch): Promise<void> {
  for (const table of ['rehab_sync', 'rehab_patient', 'rehab_owner']) {
    const r = await fetchFn(`${c.url}/rest/v1/${table}?sync_key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: headers(c, key, {}, token) });
    if (!r.ok) throw new Error(`could not erase the cloud copy (${table}: ${r.status}). Run supabase/schema-v4.sql first.`);
  }
}
export class PinError extends Error {}

/** Patient: delete their own login (schema-v4). The clinic's record of the treatment is not touched. */
export async function deleteMyAccount(c: SyncConfig, token: string, fetchFn: FetchFn = fetch): Promise<void> {
  const r = await fetchFn(`${c.url}/rest/v1/rpc/rehab_delete_my_account`, { method: 'POST', headers: headers(c, '', {}, token), body: '{}' });
  if (!r.ok) throw new Error(`could not delete the account (${r.status}). Ask your physio for help.`);
}

export interface PatientLink { sync_key: string; email: string | null; invite: string; created_at: string }
export class LinkTakenError extends Error {}

/** The patient's account claims this patient key. The invite is stored so the patient can sign in on any phone. Needs the secret link. */
export async function claimPatient(c: SyncConfig, key: string, invite: string, token: string, fetchFn: FetchFn = fetch, pin?: string): Promise<void> {
  const r = await fetchFn(`${c.url}/rest/v1/rehab_patient`, { method: 'POST', headers: headers(c, key, { Prefer: 'return=minimal' }, token), body: JSON.stringify({ sync_key: key, invite, ...(pin ? { pin } : {}) }) });
  if (r.ok) return;
  if (r.status === 403 && /PIN/i.test(await r.text().catch(() => ''))) throw new PinError('The claim PIN is missing or wrong. Ask your physio for the 8-digit PIN.');
  if (r.status === 409) {
    if ((await listPatientLinks(c, token, fetchFn, key)).length) return; // already this account's own claim
    throw new LinkTakenError('This link has already been used to make an account. Sign in with that account, or ask your physio to reset the link.');
  }
  throw new Error(`could not create the account link (${r.status})`);
}

/** Patient: their own claims. Physio: the claims on their patients (who made an account, with which email). */
export async function listPatientLinks(c: SyncConfig, token: string, fetchFn: FetchFn = fetch, onlyKey?: string): Promise<PatientLink[]> {
  const r = await fetchFn(`${c.url}/rest/v1/rehab_patient?select=sync_key,email,invite,created_at${onlyKey ? `&sync_key=eq.${encodeURIComponent(onlyKey)}` : ''}`, { headers: headers(c, onlyKey ?? '', {}, token), cache: 'no-store' });
  if (!r.ok) throw new Error(`could not read patient accounts (${r.status})`);
  const rows = (await r.json()) as unknown;
  return Array.isArray(rows) ? (rows as PatientLink[]).filter((x) => validSyncKey(x?.sync_key) && typeof x.invite === 'string') : [];
}

/** Physio: forget which account claimed this patient, so the patient can make a new one from the invite link. */
export async function resetPatientLink(c: SyncConfig, key: string, token: string, fetchFn: FetchFn = fetch): Promise<void> {
  const r = await fetchFn(`${c.url}/rest/v1/rehab_patient?sync_key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: headers(c, key, {}, token) });
  if (!r.ok) throw new Error(`could not reset the patient's account link (${r.status})`);
}

/** 128-bit random secret, hex. */
export function newSyncKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
export const validSyncKey = (k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{32}$/.test(k);
