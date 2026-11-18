/**
 * Patient devices (Phase 6.3). A phone that opened a patient's invite link, or the sign-in link, becomes a patient device:
 * it shows only the patient's own screens, never the physio dashboard or the demo controls. The flag lives in this browser only.
 * A physio who wants to test the patient view on their own computer should use a private window.
 */
import type { AppState } from './store';

const KEY = 'rehabpath-device';

export const isPatientDevice = (): boolean => { try { return localStorage.getItem(KEY) === 'patient'; } catch { return false; } };
export const setPatientDevice = (on: boolean): void => { try { if (on) localStorage.setItem(KEY, 'patient'); else localStorage.removeItem(KEY); } catch { /* private mode */ } };

/** Hashes that mean "this is a patient's phone". #reset-device is the physio's way out on their own browser. */
export const wantsPatientMode = (hash: string): boolean => /^#(join=|signin)/.test(hash);
export const wantsDeviceReset = (hash: string): boolean => hash === '#reset-device';

/** Drop the demo patients: only people who joined through an invite link stay. */
export const onlyOwnPatients = (s: AppState): AppState => {
  const mine = s.patients.filter((p) => p.syncRole === 'patient');
  if (mine.length === s.patients.length) return s;
  return { ...s, patients: mine, activeId: mine.some((p) => p.id === s.activeId) ? s.activeId : mine[0]?.id ?? '' };
};
