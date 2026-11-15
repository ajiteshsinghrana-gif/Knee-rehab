/**
 * Phase 3.3: a physio writes a protocol for a condition the app does not ship (any condition).
 *
 * The physio supplies every clinical choice: phases, exercises, measures, gates, alert thresholds,
 * restricted movements, extra warning signs. This file only assembles them into a ProtocolPack and the
 * same validator as every shipped pack decides whether it is allowed. No clinical value is invented here:
 * the only numbers the physio did not type are the project's existing placeholders, which are tagged
 * NEEDS_PHYSIO_SIGNOFF and appear in the sign-off list.
 */
import type { Bi, Exercise, Operator, ProtocolPack, Rule, WarningSign } from '../types';
import { NEEDS_SIGNOFF } from '../types';
import { registerPack } from '../engine/packs';
import { getExercise, registerExercise, unregisterExercise } from '../exercises/library';

export const AUTHORED_TAG = 'PHYSIO_AUTHORED';
export const CUSTOM_PICTURE = 'media/custom.svg';

export interface ExerciseDraft { id: string; name: Bi; doseText?: Bi }
export interface PhaseDraft { name: Bi; exercises: string[]; sessionsPerDay: number; followUpEveryDays: number; weeksMin: number; weeksMax: number | null }
/** A number the patient enters at their weekly self-test (angle, distance, a score, a weight ...). */
export interface MeasureDraft { id: string; label: Bi; unit: string; min: number; max: number; step: number }
export interface CriterionDraft { measure: string; operator: Operator; value: number }
/** Criteria to leave phase `from` (0-based index) for the next one. */
export interface GateDraft { from: number; criteria: CriterionDraft[] }
export interface RuleDraft { measure: string; operator: Operator; value: number; tier: 'REVIEW' | 'URGENT' }
export interface PrecautionDraft { label: Bi; question: Bi; phases: number[] }
export interface SignDraft { label: Bi; tier: 'REVIEW' | 'URGENT' }

/** Expected values by week since day zero for one weekly measure. Drift beyond the band raises the existing below-the-curve alert. */
export interface CurveDraft { measure: string; better: 'higher' | 'lower'; tolerance: number; points: { week: number; value: number }[] }

export type AlertGroup = 'hours' | 'missed' | 'combination' | 'painRise' | 'followUp';
export interface Alerts {
  hours: { SAFETY: number; URGENT: number; REVIEW: number };
  missed: { count: number; adherencePct: number };
  combination: { minDistinct: number; windowDays: number };
  painRise: { delta: number; window: number };
  followUp: { teleHours: number; checkInDays: number; forDays: number };
  /** Where each group came from: the project placeholder (needs sign-off) or numbers the physio typed. */
  source: Record<AlertGroup, 'placeholder' | 'physio'>;
}
/** The project's existing placeholder values (same numbers as the rotator cuff pack). Always tagged NEEDS_PHYSIO_SIGNOFF. */
export const placeholderAlerts = (): Alerts => ({
  hours: { SAFETY: 2, URGENT: 24, REVIEW: 72 },
  missed: { count: 2, adherencePct: 60 },
  combination: { minDistinct: 2, windowDays: 3 },
  painRise: { delta: 2, window: 3 },
  followUp: { teleHours: 48, checkInDays: 1, forDays: 7 },
  source: { hours: 'placeholder', missed: 'placeholder', combination: 'placeholder', painRise: 'placeholder', followUp: 'placeholder' },
});

export interface ConditionDraft {
  /** Pack id, unique per condition (`custom-...`). */
  id: string;
  condition: Bi;
  /** What day zero is: "after surgery", "after the injury", "after diagnosis". */
  anchorLabel: Bi;
  population: string;
  phases: PhaseDraft[];
  /** New exercises written for this condition (everything else comes from the shared library). */
  exercises: ExerciseDraft[];
  measures: MeasureDraft[];
  gates: GateDraft[];
  rules: RuleDraft[];
  precautions: PrecautionDraft[];
  signs: SignDraft[];
  curves: CurveDraft[];
  alerts: Alerts | null;
  /** 1 for a first condition; a copy saved as a new version is 2, 3 ... Old versions stay as they were. */
  version: number;
  /** The condition id this one was copied from. */
  previousId?: string;
}

