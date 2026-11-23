/* RehabPath service worker (Phase 7.3). Generated into docs/sw.js by scripts/build.mjs: do not edit docs/sw.js.
 *
 * What it does
 *  - Keeps the app's own files (page, script, styles, icons, exercise pictures) so the app opens with no internet.
 *  - Touches ONLY files from this app's own address. Supabase, YouTube and every other site go straight to the network, so
 *    patient data, sign-in and sync are never stored or served by this file.
 *  - Never switches to a new version on its own: a new version waits until the person taps "Update now" (the page sends
 *    SKIP_WAITING). Clinical rules therefore change at a moment the person chose, not in the middle of a check-in.
 */
const VERSION = 'c3f76a0d9a08';
const CACHE = 'rehabpath-app-' + VERSION;
const RUNTIME = 'rehabpath-runtime'; // sync.json only: the clinic's sync settings, fetched fresh when online
const PRECACHE = ["index.html","app.js","app.css","manifest.webmanifest","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","media/ankle-pumps.svg","media/assisted-arm-raise.svg","media/balance.svg","media/band-rotation.svg","media/bridging.svg","media/calf-raises.svg","media/core.svg","media/custom.svg","media/cycling.svg","media/gait-drills.svg","media/gentle-rom.svg","media/hand-wrist-elbow.svg","media/heel-slides.svg","media/hip-abduction.svg","media/ice-compression.svg","media/ice-elevation.svg","media/lunges.svg","media/mini-squats.svg","media/pendulum.svg","media/quad-set.svg","media/shoulder-blade-squeeze.svg","media/sit-to-stand.svg","media/squats.svg","media/stairs-practice.svg","media/stationary-cycling.svg","media/step-ups.svg","media/straight-leg-raise.svg","media/swimming.svg","media/walking-aid.svg","media/walking-programme.svg","media/walking.svg","media/wall-slide.svg"].map((p) => new URL(p, self.registration.scope).href);
const INDEX = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's own HTTP cache (GitHub Pages lets it keep files for 10 minutes), so a new version is never
  // built from stale copies of its files.
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map(async (u) => {
    const res = await fetch(u, { cache: 'reload' });
    if (!res.ok) throw new Error('Could not save ' + u + ' (' + res.status + ')');
    await c.put(u, res);
  }))));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('rehabpath-') && k !== CACHE && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // other sites: network only, untouched
  if (url.pathname.endsWith('/sync.json')) { event.respondWith(networkFirst(req, RUNTIME)); return; }
  if (req.mode === 'navigate') { event.respondWith(caches.match(INDEX, { cacheName: CACHE }).then((hit) => hit || fetch(req))); return; }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || networkFirst(req, CACHE)));
});

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) { const c = await caches.open(cacheName); await c.put(req, res.clone()); }
    return res;
  } catch (e) {
    const hit = await caches.match(req, { cacheName });
    if (hit) return hit;
    throw e;
  }
}
