// Core types. Nothing in here is condition-specific: all clinical content lives in packs/*.json.

export type Lang = 'en' | 'hi' | 'bn';
export const LANGS: Lang[] = ['en', 'hi', 'bn'];
export const LANG_NAME: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', bn: 'বাংলা' };
export const isLang = (x: unknown): x is Lang => x === 'en' || x === 'hi' || x === 'bn';
/** English + Hindi are always present; Bengali is optional and falls back to the built-in wording, then English. */
export interface Bi {
  en: string;
  hi: string;
  bn?: string;
}

/** Four triage tiers. Order = severity (index 0 is most severe). */
export type Tier = 'SAFETY' | 'URGENT' | 'REVIEW' | 'ON_PLAN';
export const TIER_ORDER: Tier[] = ['SAFETY', 'URGENT', 'REVIEW', 'ON_PLAN'];

export type Operator = '>=' | '>' | '<=' | '<' | '==' | '!=';
export type Capture = 'tap' | 'voice' | 'photo' | 'number';
export type Frequency = 'daily' | 'weekly' | 'monthly';
export type Value = number | string | boolean;

/**
 * Source tag. Every clinical number carries one.
 * Examples: "MELBOURNE_ACL_2.0", "DEFAULT", "SAFETY_ADDITION", "PHYSIO_IMPORTED:file.pdf",
 * and the marker "NEEDS_PHYSIO_SIGNOFF" (may be combined: "DEFAULT; NEEDS_PHYSIO_SIGNOFF").
 */
export type SourceTag = string;
export const NEEDS_SIGNOFF = 'NEEDS_PHYSIO_SIGNOFF';

export interface Measure {
  id: string;
  label: Bi;
  unit: string | null;
  capture: Capture;
  frequency: Frequency;
  valueType: 'number' | 'boolean' | 'enum';
  options?: { id: string; label: Bi }[];
  hint?: Bi;
  /** The question the patient is asked (daily measures). Condition wording lives here, not in code. */
  question?: Bi;
  /** Short clinician-facing name used on charts and gates. */
  short?: Bi;
  /** 0-10 style faces scale for tap capture. */
  scale?: { min: number; max: number };
  /** Input bounds/step for number capture. */
  input?: { min: number; max: number; step: number };
  /** The angle can be measured on a photo by tapping three points (Phase 4.1). Points are [end of first line, joint, end of second line]. */
  photoAngle?: { reading: 'between' | 'deviation'; points: [Bi, Bi, Bi] };
  /** Only asked once the patient is at or beyond this phase order. */
  fromPhaseOrder?: number;
  /** Set by the physio, never asked of the patient. */
  setBy?: 'physio';
  /** Computed, never asked: limb symmetry index = operated / other * 100. */
  derived?: { kind: 'lsi'; operated: string; other: string };
  /** Never shown as a standalone question (e.g. the "other leg" half of a pair). */
  pairOf?: string;
}

export interface GateCriterion {
  id: string;
  label: Bi;
  measure: string;
  operator: Operator;
  value: Value;
  source: SourceTag;
}
export interface Gate {
  fromPhase: string;
  toPhase: string;
  criteria: GateCriterion[];
}

export interface Exercise {
  id: string;
  name: Bi;
  /** Path under the site root (placeholder pictures until the physio supplies real ones). */
  picture: string;
  dose: { sets: number | null; reps: number | null; holdSec: number | null; text: Bi; source: SourceTag };
  /** Easier version used by "Regress exercise". null = none defined yet. */
  regressionId: string | null;
  regressionSource: SourceTag | null;
  /** Voice keywords (regex sources) for "hardest movement". */
  voice: string[];
  /** pack id -> phase ids that prescribe it (checked against the packs by the validator). */
  usedIn: Record<string, string[]>;
}
/**
 * A demonstration of the ideal way to do one exercise, attached by the physio (Phase 7.2).
 *  - link:  an https page (YouTube plays inside the app; anything else opens in the browser).
 *  - video: a file the physio uploaded to the clinic's cloud storage; the public https address travels to patients.
 *  - local: a file kept in this browser only (no cloud, or not signed in). It never travels to a patient's phone.
 */
export type ExerciseDemo =
  | { kind: 'link'; url: string; addedAt: string }
  | { kind: 'video'; url: string; name: string; mime: string; size: number; addedAt: string }
  | { kind: 'local'; id: string; name: string; mime: string; size: number; addedAt: string };
export type SyncedDemo = Exclude<ExerciseDemo, { kind: 'local' }>;

