import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { makeAllPatients, DEMO_TODAY_LAST } from '../src/demo/seed';
import { getPack } from '../src/engine/packs';
import { triage } from '../src/engine/triage';
import { addDays } from '../src/engine/dates';
import { CONSENT_TEXT, CUES, FORM_CONFIG, addFormRequest, deleteClip, expiredClips, isOverdue, newFormRequest, replyToForm, reviewHours, validClip } from '../src/forms/model';
import { FORM_STRINGS } from '../src/forms/strings';
import { applyDown, applyUp, downSlice, upSlice } from '../src/sync/slices';
import { clipPath, deleteClipObject, eraseClips, signedClipUrl, uploadClip } from '../src/forms/cloud';
import { exportMyData } from '../src/lifecycle';

const base = makeAllPatients()[0];
const pack = getPack(base.packId);
const today = addDays(DEMO_TODAY_LAST, 1);
const at = today + 'T09:00:00.000Z';
const ctx = { nowMs: Date.parse(at), today };
const key = 'a'.repeat(32);
const mk = (clip = true) => newFormRequest({ id: 'f1234abcd', exerciseId: 'squats', at, note: '  knee hurts going down  ', by: 'patient', via: 'app',
  clip: clip ? { where: 'cloud', ref: `${key}/f1234abcd.mp4`, mime: 'video/mp4', size: 1000, durationSec: null } : null });

describe('form-check request model', () => {
  it('records consent and the delete-by date; trims the note', () => {
    const r = mk();
    expect(r.consent.version).toBe(FORM_CONFIG.consentVersion);
    expect(r.note).toBe('knee hurts going down');
    expect(r.clip!.deleteAfter).toBe(addDays(today, FORM_CONFIG.clipKeepDays));
  });
  it('checks clip type and size', () => {
    expect(validClip('video/mp4', 100)).toBe(null);
    expect(validClip('video/quicktime; codecs=x', 100)).toBe(null);
    expect(validClip('image/png', 100)).toBe('type');
    expect(validClip('video/mp4', FORM_CONFIG.maxBytes + 1)).toBe('size');
    expect(validClip('video/mp4', 0)).toBe('empty');
  });
  it('review time is the protocol\'s own REVIEW time, and overdue follows it', () => {
    const r = mk();
    expect(reviewHours(pack)).toBe(pack.responseHours.REVIEW.hours);
    expect(isOverdue(r, pack, Date.parse(at) + 1000)).toBe(false);
    expect(isOverdue(r, pack, Date.parse(at) + (reviewHours(pack) + 1) * 3600_000)).toBe(true);
    expect(isOverdue({ ...r, reply: { at, by: 'x', text: 'ok', points: [] } }, pack, Date.parse(at) + 1e12)).toBe(false);
  });
  it('a reply shortens the clip life, is audited, and never changes the tier or plan', () => {
    const p0 = addFormRequest(base, mk());
    const before = JSON.stringify(triage(p0, pack));
    const p1 = replyToForm(p0, 'f1234abcd', { by: 'Demo physio', text: 'Slow down', points: ['slow', 'bogus'], at }, ctx);
    const r = p1.formRequests![0];
    expect(r.reply!.points).toEqual(['slow']);
    expect(r.clip!.deleteAfter).toBe(addDays(today, FORM_CONFIG.afterReplyDays));
    expect(p1.audit.length).toBe(p0.audit.length + 1);
    expect(JSON.stringify(p1.plan)).toBe(JSON.stringify(p0.plan));
    expect(JSON.stringify(triage(p1, pack))).toBe(before);
    expect(replyToForm(p1, 'f1234abcd', { by: 'x', text: 'again', points: [], at }, ctx)).toBe(p1); // one reply only
    expect(replyToForm(p0, 'f1234abcd', { by: 'x', text: '  ', points: [], at }, ctx)).toBe(p0); // empty reply refused
  });
  it('expired clips are found and deleting keeps the record', () => {
    const p = addFormRequest(base, mk());
    expect(expiredClips(p, today).length).toBe(0);
    expect(expiredClips(p, addDays(today, FORM_CONFIG.clipKeepDays)).length).toBe(1);
    const q = deleteClip(p, 'f1234abcd', at);
    expect(q.formRequests![0].clip).toBe(null);
    expect(q.formRequests![0].clipGone).toBe(at);
  });
  it('consent and strings exist in en, hi and bn; cues are covered', () => {
    for (const l of ['en', 'hi', 'bn'] as const) { expect(CONSENT_TEXT[l].points.length).toBe(5); expect(CONSENT_TEXT[l].points.some((x) => x.includes('112'))).toBe(true); }
    for (const c of CUES) { expect(c.en.length > 0 && c.hi.length > 0 && c.bn.length > 0).toBe(true); }
    const k = Object.keys(FORM_STRINGS.en).sort().join();
    expect(Object.keys(FORM_STRINGS.hi).sort().join()).toBe(k);
    expect(Object.keys(FORM_STRINGS.bn).sort().join()).toBe(k);
  });
  it('data export lists video requests without the clip address', () => {
    const p = replyToForm(addFormRequest(base, mk()), 'f1234abcd', { by: 'x', text: 'ok', points: ['good'], at }, ctx);
    const j = JSON.stringify(exportMyData(p, 'x', 0));
    expect(j.includes('videoRequests')).toBe(true);
    expect(j.includes(key)).toBe(false);
  });
});

