/**
 * Cloud storage for demonstration videos (Phase 7.2). Plain fetch against Supabase Storage, like the rest of the sync code.
 * Needs supabase/schema-exercise-videos.sql run once: it makes the public-read bucket and lets signed-in physios (not patients) upload.
 * The bucket is public so a patient's phone can play the video without an account; the file name is a random 128-bit value.
 * These are teaching videos. A video of a patient must never be uploaded here.
 */
import type { FetchFn, SyncConfig } from '../sync/client';

export const DEMO_BUCKET = 'exercise-demos';
const publicPrefix = (c: SyncConfig) => `${c.url}/storage/v1/object/public/${DEMO_BUCKET}/`;

const randomName = (ext: string): string => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return `${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}.${ext}`;
};

/** Upload one video. Returns the public https address. Throws an Error whose message is safe to show the physio. */
export async function uploadDemoVideo(c: SyncConfig, token: string, body: Blob, mime: string, ext: string, fetchFn: FetchFn = fetch): Promise<{ url: string; path: string }> {
  const path = randomName(ext);
  let r: Response;
  try {
    r = await fetchFn(`${c.url}/storage/v1/object/${DEMO_BUCKET}/${path}`, {
      method: 'POST', headers: { apikey: c.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': mime, 'x-upsert': 'false' }, body,
    });
  } catch { throw new Error('Could not reach the server. Check the internet connection and try again.'); }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    if (r.status === 413 || /too large|exceeded/i.test(text)) throw new Error('The server refused the video as too large. Trim it or paste a link instead.');
    if (r.status === 404 || /bucket not found/i.test(text)) throw new Error('The video store is not set up yet. Run supabase/schema-exercise-videos.sql once in Supabase, then try again.');
    if (r.status === 401 || r.status === 403) throw new Error('The server did not allow this upload. Sign in as a physio and try again.');
    if (r.status === 415 || /mime/i.test(text)) throw new Error('The server only accepts MP4, WebM or MOV videos.');
    throw new Error(`The upload failed (${r.status}).`);
  }
  return { url: `${publicPrefix(c)}${path}`, path };
}

/** Best effort: delete a video this app uploaded. Returns true when it is gone (or was already gone). Never throws. */
export async function deleteDemoVideo(c: SyncConfig, token: string, url: string, fetchFn: FetchFn = fetch): Promise<boolean> {
  const prefix = publicPrefix(c);
  if (!url.startsWith(prefix)) return true; // not ours: nothing to delete
  const path = url.slice(prefix.length);
  if (!/^[0-9a-f]{32}\.(mp4|webm|mov)$/.test(path)) return true;
  try {
    const r = await fetchFn(`${c.url}/storage/v1/object/${DEMO_BUCKET}/${path}`, { method: 'DELETE', headers: { apikey: c.anonKey, Authorization: `Bearer ${token}` } });
    return r.ok || r.status === 404;
  } catch { return false; }
}
