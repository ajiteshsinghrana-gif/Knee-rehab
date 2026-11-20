import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
// @ts-ignore plain JS build helper
import { precacheList, siteVersion } from '../scripts/pwa.mjs';
import { DICT } from '../src/i18n';
import { applyUpdate, dismissOfflineReady, getPwaStatus, markOfflineReady, markUpdateReady, subscribePwa } from '../src/pwa/status';

const read = (p: string) => readFileSync(p, 'utf8');
const pngSize = (p: string) => { const b = readFileSync(p); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), ok: b.subarray(1, 4).toString() === 'PNG' }; };

describe('installable app (Phase 7.3)', () => {
  const m = JSON.parse(read('public/manifest.webmanifest'));
  it('the manifest has what browsers need to offer "Add to Home Screen"', () => {
    expect(m.name).toBe('RehabPath');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    expect(m.theme_color).toBe('#0a6b6b');
    const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toContain('192x192:any');
    expect(sizes).toContain('512x512:any');
    expect(sizes).toContain('512x512:maskable');
  });
  it('every icon exists and really has the size the manifest claims', () => {
    for (const i of m.icons as { src: string; sizes: string }[]) {
      const { w, h, ok } = pngSize(`public/${i.src}`);
      expect(ok).toBe(true);
      expect(`${w}x${h}`).toBe(i.sizes);
    }
    expect(pngSize('public/icons/apple-touch-icon.png')).toMatchObject({ w: 180, h: 180 });
  });
  it('the page links the manifest, theme colour and iPhone home-screen icon', () => {
    const html = read('index.html');
    expect(html).toContain('rel="manifest" href="./manifest.webmanifest"');
    expect(html).toContain('<meta name="theme-color" content="#0a6b6b"');
    expect(html).toContain('rel="apple-touch-icon" href="./icons/apple-touch-icon.png"');
    expect(html).toContain('apple-mobile-web-app-capable');
  });
});

describe('the built site is current (Phase 7.3)', () => {
  it('docs/ was rebuilt after the last change: sw.js carries the version of the files it caches', () => {
    expect(existsSync('docs/sw.js')).toBe(true);
    const sw = read('docs/sw.js');
    expect(sw).toContain(`const VERSION = '${siteVersion('docs')}';`); // if this fails: run `npm run build` and commit docs/
    expect(read('docs/index.html')).toBe(read('index.html'));
    expect(read('docs/manifest.webmanifest')).toBe(read('public/manifest.webmanifest'));
  });
  it('everything the offline copy needs is in the list: page, script, styles, manifest, icons, exercise pictures', () => {
    const list: string[] = precacheList('docs');
    for (const f of ['index.html', 'app.js', 'app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'media/ankle-pumps.svg']) expect(list).toContain(f);
    for (const f of list) expect(existsSync(`docs/${f}`)).toBe(true);
    expect(list.some((f) => f.includes('sync.json') || f.includes('vendor'))).toBe(false);
  });
});

/** Runs docs/sw.js against a small pretend browser, so the caching rules are checked for real. */
function sandbox(online = true) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const network: string[] = [];
  const modes: Record<string, string | undefined> = {};
  let up = online, skipped = 0, claimed = 0;
  const key = (r: unknown) => (typeof r === 'string' ? r : (r as { url: string }).url);
  const cacheApi = (name: string) => ({
    put: async (r: unknown, res: Response) => { stores.get(name)!.set(key(r), res); },
  });
  const fetchFn = async (r: unknown, init?: { cache?: string }) => { network.push(key(r)); modes[key(r)] = init?.cache; if (!up) throw new TypeError('offline'); return new Response('net:' + key(r), { status: 200 }); };
  const caches = {
    open: async (n: string) => { if (!stores.has(n)) stores.set(n, new Map()); return cacheApi(n); },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: unknown, o: { cacheName?: string; ignoreSearch?: boolean } = {}) => {
      for (const [n, s] of stores) {
        if (o.cacheName && n !== o.cacheName) continue;
        const want = o.ignoreSearch ? key(r).split('?')[0] : key(r);
        for (const [k, v] of s) if ((o.ignoreSearch ? k.split('?')[0] : k) === want) return v.clone();
      }
      return undefined;
    },
  };
  const self = { registration: { scope: 'https://x.test/app/' }, location: new URL('https://x.test/app/sw.js'), clients: { claim: async () => { claimed++; } }, skipWaiting: () => { skipped++; }, addEventListener: (t: string, f: (e: unknown) => void) => { handlers[t] = f; } };
  vm.runInNewContext(read('docs/sw.js'), { self, caches, fetch: fetchFn, URL, Promise });
  const run = async (type: string, extra: Record<string, unknown> = {}) => { let p: Promise<unknown> | undefined; handlers[type]({ waitUntil: (x: Promise<unknown>) => { p = x; }, ...extra }); await p; };
  const request = async (url: string, o: { method?: string; mode?: string } = {}) => {
    let out: Promise<Response> | undefined;
    handlers.fetch({ request: { url, method: o.method ?? 'GET', mode: o.mode ?? 'no-cors' }, respondWith: (x: Promise<Response>) => { out = x; } });
    return out ? await out : undefined; // undefined = the worker did not touch it
  };
  return { run, request, stores, network, modes, go: (v: boolean) => { up = v; }, skipped: () => skipped, claimed: () => claimed, handlers };
}

