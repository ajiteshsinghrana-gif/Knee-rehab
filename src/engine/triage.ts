/**
 * Generic, deterministic rule engine.
 *
 * SAFETY RULES (see README):
 *  1. No LLM anywhere in here. Tiers come only from the pack's rules[] and warningSigns[].
 *  2. Nothing here changes a plan. It only returns flags and suggestions.
 *  3. No condition-specific code: every number and measure id comes from the patient's pack.
 */
import { effectivePack } from './overrides';
import type {
  CombinationRule, DailyCheckIn, Patient, ProtocolPack, Rule, StreakRule, Stage, ThresholdRule, Tier, TriageResult, Trigger,
} from '../types';
import { TIER_ORDER } from '../types';
import { addDays, diffDays, toMs } from './dates';
import { compare, evaluateGate } from './gates';
import { curveAt, latestMeasure, previousMeasure } from './measures';

export interface TriageOptions {
  /** Evaluate as of this date (default: latest check-in date). */
  asOf?: string;
  /** Current time in epoch ms. Needed for silence rules and the overdue state. */
  nowMs?: number;
}

type Tr = Exclude<Tier, 'ON_PLAN'>;
const sev = (t: Tier): number => TIER_ORDER.indexOf(t);

/** First day the app can judge: the day they joined, or the surgery date for patients who started with it. */
export const careStart = (p: Patient): string => (p.enrolledOn && p.enrolledOn > p.anchorDate ? p.enrolledOn : p.anchorDate);
export const lastCheckInDate = (p: Patient): string => (p.daily.length ? p.daily[p.daily.length - 1].date : careStart(p));
export const weeksSince = (p: Patient, d: string): number => diffDays(d, p.anchorDate) / 7;
export const weeksInPhase = (p: Patient, d: string): number => diffDays(d, p.phaseStartDate) / 7;
const truncate = (p: Patient, d: string): Patient => ({
  ...p,
  daily: p.daily.filter((x) => x.date <= d),
  periodic: p.periodic.filter((x) => x.date <= d),
});
const entryOn = (p: Patient, d: string): DailyCheckIn | undefined => p.daily.find((x) => x.date === d);
const isMissed = (p: Patient, d: string): boolean => {
  const e = entryOn(p, d);
  return !e || e.exercises === 'none';
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function stageFor(stages: Stage[], w: number): Stage | undefined {
  return stages.find(
    (s) => (s.minExclusive ? w > s.minWeek : w >= s.minWeek) && (s.maxWeek === null || (s.maxInclusive ? w <= s.maxWeek : w < s.maxWeek)),
  );
}

function trig(r: { id: string; label: Trigger['label']; tier: Tr; source: string }, evidence: string, since: string, extra: Partial<Trigger> = {}): Trigger {
  return { ruleId: r.id, label: r.label, tier: r.tier, source: r.source, evidence, since, ...extra };
}

// ------------------------------------------------------------------ rule evaluators
function threshold(r: ThresholdRule, p: Patient, pack: ProtocolPack, d: string): Trigger | null {
  const w = weeksSince(p, d);
  const stage = stageFor(r.stages, w);
  if (!stage) return null;
  const lv = latestMeasure(p, pack, r.measure, d);
  if (!lv || !compare(r.operator, lv.value, stage.value)) return null;
  if (r.notImprovingVsPrevious) {
    const prev = previousMeasure(p, pack, r.measure, d);
    if (!prev) return null;
    const higherIsBad = r.operator === '>' || r.operator === '>=';
    const notBetter = higherIsBad ? Number(lv.value) >= Number(prev.value) : Number(lv.value) <= Number(prev.value);
    if (!notBetter) return null;
    return trig(r, `${r.measure} not improving at week ${w.toFixed(1)}: ${prev.value} -> ${lv.value}`, d);
  }
  return trig(r, `${r.measure} ${lv.value} (${r.operator} ${stage.value} at week ${w.toFixed(1)})`, d);
}

function trend(r: Extract<Rule, { type: 'trend' }>, p: Patient, d: string): Trigger | null {
  const rows = p.daily.filter((x) => x.values[r.measure] !== undefined).slice(-r.window);
  if (rows.length < r.window) return null;
  const vals = rows.map((x) => Number(x.values[r.measure]));
  const change = vals[vals.length - 1] - vals[0];
  const hit = r.direction === 'up' ? change >= r.delta : -change >= r.delta;
  return hit ? trig(r, `${r.measure} ${vals.join(' -> ')} over ${r.window} check-ins (${r.direction} ${Math.abs(change)})`, d) : null;
}

function adherence(p: Patient, d: string, windowDays: number): number {
  let done = 0;
  for (let i = 0; i < windowDays; i++) done += entryOn(p, addDays(d, -i))?.sessionsDone ?? 0;
  // A patient who joined mid-window is judged only on the days since they joined.
  const days = p.enrolledOn ? Math.min(windowDays, diffDays(d, careStart(p))) : windowDays;
  if (days <= 0 || !(p.sessionsPrescribedPerDay > 0)) return 1; // nothing prescribed, nothing missed
  return done / (p.sessionsPrescribedPerDay * days);
}

function streak(r: StreakRule, p: Patient, pack: ProtocolPack, d: string): Trigger | null {
  if (r.metric === 'measureEquals') {
    if (r.windowDays) {
      let n = 0;
      for (let i = 0; i < r.windowDays; i++) if (entryOn(p, addDays(d, -i))?.values[r.measure!] === r.equals) n++;
      return n >= r.count ? trig(r, `${r.measure} "${r.equals}" on ${n} of last ${r.windowDays} days`, d) : null;
    }
    const rows = p.daily.slice(-r.count);
    const ok = rows.length === r.count && rows.every((x, i) => x.values[r.measure!] === r.equals && (i === 0 || diffDays(x.date, rows[i - 1].date) === 1));
    return ok ? trig(r, `${r.measure} reported "${r.equals}" ${r.count} days running`, d) : null;
  }
  if (r.metric === 'missedSessions') {
    let run = 0;
    for (let x = d; x > careStart(p) && isMissed(p, x); x = addDays(x, -1)) run++;
    const why: string[] = [];
    if (run >= r.count) why.push(`${plural(run, 'missed day')} in a row`);
    if (r.orAdherenceBelowPct !== undefined) {
      const a = adherence(p, d, pack.adherenceWindowDays);
      if (a < r.orAdherenceBelowPct / 100) why.push(`adherence ${Math.round(a * 100)}% over last ${pack.adherenceWindowDays} days`);
    }
    return why.length ? trig(r, why.join('; '), d) : null;
  }
  // repeatedHardMovement
  const counts = new Map<string, number>();
  const span = r.windowDays ?? r.count;
  for (let i = 0; i < span; i++) {
    const h = entryOn(p, addDays(d, -i))?.hardMovement;
    if (h && h !== 'none') counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const hits = [...counts].filter(([, n]) => n >= r.count);
  return hits.length ? trig(r, hits.map(([m, n]) => `'${m}' reported hard on ${n} of last ${span} days`).join('; '), d) : null;
}

function belowCurve(r: Extract<Rule, { type: 'belowCurve' }>, p: Patient, pack: ProtocolPack, d: string): Trigger | null {
  const c = pack.expectedCurves.find((x) => x.measure === r.measure);
  const lv = latestMeasure(p, pack, r.measure, d);
  if (!c || !lv) return null;
  // Compared at the week the value was recorded, so a reading is never judged against a later, higher curve.
  const wk = weeksSince(p, lv.date);
  const exp = curveAt(c.points, wk);
  const v = Number(lv.value);
  const below = c.better === 'higher' ? v < exp - c.tolerance : v > exp + c.tolerance;
  return below
    ? trig(r, `${r.measure} ${v} at week ${wk.toFixed(1)}; expected ${exp.toFixed(1)} (band +/- ${c.tolerance})`, d)
    : null;
}

function gateOverdue(r: Extract<Rule, { type: 'gateOverdue' }>, p: Patient, pack: ProtocolPack, d: string): Trigger | null {
  const phase = pack.phases.find((x) => x.id === p.currentPhase);
  const max = phase?.expectedWeeks[1];
  if (!phase || max === null || max === undefined) return null;
  const inPhase = weeksInPhase(p, d);
  if (inPhase <= max) return null;
  const g = evaluateGate(p, pack, d);
  if (!g || g.allMet) return null;
  const unmet = g.criteria.filter((c) => !c.met).map((c) => c.label.en).join(', ');
  return trig(r, `${inPhase.toFixed(1)} weeks in ${phase.id} (window ${max}); gate unmet: ${unmet}`, d);
}

function silence(r: Extract<Rule, { type: 'silence' }>, p: Patient, nowMs?: number): Trigger | null {
  if (nowMs === undefined) return null;
  const last = p.daily[p.daily.length - 1];
  const lastMs = last ? last.recordedAt ?? toMs(last.date) + 86_400_000 - 1 : toMs(careStart(p));
  const hours = (nowMs - lastMs) / 3_600_000;
  // Respects the patient's schedule: someone checking in every 3 days is not silent until 2 extra days have passed.
  const every = checkInEvery(p, new Date(nowMs).toISOString().slice(0, 10));
  if (hours < r.hours + (every - 1) * 24) return null;
  const days = Math.floor(hours / 24);
  const t = trig(r, `No check-in for ${days} day${days === 1 ? '' : 's'} (${Math.floor(hours)} h)`, last?.date ?? careStart(p));
  // The label states how long, in both languages (Phase 4.3)
  return { ...t, label: { en: `No check-in for ${days} day${days === 1 ? '' : 's'}`, hi: `${days} दिन से कोई चेक-इन नहीं` } };
}

/** Median of a list of numbers. */
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * The patient's usual value of a measure as of day d: the median of the `window` check-ins before the last `skipLast`
 * (needs at least `min`). Returns null when there is not enough history yet.
 */
export function usualValue(p: Patient, measure: string, d: string, o: { window?: number; min?: number; skipLast?: number } = {}): { usual: number; latest: number; n: number } | null {
  const w = o.window ?? 7, min = o.min ?? 5, skip = o.skipLast ?? 2;
  const vals = p.daily.filter((e) => e.date <= d && e.values[measure] !== undefined && e.values[measure] !== null).map((e) => Number(e.values[measure]));
  if (!vals.length) return null;
  const prev = vals.slice(Math.max(0, vals.length - skip - w), vals.length - skip);
  if (prev.length < min) return null;
  return { usual: median(prev), latest: vals[vals.length - 1], n: prev.length };
}

function aboveUsual(r: Extract<Rule, { type: 'aboveUsual' }>, p: Patient, d: string): Trigger | null {
  if (!entryOn(p, d)) return null;
  const vals = p.daily.filter((e) => e.date <= d && e.values[r.measure] !== undefined && e.values[r.measure] !== null).map((e) => Number(e.values[r.measure]));
  const u = usualValue(p, r.measure, d, { window: r.baselineWindow, min: r.minBaseline, skipLast: r.consecutive });
  if (!u || vals.length < r.consecutive) return null;
  const last = vals.slice(-r.consecutive);
  if (!last.every((v) => v >= u.usual + r.delta)) return null;
  return trig(r, `${r.measure} ${last.join(', ')} on the last ${r.consecutive} check-ins; usual ${u.usual} (median of the ${u.n} before)`, d);
}

/** Check-in interval in days from the patient's current follow-up (a temporary change reverts after its end date). */
function checkInEvery(p: Patient, today: string): number {
  const f = p.plan?.followUp;
  if (!f) return 1;
  if (f.until && today > f.until && f.revertTo) return f.revertTo.checkInEveryDays;
  return f.checkInEveryDays;
}

function precautionBreach(r: Extract<Rule, { type: 'precautionBreach' }>, p: Patient, pack: ProtocolPack, d: string): Trigger | null {
  const e = entryOn(p, d);
  if (!e?.precautionBreaches) return null;
  const hit = pack.precautions.filter((x) => x.phases.includes(p.currentPhase) && e.precautionBreaches![x.id] === true);
  return hit.length ? trig(r, `reported in ${p.currentPhase}: ${hit.map((x) => x.label.en).join('; ')}`, d) : null;
}

/** Warning signs reported on day d, grouped into one trigger per rule id. */
function signTriggers(p: Patient, pack: ProtocolPack, d: string): { t: Trigger; counts: boolean }[] {
  const e = entryOn(p, d);
  if (!e) return [];
  const groups = new Map<string, typeof pack.warningSigns>();
  for (const s of pack.warningSigns) if (e.warnings[s.id] === true) groups.set(s.ruleId, [...(groups.get(s.ruleId) ?? []), s]);
  return [...groups].map(([ruleId, signs]) => {
    const tier = signs.map((s) => s.tier).sort((a, b) => sev(a) - sev(b))[0];
    const first = signs[0];
    return {
      t: { ruleId, label: first.ruleLabel, tier, source: first.source, evidence: `reported: ${signs.map((s) => s.label.en).join(', ')}`, since: d },
      counts: signs.some((s) => s.countsTowardCombination !== false),
    };
  });
}

/** Everything except combination rules, evaluated as of day d. */
function evaluateBase(full: Patient, pack: ProtocolPack, d: string, nowMs?: number): { t: Trigger; counts: boolean }[] {
  const p = truncate(full, d);
  const out = signTriggers(p, pack, d);
  for (const r of pack.rules) {
    let t: Trigger | null = null;
    switch (r.type) {
      case 'threshold': t = threshold(r, p, pack, d); break;
      case 'trend': t = trend(r, p, d); break;
      case 'streak': t = streak(r, p, pack, d); break;
      case 'belowCurve': t = belowCurve(r, p, pack, d); break;
      case 'gateOverdue': t = gateOverdue(r, p, pack, d); break;
      case 'silence': t = silence(r, p, nowMs); break;
      case 'precautionBreach': t = precautionBreach(r, p, pack, d); break;
      case 'aboveUsual': t = aboveUsual(r, p, d); break;
      case 'combination': break;
    }
    if (t) out.push({ t, counts: true });
  }
  return out;
}

function combination(r: CombinationRule, p: Patient, pack: ProtocolPack, d: string): Trigger | null {
  const seen = new Map<string, { date: string; evidence: string }>();
  for (let i = r.windowDays - 1; i >= 0; i--) {
    const day = addDays(d, -i);
    for (const { t, counts } of evaluateBase(p, pack, day)) {
      if (t.tier === r.ofTier && counts) seen.set(t.ruleId, { date: day, evidence: t.evidence });
    }
  }
  if (seen.size < r.minDistinct) return null;
  return trig(
    r,
    `${seen.size} ${r.ofTier.toLowerCase()}-tier signals within last ${r.windowDays} days: ` + [...seen].map(([id, v]) => `${id} (${v.evidence})`).join('; '),
    d,
    { combinedFrom: [...seen.keys()] },
  );
}

/** All triggers active as of day d (no flag-episode or overdue logic). */
export function evaluateTriggers(full: Patient, pack: ProtocolPack, d: string, nowMs?: number): Trigger[] {
  const triggers = evaluateBase(full, pack, d, nowMs).map((x) => x.t);
  for (const r of pack.rules) if (r.type === 'combination') {
    const t = combination(r, full, pack, d);
    if (t) triggers.push(t);
  }
  return triggers.sort((a, b) => sev(a.tier) - sev(b.tier) || a.ruleId.localeCompare(b.ruleId, undefined, { numeric: true }));
}

const tierOf = (triggers: Trigger[]): Tier => (triggers.length ? triggers.map((t) => t.tier).sort((a, b) => sev(a) - sev(b))[0] : 'ON_PLAN');

/**
 * Triage a patient. Highest tier wins: SAFETY > URGENT > REVIEW > ON_PLAN.
 * Returns every triggered rule with plain-language evidence, the response deadline and the overdue state.
 */
export function triage(patient: Patient, basePack: ProtocolPack, opts: TriageOptions = {}): TriageResult {
  const pack = effectivePack(patient, basePack); // per-patient physio overrides (Phase 2.7)
  const asOf = opts.asOf ?? lastCheckInDate(patient);
  const triggers = evaluateTriggers(patient, pack, asOf, opts.nowMs);
  const tier = tierOf(triggers);
  if (tier === 'ON_PLAN') {
    return { tier, triggers, asOf, flagKey: null, raisedAtMs: null, dueByMs: null, responseHours: null, reviewedAt: null, overdue: false };
  }
  // Episode start: walk back while the tier stays at least as severe.
  let start = asOf;
  for (let i = 1; i <= 30; i++) {
    const day = addDays(asOf, -i);
    if (day < patient.anchorDate) break;
    if (sev(tierOf(evaluateTriggers(patient, pack, day))) > sev(tier)) break;
    start = day;
  }
  const flagKey = `${tier}@${start}`;
  const cfg = pack.responseHours[tier as Tr];
  const startEntry = entryOn(patient, start);
  const raisedAtMs = startEntry?.recordedAt ?? toMs(start) + 12 * 3_600_000;
  const dueByMs = raisedAtMs + cfg.hours * 3_600_000;
  const reviewedAt = patient.reviewed[flagKey] ?? null;
  const overdue = !reviewedAt && opts.nowMs !== undefined && opts.nowMs > dueByMs;
  return { tier, triggers, asOf, flagKey, raisedAtMs, dueByMs, responseHours: cfg.hours, reviewedAt, overdue };
}

/** Worklist ordering: tier first, then Overdue first within the tier, then earliest deadline. */
export function compareWorklist(a: TriageResult, b: TriageResult): number {
  return (
    sev(a.tier) - sev(b.tier) ||
    Number(b.overdue) - Number(a.overdue) ||
    (a.dueByMs ?? Infinity) - (b.dueByMs ?? Infinity)
  );
}
