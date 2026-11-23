import type { Exercise, ProtocolPack, Rule, Stage } from '../types';
import { getExercise } from '../exercises/library';
import { TIER_ORDER, SKIP_REASONS } from '../types';

const hasSource = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 0;
const bi = (b: any): boolean => !!b && hasSource(b.en) && hasSource(b.hi);

/** Library-level checks (Phase 2.1): names in both languages, regressions exist, no loops, usedIn matches packs. */
export function validateLibrary(lib: Exercise[], packs: ProtocolPack[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const e of lib) {
    if (ids.has(e.id)) errors.push(`duplicate exercise id ${e.id}`);
    ids.add(e.id);
    if (!bi(e.name)) errors.push(`exercise ${e.id} needs en and hi name`);
    if (!e.picture) errors.push(`exercise ${e.id} has no picture path`);
    if (!e.dose || !bi(e.dose.text) || !hasSource(e.dose.source)) errors.push(`exercise ${e.id} dose needs en/hi text and a source tag`);
  }
  for (const e of lib) {
    if (e.regressionId !== null) {
      if (!ids.has(e.regressionId)) errors.push(`exercise ${e.id} regression ${e.regressionId} does not exist`);
      if (e.regressionId === e.id) errors.push(`exercise ${e.id} regresses to itself`);
      if (!hasSource(e.regressionSource)) errors.push(`exercise ${e.id} regression has no source tag`);
    }
    // a regression chain must end (no loops)
    const seen = new Set<string>([e.id]);
    let cur = e.regressionId;
    while (cur) { if (seen.has(cur)) { errors.push(`regression loop at ${e.id}`); break; } seen.add(cur); cur = lib.find((x) => x.id === cur)?.regressionId ?? null; }
    for (const [pid, phs] of Object.entries(e.usedIn ?? {})) {
      const pk = packs.find((x) => x.id === pid);
      if (!pk) { errors.push(`exercise ${e.id} usedIn unknown pack ${pid}`); continue; }
      for (const ph of phs) if (!pk.phases.find((x) => x.id === ph)?.exercises.includes(e.id)) errors.push(`exercise ${e.id} says it is in ${pid}/${ph} but that phase does not prescribe it`);
    }
  }
  return errors;
}

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
    for (const x of ph.exercises ?? []) {
      const ex = getExercise(x);
      if (!ex) err(`phase ${ph.id} prescribes unknown exercise ${x}`);
      else if (!p.basedOn && !p.authored && !(ex.usedIn?.[p.id] ?? []).includes(ph.id)) err(`exercise ${x} is used in ${ph.id} but its library record does not list this pack and phase`);
    }
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
    if (m.photoAngle) {
      if (m.valueType !== 'number' || m.capture !== 'photo') err(`measure ${m.id} can only be measured on a photo if it is a number with photo capture`);
      if (!['between', 'deviation'].includes(m.photoAngle.reading) || m.photoAngle.points?.length !== 3 || m.photoAngle.points.some((x) => !bi(x))) err(`measure ${m.id} photoAngle needs a reading type and three points in en and hi`);
    }
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
  for (const sr of p.checkIn?.skipReasons ?? []) if (!SKIP_REASONS.includes(sr)) err(`unknown skip reason ${sr}`);
  const fu = p.followUpProposal;
  if (!fu || !(fu.teleReviewWithinHours > 0) || !(fu.checkInEveryDays >= 1) || !(fu.forDays > 0)) err('followUpProposal is missing or invalid');
  else if (!hasSource(fu.source)) err('followUpProposal has no source tag');

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
      case 'aboveUsual':
        needM(r.measure, `rule ${r.id}`);
        if (!hasSource(r.deltaSource)) err(`rule ${r.id} has a threshold without a source tag`);
        if (!(r.consecutive >= 1) || !(r.baselineWindow >= r.minBaseline) || !(r.minBaseline >= 2)) err(`rule ${r.id} needs consecutive >= 1 and baselineWindow >= minBaseline >= 2`);
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
    if (!hasSource(q.credit)) err(`questionnaire ${q.id} needs a credit line (author and terms of use)`);
    if (typeof q.licenceConfirmed !== 'boolean') err(`questionnaire ${q.id} must say whether permission to use it is confirmed`);
    if (!q.items?.length || q.items.some((it) => !bi(it))) err(`questionnaire ${q.id} needs items in en and hi`);
    if ((q.options ?? []).length < 2 || q.options.some((o) => !bi(o.label) || typeof o.value !== 'number')) err(`questionnaire ${q.id} needs at least two answer options in en and hi`);
  }
  return e;
}

export function assertValidPack(p: ProtocolPack): void {
  const e = validatePack(p);
  if (e.length) throw new Error(`Invalid protocol pack "${p?.id}":\n - ${e.join('\n - ')}`);
}
