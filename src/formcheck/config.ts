/**
 * Camera form check: exercise kinds, landmark ids and every threshold in ONE place.
 *
 * The phone measures, the rules flag, the physio decides. Nothing here changes a plan, a phase or a triage tier.
 * Every number below is a placeholder tagged NEEDS_PHYSIO_SIGNOFF: they have not been validated against a goniometer
 * or a physio's eye, and a single phone camera can be wrong by several degrees. The only limits that are not placeholders are
 * the ones a physio sets for one patient (Patient.formLimits).
 */
import type { FormFaultKind } from '../types';

export type FormKind =
  | 'slr' | 'squat' | 'shoulder-abduction'
  | 'knee-flex' | 'sit-to-stand' | 'lunge' | 'step-up' | 'shoulder-flexion' | 'hip-abduction' | 'bridging' | 'calf-raise' | 'balance';
/** Where the phone goes: side on lying down, side on standing, facing the person standing, or facing the person seated. */
export type FormView = 'side' | 'sideStand' | 'front' | 'seated' | 'balance';
export const SIGNOFF = 'NEEDS_PHYSIO_SIGNOFF' as const;

/** MediaPipe Pose Landmarker point numbers (33 points). */
export const LM = {
  nose: 0, lEar: 7, rEar: 8, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
} as const;
/** Pairs drawn as the skeleton on screen. */
export const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

/** Which library exercises each kind can measure. Shoulder abduction has no shipped library entry yet: a physio-written exercise can use it (see README). */
export const KIND_EXERCISES: Record<FormKind, string[]> = {
  slr: ['straight-leg-raise'],
  squat: ['squats', 'mini-squats'],
  'shoulder-abduction': ['shoulder-abduction'],
  'knee-flex': ['heel-slides', 'gentle-rom'],
  'sit-to-stand': ['sit-to-stand'],
  lunge: ['lunges'],
  'step-up': ['step-ups'],
  'shoulder-flexion': ['assisted-arm-raise', 'wall-slide'],
  'hip-abduction': ['hip-abduction'],
  bridging: ['bridging'],
  'calf-raise': ['calf-raises'],
  balance: ['balance'],
};
export const formKindFor = (exerciseId: string): FormKind | null => {
  for (const k of Object.keys(KIND_EXERCISES) as FormKind[]) if (KIND_EXERCISES[k].includes(exerciseId)) return k;
  return null;
};

export interface KindConfig {
  /** How the main movement number is read, and its unit for the physio's limits. */
  signal: 'deg' | 'pct';
  /** Camera view the patient is asked for. */
  view: FormView;
  /** What the main number means, shown to the physio next to the limit boxes. */
  hint: string;
  /** Rep counting with a gap between the two thresholds, so a small wobble is not counted. */
  repUp: number;
  repDown: number;
  /** A fault must be seen in this many frames in a row before it counts (about 0.4 s at 15 frames a second). */
  minFrames: number;
  /** Faults and where they come from. `limit` is the trigger value in the fault's unit. */
  /** `minFrames` here overrides the default for one fault (speed faults are short, so they need fewer frames in a row). */
  faults: { id: string; kind: FormFaultKind; limit: number; unit: 'deg' | 'pct' | 'degps' | 'pctps'; minFrames?: number }[];
}

export const FORM_CHECK = {
  /** Landmark must be at least this visible to be used. */
  minVisibility: 0.5,
  /** Smoothing of landmark positions (0 to 1; higher follows the camera faster). */
  smoothing: 0.6,
  /** Frames at rest used to learn the starting position. */
  baselineFrames: 8,
  /** Seconds to get into position after tapping start, before anything is measured. */
  getReadySec: 5,
  /** Fewer usable frames than this share, or fewer than minFrames in total, means "could not see enough": nothing is flagged. */
  minUsable: 0.7,
  minTotalFrames: 20,
  /** Set ends on its own after this many seconds (also caps the clip size). */
  maxSeconds: 90,
  /** The phone asks the patient to pause for these fault kinds (loss of balance, a physio-set limit). Can be switched off. */
  pauseOn: ['stability', 'precaution'] as FormFaultKind[],
  pauseEnabled: true,
  /** Rule F1: the same fault in this many of the last `window` reliable checks of the same exercise raises a review item. */
  f1: { checks: 3, window: 5 },
  /** A fault counts as "present" in a check when seen in at least this many reps (or in the only rep, if just one was counted). */
  presentReps: 2,
  keepChecks: 60,
  /** An unanswered auto-raised request for the same exercise stops another being raised for this many days. */
  dedupeDays: 3,
  consentVersion: '2026-11-camera-v1',
  source: SIGNOFF,
} as const;