export interface Phase {
  id: string;
  order: number;
  name: Bi;
  /** Exercise ids from the library. */
  exercises: string[];
  sessionsPerDay: number;
  followUpEveryDays: number;
  /** Time spent IN this phase, in weeks [min, max]. Criteria-driven protocols have no calendar windows. */
  expectedWeeks: [number, number | null];
  source: SourceTag;
}

export interface CurvePoint {
  week: number;
  value: number;
}
export interface ExpectedCurve {
  measure: string;
  points: [number, number][]; // [weekSinceSurgery, value]
  tolerance: number; // absolute band around the curve
  better: 'higher' | 'lower';
  source: SourceTag;
}

export interface Precaution {
  id: string;
  label: Bi;
  /** Phase ids in which this movement is restricted. */
  phases: string[];
  /** How it is asked in the check-in ("Did you ...?"). Yes = breach. */
  question: Bi;
  source: SourceTag;
}

export interface WarningSign {
  id: string;
  label: Bi;
  /** Label of the rule group this sign feeds (e.g. "Red-flag symptom"). */
  ruleLabel: Bi;
  tier: Exclude<Tier, 'ON_PLAN'>;
  ruleId: string;
  source: SourceTag;
  /** Counts toward a combination rule's distinct REVIEW-rule tally (default true for REVIEW). */
  countsTowardCombination?: boolean;
  note?: string;
  /** Voice parser keywords (regex sources, lower-case, English + Hinglish + Devanagari). */
  voice?: string[];
}


export interface CheckInConfig {
  /** Example sentence shown for the voice check-in. */
  voiceExample: Bi;
  /** Measure ids asked every day, in order. */
  dailyMeasures: string[];
  skipReasons: string[];
}

export interface Questionnaire {
  id: string;
  measure: string;
  title: Bi;
  intro: Bi;
  items: Bi[];
  /** Answer options; value is what is summed. */
  options: { value: number; label: Bi }[];
  scoring: 'sum';
  source: SourceTag;
  /** Who wrote the questionnaire and under what terms it may be used. Shown under the questions. Required. */
  credit: string;
  /** True once the physio has confirmed they have permission to use it (Phase 4.2). */
  licenceConfirmed: boolean;
}

export interface Stage {
  minWeek: number; // inclusive unless minExclusive
  maxWeek: number | null; // exclusive unless maxInclusive; null = open ended
  minExclusive?: boolean;
  maxInclusive?: boolean;
  value: number;
  source: SourceTag;
}

interface RuleBase {
  id: string;
  label: Bi;
  tier: Exclude<Tier, 'ON_PLAN'>;
  source: SourceTag;
}
export interface ThresholdRule extends RuleBase {
  type: 'threshold';
  measure: string;
  operator: Operator;
  stages: Stage[];
  /** Only fire if the value is not better than the previous weekly/monthly entry (needs 2+ entries). */
  notImprovingVsPrevious?: boolean;
}
export interface TrendRule extends RuleBase {
  type: 'trend';
  measure: string;
  direction: 'up' | 'down';
  delta: number;
  window: number; // number of check-ins
  deltaSource: SourceTag;
}
export interface StreakRule extends RuleBase {
  type: 'streak';
  metric: 'missedSessions' | 'measureEquals' | 'repeatedHardMovement';
  measure?: string;
  equals?: Value;
  count: number;
  /** If set, `count` occurrences anywhere in this many trailing days; otherwise consecutive. */
  windowDays?: number;
  orAdherenceBelowPct?: number;
  countSource: SourceTag;
}
export interface BelowCurveRule extends RuleBase {
  type: 'belowCurve';
  measure: string;
}
export interface GateOverdueRule extends RuleBase {
  type: 'gateOverdue';
}
export interface SilenceRule extends RuleBase {
  type: 'silence';
  hours: number;
  hoursSource: SourceTag;
}
export interface PrecautionBreachRule extends RuleBase {
  type: 'precautionBreach';
}
/** Personal baseline (fix phase 3): the last `consecutive` values are each at least `delta` above the patient's usual value
 * (median of the `baselineWindow` check-ins before them; needs at least `minBaseline`). */
export interface AboveUsualRule extends RuleBase {
  type: 'aboveUsual';
  measure: string;
  delta: number;
  consecutive: number;
  baselineWindow: number;
  minBaseline: number;
  deltaSource: SourceTag;
}
export interface CombinationRule extends RuleBase {
  type: 'combination';
  ofTier: 'REVIEW';
  minDistinct: number;
  windowDays: number;
  countSource: SourceTag;
}
export type Rule =
  | ThresholdRule
  | AboveUsualRule
  | TrendRule
  | StreakRule
  | BelowCurveRule
  | GateOverdueRule
  | SilenceRule
  | PrecautionBreachRule
  | CombinationRule;

