/** Per-patient threshold overrides (Phase 2.7). Applied to a copy of the pack, never to the pack itself. */
import type { Patient, ProtocolPack, Rule } from '../types';

export interface Overridable { target: string; label: string; base: number; current: number }

const stageLabel = (r: Extract<Rule, { type: 'threshold' }>, i: number) => {
  const s = r.stages[i];
  return `${r.id} ${r.label.en}: ${r.measure} ${r.operator} (weeks ${s.minWeek}-${s.maxWeek ?? 'end'})`;
};

/** Every numeric clinical value a physio may change for one patient. Warning-sign tiers are not overridable. */
export function listOverridable(pack: ProtocolPack, p?: Patient): Overridable[] {
  const out: Overridable[] = [];
  const ov = (t: string, base: number) => p?.plan.overrides.find((o) => o.target === t)?.value ?? base;
  const add = (target: string, label: string, base: number) => out.push({ target, label, base, current: ov(target, base) });
  for (const r of pack.rules) {
    if (r.type === 'threshold') r.stages.forEach((s, i) => add(`rule:${r.id}:stage:${i}`, stageLabel(r, i), s.value));
    else if (r.type === 'trend') { add(`rule:${r.id}:delta`, `${r.id} ${r.label.en}: change over ${r.window} check-ins`, r.delta); }
    else if (r.type === 'streak') {
      add(`rule:${r.id}:count`, `${r.id} ${r.label.en}: count`, r.count);
      if (r.orAdherenceBelowPct !== undefined) add(`rule:${r.id}:adherence`, `${r.id} ${r.label.en}: adherence below %`, r.orAdherenceBelowPct);
    } else if (r.type === 'combination') add(`rule:${r.id}:minDistinct`, `${r.id} ${r.label.en}: rules needed`, r.minDistinct);
    else if (r.type === 'silence') add(`rule:${r.id}:hours`, `${r.id} ${r.label.en}: hours`, r.hours);
  }
  for (const g of pack.gates) for (const c of g.criteria) if (typeof c.value === 'number') add(`gate:${c.id}`, `Gate ${g.fromPhase} to ${g.toPhase}: ${c.label.en} (${c.operator})`, c.value);
  return out;
}

/** Set one numeric value in a pack (mutates the pack passed in) and replace its source tag. */
export function setPackValue(pack: ProtocolPack, target: string, value: number, tag: string, appendTag = true): boolean {
  const [kind, id, field, idx] = target.split(':');
  if (kind === 'gate') {
    let hit = false;
    for (const g of pack.gates) for (const c of g.criteria) if (c.id === id) { c.value = value; c.source = tag; hit = true; }
    return hit;
  }
  const r = pack.rules.find((x) => x.id === id) as any;
  if (!r) return false;
  if (field === 'stage') { if (!r.stages[Number(idx)]) return false; r.stages[Number(idx)].value = value; r.stages[Number(idx)].source = tag; }
  else if (field === 'delta') { r.delta = value; r.deltaSource = tag; }
  else if (field === 'count') { r.count = value; r.countSource = tag; }
  else if (field === 'adherence') r.orAdherenceBelowPct = value;
  else if (field === 'minDistinct') { r.minDistinct = value; r.countSource = tag; }
  else if (field === 'hours') { r.hours = value; r.hoursSource = tag; }
  else return false;
  r.source = appendTag ? `${r.source}; ${tag}` : tag;
  return true;
}

/** The pack as it applies to this patient. Overridden values are tagged PHYSIO_OVERRIDE with the reason. */
export function effectivePack(p: Patient, pack: ProtocolPack): ProtocolPack {
  if (!p.plan?.overrides?.length) return pack;
  const eff: ProtocolPack = JSON.parse(JSON.stringify(pack));
  for (const o of p.plan.overrides) setPackValue(eff, o.target, o.value, `PHYSIO_OVERRIDE: ${o.reason}`);
  return eff;
}
