import { markOfflineReady, markUpdateReady } from './status';

const SHOWN_KEY = 'rehabpath-offline-ready-shown';
const secureEnough = () => window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname);

/** Saves the app for offline use and watches for new versions. Does nothing where service workers are unavailable (old browsers, plain http). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !secureEnough()) return;
  // Was the page already controlled by a version when it opened? If so, a controller change later means an update (reload), not the first install.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const start = () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const watch = (sw: ServiceWorker | null) => {
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state !== 'installed') return;
          if (navigator.serviceWorker.controller) markUpdateReady(sw); // an older version is running: offer the update
          else { // first install: the app is now saved for offline use
            try { if (localStorage.getItem(SHOWN_KEY)) return; localStorage.setItem(SHOWN_KEY, '1'); } catch { /* private mode: show it anyway */ }
            markOfflineReady();
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) markUpdateReady(reg.waiting);
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      // An app left open for days still finds out about a new version.
      const check = () => { void reg.update().catch(() => undefined); };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 60 * 60 * 1000);
    }).catch(() => undefined);
  };
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
}