export interface ProtocolPack {
  id: string;
  /** Set on packs the physio created by importing over a default pack (Phase 3.2). */
  basedOn?: string;
  /** The approved import this pack was built from, so an invite link can rebuild it on another device. */
  imported?: { file: string; fields: { target: string; value: number | string[] }[] };
  /** The physio's own protocol for a condition the app does not ship (Phase 3.3). Rebuilds the pack and its exercises on another device. */
  authored?: unknown;
  condition: Bi;
  population: string;
  version: string;
  sources: string[];
  /** Short app/patient-facing name of the first-day anchor, e.g. surgery. */
  anchorLabel: Bi;
  phases: Phase[];
  measures: Measure[];
  gates: Gate[];
  expectedCurves: ExpectedCurve[];
  precautions: Precaution[];
  warningSigns: WarningSign[];
  rules: Rule[];
  checkIn: CheckInConfig;
  questionnaires: Questionnaire[];
  /** Proposed follow-up when a patient reaches URGENT through a combination of rules (Phase 2.5). */
  followUpProposal: { teleReviewWithinHours: number; checkInEveryDays: number; forDays: number; source: SourceTag };
  /** rule id -> suggested clinician action ids. Never auto-applied. */
  suggestedActions: Record<string, string[]>;
  /** Response time (hours) per tier. Placeholders are tagged. */
  responseHours: Record<Exclude<Tier, 'ON_PLAN'>, { hours: number; source: SourceTag }>;
  /** Hardcoded adherence window for A3-type rules. */
  adherenceWindowDays: number;
}


// ---------- guided session and form-check videos ----------
/** What happened with one exercise in a guided session. Reasons use the pack's skip reasons (pain, fear, time, access, ...). */
export interface SessionExerciseLog {
  id: string;
  setsPlanned: number;
  setsDone: number;
  /** Reps per set (null: a hold or "do it as shown"). */
  repsPlanned: number | null;
  /** Reps counted over the whole exercise. */
  repsDone: number;
  /** Set when the patient stopped or skipped this exercise, with their reason. */
  stopped?: string;
  /** Pain right after this exercise (0 to 10), when the patient chose to say. */
  pain?: number;
  /** The patient said they were struggling with the form. */
  struggling?: boolean;
}
export interface SessionLog {
  id: string;
  date: string;
  startedAt: number;
  endedAt: number;
  exercises: SessionExerciseLog[];
  answeredBy?: AnsweredBy;
  via?: 'app' | 'whatsapp';
}
/** Where a patient's clip is kept: on the phone that recorded it, or in the clinic's private cloud store. */
export interface FormClip { where: 'device' | 'cloud'; ref: string; mime: string; size: number; durationSec: number | null; deleteAfter: string }
export interface FormReply { at: string; by: string; text: string; /** ids from forms/model.ts CUES */ points: string[] }
/** A patient's request for a form check on one exercise: a short clip, a note and the consent for the video. */
export interface FormRequest {
  id: string;
  exerciseId: string;
  at: string;
  note: string;
  consent: { by: AnsweredBy; at: string; version: string };
  via?: 'app' | 'whatsapp';
  clip: FormClip | null;
  /** When the clip was deleted (by either side, or by the retention rule). */
  clipGone?: string;
  reply?: FormReply;
  /** The patient has read the reply (patient's phone sets it). */
  replySeenAt?: string;
}

// ---------- patient data ----------
export type AnsweredBy = 'patient' | 'caregiver';
export type Exercises = 'all' | 'some' | 'none';

