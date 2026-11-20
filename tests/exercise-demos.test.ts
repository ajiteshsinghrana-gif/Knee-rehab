import { describe, it, expect } from 'vitest';
// @ts-ignore plain JS helper
import { startFake } from '../scripts/fake-supabase.mjs';
import { checkLink, checkVideoFile, classifyLink, cleanClinicDemos, cleanDemo, cleanSyncedDemos, demoFor, demosForPatient, MAX_VIDEO_BYTES, parseHttpsUrl, patientExerciseIds, getDemo } from '../src/exercises/demos';
import { deleteDemoVideo, uploadDemoVideo } from '../src/exercises/upload';
import { applyDown, downSlice } from '../src/sync/slices';
import { newSyncKey } from '../src/sync/client';
import { syncOnce } from '../src/sync/engine';
import { buildPatient, decodeInvite, encodeInvite } from '../src/onboarding';
import { getPack } from '../src/engine/packs';
import { LIBRARY } from '../src/exercises/library';
import { DICT } from '../src/i18n';
import { getState, setExerciseDemo } from '../src/store';
import type { ExerciseDemo, Patient } from '../src/types';
import type { AppState } from '../src/store';

const NOW = Date.parse('2026-11-15T09:00:00Z');
const AT = '2026-11-20T10:00:00.000Z';
const pack = getPack('total-knee-replacement');
const mkPatient = (): Patient => buildPatient({ name: 'Asha', age: 60, language: 'hi', packId: pack.id, anchorDate: '2026-11-01', phaseId: 'p1', exercises: pack.phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: NOW, today: '2026-11-15', id: 'asha' });
const phaseEx = pack.phases.flatMap((x) => x.exercises);
const mine = phaseEx[0];
const notMine = LIBRARY.map((e) => e.id).find((id) => !phaseEx.includes(id))!;
const link = (url = 'https://youtu.be/dQw4w9WgXcQ'): ExerciseDemo => ({ kind: 'link', url, addedAt: AT });
const cloudVideo = (url = 'https://x.supabase.co/storage/v1/object/public/exercise-demos/' + 'a'.repeat(32) + '.mp4'): ExerciseDemo => ({ kind: 'video', url, name: 'quad-set.mp4', mime: 'video/mp4', size: 1_000_000, addedAt: AT });
const local: ExerciseDemo = { kind: 'local', id: 'v0123456789abcdef01234567', name: 'clip.mov', mime: 'video/quicktime', size: 5_000_000, addedAt: AT };