let seq = 0;
export const newConditionId = (nowMs: number) => `custom-${nowMs.toString(36)}${(++seq).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export const blankBi = (): Bi => ({ en: '', hi: '' });
export const blankDraft = (id: string): ConditionDraft => ({
  id, condition: blankBi(), anchorLabel: { en: 'after surgery', hi: 'सर्जरी के बाद' }, population: '',
  phases: [{ name: blankBi(), exercises: [], sessionsPerDay: 2, followUpEveryDays: 7, weeksMin: 0, weeksMax: null }],
  exercises: [], measures: [], gates: [], rules: [], precautions: [], signs: [], curves: [], alerts: null, version: 1,
});

export const PAIN_ID = 'pain';
const OPS: Operator[] = ['>=', '>', '<=', '<', '==', '!='];
const bi = (b?: Bi) => !!b && b.en.trim().length > 0 && b.hi.trim().length > 0;
const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
const phaseId = (i: number) => `p${i + 1}`;

/** Plain-language problems the physio can fix. The pack validator still has the last word. */
export function validateDraft(d: ConditionDraft): string[] {
  const e: string[] = [];
  if (!bi(d.condition)) e.push('Name the condition in English and Hindi');
  if (!bi(d.anchorLabel)) e.push('Say what day zero is (for example "after surgery") in English and Hindi');
  if (!d.phases.length) e.push('Add at least one phase');
  const exIds = new Set(d.exercises.map((x) => x.id));
  d.exercises.forEach((x, i) => { if (!bi(x.name)) e.push(`New exercise ${i + 1}: name it in English and Hindi`); if (x.doseText && (x.doseText.en.trim() || x.doseText.hi.trim()) && !bi(x.doseText)) e.push(`New exercise ${i + 1}: write the dose in both languages, or leave both empty`); });
  d.phases.forEach((p, i) => {
    const n = `Phase ${i + 1}`;
    if (!bi(p.name)) e.push(`${n}: name it in English and Hindi`);
    if (!p.exercises.length) e.push(`${n}: choose at least one exercise`);
    if (p.exercises.some((id) => !exIds.has(id) && !getExercise(id))) e.push(`${n}: unknown exercise`);
    if (!(p.sessionsPerDay >= 1 && p.sessionsPerDay <= 6)) e.push(`${n}: sessions per day must be 1 to 6`);
    if (!(p.followUpEveryDays >= 1 && p.followUpEveryDays <= 60)) e.push(`${n}: review every 1 to 60 days`);
    if (!(p.weeksMin >= 0) || (p.weeksMax !== null && !(p.weeksMax >= p.weeksMin))) e.push(`${n}: expected weeks must be from-to with from not above to`);
  });
  const mids = new Set<string>([PAIN_ID]);
  d.measures.forEach((m, i) => {
    if (!bi(m.label)) e.push(`Measure ${i + 1}: name it in English and Hindi (this is what the patient is asked)`);
    if (!m.unit.trim()) e.push(`Measure ${i + 1}: enter a unit`);
    if (![m.min, m.max, m.step].every(num) || !(m.max > m.min) || !(m.step > 0)) e.push(`Measure ${i + 1}: needs a minimum below the maximum and a step above 0`);
    mids.add(m.id);
  });
  const crit = (c: CriterionDraft, where: string) => {
    if (!mids.has(c.measure)) e.push(`${where}: choose a measure`);
    if (!OPS.includes(c.operator)) e.push(`${where}: choose a comparison`);
    if (!num(c.value)) e.push(`${where}: enter a number`);
  };
  for (let i = 0; i < d.phases.length - 1; i++) {
    const g = d.gates.find((x) => x.from === i);
    if (!g || !g.criteria.length) e.push(`Phase ${i + 1} to ${i + 2}: add at least one criterion, otherwise the app cannot prepare a sign-off`);
    else g.criteria.forEach((c, k) => crit(c, `Phase ${i + 1} to ${i + 2}, criterion ${k + 1}`));
  }
  d.rules.forEach((r, i) => { crit(r, `Alert rule ${i + 1}`); if (r.tier !== 'REVIEW' && r.tier !== 'URGENT') e.push(`Alert rule ${i + 1}: choose REVIEW or URGENT`); });
  d.precautions.forEach((p, i) => {
    if (!bi(p.label) || !bi(p.question)) e.push(`Restricted movement ${i + 1}: write the name and the question in English and Hindi`);
    if (!p.phases.length) e.push(`Restricted movement ${i + 1}: choose the phases it applies to`);
  });
  const seenCurve = new Set<string>();
  (d.curves ?? []).forEach((c, i) => {
    const w = `Expected recovery ${i + 1}`;
    if (!d.measures.some((m) => m.id === c.measure)) e.push(`${w}: choose one of your weekly measures`);
    else if (seenCurve.has(c.measure)) e.push(`${w}: that measure already has an expected recovery`);
    seenCurve.add(c.measure);
    if (c.better !== 'higher' && c.better !== 'lower') e.push(`${w}: say whether higher or lower is better`);
    if (!num(c.tolerance) || !(c.tolerance > 0)) e.push(`${w}: the allowed gap must be above 0`);
    if (!Array.isArray(c.points) || c.points.length < 2) e.push(`${w}: add at least two points (week and value)`);
    else {
      if (c.points.some((x) => !num(x.week) || !num(x.value) || x.week < 0)) e.push(`${w}: every point needs a week (0 or more) and a value`);
      for (let k = 1; k < c.points.length; k++) if (!(c.points[k].week > c.points[k - 1].week)) { e.push(`${w}: weeks must increase from one point to the next`); break; }
    }
  });
  d.signs.forEach((s, i) => { if (!bi(s.label)) e.push(`Extra warning sign ${i + 1}: write it in English and Hindi`); });
  const a = d.alerts;
  if (!a) e.push('Set the alert timings, or choose "Use placeholder values (needs sign-off)"');
  else {
    const all = [a.hours.SAFETY, a.hours.URGENT, a.hours.REVIEW, a.missed.count, a.missed.adherencePct, a.combination.minDistinct, a.combination.windowDays, a.painRise.delta, a.painRise.window, a.followUp.teleHours, a.followUp.checkInDays, a.followUp.forDays];
    if (!all.every((n) => num(n) && n > 0)) e.push('Every alert timing must be a number above 0');
    if (a.combination.minDistinct < 2) e.push('"Several signals together" needs at least 2 signals');
    if (a.painRise.window < 2) e.push('"Pain rising" needs a window of at least 2 check-ins');
    if (a.missed.adherencePct > 100) e.push('Adherence cannot be above 100%');
  }
  return e;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'exercise';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OPSAY: Record<Operator, string> = { '>=': '≥', '>': '>', '<=': '≤', '<': '<', '==': '=', '!=': '≠' };

export const newExerciseId = (draftId: string, existing: ExerciseDraft[]) => `${draftId}-e${existing.length + 1}-${slug('x')}`;

function exerciseRecord(x: ExerciseDraft, packId: string, usedIn: string[]): Exercise {
  const hasDose = !!x.doseText && bi(x.doseText);
  const words = x.name.en.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4).map(esc);
  return {
    id: x.id, name: { en: x.name.en.trim(), hi: x.name.hi.trim() }, picture: CUSTOM_PICTURE,
    dose: {
      sets: null, reps: null, holdSec: null,
      text: hasDose ? { en: x.doseText!.en.trim(), hi: x.doseText!.hi.trim() } : { en: 'Sets and repetitions: as shown by your physio', hi: 'सेट और बार: जैसा आपके फिज़ियो ने दिखाया' },
      source: hasDose ? AUTHORED_TAG : NEEDS_SIGNOFF,
    },
    regressionId: null, regressionSource: null,
    voice: [...words, esc(x.name.hi.trim())].filter(Boolean),
    usedIn: { [packId]: usedIn },
  };
}

/** Register the draft's own exercises in the shared library (idempotent). Returns the ids it added. */
export function registerDraftExercises(d: ConditionDraft): string[] {
  const added: string[] = [];
  for (const x of d.exercises) {
    if (getExercise(x.id)) continue;
    const used = d.phases.flatMap((p, i) => (p.exercises.includes(x.id) ? [phaseId(i)] : []));
    registerExercise(exerciseRecord(x, d.id, used));
    added.push(x.id);
  }
  return added;
}

export function buildConditionPack(d: ConditionDraft): ProtocolPack {
  const problems = validateDraft(d);
  if (problems.length) throw new Error(problems[0]);
  const a = d.alerts!;
  const tag = (g: AlertGroup) => (a.source[g] === 'placeholder' ? NEEDS_SIGNOFF : AUTHORED_TAG);
  const mlabel = (id: string): Bi => (id === PAIN_ID ? { en: 'Pain', hi: 'दर्द' } : d.measures.find((m) => m.id === id)!.label);
  const sayRule = (m: string, op: Operator, v: number): Bi => ({ en: `${mlabel(m).en} ${OPSAY[op]} ${v}`, hi: `${mlabel(m).hi} ${OPSAY[op]} ${v}` });
  const RF: Bi = { en: 'Red-flag symptom', hi: 'खतरे का लक्षण' };
  const sign = (id: string, en: string, hi: string, voice: string[]): WarningSign => ({ id, label: { en, hi }, ruleLabel: RF, tier: 'SAFETY', ruleId: 'R1', source: 'SAFETY', voice });
  const warningSigns: WarningSign[] = [
    sign('calfPainOrRedness', 'Calf pain or redness', 'पिंडली में दर्द या लाली', ['calf', 'pindli', 'पिंडली']),
    sign('fever', 'Fever', 'बुखार', ['fever', 'temperature', 'bukhar', 'bukhaar', 'बुखार']),
    sign('woundDischarge', 'Fluid from the wound', 'घाव से पानी या मवाद', ['discharge', '\\bpus\\b', 'oozing', 'मवाद', 'रिस']),
    sign('spreadingRedness', 'Redness spreading', 'लाली फैल रही है', ['spreading', 'लाली फैल', 'फैल रही']),
    sign('chestPainBreathless', 'Chest pain or breathlessness', 'सीने में दर्द या सांस फूलना', ['chest', 'breathless', 'breathing', 'short of breath', 'seene', 'सीने', 'सांस', 'saans']),
    { id: 'numbness', label: { en: 'New numbness or tingling', hi: 'नई सुन्नता या झनझनाहट' }, ruleLabel: { en: 'New numbness or tingling', hi: 'नई सुन्नता या झनझनाहट' }, tier: 'REVIEW', ruleId: 'A8', source: NEEDS_SIGNOFF, voice: ['numb', 'tingl', 'sunn', 'सुन्न', 'झनझनाहट'] },
    ...d.signs.map((s, i): WarningSign => ({ id: `extra${i + 1}`, label: { en: s.label.en.trim(), hi: s.label.hi.trim() }, ruleLabel: { en: s.label.en.trim(), hi: s.label.hi.trim() }, tier: s.tier, ruleId: `X${i + 1}`, source: AUTHORED_TAG, voice: [esc(s.label.en.trim().toLowerCase())] })),
  ];

  const rules: Rule[] = [];
  d.rules.forEach((r, i) => rules.push({ id: `T${i + 1}`, label: sayRule(r.measure, r.operator, r.value), tier: r.tier, source: AUTHORED_TAG, type: 'threshold', measure: r.measure, operator: r.operator, stages: [{ minWeek: 0, maxWeek: null, value: r.value, source: AUTHORED_TAG }] }));
  rules.push({ id: 'R5', label: { en: 'Several amber signals together', hi: 'कई चेतावनी संकेत एक साथ' }, tier: 'URGENT', source: NEEDS_SIGNOFF, type: 'combination', ofTier: 'REVIEW', minDistinct: a.combination.minDistinct, windowDays: a.combination.windowDays, countSource: tag('combination') });
  rules.push({ id: 'A1', label: { en: 'Pain rising', hi: 'दर्द बढ़ रहा है' }, tier: 'REVIEW', source: NEEDS_SIGNOFF, type: 'trend', measure: PAIN_ID, direction: 'up', delta: a.painRise.delta, window: a.painRise.window, deltaSource: tag('painRise') });
  rules.push({ id: 'A3', label: { en: 'Missed sessions', hi: 'कसरत छूट रही है' }, tier: 'REVIEW', source: NEEDS_SIGNOFF, type: 'streak', metric: 'missedSessions', count: a.missed.count, orAdherenceBelowPct: a.missed.adherencePct, countSource: tag('missed') });
  const gates = d.gates.filter((g) => g.from < d.phases.length - 1 && g.criteria.length).sort((x, y) => x.from - y.from);
  if (gates.length) rules.push({ id: 'A6', label: { en: 'Phase taking longer than expected', hi: 'चरण अपेक्षा से लंबा चल रहा है' }, tier: 'REVIEW', source: NEEDS_SIGNOFF, type: 'gateOverdue' });
  if (d.precautions.length) rules.push({ id: 'P1', label: { en: 'Restricted movement in a restricted phase', hi: 'प्रतिबंधित हरकत प्रतिबंध वाले चरण में' }, tier: 'REVIEW', source: NEEDS_SIGNOFF, type: 'precautionBreach' });

  (d.curves ?? []).forEach((c, i) => {
    const m = mlabel(c.measure);
    const lower = c.better === 'lower';
    rules.push({ id: `C${i + 1}`, label: { en: `${m.en} ${lower ? 'above' : 'below'} the expected recovery`, hi: `${m.hi} अपेक्षित सुधार से ${lower ? 'ऊपर' : 'नीचे'}` }, tier: 'REVIEW', source: NEEDS_SIGNOFF, type: 'belowCurve', measure: c.measure });
  });
  const call = ['call-patient', 'reassess-bring-visit-forward'];
  const suggestedActions: Record<string, string[]> = { R1: call, R5: ['hold-progression', ...call], A1: ['hold-progression'], A3: ['call-patient'], A8: call };
  d.rules.forEach((_, i) => { suggestedActions[`T${i + 1}`] = ['call-patient', 'hold-progression', 'reassess-bring-visit-forward']; });
  d.signs.forEach((_, i) => { suggestedActions[`X${i + 1}`] = call; });
  (d.curves ?? []).forEach((_, i) => { suggestedActions[`C${i + 1}`] = ['reassess-bring-visit-forward']; });
  if (gates.length) suggestedActions.A6 = ['reassess-bring-visit-forward'];
  if (d.precautions.length) suggestedActions.P1 = call;

  const pack: ProtocolPack = {
    id: d.id,
    authored: JSON.parse(JSON.stringify(d)),
    condition: { en: d.condition.en.trim(), hi: d.condition.hi.trim() },
    population: d.population.trim() || 'Written by the treating physio. Every clinical value was entered or approved by the physio.',
    version: `${d.version ?? 1}.0.0-physio-authored`,
    sources: ['Written by the treating physio in the app (PHYSIO_AUTHORED). Values tagged NEEDS_PHYSIO_SIGNOFF are placeholders.'],
    anchorLabel: { en: d.anchorLabel.en.trim(), hi: d.anchorLabel.hi.trim() },
    phases: d.phases.map((p, i) => ({ id: phaseId(i), order: i + 1, name: { en: p.name.en.trim(), hi: p.name.hi.trim() }, exercises: [...p.exercises], sessionsPerDay: p.sessionsPerDay, followUpEveryDays: p.followUpEveryDays, expectedWeeks: [p.weeksMin, p.weeksMax], source: AUTHORED_TAG })),
    measures: [
      { id: PAIN_ID, label: { en: 'Pain', hi: 'दर्द' }, question: { en: 'How much pain do you have today?', hi: 'आज आपको कितना दर्द है?' }, unit: '0-10', capture: 'tap', frequency: 'daily', valueType: 'number', scale: { min: 0, max: 10 } },
      ...d.measures.map((m) => ({ id: m.id, label: { en: m.label.en.trim(), hi: m.label.hi.trim() }, short: { en: m.label.en.trim(), hi: m.label.hi.trim() }, unit: m.unit.trim(), capture: 'number' as const, frequency: 'weekly' as const, valueType: 'number' as const, input: { min: m.min, max: m.max, step: m.step } })),
    ],
    gates: gates.map((g) => ({ fromPhase: phaseId(g.from), toPhase: phaseId(g.from + 1), criteria: g.criteria.map((c, k) => ({ id: `g${g.from + 1}.${k + 1}`, label: mlabel(c.measure), measure: c.measure, operator: c.operator, value: c.value, source: AUTHORED_TAG })) })),
    expectedCurves: (d.curves ?? []).map((c) => ({ measure: c.measure, better: c.better, tolerance: c.tolerance, points: c.points.map((x): [number, number] => [x.week, x.value]), source: AUTHORED_TAG })),
    precautions: d.precautions.map((p, i) => ({ id: `prec${i + 1}`, label: { en: p.label.en.trim(), hi: p.label.hi.trim() }, question: { en: p.question.en.trim(), hi: p.question.hi.trim() }, phases: p.phases.map(phaseId), source: AUTHORED_TAG })),
    warningSigns,
    rules,
    checkIn: {
      voiceExample: { en: 'Say e.g. "pain 4, did all my exercises, no fever"', hi: 'ऐसे बोलें: "दर्द 4, सारी कसरतें कीं, बुखार नहीं"' },
      dailyMeasures: [PAIN_ID], skipReasons: ['pain', 'fear', 'time', 'access', 'understand'],
    },
    questionnaires: [],
    followUpProposal: { teleReviewWithinHours: a.followUp.teleHours, checkInEveryDays: a.followUp.checkInDays, forDays: a.followUp.forDays, source: tag('followUp') },
    suggestedActions,
    responseHours: { SAFETY: { hours: a.hours.SAFETY, source: tag('hours') }, URGENT: { hours: a.hours.URGENT, source: tag('hours') }, REVIEW: { hours: a.hours.REVIEW, source: tag('hours') } },
    adherenceWindowDays: 7,
  };

  const added = registerDraftExercises(d);
  try { registerPack(pack); } catch (err) { for (const id of added) unregisterExercise(id); throw err; }
  return pack;
}

/** For a saved or invited pack: bring its own exercises back, then the pack itself. */
export function restoreAuthoredPack(p: ProtocolPack): void {
  if (p.authored) registerDraftExercises(p.authored as ConditionDraft);
  registerPack(p);
}

/**
 * Copy a written condition so the physio can change it and save it as the next version.
 * The old condition and the patients on it are never touched. Exercises written for the old one are copied under new ids.
 */
export function draftAsNewVersion(from: ConditionDraft, newId: string): ConditionDraft {
  const c: ConditionDraft = JSON.parse(JSON.stringify(from));
  const swap = (id: string) => (id.startsWith(`${from.id}-e`) ? `${newId}${id.slice(from.id.length)}` : id);
  c.exercises = c.exercises.map((x) => ({ ...x, id: swap(x.id) }));
  c.phases = c.phases.map((p) => ({ ...p, exercises: p.exercises.map(swap) }));
  c.id = newId;
  c.previousId = from.id;
  c.version = (from.version ?? 1) + 1;
  c.curves = c.curves ?? [];
  c.condition = { en: `${stripVersion(from.condition.en)} (version ${c.version})`, hi: `${stripVersion(from.condition.hi)} (संस्करण ${c.version})` };
  return c;
}
const stripVersion = (s: string) => s.replace(/\s*\((version|संस्करण) \d+\)\s*$/, '');

// ---------- compact form for invite links (Phase 3.4) ----------
/** Leaves out everything that equals the default, so the link is shorter. `fatDraft` puts it back. */
export function slimDraft(d: ConditionDraft): Record<string, unknown> {
  const x: Record<string, any> = JSON.parse(JSON.stringify(d));
  if (!x.population) delete x.population;
  for (const k of ['exercises', 'measures', 'gates', 'rules', 'precautions', 'signs', 'curves']) if (!x[k]?.length) delete x[k];
  if (x.version === 1) delete x.version;
  if (!x.previousId) delete x.previousId;
  for (const e of x.exercises ?? []) if (!e.doseText || (!e.doseText.en && !e.doseText.hi)) delete e.doseText;
  if (JSON.stringify(x.alerts) === JSON.stringify(placeholderAlerts())) x.alerts = 'P';
  return x;
}
export function fatDraft(x: any): ConditionDraft {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string') throw new Error('not a condition');
  const base = blankDraft(x.id);
  const d = { ...base, ...x } as ConditionDraft;
  if ((x as any).alerts === 'P') d.alerts = placeholderAlerts();
  for (const k of ['phases', 'exercises', 'measures', 'gates', 'rules', 'precautions', 'signs', 'curves'] as const) if (!Array.isArray(d[k])) throw new Error(`${k} must be a list`);
  return d;
}