export interface DailyCheckIn {
  date: string; // YYYY-MM-DD
  /** Daily measure values (pain, swelling, ...). */
  values: Record<string, Value>;
  exercises: Exercises;
  sessionsPrescribed: number;
  sessionsDone: number;
  skipReason?: string;
  hardMovement: string; // movement id or 'none'
  /** warning sign id -> true/false. Every sign must be present on save. */
  warnings: Record<string, boolean>;
  /** Per-exercise result for the day (Phase 2.2). */
  exerciseResults?: { id: string; done: boolean; reason?: string }[];
  precautionBreaches?: Record<string, boolean>;
  answeredBy?: AnsweredBy;
  /** Epoch ms of when the check-in was recorded (for silence rules). Optional for seeded data. */
  recordedAt?: number;
}
export interface PeriodicEntry {
  date: string;
  values: Record<string, Value>;
  /** measure id -> photo file name (upload arrives with the backend). */
  photos?: Record<string, string>;
  /** measure id -> 'photo' when the number was measured on a photo in the app (Phase 4.1). */
  methods?: Record<string, 'photo'>;
  /** Who typed the answers. Absent means the patient (Phase 5.3). */
  answeredBy?: AnsweredBy;
}
export interface Patient {
  id: string;
  name: string;
  age: number;
  packId: string;
  language: Lang;
  /** True when a family member or carer usually answers on this phone (Phase 5.3). Changes only who is recorded as answering. */
  caregiverMode?: boolean;
  /** Secret that ties this patient's data in the cloud together (Phase 6.1). Whoever holds it can read and write that patient's sync rows. */
  syncKey?: string;
  /** Which side of the sync this device is: the physio who created the patient, or the patient's own phone. */
  syncRole?: 'physio' | 'patient';
  /** Added in demo mode (Phase 6.9). It syncs like any patient so a real phone can join the demo, but it is never carried into the live clinic. */
  demoPatient?: boolean;
  /** Set on a patient's own phone once their account (Phase 6.3) has claimed this patient. Not sent in invites. */
  accountEmail?: string;
  /** Treatment finished (Phase 6.4). A completed patient leaves the worklist and sits under Past patients; nothing else about the record changes. */
  status?: 'completed';
  completedAt?: string;
  /** The physio's own note on why treatment ended. Stays on the physio's computer. */
  completionNote?: string;
  /** What the patient agreed to when making their account (DPDP notice version and time). Travels to the physio with the answers. */
  consent?: { version: string; at: string };
  /** The patient asked for their record to be erased (right to erasure). The physio decides; see lifecycle.ts. */
  erasureRequestedAt?: string;
  /** The physio's message to the patient when erasure is deferred (for example, record-keeping rules). */
  erasureNote?: string;
  /** Who to contact about this data (clinic phone or email). Set once by the physio and shown in the privacy notice. */
  clinicContact?: string;
  /** Demonstration links and videos the physio attached to this patient's exercises, received from the physio (Phase 7.2). Patient's phone only. */
  demos?: Record<string, SyncedDemo>;
  /** One-time PIN the patient needs to claim the link. Physio's computer only; never put in a link or a slice. */
  claimPin?: string;
  /** Guided exercise sessions the patient did (kept to the last 60). */
  sessions?: SessionLog[];
  /** Form-check video requests and the physio's replies. */
  formRequests?: FormRequest[];
  anchorDate: string; // surgery date
  currentPhase: string; // phase id
  phaseStartDate: string;
  /** Day the patient joined the app, when later than the surgery date. Days before it are never counted as missed. */
  enrolledOn?: string;
  sessionsPrescribedPerDay: number;
  daily: DailyCheckIn[];
  periodic: PeriodicEntry[];
  /** Flag key (tier@episodeStart) -> ISO time the physio reviewed it. */
  reviewed: Record<string, string>;
  /** Physio decisions on suggested actions. Recorded only; plan changes arrive with Phase 2.4. */
  decisions: Decision[];
  plan: Plan;
  /** Append-only record of every change to the plan. */
  audit: AuditEntry[];
  /** What the patient is told after a physio review. */
  notices: Notice[];
  /** flagKey -> what the physio did with the follow-up proposal. */
  proposalStatus: Record<string, { status: 'approved' | 'modified' | 'rejected'; at: string; note?: string }>;
  /** Weekly self-test items that are off unless the physio switches them on for this patient (e.g. eyes-closed balance). */
  weeklyOptIn?: string[];
  /** The physio's answer to "Was this flag useful?", by flag key (fix phase 4). */
  flagFeedback?: Record<string, { useful: boolean; at: string; rules: string[] }>;
  /** Overdue SAFETY or URGENT flags handed to the clinic's backup contact, by flag key (fix phase 4). */
  escalated?: Record<string, { at: string; to: string }>;
  /** Optional details the physio can fill in (physio feedback round). Only name and condition are required. */
  details?: PatientDetails;
  /** The physio's own clinical notes (free text), and photos attached to them (stored on the physio's device only). */
  clinicalNotes?: { text: string; at: string; by: string };
  attachments?: { id: string; name: string; mime: string; size: number; at: string }[];
}

