/**
 * Setup check before a set (camera check safety round). Body points and picture brightness in, ONE plain prompt out:
 * "too dark", "step back", "turn sideways", "turn to face the phone", "hold your hand up", or "I can see you".
 * Pure logic, no camera: the screen supplies the points and the brightness. The set cannot start until it says "I can see you",
 * so nothing is flagged until the needed body points are all in the picture. Thresholds are placeholders (NEEDS_PHYSIO_SIGNOFF).
 */
import type { Frame } from './analyze';
import { FORM_CHECK, HAND, HAND_KINDS, KINDS, LM, SETUP, type FormKind, type FormView } from './config';

export type SetupHint = 'fcSetDark' | 'fcSetStepBack' | 'fcSetSide' | 'fcSetFront' | 'fcSetHand' | 'fcSetOk';

/** Views where the phone sees the person from the side. */
const SIDE_VIEWS: FormView[] = ['side', 'sideStand', 'walkSide', 'sideFoot', 'pendulum', 'cycle', 'plank', 'birdDog', 'armSide', 'forearm'];
/** Views where the phone faces the person (or their back). */
const FRONT_VIEWS: FormView[] = ['front', 'seated', 'balance', 'balanceLine', 'bandFront', 'back'];
/** Views that need only the upper body in the picture. */
const UPPER_VIEWS: FormView[] = ['pendulum', 'armSide', 'back', 'bandFront', 'forearm'];

const L = { sh: [LM.lShoulder, LM.rShoulder], hip: [LM.lHip, LM.rHip], knee: [LM.lKnee, LM.rKnee], ank: [LM.lAnkle, LM.rAnkle], elb: [LM.lElbow, LM.rElbow], wr: [LM.lWrist, LM.rWrist] } as const;

/** In view: seen clearly and not cut off at the edge of the picture. */
const inView = (f: Frame, i: number) => { const p = f[i]; return !!p && (p.v ?? 0) >= FORM_CHECK.minVisibility && p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99; };

/** The body points this view needs, for one side (0 left, 1 right). */
function needed(view: FormView, side: 0 | 1): number[] {
  if (view === 'sideFoot') return [L.hip[side], L.knee[side], L.ank[side]];
  if (UPPER_VIEWS.includes(view)) return [L.sh[side], L.elb[side], L.wr[side], L.hip[side]];
  return [L.sh[side], L.hip[side], L.knee[side], L.ank[side]];
}

export function setupHint(kind: FormKind, frame: Frame | null, luma: number | null): SetupHint {
  if (luma !== null && luma < SETUP.darkLuma) return 'fcSetDark';
  const view = KINDS[kind].view;
  if (HAND_KINDS.includes(kind)) {
    const hand = !!frame && frame.length > HAND + 20 && frame.slice(HAND, HAND + 21).every((p) => p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99);
    return hand ? 'fcSetOk' : 'fcSetHand';
  }
  if (!frame || frame.length < 29) return 'fcSetStepBack';
  const sideOk = (s: 0 | 1) => needed(view, s).every((i) => inView(frame, i));
  const front = FRONT_VIEWS.includes(view);
  // Facing the phone: both sides are needed. From the side: the side nearest the phone is enough.
  if (front ? !(sideOk(0) && sideOk(1)) : !(sideOk(0) || sideOk(1))) return 'fcSetStepBack';
  // Which way the person faces: how far apart the shoulders look, compared with the length of the trunk.
  const ls = frame[LM.lShoulder], rs = frame[LM.rShoulder], lh = frame[LM.lHip], rh = frame[LM.rHip];
  const bothSh = inView(frame, LM.lShoulder) && inView(frame, LM.rShoulder);
  const trunk = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  const width = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (bothSh && trunk > 0) {
    if (SIDE_VIEWS.includes(view) && width > 0.45 * trunk) return 'fcSetSide';
    if (front && width < 0.25 * trunk) return 'fcSetFront';
  }
  if (front && !bothSh) return 'fcSetFront';
  return 'fcSetOk';
}

/** Average brightness (0 to 255) of an RGBA pixel buffer, read from a small copy of the camera picture. */
export function lumaOf(data: Uint8ClampedArray): number {
  let sum = 0, n = 0;
  for (let i = 0; i + 2 < data.length; i += 16) { sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++; }
  return n ? sum / n : 255;
}