describe('form requests over sync', () => {
  it('the patient sends requests without replies; the physio keeps his reply when the patient syncs again', () => {
    const patientSide = addFormRequest(base, mk());
    const up = upSlice(patientSide);
    expect(up.forms!.length).toBe(1);
    const physio1 = applyUp(base, JSON.parse(JSON.stringify(up)));
    expect(physio1.formRequests!.length).toBe(1);
    const replied = replyToForm(physio1, 'f1234abcd', { by: 'P', text: 'Slow', points: ['slow'], at }, ctx);
    const physio2 = applyUp(replied, JSON.parse(JSON.stringify(up))); // patient syncs again, no reply in it
    expect(physio2.formRequests![0].reply!.text).toBe('Slow');
    const down = JSON.parse(JSON.stringify(downSlice(replied)));
    const back = applyDown(patientSide, down);
    expect(back.formRequests![0].reply!.points).toEqual(['slow']);
  });
  it('a deletion on either side wins and a clip never comes back', () => {
    const p = addFormRequest(base, mk());
    const up = JSON.parse(JSON.stringify(upSlice(p)));
    const physio = deleteClip(applyUp(base, up), 'f1234abcd', at);
    const again = applyUp(physio, up); // an old copy still has the clip
    expect(again.formRequests![0].clip).toBe(null);
    const down = JSON.parse(JSON.stringify(downSlice(physio)));
    const patient = applyDown(p, down);
    expect(patient.formRequests![0].clipGone).toBe(at);
    expect(expiredClips(patient, today).length).toBe(1); // due now, so the phone's clean-up removes the file
  });
  it('damaged or hostile rows are ignored field by field', () => {
    const bad = { v: 1, daily: [], periodic: [], forms: [{ id: '../x', exerciseId: 'a', at, note: 'n', consent: { by: 'patient', at, version: 'v' }, clip: null }, { id: 'okid1234', exerciseId: 'a', at, note: 'n'.repeat(900), consent: { by: 'patient', at, version: 'v' }, clip: null }, 7, null, { id: 'good1234', exerciseId: 'a', at, note: 'n', consent: { by: 'hacker', at, version: 'v' }, clip: null }] };
    expect((applyUp(base, bad).formRequests ?? []).length).toBe(0);
  });
  it('a reply from the patient side is not sent upward', () => {
    const p = replyToForm(addFormRequest(base, mk()), 'f1234abcd', { by: 'P', text: 'x', points: [], at }, ctx);
    expect(JSON.stringify(upSlice(p)).includes('"reply"')).toBe(false);
  });
});

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };
const fake = (status: number, json?: unknown) => { const calls: Call[] = []; const f = (async (url: string, init: RequestInit) => { calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body }); return new Response(json === undefined ? '' : JSON.stringify(json), { status }); }) as unknown as typeof fetch; return { f, calls }; };
const cfg = { url: 'https://x.supabase.co', anonKey: 'eyJanon' };