export interface FollowUp {
  checkInEveryDays: number;
  reviewEveryDays: number;
  nextReviewDate: string | null;
  /** If set, the plan reverts to `revertTo` after this date. */
  until: string | null;
  revertTo?: { checkInEveryDays: number; reviewEveryDays: number; nextReviewDate: string | null };
}
export interface Override {
  id: string;
  target: string; // rule:R3:stage:0 | rule:A1:delta | gate:g1.flexion ...
  label: string;
  original: number;
  value: number;
  reason: string;
  by: string;
  at: string;
}
/** A physio-set expected-recovery curve that replaces the protocol's curve (Phase 7.1). */
export interface CurveEdit {
  id: string;
  measure: string;
  points: [number, number][]; // [weekSinceSurgery, value]
  tolerance: number;
  reason: string;
  by: string;
  at: string;
}
export interface Plan {
  /** exercise id -> easier exercise it was swapped for. */
  swaps: Record<string, string>;
  /** Exercises the physio added to / removed from the current phase list for this patient (Phase 3.1). */
  added: string[];
  removed: string[];
  hold: { at: string; by: string; note?: string } | null;
  followUp: FollowUp | null;
  overrides: Override[];
  /** Curves set for this patient only; they win over a clinic default and the protocol's curve. */
  curveOverrides?: CurveEdit[];
  /** Free-text instructions the physio wrote himself (Phase 6.3). The patient sees the text, never the reason. */
  instructions?: CustomInstruction[];
  /** A short note for the patient about one exercise, keyed by exercise id (shown to the patient, e.g. when an easier version is swapped in). */
  exerciseNotes?: Record<string, { text: string; at: string; by: string }>;
  /** The physio's own dose for an exercise for this patient (fix phase 3); wins over the library dose. */
  doses?: Record<string, ExerciseDose>;
  /** "Advice from your physio": free text the patient sees on their home screen (diet, icing, precautions...). */
  advice?: { text: string; at: string; by: string };
}
export interface PatientDetails {
  phone?: string; gender?: string; city?: string; occupation?: string; diagnosis?: string;
  surgeryDate?: string; surgeon?: string; diabetes?: boolean; bloodPressure?: boolean; otherConditions?: string;
  carerName?: string; carerPhone?: string; goal?: string;
}
export interface ExerciseDose { sets: number | null; reps: number | null; holdSec: number | null; perDay: number | null; at: string; by: string }
export interface CustomInstruction { id: string; text: string; at: string; }
export interface AuditEntry {
  id: string;
  at: string;
  who: string;
  action: string;
  summary: string;
  before: unknown;
  after: unknown;
  note?: string;
  /** A change the physio made on his own, not from a suggested action (Phase 5.4). A reason is always recorded in `note`. */
  manual?: boolean;
}
export type NoticeChange =
  | { kind: 'regress'; from: string; to: string }
  | { kind: 'restore'; exercise: string }
  | { kind: 'hold' }
  | { kind: 'release' }
  | { kind: 'followUp'; nextReviewDate: string | null; checkInEveryDays: number }
  | { kind: 'phase'; phaseId: string }
  | { kind: 'exercises'; added: string[]; removed: string[] }
  | { kind: 'instruction'; text: string }
  | { kind: 'instructionRemoved'; text: string }
  | { kind: 'dose'; exercise: string }
  | { kind: 'advice' };
export interface Notice {
  id: string;
  at: string;
  changes: NoticeChange[];
  seen: boolean;
}

export interface Decision {
  at: string; // ISO time
  flagKey: string | null;
  action: string;
  status: 'approved' | 'modified';
  note?: string;
}

export interface Trigger {
  ruleId: string;
  label: Bi;
  tier: Exclude<Tier, 'ON_PLAN'>;
  evidence: string;
  source: SourceTag;
  /** For combination rules: which rules combined. */
  combinedFrom?: string[];
  /** Date the trigger became active (as-of date). */
  since: string;
}
export interface TriageResult {
  tier: Tier;
  triggers: Trigger[];
  /** Date the evaluation is as of (latest check-in date by default). */
  asOf: string;
  /** Identifies this flag episode: tier@episodeStart. null when ON_PLAN. */
  flagKey: string | null;
  /** Epoch ms when the flag was raised (start of the episode). */
  raisedAtMs: number | null;
  /** Epoch ms by which the physio should respond. */
  dueByMs: number | null;
  responseHours: number | null;
  reviewedAt: string | null;
  /** Response time passed and the flag has not been reviewed. */
  overdue: boolean;
}

/** Reasons a patient can give when they could not do an exercise (Phase 2.2). */
export const SKIP_REASONS = ['pain', 'fear', 'time', 'access', 'understand'];
