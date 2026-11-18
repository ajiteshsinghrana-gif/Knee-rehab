/**
 * Demo and live clinic (Phase 6.5). The same website runs in two modes that never share data:
 *  - demo: six made-up patients, the demo bar and fast-forward. No cloud sync. Exactly as before.
 *  - live: the running app. Only real patients, real dates, cloud sync, physio sign-in. The physio can preview any patient's screen.
 * A patient's phone is always live (patients never see the demo or the physio side).
 */
export type Mode = 'demo' | 'live';
const KEY = 'rehabpath-mode';

export const getMode = (): Mode => { try { return localStorage.getItem(KEY) === 'live' ? 'live' : 'demo'; } catch { return 'demo'; } };
export const setMode = (m: Mode): void => { try { localStorage.setItem(KEY, m); } catch { /* private mode: stays demo */ } };
/** #live and #demo in the address switch mode on this browser. */
export const modeFromHash = (hash: string): Mode | null => (hash === '#live' ? 'live' : hash === '#demo' ? 'demo' : null);
