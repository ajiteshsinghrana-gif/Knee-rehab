/**
 * "My progress" (patient) and the progress report (physio). Pure calculations only.
 * Deliberately separate from triage: no tiers, flags, rule codes or expected-recovery bands appear here, and nothing
 * here feeds a rule. Each card needs at least two data points, otherwise it is "not enough readings yet".
 */
import type { Bi, Patient, ProtocolPack } from './types';
import { addDays, diffDays } from './engine/dates';
import { careStart } from './engine/triage';

export type Trend = 'better' | 'worse' | 'same';
export interface Pt { x: number; y: number }

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** Pain: average of the first 7 days with a check-in vs the last 7 days. Lower is better. */
export function painCard(p: Patient, today: string): { first: number; now: number; trend: Trend; pts: Pt[] } | null {
  const rows = p.daily.filter((e) => e.values.pain !== undefined && e.date <= today).map((e) => ({ d: e.date, v: Number(e.values.pain) }));
  if (rows.length < 2) return null;
  const start = rows[0].d;
  const first = avg(rows.filter((r) => r.d < addDays(start, 7)).map((r) => r.v));
  const now = avg(rows.filter((r) => r.d > addDays(today, -7)).map((r) => r.v));
  if (first === null || now === null || rows[rows.length - 1].d < addDays(start, 7)) return null; // the first week is not over yet
  const trend: Trend = now < first - 0.4 ? 'better' : now > first + 0.4 ? 'worse' : 'same';
  return { first, now, trend, pts: rows.map((r) => ({ x: diffDays(r.d, start), y: r.v })) };
}

/** Exercises: days with all exercises done in the last 7 and the last 28 days. */
export function exerciseCard(p: Patient, today: string): { last7: number; last28: number; trend: Trend; days: (boolean | null)[] } | null {
  // Today counts only once the patient has checked in; until then the 7 and 28 days end yesterday.
  const end = p.daily.some((e) => e.date === today) ? today : addDays(today, -1);
  const days = Array.from({ length: 28 }, (_, i) => addDays(end, i - 27));
  const from = careStart(p);
  const marks = days.map((d) => (d < from ? null : p.daily.find((e) => e.date === d)?.exercises === 'all'));
  const known = p.daily.filter((e) => e.date >= days[0] && e.date <= end);
  if (known.length < 2) return null;
  const last7 = marks.slice(-7).filter(Boolean).length;
  const last28 = marks.filter(Boolean).length;
  const span28 = marks.filter((m) => m !== null).length;
  // "Harder" only when this week is clearly below the 4-week rate.
  const rate7 = last7 / 7, rate28 = span28 ? last28 / span28 : rate7;
  const trend: Trend = rate7 > rate28 + 0.1 ? 'better' : rate7 < rate28 - 0.15 ? 'worse' : 'same';
  return { last7, last28, trend, days: marks };
}

/** Knee bend: every reading, marked home or clinic, and the other leg when it was measured. Higher is better. */
export function kneeCard(p: Patient): { first: number; now: number; trend: Trend; home: Pt[]; clinic: Pt[]; other: Pt[] } | null {
  const rows = p.periodic.filter((e) => e.values.flexionDeg !== undefined).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 2) return null;
  const x = (d: string) => Math.round((diffDays(d, careStart(p)) / 7) * 10) / 10;
  const first = Number(rows[0].values.flexionDeg), now = Number(rows[rows.length - 1].values.flexionDeg);
  const trend: Trend = now > first + 2 ? 'better' : now < first - 2 ? 'worse' : 'same';
  return {
    first, now, trend,
    home: rows.filter((e) => e.where !== 'clinic').map((e) => ({ x: x(e.date), y: Number(e.values.flexionDeg) })),
    clinic: rows.filter((e) => e.where === 'clinic').map((e) => ({ x: x(e.date), y: Number(e.values.flexionDeg) })),
    other: p.periodic.filter((e) => e.values.flexionDegOther !== undefined).sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ x: x(e.date), y: Number(e.values.flexionDegOther) })),
  };
}

/** My goal: the goal the physio recorded, and the progress percentages they noted over time. */
export function goalCard(p: Patient): { goal: string; first: number; now: number; trend: Trend; pts: Pt[] } | null {
  const goal = p.details?.goal?.trim();
  const g = [...(p.goalProgress ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  if (!goal || g.length < 2) return null;
  const first = g[0].pct, now = g[g.length - 1].pct;
  return { goal, first, now, trend: now > first ? 'better' : now < first ? 'worse' : 'same', pts: g.map((x) => ({ x: diffDays(x.date, g[0].date), y: x.pct })) };
}

/**
 * "Your operated leg is at X% of your other leg": the first two-leg measure with data (a strength test in the protocol,
 * else knee bend on both legs), with the earlier value when there is one.
 */
export function legLine(p: Patient, pack: ProtocolPack): { measure: string; label: Bi; now: number; earlier: number | null } | null {
  const pairs: { id: string; label: Bi; val: (v: Record<string, unknown>) => number | null }[] = [
    ...pack.measures.filter((m) => m.derived?.kind === 'lsi').map((m) => ({ id: m.id, label: m.short ?? m.label, val: (v: Record<string, unknown>) => (v[m.id] !== undefined ? Number(v[m.id]) : null) })),
    { id: 'flexionDeg', label: { en: 'Knee bend', hi: 'घुटना मोड़ना', bn: 'হাঁটু ভাঁজ' }, val: (v) => (v.flexionDeg !== undefined && v.flexionDegOther !== undefined && Number(v.flexionDegOther) > 0 ? Math.round((Number(v.flexionDeg) / Number(v.flexionDegOther)) * 100) : null) },
  ];
  for (const pr of pairs) {
    const vals = [...p.periodic].sort((a, b) => a.date.localeCompare(b.date)).map((e) => pr.val(e.values)).filter((x): x is number => x !== null && Number.isFinite(x));
    if (vals.length) return { measure: pr.id, label: pr.label, now: vals[vals.length - 1], earlier: vals.length > 1 ? vals[vals.length - 2] : null };
  }
  return null;
}

/** Whole weeks since the patient started (surgery or the start of treatment). */
export const weeksSinceStart = (p: Patient, today: string): number => Math.max(0, Math.floor(diffDays(today, p.anchorDate) / 7));
