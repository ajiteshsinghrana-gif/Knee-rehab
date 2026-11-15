import type { ProtocolPack, Rule, Stage } from '../types';
import { TIER_ORDER } from '../types';

const hasSource = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 0;
const bi = (b: any): boolean => !!b && hasSource(b.en) && hasSource(b.hi);

/** Returns a list of problems. Empty list = valid. */
export function validatePack(p: ProtocolPack): string[] {
  const e: string[] = [];
  const err = (m: string) => e.push(m);
  if (!p || typeof p !== 'object') return ['pack is not an object'];
  if (!hasSource(p.id)) err('pack.id missing');
  if (!bi(p.condition)) err('pack.condition needs en and hi');
  if (!hasSource(p.version)) err('pack.version missing');
  if (!Array.isArray(p.sources) || p.sources.length === 0) err('pack.sources[] must list at least one source');

  // --- warning signs: a pack with none is unsafe ---
  if (!Array.isArray(p.warningSigns) || p.warningSigns.length === 0) err('pack has no warning signs');
  const signIds = new Set<string>();
  for (const w of p.warningSigns ?? []) {
    if (signIds.has(w.id)) err(`duplicate warning sign id ${w.id}`);
    signIds.add(w.id);
    if (!bi(w.label)) err(`warning sign ${w.id} needs en and hi label`);
    if (!['SAFETY', 'URGENT', 'REVIEW'].includes(w.tier)) err(`warning sign ${w.id} has invalid tier ${w.tier}`);
    if (!hasSource(w.source)) err(`warning sign ${w.id} has no source tag`);
    if (!hasSource(w.ruleId)) err(`warning sign ${w.id} has no ruleId`);
  }
  if (!(p.warningSigns ?? []).some((w) => w.tier === 'SAFETY')) err('pack needs at least one SAFETY-tier warning sign');

  // --- phases: unique, strictly ordered, sane durations ---
  const phaseIds = new Set<string>();
  const orders = new Set<number>();
  let prevOrder = -Infinity;
  if (!Array.isArray(p.phases) || p.phases.length === 0) err('pack has no phases');
  for (const ph of p.phases ?? []) {
    if (phaseIds.has(ph.id)) err(`overlapping phases: duplicate phase id ${ph.id}`);
    if (orders.has(ph.order)) err(`overlapping phases: two phases share order ${ph.order}`);
    if (ph.order <= prevOrder) err(`phases must be listed in strictly increasing order (${ph.id})`);
    phaseIds.add(ph.id);
    orders.add(ph.order);
    prevOrder = ph.order;
    if (!bi(ph.name)) err(`phase ${ph.id} needs en and hi name`);
    const [mn, mx] = ph.expectedWeeks ?? [NaN, NaN];
    if (!(mn >= 0) || (mx !== null && !(mx >= mn))) err(`phase ${ph.id} expectedWeeks must be [min, max] with min <= max`);
    if (!hasSource(ph.source)) err(`phase ${ph.id} has no source tag`);
    for (const x of ph.exercises ?? []) if (!bi(x.name)) err(`exercise ${x.id} in ${ph.id} needs en and hi name`);
  }

  // --- measures ---
  const measureIds = new Set<string>();
  for (const m of p.measures ?? []) {
    if (measureIds.has(m.id)) err(`duplicate measure id ${m.id}`);
    measureIds.add(m.id);
    if (!bi(m.label)) err(`measure ${m.id} needs en and hi label`);
    if (!['tap', 'voice', 'photo', 'number'].includes(m.capture)) err(`measure ${m.id} has invalid capture`);
    if (!['daily', 'weekly', 'monthly'].includes(m.frequency)) err(`measure ${m.id} has invalid frequency`);
    if (m.valueType === 'enum' && !(m.options && m.options.length)) err(`enum measure ${m.id} needs options`);
  }
  for (const m of p.measures ?? []) {
    if (m.derived) {
      for (const r of [m.derived.operated, m.derived.other]) if (!measureIds.has(r)) err(`measure ${m.id} derives from unknown measure ${r}`);
    }
    if (m.pairOf && !measureIds.has(m.pairOf)) err(`measure ${m.id} pairs with unknown measure ${m.pairOf}`);
  }
  const needM = (id: string | undefined, where: string) => {
    if (!id || !measureIds.has(id)) err(`${where} points to unknown measure "${id}"`);
  };

  // --- gates ---
  const seenGate = new Set<string>();
  for (const g of p.gates ?? []) {
    const key = `${g.fromPhase}>${g.toPhase}`;
    if (seenGate.has(key)) err(`overlapping gates: two gates for ${key}`);
    seenGate.add(key);
    const a = (p.phases ?? []).find((x) => x.id === g.fromPhase);
    const b = (p.phases ?? []).find((x) => x.id === g.toPhase);
    if (!a || !b) err(`gate ${key} references an unknown phase`);
    else {
      const ia = p.phases.indexOf(a);
      const ib = p.phases.indexOf(b);
      if (ib !== ia + 1) err(`gate ${key} must go to the next phase`);
    }
    if (!g.criteria?.length) err(`gate ${key} has no criteria`);
    for (const c of g.criteria ?? []) {
      needM(c.measure, `gate ${key} criterion ${c.id}`);
      if (!hasSource(c.source)) err(`gate ${key} criterion ${c.id} has no source tag`);
      if (!bi(c.label)) err(`gate criterion ${c.id} needs en and hi label`);
    }
  }

  // --- curves ---
  for (const c of p.expectedCurves ?? []) {
    needM(c.measure, `expectedCurve`);
    if (!hasSource(c.source)) err(`expectedCurve ${c.measure} has no source tag`);
    if (!c.points?.length) err(`expectedCurve ${c.measure} has no points`);
    for (let i = 1; i < (c.points?.length ?? 0); i++) if (c.points[i][0] <= c.points[i - 1][0]) err(`expectedCurve ${c.measure} weeks must increase`);
  }

  // --- precautions ---
  for (const pr of p.precautions ?? []) {
    if (!hasSource(pr.source)) err(`precaution ${pr.id} has no source tag`);
    if (!bi(pr.label) || !bi(pr.question)) err(`precaution ${pr.id} needs en and hi label and question`);
    for (const ph of pr.phases) if (!phaseIds.has(ph)) err(`precaution ${pr.id} references unknown phase ${ph}`);
  }

  // --- check-in ---
  for (const id of p.checkIn?.dailyMeasures ?? []) {
    needM(id, 'checkIn.dailyMeasures');
    const m = (p.measures ?? []).find((x) => x.id === id);
    if (m && !bi(m.question)) err(`daily measure ${id} needs a question in en and hi`);
  }
  if (!bi(p.checkIn?.voiceExample)) err('checkIn.voiceExample needs en and hi');
  for (const h of p.checkIn?.hardMovements ?? []) if (!bi(h.label)) err(`hardMovement ${h.id} needs en and hi label`);

  // --- response hours ---
  for (const t of ['SAFETY', 'URGENT', 'REVIEW'] as const) {
    const r = p.responseHours?.[t];
    if (!r || !(r.hours > 0)) err(`responseHours.${t} missing`);
    else if (!hasSource(r.source)) err(`responseHours.${t} has no source tag`);
  }

  // --- rules ---
  const ruleIds = new Set<string>();
  const checkStages = (r: Rule & { stages: Stage[] }) => {
    if (!r.stages?.length) err(`rule ${r.id} has no stages`);
    const sorted = [...(r.stages ?? [])].sort((a, b) => a.minWeek - b.minWeek);
    sorted.forEach((s, i) => {
      if (!hasSource(s.source)) err(`rule ${r.id} has a threshold without a source tag`);
      if (typeof s.value !== 'number' || Number.isNaN(s.value)) err(`rule ${r.id} stage has no numeric value`);
      if (s.maxWeek !== null && s.maxWeek < s.minWeek) err(`rule ${r.id} stage has maxWeek < minWeek`);
      const next = sorted[i + 1];
      if (next && (s.maxWeek === null || s.maxWeek > next.minWeek)) err(`rule ${r.id} has overlapping stages`);
    });
  };
  for (const r of p.rules ?? []) {
    if (ruleIds.has(r.id)) err(`duplicate rule id ${r.id}`);
    ruleIds.add(r.id);
    if (!bi(r.label)) err(`rule ${r.id} needs en and hi label`);
    if (!hasSource(r.source)) err(`rule ${r.id} has no source tag`);
    if (!TIER_ORDER.slice(0, 3).includes(r.tier)) err(`rule ${r.id} has invalid tier`);
    switch (r.type) {
      case 'threshold':
        needM(r.measure, `rule ${r.id}`);
        checkStages(r as any);
        break;
      case 'trend':
        needM(r.measure, `rule ${r.id}`);
        if (!hasSource(r.deltaSource)) err(`rule ${r.id} has a threshold without a source tag`);
        if (!(r.window >= 2)) err(`rule ${r.id} window must be >= 2`);
        break;
      case 'streak':
        if (r.metric === 'measureEquals') needM(r.measure, `rule ${r.id}`);
        if (!hasSource(r.countSource)) err(`rule ${r.id} has a threshold without a source tag`);
        break;
      case 'belowCurve':
        needM(r.measure, `rule ${r.id}`);
        if (!(p.expectedCurves ?? []).some((c) => c.measure === r.measure)) err(`rule ${r.id} needs an expectedCurve for ${r.measure}`);
        break;
      case 'gateOverdue':
        if (!(p.gates ?? []).length) err(`rule ${r.id} (gateOverdue) needs at least one gate`);
        break;
      case 'silence':
        if (!hasSource(r.hoursSource)) err(`rule ${r.id} has a threshold without a source tag`);
        if (!(r.hours > 0)) err(`rule ${r.id} silence hours must be > 0`);
        break;
      case 'precautionBreach':
        if (!(p.precautions ?? []).length) err(`rule ${r.id} (precautionBreach) needs precautions[]`);
        break;
      case 'combination':
        if (!hasSource(r.countSource)) err(`rule ${r.id} has a threshold without a source tag`);
        if (!(r.minDistinct >= 2) || !(r.windowDays >= 1)) err(`rule ${r.id} combination needs minDistinct >= 2 and windowDays >= 1`);
        break;
      default:
        err(`rule ${(r as any).id} has unknown type ${(r as any).type}`);
    }
  }
  // suggested actions must point at known rules or sign rule ids
  const allRuleIds = new Set<string>([...ruleIds, ...(p.warningSigns ?? []).map((w) => w.ruleId)]);
  for (const id of Object.keys(p.suggestedActions ?? {})) if (!allRuleIds.has(id)) err(`suggestedActions refers to unknown rule ${id}`);
  for (const q of p.questionnaires ?? []) {
    needM(q.measure, `questionnaire ${q.id}`);
    if (!hasSource(q.source)) err(`questionnaire ${q.id} has no source tag`);
  }
  return e;
}

export function assertValidPack(p: ProtocolPack): void {
  const e = validatePack(p);
  if (e.length) throw new Error(`Invalid protocol pack "${p?.id}":\n - ${e.join('\n - ')}`);
}
