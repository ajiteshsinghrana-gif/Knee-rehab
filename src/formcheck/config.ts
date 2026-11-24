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
  | 'slr' | 'squat' | 'squat-side' | 'shoulder-abduction'
  | 'lunge-side'
  | 'knee-flex' | 'sit-to-stand' | 'lunge' | 'step-up' | 'shoulder-flexion' | 'hip-abduction' | 'bridging' | 'calf-raise' | 'balance' | 'balance-line' | 'walking' | 'ankle-pump' | 'pendulum' | 'cycle' | 'plank' | 'bird-dog'
  | 'hand-fist' | 'wrist' | 'elbow' | 'scap' | 'band-rot';
/** Where the phone goes: side on lying down, side on standing, facing the person standing, or facing the person seated. */
export type FormView = 'side' | 'sideStand' | 'front' | 'seated' | 'balance' | 'balanceLine' | 'walkSide' | 'sideFoot' | 'pendulum' | 'cycle' | 'plank' | 'birdDog' | 'hand' | 'forearm' | 'armSide' | 'back' | 'bandFront';
export const SIGNOFF = 'NEEDS_PHYSIO_SIGNOFF' as const;

/** MediaPipe Pose Landmarker point numbers (33 points). */
export const LM = {
  nose: 0, lEar: 7, rEar: 8, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHeel: 29, rHeel: 30, lFoot: 31, rFoot: 32,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
} as const;
/**
 * The hand model adds 21 points after the 33 body points (frame index HAND + n). Only the check for the hand, wrist and elbow uses them.
 * n: 0 wrist, 4 thumb tip, 5/9/13/17 knuckles of index, middle, ring, little finger, 8/12/16/20 their tips.
 */
export const HAND = 33;
export const HL = { wrist: 0, indexMcp: 5, middleMcp: 9, ringMcp: 13, pinkyMcp: 17, indexTip: 8, middleTip: 12, ringTip: 16, pinkyTip: 20 } as const;
export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
/** Kinds that need the separate hand model (loaded only for these, because it is an extra download). */
export const HAND_KINDS: FormKind[] = ['hand-fist', 'wrist'];
/** Pairs drawn as the skeleton on screen. */
export const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

/** Which library exercises each kind can measure. Shoulder abduction has no shipped library entry yet: a physio-written exercise can use it (see README). */
export const KIND_EXERCISES: Record<FormKind, string[]> = {
  slr: ['straight-leg-raise'],
  squat: ['squats', 'mini-squats'],
  /** The second angle of the squat (from the side). Chosen by the screen after the front view, so no exercise maps here on its own. */
  'squat-side': [],
  'shoulder-abduction': ['shoulder-abduction'],
  'knee-flex': ['heel-slides', 'gentle-rom'],
  'sit-to-stand': ['sit-to-stand'],
  lunge: ['lunges'],
  /** The second angle of the lunge (from the side). Chosen on the screen, so no exercise maps here on its own. */
  'lunge-side': [],
  /** Stairs practice is stepping up and down one step: the same check as step-ups. */
  'step-up': ['step-ups', 'stairs-practice'],
  'shoulder-flexion': ['assisted-arm-raise', 'wall-slide'],
  'hip-abduction': ['hip-abduction'],
  bridging: ['bridging'],
  'calf-raise': ['calf-raises'],
  balance: ['balance'],
  /** The same balance exercise done heel to toe. Chosen on the screen (see VARIANTS), so no exercise maps here on its own. */
  'balance-line': [],
  /** A walking programme or a walk with an aid is judged on one pass across the picture, not on the whole programme. An aid can hide part of a leg: then the check says it could not see enough. */
  walking: ['walking', 'walking-programme', 'walking-aid'],
  'ankle-pump': ['ankle-pumps'],
  pendulum: ['pendulum'],
  cycle: ['stationary-cycling'],
  plank: ['core'],
  'bird-dog': [],
  /** Hand, wrist and elbow movement is three exercises in one: the patient picks which (see VARIANTS). */
  'hand-fist': ['hand-wrist-elbow'],
  wrist: [],
  elbow: [],
  scap: ['shoulder-blade-squeeze'],
  'band-rot': ['band-rotation'],
};
/** Exercises the patient does in more than one way: the camera asks which. */
export const VARIANTS: Record<string, { kind: FormKind; labelKey: string }[]> = {
  balance: [{ kind: 'balance', labelKey: 'fcVarLeg' }, { kind: 'balance-line', labelKey: 'fcVarLine' }],
  core: [{ kind: 'plank', labelKey: 'fcVarPlank' }, { kind: 'bird-dog', labelKey: 'fcVarBird' }],
  'hand-wrist-elbow': [{ kind: 'hand-fist', labelKey: 'fcVarFist' }, { kind: 'wrist', labelKey: 'fcVarWrist' }, { kind: 'elbow', labelKey: 'fcVarElbow' }],
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
  /** The main number has no meaning a physio could cap (a pedal position, a plank angle): no per-patient limit for this kind. */
  noLimit?: true;
  /** Rep counting with a gap between the two thresholds, so a small wobble is not counted. */
  repUp: number;
  repDown: number;
  /** A fault must be seen in this many frames in a row before it counts (about 0.4 s at 15 frames a second). */
  minFrames: number;
  /** Faults and where they come from. `limit` is the trigger value in the fault's unit. */
  /** `minFrames` here overrides the default for one fault (speed faults are short, so they need fewer frames in a row). */
  faults: { id: string; kind: FormFaultKind; limit: number; unit: 'deg' | 'pct' | 'degps' | 'pctps' | 's'; minFrames?: number }[];
}

