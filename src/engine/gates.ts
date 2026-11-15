import { effectivePack } from './overrides';
import type { Operator, Patient, ProtocolPack, Value } from '../types';
import { latestMeasure } from './measures';

export const compare = (op: Operator, a: Value, b: Value): boolean => {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    default: {
      const x = Number(a), y = Number(b);
      if (Number.isNaN(x) || Number.isNaN(y)) return false;
      return op === '>=' ? x >= y : op === '>' ? x > y : op === '<=' ? x <= y : x < y;
    }
  }
};

export interface GateRow {
  id: string;
  label: { en: string; hi: string };
  measure: string;
  required: string;
  actual: string;
  met: boolean;
  source: string;
}
export interface GateResult {
  fromPhase: string;
  toPhase: string;
  criteria: GateRow[];
  allMet: boolean;
  /** Physio put progression on hold: sign-off is blocked until the hold is removed. */
  held: boolean;
  canSignOff: boolean;
}

/** Gate for the patient's current phase (null if the pack has no gate out of it). */
export function evaluateGate(p: Patient, basePack: ProtocolPack, asOf: string): GateResult | null {
  const pack = effectivePack(p, basePack);
  const g = pack.gates.find((x) => x.fromPhase === p.currentPhase);
  if (!g) return null;
  const criteria: GateRow[] = g.criteria.map((c) => {
    const m = pack.measures.find((x) => x.id === c.measure);
    const lv = latestMeasure(p, pack, c.measure, asOf);
    const unit = m?.unit && m.unit !== '%' ? ` ${m.unit}` : m?.unit === '%' ? '%' : '';
    return {
      id: c.id,
      label: c.label,
      measure: c.measure,
      required: `${c.operator} ${String(c.value)}${typeof c.value === 'number' ? unit : ''}`,
      actual: lv ? `${String(lv.value)}${typeof lv.value === 'number' ? unit : ''}${p.periodic.find((e) => e.date === lv.date && e.values[c.measure] !== undefined)?.methods?.[c.measure] === 'photo' ? ' (measured on photo)' : ''}` : 'not measured',
      met: !!lv && compare(c.operator, lv.value, c.value),
      source: c.source,
    };
  });
  const allMet = criteria.every((c) => c.met);
  return { fromPhase: g.fromPhase, toPhase: g.toPhase, criteria, allMet, held: !!p.plan?.hold, canSignOff: allMet && !p.plan?.hold };
}
