/**
 * What the page knows about the offline copy of the app (Phase 7.3): a tiny store the banner reads.
 *  - updateReady: a newer version has been downloaded and is waiting for the person to tap "Update now".
 *  - offlineReady: the app was just saved for offline use for the first time (shown once).
 */
export interface PwaStatus { updateReady: boolean; offlineReady: boolean }
let status: PwaStatus = { updateReady: false, offlineReady: false };
let waiting: ServiceWorker | null = null;
const subs = new Set<() => void>();
const set = (next: Partial<PwaStatus>) => { status = { ...status, ...next }; subs.forEach((f) => f()); };
export const getPwaStatus = (): PwaStatus => status;
export const subscribePwa = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const markUpdateReady = (sw: ServiceWorker): void => { waiting = sw; set({ updateReady: true }); };
export const markOfflineReady = (): void => set({ offlineReady: true });
export const dismissOfflineReady = (): void => set({ offlineReady: false });
/** The person tapped "Update now": the waiting version takes over and the page reloads once it has. */
export function applyUpdate(): void {
  if (waiting) waiting.postMessage('SKIP_WAITING');
}