/**
 * Counting is easy on the patient: a rep counts once the movement reaches `upFactor` of the range in each kind's `repUp`, and ends once it comes back to
 * `downFactor` times `repDown` (never above 0.8 of the way up). A rep is never taken away for form: faults are only tips. NEEDS_PHYSIO_SIGNOFF.
 */
export const REP = { upFactor: 0.7, downFactor: 1.4 } as const;

export const FORM_CHECK = {
  /**
   * Only point out what is clearly off. Every fault limit below is multiplied by `limitFactor`, and the fault must last `framesFactor` times as many frames.
   * The physio's own per-patient limits are not softened. NEEDS_PHYSIO_SIGNOFF.
   */
  gross: { limitFactor: 1.5, framesFactor: 2 },
  /** Landmark must be at least this visible to be used. */
  minVisibility: 0.4,
  /** Smoothing of landmark positions (0 to 1; higher follows the camera faster). */
  smoothing: 0.6,
  /** Frames at rest used to learn the starting position. */
  baselineFrames: 8,
  /** Seconds to get into position after tapping start, before anything is measured. */
  getReadySec: 5,
  /** Fewer usable frames than this share, or fewer than minFrames in total, means "could not see enough": nothing is flagged. */
  minUsable: 0.7,
  minTotalFrames: 20,
  /** Balance holds: a hold shorter than this many seconds is flagged (placeholder; not yet set per patient). */
  holdMinSec: 10,
  /** Set ends on its own after this many seconds (also caps the clip size). */
  maxSeconds: 90,
  /** The phone stops the set for these fault kinds: a loss of balance ("Sit down and rest") or a limit the physio set. Can be switched off. */
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
    ],
  },
  // Facing the camera. Signal: how far the hips drop, as a share of leg length.
  squat: {
    signal: 'pct', view: 'front', hint: 'hip drop as % of leg length', repUp: 12, repDown: 5, minFrames: 6,
    faults: [
      { id: 'squat-knee-in', kind: 'posture', limit: 12, unit: 'pct' },        // knee falls inward by 12% of thigh length
      { id: 'squat-lean', kind: 'compensation', limit: 10, unit: 'deg' },      // trunk leans sideways more than 10 degrees
      { id: 'squat-balance', kind: 'stability', limit: 15, unit: 'pct' },      // a foot moves, or the hips sway, by 15% of leg length
    ],
  },
  // Side-on, standing: the second angle of the squat. Signal: how far the knee bends, in degrees (0 = straight). This is the depth of the squat.
  'squat-side': {
    signal: 'deg', view: 'sideStand', hint: 'degrees of knee bend (squat depth, side view)', repUp: 25, repDown: 10, minFrames: 6,
    faults: [
      { id: 'squat-side-lean', kind: 'compensation', limit: 40, unit: 'deg' },  // trunk tips forward more than 40 degrees beyond how upright it started
    ],
  },
  // Facing the camera. Signal: arm raise away from the side, in degrees.
  'shoulder-abduction': {
    signal: 'deg', view: 'front', hint: 'degrees the arm is raised', repUp: 40, repDown: 15, minFrames: 6,
    faults: [
      { id: 'abd-elbow-bent', kind: 'posture', limit: 30, unit: 'deg' },       // elbow more than 30 degrees short of straight
      { id: 'abd-lean', kind: 'compensation', limit: 8, unit: 'deg' },         // trunk leans sideways more than 8 degrees
      { id: 'abd-shrug', kind: 'compensation', limit: 15, unit: 'pct' },       // shoulder rises by 15% of its starting ear distance
    ],
  },
  // Side-on, lying or sitting. Signal: how far the knee bends, in degrees (0 = straight).
  'knee-flex': {
    signal: 'deg', view: 'side', hint: 'degrees of knee bend', repUp: 30, repDown: 10, minFrames: 6,
    faults: [
      { id: 'flex-trunk-shift', kind: 'compensation', limit: 12, unit: 'deg' },  // trunk rolls or turns more than 12 degrees from where it started
    ],
  },
  // Facing the camera, starting seated. Signal: how far the hips rise, as a share of leg length.
  'sit-to-stand': {
    signal: 'pct', view: 'seated', hint: 'hip rise as % of leg length', repUp: 25, repDown: 8, minFrames: 6,
    faults: [
      { id: 'sit-knee-in', kind: 'posture', limit: 12, unit: 'pct' },
      { id: 'sit-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'sit-balance', kind: 'stability', limit: 15, unit: 'pct' },
    ],
  },
  // Facing the camera. The front foot moves, so only hip sway is judged, not the feet.
  lunge: {
    signal: 'pct', view: 'front', hint: 'hip drop as % of leg length', repUp: 12, repDown: 5, minFrames: 6,
    faults: [
      { id: 'lunge-knee-in', kind: 'posture', limit: 12, unit: 'pct' },
      { id: 'lunge-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'lunge-sway', kind: 'stability', limit: 15, unit: 'pct' },
    ],
  },
  // Side-on, standing: the second angle of the lunge. Signal: how far the knee nearest the phone bends, in degrees (0 = straight). The lunge depth.
  'lunge-side': {
    signal: 'deg', view: 'sideStand', hint: 'degrees of knee bend (lunge depth, side view)', repUp: 25, repDown: 10, minFrames: 6,
    faults: [
      { id: 'lunge-side-lean', kind: 'compensation', limit: 40, unit: 'deg' },  // trunk tips forward more than 40 degrees beyond how upright it started
    ],
  },
  // Facing the camera. Signal: how far the hips rise onto the step, as a share of leg length.
  'step-up': {
    signal: 'pct', view: 'front', hint: 'hip rise as % of leg length', repUp: 8, repDown: 3, minFrames: 6,
    faults: [
      { id: 'step-knee-in', kind: 'posture', limit: 12, unit: 'pct' },
      { id: 'step-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'step-sway', kind: 'stability', limit: 15, unit: 'pct' },
    ],
  },
  // Side-on, standing. Signal: arm raised forwards, in degrees.
  'shoulder-flexion': {
    signal: 'deg', view: 'sideStand', hint: 'degrees the arm is raised', repUp: 40, repDown: 15, minFrames: 6,
    faults: [
      { id: 'arm-lean', kind: 'compensation', limit: 10, unit: 'deg' },  // trunk leans more than 10 degrees from where it started
    ],
  },
  // Facing the camera, standing. Signal: how far the lifted leg moves out from straight down, in degrees.
  'hip-abduction': {
    signal: 'deg', view: 'front', hint: 'degrees the leg moves out to the side', repUp: 15, repDown: 6, minFrames: 6,
    faults: [
      { id: 'hipabd-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'hipabd-knee-bent', kind: 'posture', limit: 20, unit: 'deg' },
    ],
  },
  // Side-on, lying on the back. Signal: how far the hips lift, as a share of thigh length.
  bridging: {
    signal: 'pct', view: 'side', hint: 'hip lift as % of thigh length', repUp: 25, repDown: 8, minFrames: 6,
    faults: [
      { id: 'bridge-feet', kind: 'stability', limit: 12, unit: 'pct' },  // a foot slides by 12% of thigh length
    ],
  },
  // Facing the camera, standing. Signal: how far the heels rise, as a share of leg length.
  'calf-raise': {
    signal: 'pct', view: 'front', hint: 'heel rise as % of leg length', repUp: 4, repDown: 1.5, minFrames: 6,
    faults: [
      { id: 'calf-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'calf-sway', kind: 'stability', limit: 10, unit: 'pct' },
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
  // Facing the camera, feet hip-width apart to start, then one foot placed directly in front of the other (heel to toe).
  // Signal: how much closer together the feet look, as a share of their starting width. Physio limits do not apply to this variant.
  'balance-line': {
    signal: 'pct', view: 'balanceLine', hint: 'how much closer the feet came, as % of their starting gap', repUp: 70, repDown: 35, minFrames: 6,
    faults: [
      { id: 'bal-wobble', kind: 'stability', limit: 30, unit: 'pctps', minFrames: 3 },
      { id: 'bal-lean', kind: 'compensation', limit: 10, unit: 'deg' },
      { id: 'bal-arms', kind: 'compensation', limit: 50, unit: 'deg' },
    ],
  },
  // Side-on to a fixed phone, walking across the picture and back. Each step is one "rep". Signal: how far apart the feet are, as a share of trunk length.
  walking: {
    signal: 'pct', view: 'walkSide', hint: 'step length as % of trunk length', repUp: 40, repDown: 20, minFrames: 6,
    faults: [
      { id: 'walk-lean', kind: 'compensation', limit: 12, unit: 'deg', minFrames: 8 },  // trunk more than 12 degrees from upright
    ],
  },
  // Side-on, lying with the leg straight and the foot in view. Signal: how far the toes point away, in degrees from the relaxed position.
  'ankle-pump': {
    signal: 'deg', view: 'sideFoot', hint: 'degrees the toes point away from relaxed', repUp: 15, repDown: 6, minFrames: 4,
    faults: [
      { id: 'pump-leg-moves', kind: 'compensation', limit: 12, unit: 'pct' },  // the knee moves by 12% of shank length
    ],
  },
  // Side-on, bent forward with one arm hanging. Signal: how far the arm swings from hanging, in degrees. Swings towards or away from the camera are not seen.
  pendulum: {
    signal: 'deg', view: 'pendulum', hint: 'degrees the arm swings from hanging', repUp: 8, repDown: 3, minFrames: 4,
    faults: [
      { id: 'pend-wide', kind: 'control', limit: 45, unit: 'deg' },
    ],
  },
  // Side-on to a stationary bike. Signal: where the knee is in its bend and straighten, 0 to 100 (one rep is one pedal turn).
  cycle: {
    signal: 'pct', view: 'cycle', hint: 'pedal position', noLimit: true, repUp: 70, repDown: 30, minFrames: 6,
    faults: [
      { id: 'cyc-bob', kind: 'posture', limit: 8, unit: 'pct', minFrames: 3 },         // the hips move up and down by 8% of trunk length
      { id: 'cyc-lean', kind: 'compensation', limit: 15, unit: 'deg' },
    ],
  },
  // Side-on, on the floor. Signal: how flat the body is, in degrees (0 upright, 90 flat). The hold is timed.
  plank: {
    signal: 'deg', view: 'plank', hint: 'degrees flat', noLimit: true, repUp: 60, repDown: 30, minFrames: 8,
    faults: [
      { id: 'plank-sag', kind: 'posture', limit: 8, unit: 'pct' },   // hips below the shoulder-to-ankle line by 8% of body length
      { id: 'plank-pike', kind: 'posture', limit: 10, unit: 'pct' },
    ],
  },
  // Side-on, on hands and knees. Signal: how far the back leg is extended from resting, in degrees. The hold is timed. Only the leg is measured.
  'bird-dog': {
    signal: 'deg', view: 'birdDog', hint: 'degrees the back leg is lifted', noLimit: true, repUp: 25, repDown: 10, minFrames: 8,
    faults: [
      { id: 'bird-tilt', kind: 'compensation', limit: 10, unit: 'deg' },
    ],
  },
  // Close up, palm towards the camera (hand model). Signal: how closed the hand is, 0 open to 100 tight fist.
  'hand-fist': {
    signal: 'pct', view: 'hand', hint: 'how closed the fist is (0 open, 100 tight fist)', repUp: 50, repDown: 20, minFrames: 6,
    faults: [
      { id: 'fist-wrist-moves', kind: 'compensation', limit: 80, unit: 'pct' },  // the wrist travels by 80% of the palm length from where it started
    ],
  },
  // Side-on, forearm resting, upper body in view (hand model for the hand). Signal: how far the wrist bends from straight, either way.
  wrist: {
    signal: 'deg', view: 'forearm', hint: 'degrees the wrist is bent (up or down)', repUp: 25, repDown: 10, minFrames: 6,
    faults: [
      { id: 'wrist-elbow-moves', kind: 'compensation', limit: 15, unit: 'pct' },  // the elbow moves by 15% of forearm length
    ],
  },
  // Side-on, seated. Signal: how far the elbow bends, in degrees (0 = straight).
  elbow: {
    signal: 'deg', view: 'armSide', hint: 'degrees the elbow is bent', repUp: 60, repDown: 20, minFrames: 6,
    faults: [
      { id: 'elbow-arm-moves', kind: 'compensation', limit: 20, unit: 'deg' },  // the upper arm swings 20 degrees from where it started
    ],
  },
  // From behind. Signal: how much the shoulder points pull in, as a share of their starting width. The least accurate check: the squeeze moves the points only a little.
  scap: {
    signal: 'pct', view: 'back', hint: 'how much the shoulders pulled in (% of their starting width)', repUp: 4, repDown: 1.5, minFrames: 8,
    faults: [
      { id: 'scap-shrug', kind: 'compensation', limit: 10, unit: 'pct' },  // shoulders rise by 10% of hip width
      { id: 'scap-lean', kind: 'compensation', limit: 10, unit: 'deg' },
    ],
  },
  // Facing the camera, elbow at the side. Signal: how far the forearm turns outwards, as a share of upper-arm length. Turning inwards is not counted.
  'band-rot': {
    signal: 'pct', view: 'bandFront', hint: 'how far the forearm turned outwards (% of upper-arm length)', repUp: 40, repDown: 15, minFrames: 6,
    faults: [
      { id: 'rot-elbow-away', kind: 'compensation', limit: 25, unit: 'pct' },  // the elbow leaves the side by 25% of upper-arm length
      { id: 'rot-lean', kind: 'compensation', limit: 10, unit: 'deg' },
    ],
  },
};

/** Walking: the left and right leading steps are compared at the end of the set. Placeholders. */
export const WALK = { unevenPct: 20, minSteps: 6 } as const;
/** Ankle pumps: toes should come at least this far towards the shin between pumps (degrees). Placeholder. */
export const PUMP = { dorsiMinDeg: 8 } as const;

/** A balance hold shorter than the target. Judged per hold, not per camera frame, so it is not in a kind's fault list. */
export const HOLD_FAULT = { id: 'bal-short', kind: 'control' as FormFaultKind };
/** Walking: uneven step length, judged on the whole set. */
export const STEP_FAULT = { id: 'walk-uneven', kind: 'compensation' as FormFaultKind };
/** Ankle pumps: the toes did not come up far enough between pumps. */
export const PUMP_FAULT = { id: 'pump-short-dorsi', kind: 'range' as FormFaultKind };
/** Faults judged per hold, step or pump rather than per camera frame: they are not in a kind's fault list. */
export const SET_FAULTS = [HOLD_FAULT, STEP_FAULT, PUMP_FAULT, { id: 'pace-fast', kind: 'control' as FormFaultKind }, { id: 'pace-slow', kind: 'control' as FormFaultKind }] as const;

/** Faults the physio's own limits can raise. Not placeholders: they use the number the physio typed. */
export const LIMIT_FAULTS: Record<'max' | 'min', { id: string; kind: FormFaultKind }> = {
  max: { id: 'limit-max', kind: 'precaution' },
  min: { id: 'limit-min', kind: 'range' },
};
/**
 * Angles an exercise can be checked from, first one is the usual. One view cannot see everything: the squat and the lunge from the front
 * see knees going in, leaning and swaying but not how deep the knee bends; from the side they measure the knee bend (depth) and the trunk
 * tipping forward. Every extra angle is optional: the patient picks which to start with, and is offered the others after a set, never required.
 * Other exercises have one angle because a second one would not measure anything new with one phone (for example the sideways arm raise is
 * seen from the front only, and the straight leg raise is already side-on).
 */
export const ANGLES: Partial<Record<FormKind, FormKind[]>> = { squat: ['squat', 'squat-side'], lunge: ['lunge', 'lunge-side'] };
/** Kinds whose deepest point in every rep is kept and shown as a depth (degrees of knee bend). */
export const DEPTH_KINDS: FormKind[] = ['squat-side', 'lunge-side'];
/** Is this angle a front view (as opposed to a side view)? Used for the labels. */
export const isFrontView = (k: FormKind): boolean => KINDS[k].view === 'front';
export const unitOf = (k: FormKind): 'deg' | 'pct' => KINDS[k].signal;

// ---------- what the camera offers for each exercise (camera check safety round) ----------
/**
 * Exercises that reuse another exercise's check instead of having rules of their own. The camera only counts for these:
 * stairs practice is a staircase, not one step; a walking programme or a walk with an aid is judged on one pass at most.
 */
export const BORROWED: string[] = ['stairs-practice', 'walking-programme', 'walking-aid'];
/**
 * What the camera offers for one exercise:
 *   form   its own form rules, each with an automated test (tests/formcheck.test.ts): reps, pace and one cue per fault
 *   count  reps and pace only, no form tips (the check is borrowed from another exercise); a stumble still stops the set
 *   video  the camera cannot measure or count it: the screen still opens, says form tips are not available yet, and offers a video
 */
export type CheckMode = 'form' | 'count' | 'video';
export const checkMode = (exerciseId: string): CheckMode => (!formKindFor(exerciseId) ? 'video' : BORROWED.includes(exerciseId) ? 'count' : 'form');

/**
 * Pace: each rep is timed (from when the movement starts to when it is back at rest) and compared with a tempo, in seconds per
 * rep. The physio can set the tempo per exercise for one patient; otherwise the default below is used. Placeholders: NEEDS_PHYSIO_SIGNOFF.
 * Too fast: shorter than `fast` x tempo. Too slow: longer than `slow` x tempo.
 */
export const PACE = { fast: 0.35, slow: 3, minSec: 1, maxSec: 20 } as const;
/** No pace for timed holds, walking, cycling (they have their own rates) or the pendulum (a loose swing has no set speed). */
export const DEFAULT_TEMPO: Partial<Record<FormKind, number>> = {
  slr: 4, squat: 4, 'squat-side': 4, 'lunge-side': 4, 'shoulder-abduction': 4, 'knee-flex': 4, 'sit-to-stand': 4, lunge: 4, 'step-up': 4, 'shoulder-flexion': 4, 'hip-abduction': 4,
  bridging: 4, 'calf-raise': 3, 'ankle-pump': 2, 'hand-fist': 3, wrist: 3, elbow: 3, scap: 3, 'band-rot': 3,
};
export const paceApplies = (k: FormKind): boolean => DEFAULT_TEMPO[k] !== undefined;
export const PACE_FAULTS = { fast: { id: 'pace-fast', kind: 'control' as FormFaultKind }, slow: { id: 'pace-slow', kind: 'control' as FormFaultKind } } as const;

/**
 * Setup check before a set (live prompts: step back, too dark, turn sideways). Placeholders: NEEDS_PHYSIO_SIGNOFF.
 * `darkLuma`: average brightness (0 to 255) below which the picture is too dark. `slowFps`: fewer measured frames a second
 * than this while setting up means the phone is too slow to measure, so the screen offers a video for the physio instead.
 */
/** autoFrames: held in position this many frames (about 1.3 s) and the countdown starts by itself. lostFrames: out of position this long during the countdown and it goes back to setup. */
export const SETUP = { darkLuma: 30, slowFps: 7, slowAfterMs: 3000, okFrames: 6, autoFrames: 12, lostFrames: 30, helpAfterSec: 10 } as const;
