/**
 * Preliminary screening for the Marketplace tab. Same safety stance as the triage engine:
 *  - Rules only. No LLM, no network, nothing learned. Every tier comes from a rule in the pack, and every rule says why.
 *  - It never diagnoses and never prescribes. It sorts a person into one of three groups.
 *  - Every rule carries a source tag. The whole pack is marked NEEDS_PHYSIO_SIGNOFF until a clinician reviews it.
 */
import type { Bi } from '../types';
import packJson from './screening-pack.json';

export type AreaId = 'back' | 'neck' | 'knee' | 'sports' | 'mobility';
export type DurationId = 'lt2w' | '2to6w' | '6to12w' | 'gt12w';
export type FunctionId = 'none' | 'some' | 'cannot';
export type ScreenTier = 'RED_FLAG' | 'PHYSIO' | 'LOW_RISK';
export type Urgency = 'now' | 'soon';

export type Cond =
  | { flag: string }
  | { field: 'severity' | 'durationWeeks'; op: '>=' | '>' | '<=' | '<' | '=='; value: number }
  | { field: 'function' | 'area' | 'duration'; in: string[] }
  | { field: 'recentSurgery' | 'priorEpisodes'; is: boolean }
  | { all: Cond[] }
  | { any: Cond[] };

export interface ScreeningRule { id: string; tier: 'RED_FLAG' | 'PHYSIO'; urgency?: Urgency; source: string; when: Cond; why: Bi }
export interface ScreeningFlag { id: string; label: Bi; areas?: AreaId[] }
export interface ScreeningPack {
  id: string; version: string; review: string; disclaimer: Bi;
  areas: { id: AreaId; icon: string; label: Bi }[];
  durations: { id: DurationId; weeks: number; label: Bi }[];
  functions: { id: FunctionId; label: Bi }[];
  flags: ScreeningFlag[];
  rules: ScreeningRule[];
  results: { now: { headline: Bi; body: Bi }; soon: { headline: Bi; body: Bi }; PHYSIO: { headline: Bi; body: Bi }; LOW_RISK: { headline: Bi; body: Bi } };
  specialties: { id: string; label: Bi }[];
  matching: { byArea: Record<string, string[]>; recentSurgery: string[] };
}

export interface ScreeningAnswers {
  area: AreaId; duration: DurationId; severity: number; function: FunctionId;
  recentSurgery: boolean; priorEpisodes: boolean;
  /** Flag ids the person answered "yes" to. */
  flags: string[];
}
export interface Triggered { id: string; tier: 'RED_FLAG' | 'PHYSIO'; urgency?: Urgency; source: string; why: Bi }
export interface ScreeningResult {
  tier: ScreenTier;
  /** Only for RED_FLAG: 'now' means emergency care, 'soon' means a doctor within 24 hours. */
  urgency?: Urgency;
  triggered: Triggered[];
  specialties: string[];
  headline: Bi;
  body: Bi;
}

export const SCREENING_PACK = packJson as unknown as ScreeningPack;

const cmp = (a: number, op: string, b: number): boolean => (op === '>=' ? a >= b : op === '>' ? a > b : op === '<=' ? a <= b : op === '<' ? a < b : a === b);

function holds(c: Cond, facts: Record<string, string | number | boolean>, flags: Set<string>): boolean {
  if ('all' in c) return c.all.every((x) => holds(x, facts, flags));
  if ('any' in c) return c.any.some((x) => holds(x, facts, flags));
  if ('flag' in c) return flags.has(c.flag);
  if ('op' in c) return cmp(Number(facts[c.field]), c.op, c.value);
  if ('in' in c) return c.in.includes(String(facts[c.field]));
  return facts[c.field] === c.is;
}

export function validateAnswers(a: ScreeningAnswers, pack: ScreeningPack = SCREENING_PACK): string[] {
  const e: string[] = [];
  if (!pack.areas.some((x) => x.id === a.area)) e.push('Choose where it hurts');
  if (!pack.durations.some((x) => x.id === a.duration)) e.push('Choose how long it has lasted');
  if (!pack.functions.some((x) => x.id === a.function)) e.push('Say whether it limits daily activities');
  if (!Number.isInteger(a.severity) || a.severity < 0 || a.severity > 10) e.push('Pain must be a whole number from 0 to 10');
  const ids = new Set(pack.flags.map((f) => f.id));
  if (a.flags.some((f) => !ids.has(f))) e.push('Unknown warning-sign answer');
  return e;
}

