/**
 * Exercise demonstration videos (Phase 7.2).
 *
 * The physio attaches, per exercise, either a link or a short video of the ideal way to do it. Patients see a
 * "Watch how to do it" button on that exercise. A demo is teaching material, not clinical data: it changes nothing
 * about triage, thresholds or the prescribed plan.
 *
 * Everything that comes from outside (a typed link, a chosen file, a row received from the cloud) is checked here,
 * because the patient's phone will play it. Only https addresses are ever used, never javascript:, data: or http:.
 */
import type { ExerciseDemo, Patient, SyncedDemo } from '../types';

/** Supabase's free plan caps one upload at 50 MB. Keep demos short: 30 to 60 seconds is plenty. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
const EXT_MIME: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const MIME_EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX_URL = 2000;
const MAX_ENTRIES = 300;
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

/** An https URL with a host and no embedded password, or null. */
export function parseHttpsUrl(input: string): URL | null {
  const s = (input ?? '').trim();
  if (!s || s.length > MAX_URL) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    return u;
  } catch { return null; }
}

export type LinkCheck = { ok: true; url: string } | { ok: false; error: string };
/** Physio typed a link: accept only a real https address. A missing "https://" is added, plain http is refused. */
export function checkLink(input: string): LinkCheck {
  let s = (input ?? '').trim();
  if (!s) return { ok: false, error: 'Paste the link to the video.' };
  if (/^http:\/\//i.test(s)) return { ok: false, error: 'Only secure links are allowed. The address must start with https://' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  const u = parseHttpsUrl(s);
  if (!u) return { ok: false, error: 'That does not look like a web address starting with https://' };
  if (!u.hostname.includes('.')) return { ok: false, error: 'That does not look like a web address.' };
  return { ok: true, url: u.toString() };
}

export type LinkKind = { type: 'youtube'; embed: string } | { type: 'file' } | { type: 'external' };
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
/** How a link is shown: YouTube plays inside the app (without cookies), a direct video file plays in a player, anything else opens in the browser. */
export function classifyLink(url: string): LinkKind {
  const u = parseHttpsUrl(url);
  if (!u) return { type: 'external' };
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (YT_HOSTS.has(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1] ?? null;
  }
  if (id && YT_ID.test(id)) return { type: 'youtube', embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0` };
  if (/\.(mp4|m4v|webm|mov)$/i.test(u.pathname)) return { type: 'file' };
  return { type: 'external' };
}

/** Normalised mime type and extension for a chosen file, or an error the physio can act on. */
export function checkVideoFile(f: { name: string; type: string; size: number }): { ok: true; mime: string; ext: string } | { ok: false; error: string } {
  const ext = (f.name.split('.').pop() ?? '').toLowerCase();
  const mime = (VIDEO_MIMES as readonly string[]).includes(f.type) ? f.type : EXT_MIME[ext];
  if (!mime) return { ok: false, error: 'Use an MP4, WebM or MOV video. For anything else, paste a link instead.' };
  if (!f.size) return { ok: false, error: 'That file is empty.' };
  if (f.size > MAX_VIDEO_BYTES) return { ok: false, error: `That video is ${(f.size / 1048576).toFixed(0)} MB. The limit is ${MAX_VIDEO_BYTES / 1048576} MB: trim it, or paste a link instead.` };
  return { ok: true, mime, ext: MIME_EXT[mime] };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isTime = (s: unknown): s is string => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));
const fileMeta = (x: Record<string, unknown>) => typeof x.name === 'string' && x.name.length <= 200 && typeof x.mime === 'string' && (VIDEO_MIMES as readonly string[]).includes(x.mime) && typeof x.size === 'number' && Number.isFinite(x.size) && x.size >= 0 && x.size <= MAX_VIDEO_BYTES;

/** Strict check of one demo, from anywhere. Returns a clean copy (unknown fields dropped) or null. */
export function cleanDemo(x: unknown): ExerciseDemo | null {
  if (!isObj(x) || !isTime(x.addedAt)) return null;
  if (x.kind === 'link' && typeof x.url === 'string' && parseHttpsUrl(x.url)) return { kind: 'link', url: x.url, addedAt: x.addedAt };
  if (x.kind === 'video' && typeof x.url === 'string' && parseHttpsUrl(x.url) && fileMeta(x)) return { kind: 'video', url: x.url, name: x.name as string, mime: x.mime as string, size: x.size as number, addedAt: x.addedAt };
  if (x.kind === 'local' && typeof x.id === 'string' && ID_RE.test(x.id) && fileMeta(x)) return { kind: 'local', id: x.id, name: x.name as string, mime: x.mime as string, size: x.size as number, addedAt: x.addedAt };
  return null;
}

/** What may travel between devices: links and cloud videos only. A device-only video is never sent. */
export function cleanSyncedDemos(raw: unknown): Record<string, SyncedDemo> {
  const out: Record<string, SyncedDemo> = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw).slice(0, MAX_ENTRIES)) {
    if (!ID_RE.test(id)) continue;
    const d = cleanDemo(v);
    if (d && d.kind !== 'local') out[id] = d;
  }
  return out;
}
/** Saved clinic state: same check, but device-only videos stay (they are this browser's own). */
export function cleanClinicDemos(raw: unknown): Record<string, ExerciseDemo> {
  const out: Record<string, ExerciseDemo> = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw).slice(0, MAX_ENTRIES)) {
    if (!ID_RE.test(id)) continue;
    const d = cleanDemo(v);
    if (d) out[id] = d;
  }
  return out;
}

// ---------------- the physio's clinic-wide set, kept in memory like the exercise library ----------------
let REG: Record<string, ExerciseDemo> = {};
export const setDemoRegistry = (m: Record<string, ExerciseDemo> | undefined): void => { REG = m ?? {}; };
export const getDemo = (exerciseId: string): ExerciseDemo | undefined => REG[exerciseId];
/** The demo a screen should show: what the physio sent to this patient, or (on the physio's own device) the clinic's own set. */
export const demoFor = (patient: Pick<Patient, 'demos'>, exerciseId: string): ExerciseDemo | undefined => patient.demos?.[exerciseId] ?? REG[exerciseId];

/** Exercise ids a patient could be shown: every exercise in their protocol's phases, plus what the physio added or swapped in. */
export function patientExerciseIds(p: Patient, phaseExercises: string[]): Set<string> {
  return new Set([...phaseExercises, ...(p.plan.added ?? []), ...Object.values(p.plan.swaps ?? {})]);
}
/** The part of the clinic's set that goes to one patient: only their exercises, and never a device-only video. */
export function demosForPatient(p: Patient, phaseExercises: string[], all: Record<string, ExerciseDemo> | undefined): Record<string, SyncedDemo> {
  const mine = patientExerciseIds(p, phaseExercises);
  const out: Record<string, SyncedDemo> = {};
  for (const [id, d] of Object.entries(all ?? {})) if (mine.has(id) && d.kind !== 'local') out[id] = d;
  return out;
}
