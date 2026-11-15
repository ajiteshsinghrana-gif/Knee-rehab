import type { Patient, ProtocolPack, Value } from '../types';

export interface Reading {
  value: Value;
  date: string;
}

/**
 * Latest reading of a measure on or before asOf.
 * Daily measures: only the check-in dated asOf counts (a missing check-in is not a reading).
 * Weekly/monthly: newest periodic entry that contains the measure.
 */
export function latestMeasure(p: Patient, pack: ProtocolPack, id: string, asOf: string): Reading | undefined {
  const m = pack.measures.find((x) => x.id === id);
  if (!m) return undefined;
  if (m.frequency === 'daily') {
    const d = p.daily.find((x) => x.date === asOf);
    const v = d?.values[id];
    return v === undefined ? undefined : { value: v, date: d!.date };
  }
  const entries = p.periodic.filter((x) => x.date <= asOf && x.values[id] !== undefined).sort((a, b) => a.date.localeCompare(b.date));
  const e = entries[entries.length - 1];
  return e ? { value: e.values[id], date: e.date } : undefined;
}

/** The reading before the latest one (periodic measures only). */
export function previousMeasure(p: Patient, pack: ProtocolPack, id: string, asOf: string): Reading | undefined {
  const entries = p.periodic.filter((x) => x.date <= asOf && x.values[id] !== undefined).sort((a, b) => a.date.localeCompare(b.date));
  const e = entries[entries.length - 2];
  return e ? { value: e.values[id], date: e.date } : undefined;
}

/** Linear interpolation on an expected curve, clamped at both ends. */
export function curveAt(points: [number, number][], week: number): number {
  if (week <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (week >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [w1, v1] = points[i];
    if (week <= w1) {
      const [w0, v0] = points[i - 1];
      return v0 + ((week - w0) / (w1 - w0)) * (v1 - v0);
    }
  }
  return last[1];
}