/** Which warning-sign questions are asked for this area. */
export const flagsForArea = (area: AreaId, pack: ScreeningPack = SCREENING_PACK): ScreeningFlag[] => pack.flags.filter((f) => !f.areas || f.areas.includes(area));

export function screen(a: ScreeningAnswers, pack: ScreeningPack = SCREENING_PACK): ScreeningResult {
  const errs = validateAnswers(a, pack);
  if (errs.length) throw new Error(errs[0]);
  // A warning sign that was not asked for this area cannot be set, even by a tampered answer.
  const asked = new Set(flagsForArea(a.area, pack).map((f) => f.id));
  const flags = new Set(a.flags.filter((f) => asked.has(f)));
  const facts = { severity: a.severity, durationWeeks: pack.durations.find((d) => d.id === a.duration)!.weeks, duration: a.duration, function: a.function, area: a.area, recentSurgery: a.recentSurgery, priorEpisodes: a.priorEpisodes };
  const triggered: Triggered[] = pack.rules.filter((r) => holds(r.when, facts, flags)).map((r) => ({ id: r.id, tier: r.tier, urgency: r.urgency, source: r.source, why: r.why }));
  const red = triggered.filter((t) => t.tier === 'RED_FLAG');
  const specialties = [...new Set([...(pack.matching.byArea[a.area] ?? []), ...(a.recentSurgery ? pack.matching.recentSurgery : [])])];
  if (red.length) {
    const urgency: Urgency = red.some((t) => t.urgency === 'now') ? 'now' : 'soon';
    return { tier: 'RED_FLAG', urgency, triggered, specialties, ...pack.results[urgency] };
  }
  if (triggered.length) return { tier: 'PHYSIO', triggered, specialties, ...pack.results.PHYSIO };
  return { tier: 'LOW_RISK', triggered, specialties, ...pack.results.LOW_RISK };
}

/** The pack validator: a rule with no source tag, an unknown flag, or missing Hindi is rejected, like the protocol packs. */
export function validateScreeningPack(pack: ScreeningPack): string[] {
  const e: string[] = [];
  const bi = (b: Bi | undefined, where: string) => { if (!b?.en?.trim() || !b?.hi?.trim()) e.push(`${where}: needs English and Hindi text`); };
  if (pack.review !== 'NEEDS_PHYSIO_SIGNOFF' && !/^SIGNED_OFF /.test(pack.review)) e.push('review status must be NEEDS_PHYSIO_SIGNOFF or SIGNED_OFF <name>');
  const flagIds = new Set<string>();
  for (const f of pack.flags) { if (flagIds.has(f.id)) e.push(`duplicate flag ${f.id}`); flagIds.add(f.id); bi(f.label, `flag ${f.id}`); }
  const ruleIds = new Set<string>();
  const walk = (c: Cond, rule: string) => {
    if ('all' in c) c.all.forEach((x) => walk(x, rule));
    else if ('any' in c) c.any.forEach((x) => walk(x, rule));
    else if ('flag' in c && !flagIds.has(c.flag)) e.push(`rule ${rule} uses unknown flag ${c.flag}`);
  };
  for (const r of pack.rules) {
    if (ruleIds.has(r.id)) e.push(`duplicate rule ${r.id}`); ruleIds.add(r.id);
    if (!r.source?.trim()) e.push(`rule ${r.id} has no source tag`);
    if (r.tier === 'RED_FLAG' && !r.urgency) e.push(`rule ${r.id} is a red flag with no urgency`);
    bi(r.why, `rule ${r.id}`); walk(r.when, r.id);
  }
  for (const k of ['now', 'soon', 'PHYSIO', 'LOW_RISK'] as const) { bi(pack.results[k]?.headline, `result ${k} headline`); bi(pack.results[k]?.body, `result ${k} body`); }
  for (const x of [...pack.areas, ...pack.durations, ...pack.functions, ...pack.specialties]) bi(x.label, `label ${x.id}`);
  bi(pack.disclaimer, 'disclaimer');
  const spec = new Set(pack.specialties.map((s) => s.id));
  for (const [area, ids] of Object.entries(pack.matching.byArea)) for (const s of ids) if (!spec.has(s)) e.push(`area ${area} maps to unknown specialty ${s}`);
  for (const s of pack.matching.recentSurgery) if (!spec.has(s)) e.push(`unknown specialty ${s}`);
  for (const a of pack.areas) if (!(pack.matching.byArea[a.id]?.length)) e.push(`area ${a.id} has no specialty mapping`);
  return e;
}

const errs = validateScreeningPack(SCREENING_PACK);
if (errs.length) throw new Error(`Screening pack is invalid:\n- ${errs.join('\n- ')}`);
