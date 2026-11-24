/**
 * Camera form check: exercise kinds, landmark ids and every threshold in ONE place.
 *
 * The phone measures, the rules flag, the physio decides. Nothing here changes a plan, a phase or a triage tier.
 * Every number below is a placeholder tagged NEEDS_PHYSIO_SIGNOFF: they have not been validated against a goniometer
 * or a physio's eye, and a single phone camera can be wrong by several degrees. The only limits that are not placeholders are
 * the ones a physio sets for one patient (Patient.formLimits).
 */
import type { FormFaultKind } from '../types';

export type FormKind = 'slr' | 'squat' | 'shoulder-abduction';
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
};
export const formKindFor = (exerciseId: string): FormKind | null => {
  for (const k of Object.keys(KIND_EXERCISES) as FormKind[]) if (KIND_EXERCISES[k].includes(exerciseId)) return k;
  return null;
};

export interface KindConfig {
  /** How the main movement number is read, and its unit for the physio's limits. */
  signal: 'deg' | 'pct';
  /** Camera view the patient is asked for. */
  view: 'side' | 'front';
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
    signal: 'deg', view: 'side', repUp: 20, repDown: 8, minFrames: 6,
    faults: [
      { id: 'slr-knee-bent', kind: 'posture', limit: 20, unit: 'deg' },        // knee more than 20 degrees short of straight
      { id: 'slr-trunk-shift', kind: 'compensation', limit: 12, unit: 'deg' }, // trunk turns more than 12 degrees from where it started
      { id: 'slr-fast', kind: 'control', limit: 120, unit: 'degps', minFrames: 3 },  // lift faster than 120 degrees a second for about 0.2 s
    ],
  },
  // Facing the camera. Signal: how far the hips drop, as a share of leg length.
  squat: {
    signal: 'pct', view: 'front', repUp: 12, repDown: 5, minFrames: 6,
    faults: [
      { id: 'squat-knee-in', kind: 'posture', limit: 12, unit: 'pct' },        // knee falls inward by 12% of thigh length
      { id: 'squat-lean', kind: 'compensation', limit: 10, unit: 'deg' },      // trunk leans sideways more than 10 degrees
      { id: 'squat-balance', kind: 'stability', limit: 15, unit: 'pct' },      // a foot moves, or the hips sway, by 15% of leg length
      { id: 'squat-fast', kind: 'control', limit: 60, unit: 'pctps', minFrames: 3 },  // hips move faster than 60% of leg length a second
    ],
  },
  // Facing the camera. Signal: arm raise away from the side, in degrees.
  'shoulder-abduction': {
    signal: 'deg', view: 'front', repUp: 40, repDown: 15, minFrames: 6,
    faults: [
      { id: 'abd-elbow-bent', kind: 'posture', limit: 30, unit: 'deg' },       // elbow more than 30 degrees short of straight
      { id: 'abd-lean', kind: 'compensation', limit: 8, unit: 'deg' },         // trunk leans sideways more than 8 degrees
      { id: 'abd-shrug', kind: 'compensation', limit: 15, unit: 'pct' },       // shoulder rises by 15% of its starting ear distance
      { id: 'abd-fast', kind: 'control', limit: 120, unit: 'degps', minFrames: 3 },
    ],
  },
};

/** Faults the physio's own limits can raise. Not placeholders: they use the number the physio typed. */
export const LIMIT_FAULTS: Record<'max' | 'min', { id: string; kind: FormFaultKind }> = {
  max: { id: 'limit-max', kind: 'precaution' },
  min: { id: 'limit-min', kind: 'range' },
};
export const unitOf = (k: FormKind): 'deg' | 'pct' => KINDS[k].signal;
