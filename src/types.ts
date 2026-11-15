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
}
export interface Phase {
  id: string;
  order: number;
  name: Bi;
  exercises: Exercise[];
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

export interface HardMovement {
  id: string;
  label: Bi;
  /** Exercise id this option corresponds to (Phase 2.3 uses prescribed exercises). */
  exerciseId?: string;
  voice?: string[];
}

export interface CheckInConfig {
  /** Example sentence shown for the voice check-in. */
  voiceExample: Bi;
  /** Measure ids asked every day, in order. */
  dailyMeasures: string[];
  hardMovements: HardMovement[];
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
  sessionsPrescribedPerDay: number;
  daily: DailyCheckIn[];
  periodic: PeriodicEntry[];
  /** Flag key (tier@episodeStart) -> ISO time the physio reviewed it. */
  reviewed: Record<string, string>;
  /** Physio decisions on suggested actions. Recorded only; plan changes arrive with Phase 2.4. */
  decisions: Decision[];
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