describe('exercise demonstration links (Phase 7.2)', () => {
  it('accepts a secure link, adds https when it is missing, and refuses everything else', () => {
    expect(checkLink('https://youtu.be/dQw4w9WgXcQ')).toEqual({ ok: true, url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(checkLink('  www.youtube.com/watch?v=dQw4w9WgXcQ ')).toMatchObject({ ok: true, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    for (const bad of ['', '   ', 'http://example.com/v', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'https://user:pw@example.com/v', 'https://localhost/v', 'not a link', 'ftp://example.com/v']) {
      expect(checkLink(bad).ok).toBe(false);
    }
    expect(parseHttpsUrl('https://example.com/' + 'a'.repeat(2100))).toBeNull();
  });

  it('YouTube links play inside the app without cookies; look-alike hosts and bad ids do not', () => {
    const id = 'dQw4w9WgXcQ';
    const emb = { type: 'youtube', embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0` };
    for (const u of [`https://www.youtube.com/watch?v=${id}&t=10`, `https://youtu.be/${id}`, `https://m.youtube.com/watch?v=${id}`, `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) {
      expect(classifyLink(u)).toEqual(emb);
    }
    expect(classifyLink(`https://youtube.com.evil.example/watch?v=${id}`).type).toBe('external');
    expect(classifyLink(`https://notyoutube.com/watch?v=${id}`).type).toBe('external');
    expect(classifyLink('https://www.youtube.com/watch?v="><script>').type).toBe('external');
    expect(classifyLink('https://www.youtube.com/watch?v=short').type).toBe('external');
  });

  it('a direct video file plays in a player; any other page opens in the browser', () => {
    expect(classifyLink('https://cdn.example.com/clips/squat.mp4').type).toBe('file');
    expect(classifyLink('https://cdn.example.com/clips/squat.WEBM?x=1').type).toBe('file');
    expect(classifyLink('https://physio.example.org/exercises/squat').type).toBe('external');
  });
});

describe('exercise demonstration video files', () => {
  it('accepts MP4, WebM and MOV up to the limit, even when the browser gives no type', () => {
    expect(checkVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 1000 })).toEqual({ ok: true, mime: 'video/mp4', ext: 'mp4' });
    expect(checkVideoFile({ name: 'a.MOV', type: '', size: 1000 })).toEqual({ ok: true, mime: 'video/quicktime', ext: 'mov' });
    expect(checkVideoFile({ name: 'a.m4v', type: '', size: 1000 })).toEqual({ ok: true, mime: 'video/mp4', ext: 'mp4' });
    expect(checkVideoFile({ name: 'a.webm', type: 'video/webm', size: MAX_VIDEO_BYTES })).toMatchObject({ ok: true });
  });
  it('refuses a too-large, empty or non-video file with a message that says what to do', () => {
    const big = checkVideoFile({ name: 'a.mp4', type: 'video/mp4', size: MAX_VIDEO_BYTES + 1 });
    expect(big.ok).toBe(false);
    expect((big as { error: string }).error).toMatch(/50 MB/);
    expect(checkVideoFile({ name: 'a.mp4', type: 'video/mp4', size: 0 }).ok).toBe(false);
    expect(checkVideoFile({ name: 'a.avi', type: 'video/x-msvideo', size: 10 }).ok).toBe(false);
    expect(checkVideoFile({ name: 'a.pdf', type: 'application/pdf', size: 10 }).ok).toBe(false);
  });
});

describe('what is trusted when it arrives (Phase 7.2)', () => {
  it('cleanDemo keeps valid demos, drops unknown fields, and refuses unsafe or damaged ones', () => {
    expect(cleanDemo({ ...link(), junk: 'x' })).toEqual(link());
    expect(cleanDemo(cloudVideo())).toEqual(cloudVideo());
    expect(cleanDemo(local)).toEqual(local);
    expect(cleanDemo({ kind: 'link', url: 'javascript:alert(1)', addedAt: AT })).toBeNull();
    expect(cleanDemo({ kind: 'link', url: 'http://example.com/v', addedAt: AT })).toBeNull();
    expect(cleanDemo({ kind: 'link', url: 'https://example.com/v', addedAt: 'yesterday-ish' })).toBeNull();
    expect(cleanDemo({ ...cloudVideo(), mime: 'text/html' })).toBeNull();
    expect(cleanDemo({ ...cloudVideo(), size: MAX_VIDEO_BYTES + 1 })).toBeNull();
    expect(cleanDemo({ ...local, id: '../../etc/passwd' })).toBeNull();
    expect(cleanDemo(null)).toBeNull();
    expect(cleanDemo('https://example.com')).toBeNull();
  });
  it('only links and cloud videos travel; a device-only video never does', () => {
    const out = cleanSyncedDemos({ a: link(), b: cloudVideo(), c: local, 'bad id!': link(), d: { kind: 'link', url: 'javascript:1', addedAt: AT } });
    expect(Object.keys(out).sort()).toEqual(['a', 'b']);
    expect(Object.keys(cleanClinicDemos({ a: link(), c: local, d: null })).sort()).toEqual(['a', 'c']);
    expect(cleanSyncedDemos(null)).toEqual({});
    expect(cleanSyncedDemos([link()])).toEqual({});
  });
  it('a patient gets demos only for their own exercises', () => {
    const p = mkPatient();
    const all = { [mine]: link(), [notMine]: link('https://youtu.be/AAAAAAAAAAA'), local1: local };
    const sent = demosForPatient(p, phaseEx, { ...all, [phaseEx[1]]: local });
    expect(Object.keys(sent)).toEqual([mine]);
    // an exercise the physio adds or swaps in for this patient is theirs too
    const p2: Patient = { ...p, plan: { ...p.plan, added: [notMine] } };
    expect(patientExerciseIds(p2, phaseEx).has(notMine)).toBe(true);
    expect(Object.keys(demosForPatient(p2, phaseEx, all)).sort()).toEqual([mine, notMine].sort());
  });
});

describe('sending demos from the physio to the patient (Phase 7.2)', () => {
  it('the down slice carries the patient\'s demos; the phone keeps them, replaces them, and clears them', () => {
    const p = mkPatient();
    const slice = downSlice(p, { [mine]: link(), [notMine]: link('https://youtu.be/AAAAAAAAAAA') });
    expect(Object.keys(slice.demos ?? {})).toEqual([mine]);
    const onPhone = applyDown(p, JSON.parse(JSON.stringify(slice)));
    expect(onPhone.demos?.[mine]).toEqual(link());
    expect(demoFor(onPhone, mine)).toEqual(link());
    // physio replaces it: the phone shows the new one
    const next = applyDown(onPhone, JSON.parse(JSON.stringify(downSlice(p, { [mine]: cloudVideo() }))));
    expect(next.demos?.[mine]).toEqual(cloudVideo());
    // physio removes the last one: it disappears from the phone
    const gone = applyDown(next, JSON.parse(JSON.stringify(downSlice(p, {}))));
    expect(gone.demos).toEqual({});
    expect(demoFor(gone, mine)).toBeUndefined();
  });
  it('an older physio build that sends no demos does not wipe what the phone has', () => {
    const p = mkPatient();
    const has = applyDown(p, JSON.parse(JSON.stringify(downSlice(p, { [mine]: link() }))));
    expect(has.demos?.[mine]).toBeDefined();
    const kept = applyDown(has, JSON.parse(JSON.stringify(downSlice(p))));
    expect(kept.demos?.[mine]).toEqual(link());
  });
  it('a tampered slice cannot put an unsafe address on the phone', () => {
    const p = mkPatient();
    const raw = JSON.parse(JSON.stringify(downSlice(p, {})));
    raw.demos = { [mine]: { kind: 'link', url: 'javascript:alert(document.cookie)', addedAt: AT }, [phaseEx[1]]: { kind: 'local', id: 'v0123456789abcdef01234567', name: 'x.mp4', mime: 'video/mp4', size: 1, addedAt: AT } };
    expect(applyDown(p, raw).demos).toEqual({});
  });
  it('changing a demo never changes the plan, the phase or the triage inputs', () => {
    const p = mkPatient();
    const before = JSON.stringify([p.plan, p.currentPhase, p.daily, p.audit]);
    const after = applyDown(p, JSON.parse(JSON.stringify(downSlice(p, { [mine]: link() }))));
    expect(JSON.stringify([after.plan, after.currentPhase, after.daily, after.audit])).toBe(before);
  });
  it('end to end through live sync: the physio attaches a link, the patient\'s phone gets it, and removing it clears it', async () => {
    const fake = await startFake();
    const cfg = { url: `http://127.0.0.1:${fake.port}`, anonKey: 'anon' };
    const key = newSyncKey();
    const base = mkPatient();
    const dev = (p: Patient, role: 'physio' | 'patient', extra: Partial<AppState> = {}) => {
      let st = { version: 1, patients: [{ ...p, syncKey: key, syncRole: role }], activeId: p.id, today: '2026-11-15', demoStep: 0, ...extra } as AppState;
      return { get: () => st, set: (s: AppState) => { st = s; }, p: () => st.patients[0] };
    };
    const physio = dev(base, 'physio');
    const phone = dev(decodeInvite(encodeInvite({ ...base, syncKey: key, syncRole: 'physio' }))!.patient, 'patient');
    const m = () => ({ pushed: new Map<string, string>(), pulled: new Map<string, string>() });
    const mP = m(), mH = m();
    const penv = { getState: physio.get, setState: physio.set, config: cfg };
    const henv = { getState: phone.get, setState: phone.set, config: cfg };

    physio.set({ ...physio.get(), exerciseDemos: { [mine]: link(), [notMine]: link('https://youtu.be/AAAAAAAAAAA'), [phaseEx[1]]: local } });
    await syncOnce(penv, mP); await syncOnce(henv, mH);
    expect(Object.keys(phone.p().demos ?? {})).toEqual([mine]);
    expect(JSON.stringify([...fake.rows.values()])).not.toContain('AAAAAAAAAAA'); // another patient's exercise is not sent
    expect(JSON.stringify([...fake.rows.values()])).not.toContain('v0123456789abcdef01234567'); // a device-only video never leaves the device

    physio.set({ ...physio.get(), exerciseDemos: {} });
    await syncOnce(penv, mP); await syncOnce(henv, mH);
    expect(phone.p().demos).toEqual({});
    await fake.close();
  });
});

describe('the physio\'s clinic-wide set (Phase 7.2)', () => {
  it('setExerciseDemo attaches, replaces and removes a demo, and refuses unknown exercises and unsafe links', () => {
    setExerciseDemo(mine, link());
    expect(getDemo(mine)).toEqual(link());
    expect(getState().exerciseDemos?.[mine]).toEqual(link());
    setExerciseDemo(mine, cloudVideo());
    expect(getDemo(mine)?.kind).toBe('video');
    expect(() => setExerciseDemo('no-such-exercise', link())).toThrow(/Unknown exercise/);
    expect(() => setExerciseDemo(mine, { kind: 'link', url: 'javascript:1', addedAt: AT })).toThrow(/not valid/);
    expect(getDemo(mine)?.kind).toBe('video'); // a refused change leaves the old one
    setExerciseDemo(mine, null);
    expect(getDemo(mine)).toBeUndefined();
    expect(getState().exerciseDemos?.[mine]).toBeUndefined();
  });
});

describe('uploading to cloud storage (Phase 7.2)', () => {
  const cfg = { url: 'https://proj.supabase.co', anonKey: 'anon' };
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = (status: number, text = '') => (async (u: string, init: RequestInit) => { calls.push({ url: String(u), init }); return new Response(text, { status }); }) as unknown as typeof fetch;

  it('sends the file with the physio\'s token and returns the public address', async () => {
    calls.length = 0;
    const body = new Blob(['x'], { type: 'video/mp4' });
    const r = await uploadDemoVideo(cfg, 'tok123', body, 'video/mp4', 'mp4', stub(200, '{}'));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/exercise-demos\/[0-9a-f]{32}\.mp4$/);
    expect(calls[0].init.method).toBe('POST');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok123');
    expect(h['Content-Type']).toBe('video/mp4');
    expect(h['x-upsert']).toBe('false');
    expect(r.url).toBe(`https://proj.supabase.co/storage/v1/object/public/exercise-demos/${r.path}`);
    expect(cleanDemo({ kind: 'video', url: r.url, name: 'a.mp4', mime: 'video/mp4', size: 1, addedAt: AT })).not.toBeNull();
  });
  it('turns server refusals into messages the physio can act on', async () => {
    const msg = async (status: number, text = '') => { try { await uploadDemoVideo(cfg, 't', new Blob(['x']), 'video/mp4', 'mp4', stub(status, text)); } catch (e) { return (e as Error).message; } return ''; };
    expect(await msg(404, '{"message":"Bucket not found"}')).toMatch(/schema-exercise-videos\.sql/);
    expect(await msg(403)).toMatch(/Sign in as a physio/);
    expect(await msg(413)).toMatch(/too large/);
    expect(await msg(500)).toMatch(/500/);
    const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    let m = ''; try { await uploadDemoVideo(cfg, 't', new Blob(['x']), 'video/mp4', 'mp4', offline); } catch (e) { m = (e as Error).message; }
    expect(m).toMatch(/internet connection/);
  });
  it('deletes only files this app uploaded', async () => {
    calls.length = 0;
    const ours = `https://proj.supabase.co/storage/v1/object/public/exercise-demos/${'b'.repeat(32)}.webm`;
    expect(await deleteDemoVideo(cfg, 'tok', ours, stub(200))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].url).toBe(`https://proj.supabase.co/storage/v1/object/exercise-demos/${'b'.repeat(32)}.webm`);
    calls.length = 0;
    expect(await deleteDemoVideo(cfg, 'tok', 'https://example.com/other.mp4', stub(200))).toBe(true);
    expect(await deleteDemoVideo(cfg, 'tok', `https://proj.supabase.co/storage/v1/object/public/exercise-demos/../../../rehab_sync`, stub(200))).toBe(true);
    expect(calls).toHaveLength(0); // nothing was sent for a foreign or odd address
    expect(await deleteDemoVideo(cfg, 'tok', ours, stub(404))).toBe(true); // already gone
    expect(await deleteDemoVideo(cfg, 'tok', ours, stub(500))).toBe(false);
  });
});

describe('patient wording (Phase 7.2)', () => {
  it('every demo string exists in English, Hindi and Bengali with the same {placeholders}', () => {
    const keys = Object.keys(DICT.en).filter((k) => k.startsWith('demo'));
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) {
      expect(!!DICT.hi[k]).toBe(true);
      expect(!!DICT.bn[k]).toBe(true);
      const slots = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
      expect(slots(DICT.hi[k])).toBe(slots(DICT.en[k]));
      expect(slots(DICT.bn[k])).toBe(slots(DICT.en[k]));
    }
  });
});
