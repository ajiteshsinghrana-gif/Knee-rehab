/** Marketplace data lives apart from patient data: its own storage key per mode, so the demo roster never mixes with a real clinic. */
import { getMode } from '../mode';
import { DEMO_PHYSIOS } from './physios';
import { emptyMp, type MpState } from './ledger';

export const MP_KEY_DEMO = 'rehabpath-marketplace-demo-v1';
export const MP_KEY_LIVE = 'rehabpath-marketplace-live-v1';
const keyFor = (live: boolean): string => (live ? MP_KEY_LIVE : MP_KEY_DEMO);

/** The demo starts with the made-up roster. The live clinic starts empty: real physiotherapists register and are verified. */
export const seedMp = (live: boolean): MpState => emptyMp(live ? [] : DEMO_PHYSIOS.map((p) => ({ ...p })));

type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function loadMp(live: boolean, store?: Store): MpState {
  try {
    const raw = (store ?? localStorage).getItem(keyFor(live));
    if (!raw) return seedMp(live);
    const s = JSON.parse(raw) as MpState;
    if (s?.v === 1 && Array.isArray(s.physios) && Array.isArray(s.bookings) && typeof s.seq === 'number') return s;
  } catch { /* unreadable: start from the seed */ }
  return seedMp(live);
}

let state: MpState | null = null;
let liveFlag = false;
const subs = new Set<() => void>();
export const getMp = (): MpState => {
  const live = getMode() === 'live';
  if (!state || live !== liveFlag) { liveFlag = live; state = loadMp(live); }
  return state;
};
export const subscribeMp = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setMp(next: MpState): void {
  state = next;
  try { localStorage.setItem(keyFor(liveFlag), JSON.stringify(next)); } catch { /* private mode: works in memory */ }
  subs.forEach((f) => f());
}
export const resetMp = (): void => setMp(seedMp(liveFlag));