export const KINDS: Record<FormKind, KindConfig> = {
  // Side-on, lying on the back. Signal: hip lift in degrees.
  slr: {
    signal: 'deg', view: 'side', hint: 'degrees the leg is lifted', repUp: 20, repDown: 8, minFrames: 6,
    faults: [
      { id: 'slr-knee-bent', kind: 'posture', limit: 20, unit: 'deg' },        // knee more than 20 degrees short of straight
      { id: 'slr-trunk-shift', kind: 'compensation', limit: 12, unit: 'deg' }, // trunk turns more than 12 degrees from where it started
      { id: 'slr-fast', kind: 'control', limit: 120, unit: 'degps', minFrames: 3 },  // lift faster than 120 degrees a second for about 0.2 s
    ],
  },
  // Facing the camera. Signal: how far the hips drop, as a share of leg length.
  squat: {
    signal: 'pct', view: 'front', hint: 'hip drop as % of leg length', repUp: 12, repDown: 5, minFrames: 6,
    faults: [
      { id: 'squat-knee-in', kind: 'posture', limit: 12, unit: 'pct' },        // knee falls inward by 12% of thigh length
      { id: 'squat-lean', kind: 'compensation', limit: 10, unit: 'deg' },      // trunk leans sideways more than 10 degrees
      { id: 'squat-balance', kind: 'stability', limit: 15, unit: 'pct' },      // a foot moves, or the hips sway, by 15% of leg length
      { id: 'squat-fast', kind: 'control', limit: 60, unit: 'pctps', minFrames: 3 },  // hips move faster than 60% of leg length a second
    ],
  },
  // Facing the camera. Signal: arm raise away from the side, in degrees.
  'shoulder-abduction': {
    signal: 'deg', view: 'front', hint: 'degrees the arm is raised', repUp: 40, repDown: 15, minFrames: 6,
    faults: [
      { id: 'abd-elbow-bent', kind: 'posture', limit: 30, unit: 'deg' },       // elbow more than 30 degrees short of straight
      { id: 'abd-lean', kind: 'compensation', limit: 8, unit: 'deg' },         // trunk leans sideways more than 8 degrees
      { id: 'abd-shrug', kind: 'compensation', limit: 15, unit: 'pct' },       // shoulder rises by 15% of its starting ear distance
      { id: 'abd-fast', kind: 'control', limit: 120, unit: 'degps', minFrames: 3 },
    ],
  },
  // Side-on, lying or sitting. Signal: how far the knee bends, in degrees (0 = straight).
  'knee-flex': {
    signal: 'deg', view: 'side', hint: 'degrees of knee bend', repUp: 30, repDown: 10, minFrames: 6,
    faults: [
      { id: 'flex-trunk-shift', kind: 'compensation', limit: 12, unit: 'deg' },  // trunk rolls or turns more than 12 degrees from where it started
      { id: 'flex-fast', kind: 'control', limit: 120, unit: 'degps', minFrames: 3 },
    ],
  },
  // Facing the camera, starting seated. Signal: how far the hips rise, as a share of leg length.
  'sit-to-stand': {
    signal: 'pct', view: 'seated', hint: 'hip rise as % of leg length', repUp: 25, repDown: 8, minFrames: 6,
    faults: [
      { id: 'sit-knee-in', kind: 'posture', limit: 12, unit: 'pct' },
      { id: 'sit-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'sit-balance', kind: 'stability', limit: 15, unit: 'pct' },
      { id: 'sit-fast', kind: 'control', limit: 60, unit: 'pctps', minFrames: 3 },
    ],
  },
  // Facing the camera. The front foot moves, so only hip sway is judged, not the feet.
  lunge: {
    signal: 'pct', view: 'front', hint: 'hip drop as % of leg length', repUp: 12, repDown: 5, minFrames: 6,
    faults: [
      { id: 'lunge-knee-in', kind: 'posture', limit: 12, unit: 'pct' },
      { id: 'lunge-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'lunge-sway', kind: 'stability', limit: 15, unit: 'pct' },
      { id: 'lunge-fast', kind: 'control', limit: 60, unit: 'pctps', minFrames: 3 },
    ],
  },
  // Facing the camera. Signal: how far the hips rise onto the step, as a share of leg length.
  'step-up': {
    signal: 'pct', view: 'front', hint: 'hip rise as % of leg length', repUp: 8, repDown: 3, minFrames: 6,
    faults: [
      { id: 'step-knee-in', kind: 'posture', limit: 12, unit: 'pct' },
      { id: 'step-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'step-sway', kind: 'stability', limit: 15, unit: 'pct' },
      { id: 'step-fast', kind: 'control', limit: 60, unit: 'pctps', minFrames: 3 },
    ],
  },
  // Side-on, standing. Signal: arm raised forwards, in degrees.
  'shoulder-flexion': {
    signal: 'deg', view: 'sideStand', hint: 'degrees the arm is raised', repUp: 40, repDown: 15, minFrames: 6,
    faults: [
      { id: 'arm-lean', kind: 'compensation', limit: 10, unit: 'deg' },  // trunk leans more than 10 degrees from where it started
      { id: 'arm-fast', kind: 'control', limit: 120, unit: 'degps', minFrames: 3 },
    ],
  },
  // Facing the camera, standing. Signal: how far the lifted leg moves out from straight down, in degrees.
  'hip-abduction': {
    signal: 'deg', view: 'front', hint: 'degrees the leg moves out to the side', repUp: 15, repDown: 6, minFrames: 6,
    faults: [
      { id: 'hipabd-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'hipabd-knee-bent', kind: 'posture', limit: 20, unit: 'deg' },
      { id: 'hipabd-fast', kind: 'control', limit: 100, unit: 'degps', minFrames: 3 },
    ],
  },
  // Side-on, lying on the back. Signal: how far the hips lift, as a share of thigh length.
  bridging: {
    signal: 'pct', view: 'side', hint: 'hip lift as % of thigh length', repUp: 25, repDown: 8, minFrames: 6,
    faults: [
      { id: 'bridge-feet', kind: 'stability', limit: 12, unit: 'pct' },  // a foot slides by 12% of thigh length
      { id: 'bridge-fast', kind: 'control', limit: 60, unit: 'pctps', minFrames: 3 },
    ],
  },
  // Facing the camera, standing. Signal: how far the heels rise, as a share of leg length.
  'calf-raise': {
    signal: 'pct', view: 'front', hint: 'heel rise as % of leg length', repUp: 4, repDown: 1.5, minFrames: 6,
    faults: [
      { id: 'calf-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'calf-sway', kind: 'stability', limit: 10, unit: 'pct' },
      { id: 'calf-fast', kind: 'control', limit: 40, unit: 'pctps', minFrames: 3 },
    ],
  },
  // Facing the camera, standing near a support. One foot is lifted and held. Signal: how high the lifted foot comes off the floor, as a share of leg length.
  balance: {
    signal: 'pct', view: 'balance', hint: 'foot lift as % of leg length', repUp: 8, repDown: 3, minFrames: 6,
    faults: [
      { id: 'bal-wobble', kind: 'stability', limit: 30, unit: 'pctps', minFrames: 3 },  // the hips jerk sideways faster than 30% of leg length a second
      { id: 'bal-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'bal-arms', kind: 'compensation', limit: 50, unit: 'deg' },  // an arm held out more than 50 degrees from the body to balance
    ],
  },
};

/** Faults the physio's own limits can raise. Not placeholders: they use the number the physio typed. */
export const LIMIT_FAULTS: Record<'max' | 'min', { id: string; kind: FormFaultKind }> = {
  max: { id: 'limit-max', kind: 'precaution' },
  min: { id: 'limit-min', kind: 'range' },
};
export const unitOf = (k: FormKind): 'deg' | 'pct' => KINDS[k].signal;
