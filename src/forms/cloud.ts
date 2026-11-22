/**
 * Private cloud storage for form-check clips (Supabase Storage, bucket "form-clips", see supabase/schema-form-clips.sql).
 *
 * Plain fetch, like the rest of sync. Clips are never public: the patient's phone uploads with its secret sync key (or its signed-in
 * account), and only the clinic's signed-in physio can read, through a short-lived signed address. Folder name = the patient's sync key.
 *
 * UNTESTED against a real Supabase project. The unit tests use a fake fetch. Whether the database sees the x-sync-key header on
 * Storage calls must be checked in a staging project before real patients use this (README, "Video requests").
 */
import type { SyncConfig, FetchFn } from '../sync/client';
import { FORM_CONFIG } from './model';

export const CLIP_BUCKET = 'form-clips';
const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
export const clipExt = (mime: string): string => EXT[mime.split(';')[0].toLowerCase()] ?? 'mp4';
/** Folder = sync key, file = request id. Both are checked so a path can never climb out of its folder. */
export function clipPath(syncKey: string, requestId: string, mime: string): string {
  if (!/^[0-9a-f]{32}$/.test(syncKey)) throw new Error('bad key');
  if (!/^[A-Za-z0-9_-]{4,60}$/.test(requestId)) throw new Error('bad id');
  return `${syncKey}/${requestId}.${clipExt(mime)}`;
}
const hdr = (c: SyncConfig, syncKey: string, token?: string, extra: Record<string, string> = {}) => ({
  apikey: c.anonKey, ...(token ? { Authorization: `Bearer ${token}` } : c.anonKey.startsWith('eyJ') ? { Authorization: `Bearer ${c.anonKey}` } : {}), 'x-sync-key': syncKey, ...extra,
});

/** Patient: upload one clip. Returns the stored path. Throws an Error with a message that is safe to show. */
export async function uploadClip(c: SyncConfig, syncKey: string, requestId: string, body: Blob, mime: string, token?: string, fetchFn: FetchFn = fetch): Promise<string> {
  if (body.size > FORM_CONFIG.maxBytes) throw new Error('The video is too large. Record a shorter one.');
  const path = clipPath(syncKey, requestId, mime);
  let r: Response;
  try { r = await fetchFn(`${c.url}/storage/v1/object/${CLIP_BUCKET}/${path}`, { method: 'POST', headers: hdr(c, syncKey, token, { 'Content-Type': mime, 'x-upsert': 'false' }), body }); }
  catch { throw new Error('Could not reach the server. Check the internet and try again.'); }
  if (!r.ok) {
    if (r.status === 413) throw new Error('The server refused the video as too large. Record a shorter one.');
    if (r.status === 404) throw new Error('The video store is not set up yet. Ask the clinic.');
    if (r.status === 401 || r.status === 403) throw new Error('The server did not allow this upload. Ask the clinic to check your link.');
    throw new Error(`The upload failed (${r.status}).`);
  }
  return path;
}
/** Physio: a short-lived address to play one clip. */
export async function signedClipUrl(c: SyncConfig, token: string, path: string, seconds = 600, fetchFn: FetchFn = fetch): Promise<string> {
  const r = await fetchFn(`${c.url}/storage/v1/object/sign/${CLIP_BUCKET}/${path}`, { method: 'POST', headers: hdr(c, '', token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: seconds }) });
  if (!r.ok) throw new Error(r.status === 404 ? 'The clip is no longer stored.' : `Could not open the clip (${r.status}).`);
  const j = (await r.json()) as { signedURL?: string; signedUrl?: string };
  const u = j.signedURL ?? j.signedUrl;
  if (!u) throw new Error('Could not open the clip.');
  return u.startsWith('http') ? u : `${c.url}/storage/v1${u.startsWith('/') ? '' : '/'}${u}`;
}
/** Delete one clip. True when it is gone (or was already gone). Never throws. */
export async function deleteClipObject(c: SyncConfig, syncKey: string, path: string, token?: string, fetchFn: FetchFn = fetch): Promise<boolean> {
  try {
    const r = await fetchFn(`${c.url}/storage/v1/object/${CLIP_BUCKET}/${path}`, { method: 'DELETE', headers: hdr(c, syncKey, token) });
    return r.ok || r.status === 404;
  } catch { return false; }
}
/** Physio erasing a patient: remove every clip in the patient's folder. Throws when the list or delete fails, so the caller can say so. */
export async function eraseClips(c: SyncConfig, token: string, syncKey: string, fetchFn: FetchFn = fetch): Promise<number> {
  if (!/^[0-9a-f]{32}$/.test(syncKey)) throw new Error('bad key');
  const l = await fetchFn(`${c.url}/storage/v1/object/list/${CLIP_BUCKET}`, { method: 'POST', headers: hdr(c, syncKey, token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: syncKey, limit: 1000 }) });
  if (l.status === 404 || l.status === 400) return 0; // bucket not set up: nothing to erase
  if (!l.ok) throw new Error(`could not list the video clips (${l.status}). Run supabase/schema-form-clips.sql first.`);
  const names = ((await l.json()) as { name: string }[]).map((x) => `${syncKey}/${x.name}`);
  if (!names.length) return 0;
  const d = await fetchFn(`${c.url}/storage/v1/object/${CLIP_BUCKET}`, { method: 'DELETE', headers: hdr(c, syncKey, token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: names }) });
  if (!d.ok) throw new Error(`could not delete the video clips (${d.status}).`);
  return names.length;
}
