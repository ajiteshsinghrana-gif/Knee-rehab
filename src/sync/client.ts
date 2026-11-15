/** Talks to Supabase's REST interface with plain fetch (no library). Nothing here runs unless sync.json has a URL and key. */
export interface SyncConfig { url: string; anonKey: string }
export type FetchFn = typeof fetch;
export type Slice = 'up' | 'down';
export interface Row { data: unknown; updated_at: string }

export async function loadConfig(fetchFn: FetchFn = fetch, path = 'sync.json'): Promise<SyncConfig | null> {
  try {
    const r = await fetchFn(path, { cache: 'no-store' });
    if (!r.ok) return null;
    const c = (await r.json()) as Partial<SyncConfig>;
    return typeof c.url === 'string' && /^https?:\/\//.test(c.url) && typeof c.anonKey === 'string' && c.anonKey ? { url: c.url.replace(/\/+$/, ''), anonKey: c.anonKey } : null;
  } catch { return null; }
}

const headers = (c: SyncConfig, key: string, extra: Record<string, string> = {}) => ({ apikey: c.anonKey, ...(c.anonKey.startsWith('eyJ') ? { Authorization: `Bearer ${c.anonKey}` } : {}), 'x-sync-key': key, 'Content-Type': 'application/json', ...extra });

/** Write one slice. The database only accepts it when the x-sync-key header matches the row's key. */
export async function pushSlice(c: SyncConfig, key: string, slice: Slice, data: unknown, fetchFn: FetchFn = fetch): Promise<void> {
  const r = await fetchFn(`${c.url}/rest/v1/rehab_sync?on_conflict=sync_key,slice`, {
    method: 'POST', headers: headers(c, key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ sync_key: key, slice, data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`sync write failed (${r.status})`);
}

export async function pullSlice(c: SyncConfig, key: string, slice: Slice, fetchFn: FetchFn = fetch): Promise<Row | null> {
  const r = await fetchFn(`${c.url}/rest/v1/rehab_sync?sync_key=eq.${encodeURIComponent(key)}&slice=eq.${slice}&select=data,updated_at`, { headers: headers(c, key), cache: 'no-store' });
  if (!r.ok) throw new Error(`sync read failed (${r.status})`);
  const rows = (await r.json()) as Row[];
  return rows[0] ?? null;
}

/** 128-bit random secret, hex. */
export function newSyncKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
export const validSyncKey = (k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{32}$/.test(k);
