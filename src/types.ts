// Core types. Nothing in here is condition-specific: all clinical content lives in packs/*.json.

export type Lang = 'en' | 'hi';
export interface Bi {
  en: string;
  hi: string;
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
export interface CombinationRule extends RuleBase {
  type: 'combination';
  ofTier: 'REVIEW';
  minDistinct: number;
  windowDays: number;
  countSource: SourceTag;
}
export type Rule =
  | ThresholdRule
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
}
export interface Patient {
  id: string;
  name: string;
  age: number;
  packId: string;
  language: Lang;
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
export interface Plan {
  /** exercise id -> easier exercise it was swapped for. */
  swaps: Record<string, string>;
  /** Exercises the physio added to / removed from the current phase list for this patient (Phase 3.1). */
  added: string[];
  removed: string[];
  hold: { at: string; by: string; note?: string } | null;
  followUp: FollowUp | null;
  overrides: Override[];
}
export interface AuditEntry {
  id: string;
  at: string;
  who: string;
  action: string;
  summary: string;
  before: unknown;
  after: unknown;
  note?: string;
}
export type NoticeChange =
  | { kind: 'regress'; from: string; to: string }
  | { kind: 'restore'; exercise: string }
  | { kind: 'hold' }
  | { kind: 'release' }
  | { kind: 'followUp'; nextReviewDate: string | null; checkInEveryDays: number }
  | { kind: 'phase'; phaseId: string };
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
