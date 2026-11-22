// Talks to the clinic's WhatsApp backend (the Supabase edge function in supabase/functions/whatsapp).
// Until a WhatsApp Business number is connected, status() says "not configured" and send() is never offered.
import type { Lang } from '../types';
import { getAccessToken } from '../sync/auth';
import { loadConfig, type FetchFn } from '../sync/client';

export interface WaStatus { reachable: boolean; configured: boolean; missing: string[]; note?: string }

export async function whatsappStatus(fetchFn: FetchFn = fetch): Promise<WaStatus> {
  try {
    const c = await loadConfig(fetchFn);
    if (!c) return { reachable: false, configured: false, missing: [], note: 'Cloud sync is off, so there is no clinic backend to connect.' };
    const token = await getAccessToken(c, fetchFn);
    if (!token) return { reachable: false, configured: false, missing: [], note: 'Sign in as a physio to check the connection.' };
    const r = await fetchFn(`${c.url}/functions/v1/whatsapp?action=status`, { headers: { apikey: c.anonKey, Authorization: `Bearer ${token}` } });
    if (r.status === 404) return { reachable: false, configured: false, missing: [], note: 'The WhatsApp function is not deployed yet.' };
    if (!r.ok) return { reachable: false, configured: false, missing: [], note: `The backend answered ${r.status}.` };
    const j = (await r.json()) as { configured?: boolean; missing?: string[] };
    return { reachable: true, configured: !!j.configured, missing: j.missing ?? [] };
  } catch {
    return { reachable: false, configured: false, missing: [], note: 'Could not reach the backend. Check the connection.' };
  }
}

export interface SendArgs { to: string; template: string; lang: Lang; vars: string[] }
export async function sendTemplate(a: SendArgs, fetchFn: FetchFn = fetch): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = await loadConfig(fetchFn);
    const token = c ? await getAccessToken(c, fetchFn) : null;
    if (!c || !token) return { ok: false, error: 'Sign in as a physio first.' };
    const r = await fetchFn(`${c.url}/functions/v1/whatsapp?action=send`, { method: 'POST', headers: { apikey: c.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return r.ok ? { ok: true } : { ok: false, error: j.error ?? `The backend answered ${r.status}.` };
  } catch { return { ok: false, error: 'Could not reach the backend.' }; }
}