describe('offline copy: what the service worker does (Phase 7.3)', () => {
  const base = 'https://x.test/app/';
  it('install saves every app file, and does not take over until the person taps "Update now"', async () => {
    const s = sandbox();
    await s.run('install');
    const [name] = [...s.stores.keys()];
    expect(name).toBe(`rehabpath-app-${siteVersion('docs')}`);
    expect(s.stores.get(name)!.size).toBe(precacheList('docs').length);
    expect(Object.values(s.modes).every((m) => m === 'reload')).toBe(true); // a new version never builds from the browser's stale HTTP cache
    expect(s.skipped()).toBe(0);
    s.handlers.message({ data: 'something else' });
    expect(s.skipped()).toBe(0);
    s.handlers.message({ data: 'SKIP_WAITING' });
    expect(s.skipped()).toBe(1);
  });
  it('app files come from the saved copy with no network at all', async () => {
    const s = sandbox(); await s.run('install'); s.network.length = 0; s.go(false);
    const js = await s.request(`${base}app.js?v=2`);
    expect(await js!.text()).toContain('net:https://x.test/app/app.js');
    expect(s.network).toHaveLength(0);
  });
  it('opening the app, even from an invite link or a deep address, gives the saved page while offline', async () => {
    const s = sandbox(); await s.run('install'); s.go(false);
    for (const u of [base, `${base}index.html`, `${base}?x=1`]) expect(await (await s.request(u, { mode: 'navigate' }))!.text()).toContain('index.html');
  });
  it('never touches other sites (Supabase, YouTube) or anything that is not a plain GET', async () => {
    const s = sandbox(); await s.run('install');
    expect(await s.request('https://proj.supabase.co/rest/v1/rehab_sync?id=eq.1')).toBeUndefined();
    expect(await s.request('https://proj.supabase.co/storage/v1/object/public/exercise-demos/' + 'a'.repeat(32) + '.mp4')).toBeUndefined();
    expect(await s.request('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBeUndefined();
    expect(await s.request(`${base}app.js`, { method: 'POST' })).toBeUndefined();
    expect([...s.stores.values()].every((st) => [...st.keys()].every((k) => k.startsWith(base)))).toBe(true); // only this app's own files are ever stored
  });
  it('sync settings are fetched fresh when online and fall back to the last copy offline', async () => {
    const s = sandbox(); await s.run('install');
    expect(await (await s.request(`${base}sync.json`))!.text()).toBe(`net:${base}sync.json`);
    s.go(false);
    expect(await (await s.request(`${base}sync.json`))!.text()).toBe(`net:${base}sync.json`);
  });
  it('an unknown file offline fails cleanly instead of serving the wrong thing', async () => {
    const s = sandbox(); await s.run('install'); s.go(false);
    let failed = false; try { await s.request(`${base}vendor/pdf.min.mjs`); } catch { failed = true; }
    expect(failed).toBe(true);
  });
  it('activate removes older app versions but keeps the sync settings copy and other sites\' caches', async () => {
    const s = sandbox(); await s.run('install');
    s.stores.set('rehabpath-app-oldversion', new Map()); s.stores.set('rehabpath-runtime', new Map()); s.stores.set('someone-elses', new Map());
    await s.run('activate');
    const keys = [...s.stores.keys()].sort();
    expect(keys).toEqual([`rehabpath-app-${siteVersion('docs')}`, 'rehabpath-runtime', 'someone-elses'].sort());
    expect(s.claimed()).toBe(1);
  });
});

describe('update and offline banner state (Phase 7.3)', () => {
  it('tracks "update ready" and "saved for offline", tells listeners, and only the update button sends SKIP_WAITING', () => {
    const sent: unknown[] = [];
    let n = 0; const off = subscribePwa(() => { n++; });
    expect(getPwaStatus()).toEqual({ updateReady: false, offlineReady: false });
    markOfflineReady(); expect(getPwaStatus().offlineReady).toBe(true);
    dismissOfflineReady(); expect(getPwaStatus().offlineReady).toBe(false);
    applyUpdate(); expect(sent).toHaveLength(0); // nothing waiting yet: nothing happens
    markUpdateReady({ postMessage: (m: unknown) => { sent.push(m); } } as unknown as ServiceWorker);
    expect(getPwaStatus().updateReady).toBe(true);
    applyUpdate(); expect(sent).toEqual(['SKIP_WAITING']);
    expect(n).toBe(3);
    off();
  });
  it('every banner string exists in English, Hindi and Bengali', () => {
    const keys = Object.keys(DICT.en).filter((k) => k.startsWith('pwa'));
    expect(keys.length).toBe(5);
    for (const k of keys) { expect(!!DICT.hi[k]).toBe(true); expect(!!DICT.bn[k]).toBe(true); }
  });
});