describe('cloud clip storage (fake server)', () => {
  it('paths cannot climb out of their folder', () => {
    expect(clipPath(key, 'f1234abcd', 'video/webm')).toBe(`${key}/f1234abcd.webm`);
    expect(() => clipPath('../x', 'f1234abcd', 'video/mp4')).toThrow();
    expect(() => clipPath(key, '../../a', 'video/mp4')).toThrow();
  });
  it('upload sends the sync key header and no public address', async () => {
    const { f, calls } = fake(200, {});
    const path = await uploadClip(cfg, key, 'f1234abcd', new Blob(['abc'], { type: 'video/mp4' }), 'video/mp4', undefined, f);
    expect(path).toBe(`${key}/f1234abcd.mp4`);
    expect(calls[0].url).toBe(`${cfg.url}/storage/v1/object/form-clips/${path}`);
    expect(calls[0].headers['x-sync-key']).toBe(key);
    expect(calls[0].url.includes('/public/')).toBe(false);
  });
  it('upload failures give safe messages', async () => {
    for (const [st, re] of [[403, /did not allow/], [413, /too large/], [404, /not set up/]] as const) {
      const { f } = fake(st, {});
      let msg = ''; try { await uploadClip(cfg, key, 'f1234abcd', new Blob(['a']), 'video/mp4', undefined, f); } catch (e) { msg = (e as Error).message; }
      expect(re.test(msg)).toBe(true);
    }
  });
  it('a signed address is short-lived and absolute', async () => {
    const { f, calls } = fake(200, { signedURL: '/object/sign/form-clips/a/b.mp4?token=t' });
    const u = await signedClipUrl(cfg, 'tok', `${key}/f1234abcd.mp4`, 600, f);
    expect(u.startsWith('https://x.supabase.co/storage/v1/object/sign/')).toBe(true);
    expect(JSON.parse(String(calls[0].body)).expiresIn).toBe(600);
  });
  it('deleting treats "already gone" as gone and never throws', async () => {
    expect(await deleteClipObject(cfg, key, 'a/b.mp4', undefined, fake(404).f)).toBe(true);
    expect(await deleteClipObject(cfg, key, 'a/b.mp4', undefined, fake(500).f)).toBe(false);
    expect(await deleteClipObject(cfg, key, 'a/b.mp4', undefined, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe(false);
  });
  it('erasing a patient lists then deletes everything in their folder; a missing bucket is not an error', async () => {
    let n = 0;
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, method: init.method ?? '', headers: {}, body: init.body }); n++; return new Response(n === 1 ? JSON.stringify([{ name: 'a.mp4' }, { name: 'b.webm' }]) : '', { status: 200 }); }) as unknown as typeof fetch;
    expect(await eraseClips(cfg, 'tok', key, f)).toBe(2);
    expect(JSON.parse(String(calls[1].body)).prefixes).toEqual([`${key}/a.mp4`, `${key}/b.webm`]);
    expect(await eraseClips(cfg, 'tok', key, fake(404).f)).toBe(0);
    let failed = false; try { await eraseClips(cfg, 'tok', key, fake(500).f); } catch { failed = true; }
    expect(failed).toBe(true);
  });
});

describe('video code stays out of triage', () => {
  it('no forms or session import inside src/engine, and the engine never reads formRequests', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    for (const f of walk('src/engine').filter((x) => x.endsWith('.ts') && !x.endsWith('plan.ts'))) {
      const t = readFileSync(f, 'utf8');
      expect(/forms\/|session\/|formRequests/.test(t)).toBe(false);
    }
  });
});
