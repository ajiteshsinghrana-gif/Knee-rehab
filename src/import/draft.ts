/**
 * AI-assisted protocol drafting (Phase 6.6).
 *
 * The AI is a READER, not a clinician. It only copies what a document says into the shape below, with an exact quote for
 * every item. Nothing here decides anything about a patient. The physio sees every item beside its quote, ticks the
 * ones to keep, and the result opens in the normal "Add a condition" editor, where the same validator as every other
 * protocol has the last word. Hindi wording comes from the model and is flagged for the physio to check.
 */
import type { Bi, Operator } from '../types';
import { blankDraft, placeholderAlerts, PAIN_ID, type ConditionDraft } from '../author/condition';
import { parseExerciseList } from './extract';
import { getAccessToken } from '../sync/auth';
import { loadConfig, type FetchFn } from '../sync/client';

export interface AiBi { en?: unknown; hi?: unknown }
export interface AiDraft {
  condition?: AiBi; anchorLabel?: AiBi; population?: unknown;
  phases?: { name?: AiBi; weeksMin?: unknown; weeksMax?: unknown; sessionsPerDay?: unknown; followUpEveryDays?: unknown; exercises?: { name?: AiBi; dose?: AiBi }[]; quote?: unknown }[];
  measures?: { id?: unknown; label?: AiBi; unit?: unknown; min?: unknown; max?: unknown; step?: unknown; quote?: unknown }[];
  gates?: { fromPhase?: unknown; measure?: unknown; operator?: unknown; value?: unknown; quote?: unknown }[];
  rules?: { measure?: unknown; operator?: unknown; value?: unknown; tier?: unknown; quote?: unknown }[];
  signs?: { label?: AiBi; tier?: unknown; quote?: unknown }[];
  precautions?: { label?: AiBi; question?: AiBi; phases?: unknown; quote?: unknown }[];
  notStated?: unknown;
}

export type ItemKind = 'phase' | 'measure' | 'gate' | 'rule' | 'sign' | 'precaution';
export interface ReviewItem {
  /** Stable id: `<kind>:<index>` into the AI's list. */
  id: string; kind: ItemKind; summary: string; quote: string;
  /** The quote really appears in the uploaded text. Items whose quote is not found start unticked. */
  quoteFound: boolean;
}
export interface DraftReview { items: ReviewItem[]; notStated: string[]; headline: string }

const OPS: Operator[] = ['>=', '>', '<=', '<', '==', '!='];
const OPSAY: Record<string, string> = { '>=': '≥', '>': '>', '<=': '≤', '<': '<', '==': '=', '!=': '≠' };
const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const bi = (b?: AiBi): Bi => ({ en: str(b?.en), hi: str(b?.hi) });
const label = (b?: AiBi) => str(b?.en) || str(b?.hi) || '(no name)';

/** Whitespace, case, hyphenation and quote-mark differences must not hide a real quote (PDF text often breaks lines mid-sentence). */
const squash = (s: string) => s.toLowerCase().replace(/[‘’“”"'`]/g, '').replace(/-\s+/g, '').replace(/[^\p{L}\p{N}%.<>=≤≥]+/gu, ' ').replace(/\s+/g, ' ').trim();
export function quoteInText(quote: string, text: string): boolean {
  const q = squash(quote);
  return q.length >= 8 && squash(text).includes(q);
}

/** Turns the AI's answer into a list the physio can tick through. Anything malformed is dropped, never repaired. */
export function reviewOf(ai: AiDraft, text: string): DraftReview {
  const items: ReviewItem[] = [];
  const add = (kind: ItemKind, i: number, summary: string, quoteRaw: unknown) => {
    const quote = str(quoteRaw).slice(0, 400);
    if (!quote) return; // no quote, no item: the rule is "if you cannot quote it, leave it out"
    items.push({ id: `${kind}:${i}`, kind, summary, quote, quoteFound: quoteInText(quote, text) });
  };
  const m = new Map<string, string>();
  (ai.measures ?? []).forEach((x) => m.set(str(x.id), label(x.label)));
  const measureName = (id: unknown) => (str(id) === PAIN_ID ? 'Pain (0-10)' : m.get(str(id)) ?? `(unknown measure ${str(id)})`);

  (ai.phases ?? []).forEach((p, i) => {
    const wk = num(p.weeksMin) !== null || num(p.weeksMax) !== null ? `, weeks ${num(p.weeksMin) ?? '?'}-${num(p.weeksMax) ?? 'open'}` : '';
    const ex = (p.exercises ?? []).map((e) => label(e.name));
    add('phase', i, `Phase ${i + 1}: ${label(p.name)}${wk}. Exercises: ${ex.length ? ex.join(', ') : 'none stated'}`, p.quote);
  });
  (ai.measures ?? []).forEach((x, i) => {
    if (num(x.min) === null || num(x.max) === null || num(x.step) === null) return;
    add('measure', i, `Weekly measure: ${label(x.label)} (${str(x.unit)}, ${x.min} to ${x.max})`, x.quote);
  });
  (ai.gates ?? []).forEach((g, i) => {
    if (!OPS.includes(g.operator as Operator) || num(g.value) === null || num(g.fromPhase) === null) return;
    add('gate', i, `To leave phase ${g.fromPhase}: ${measureName(g.measure)} ${OPSAY[g.operator as string]} ${g.value}`, g.quote);
  });
  (ai.rules ?? []).forEach((r, i) => {
    if (!OPS.includes(r.operator as Operator) || num(r.value) === null || (r.tier !== 'REVIEW' && r.tier !== 'URGENT')) return;
    add('rule', i, `Alert (${r.tier}): ${measureName(r.measure)} ${OPSAY[r.operator as string]} ${r.value}`, r.quote);
  });
  (ai.signs ?? []).forEach((s, i) => {
    if (s.tier !== 'REVIEW' && s.tier !== 'URGENT') return;
    add('sign', i, `Warning sign (${s.tier}): ${label(s.label)}`, s.quote);
  });
  (ai.precautions ?? []).forEach((p, i) => add('precaution', i, `Restricted movement: ${label(p.label)}`, p.quote));

  const notStated = Array.isArray(ai.notStated) ? ai.notStated.map(str).filter(Boolean) : [];
  return { items, notStated, headline: str(ai.condition?.en) || 'Untitled condition' };
}

/** Only items the physio ticked reach the draft. Items that point at something not ticked or not valid are skipped with a note. */
export function draftFrom(ai: AiDraft, approved: Set<string>, newId: string, fileName = 'uploaded file'): { draft: ConditionDraft; notes: string[]; sources: { what: string; quote: string }[] } {
  const d = blankDraft(newId);
  const notes: string[] = [];
  const sources: { what: string; quote: string }[] = [];
  const keep = (kind: ItemKind, i: number) => approved.has(`${kind}:${i}`);
  const cite = (what: string, quote: unknown) => sources.push({ what, quote: str(quote) });

  d.condition = bi(ai.condition);
  if (str(ai.anchorLabel?.en) || str(ai.anchorLabel?.hi)) d.anchorLabel = bi(ai.anchorLabel);
  d.population = str(ai.population);
  d.phases = [];

  let nEx = 0;
  const phaseIndexOfAi = new Map<number, number>();
  (ai.phases ?? []).forEach((p, i) => {
    if (!keep('phase', i)) return;
    phaseIndexOfAi.set(i + 1, d.phases.length);
    const ids: string[] = [];
    for (const e of p.exercises ?? []) {
      const name = bi(e.name);
      if (!name.en && !name.hi) continue;
      const hit = parseExerciseList(name.en).ids; // reuse a library exercise when the name matches one
      if (hit.length) { for (const id of hit) if (!ids.includes(id)) ids.push(id); continue; }
      const dose = bi(e.dose);
      const id = `${newId}-e${++nEx}`;
      d.exercises.push({ id, name, ...(dose.en && dose.hi ? { doseText: dose } : {}) });
      ids.push(id);
    }
    d.phases.push({
      name: bi(p.name), exercises: ids,
      sessionsPerDay: num(p.sessionsPerDay) ?? 2, followUpEveryDays: num(p.followUpEveryDays) ?? 7,
      weeksMin: num(p.weeksMin) ?? 0, weeksMax: num(p.weeksMax),
    });
    cite(`Phase ${d.phases.length}: ${label(p.name)}`, p.quote);
    if (num(p.sessionsPerDay) === null) notes.push(`Phase ${d.phases.length}: the document gave no sessions per day, so 2 is a placeholder. Set your own.`);
    if (num(p.followUpEveryDays) === null) notes.push(`Phase ${d.phases.length}: the document gave no review interval, so 7 days is a placeholder. Set your own.`);
  });
  if (!d.phases.length) d.phases = blankDraft(newId).phases;

  const mIds = new Set<string>([PAIN_ID]);
  (ai.measures ?? []).forEach((x, i) => {
    if (!keep('measure', i) || num(x.min) === null || num(x.max) === null || num(x.step) === null) return;
    const id = str(x.id) || `m${d.measures.length + 1}`;
    if (mIds.has(id)) return;
    mIds.add(id);
    d.measures.push({ id, label: bi(x.label), unit: str(x.unit), min: x.min as number, max: x.max as number, step: x.step as number });
    cite(`Measure: ${label(x.label)}`, x.quote);
  });

  (ai.gates ?? []).forEach((g, i) => {
    if (!keep('gate', i)) return;
    const from = phaseIndexOfAi.get(num(g.fromPhase) ?? -1);
    const measure = str(g.measure);
    if (from === undefined) { notes.push(`A criterion for leaving phase ${g.fromPhase} was skipped because that phase was not kept.`); return; }
    if (!mIds.has(measure)) { notes.push(`A criterion for leaving phase ${g.fromPhase} was skipped because its measure (${measure}) was not kept.`); return; }
    let gate = d.gates.find((x) => x.from === from);
    if (!gate) { gate = { from, criteria: [] }; d.gates.push(gate); }
    gate.criteria.push({ measure, operator: g.operator as Operator, value: g.value as number });
    cite(`Gate, phase ${from + 1} to ${from + 2}: ${measure} ${OPSAY[g.operator as string]} ${g.value}`, g.quote);
  });

  (ai.rules ?? []).forEach((r, i) => {
    if (!keep('rule', i)) return;
    const measure = str(r.measure);
    if (!mIds.has(measure)) { notes.push(`An alert on "${measure}" was skipped because that measure was not kept.`); return; }
    d.rules.push({ measure, operator: r.operator as Operator, value: r.value as number, tier: r.tier as 'REVIEW' | 'URGENT' });
    cite(`Alert: ${measure} ${OPSAY[r.operator as string]} ${r.value}`, r.quote);
  });

  (ai.signs ?? []).forEach((s, i) => {
    if (!keep('sign', i)) return;
    d.signs.push({ label: bi(s.label), tier: s.tier as 'REVIEW' | 'URGENT' });
    cite(`Warning sign: ${label(s.label)}`, s.quote);
  });

  (ai.precautions ?? []).forEach((p, i) => {
    if (!keep('precaution', i)) return;
    const phases = (Array.isArray(p.phases) ? p.phases : []).map((n) => phaseIndexOfAi.get(Number(n))).filter((x): x is number => x !== undefined);
    if (!phases.length) { notes.push(`The restricted movement "${label(p.label)}" was skipped because none of its phases were kept.`); return; }
    d.precautions.push({ label: bi(p.label), question: bi(p.question), phases });
    cite(`Restricted movement: ${label(p.label)}`, p.quote);
  });

  // The document rarely gives alert timings; they stay the project's placeholders, tagged NEEDS_PHYSIO_SIGNOFF.
  d.alerts = placeholderAlerts();
  notes.push('Alert timings (hours to respond, missed sessions, pain rising) are the project placeholders and will be listed for sign-off.');
  if ([d.condition, d.anchorLabel, ...d.phases.map((p) => p.name), ...d.measures.map((m) => m.label), ...d.signs.map((s) => s.label)].some((b) => !b.hi)) notes.push('Some Hindi wording is missing. Patient-facing text must be in both languages.');
  notes.push('The Hindi wording was written by AI. Have a Hindi-speaking clinician read it before patients use it.');
  d.aiDraft = { file: fileName, sources };
  return { draft: d, notes, sources };
}

/** Asks the server function to draft a protocol. Needs a signed-in physio (the server refuses anyone else). */
export async function requestDraft(text: string, fileName: string, fetchFn: FetchFn = fetch): Promise<AiDraft> {
  const c = await loadConfig(fetchFn);
  if (!c) throw new Error('AI drafting needs the clinic connection (sync.json is not set up).');
  const token = await getAccessToken(c, fetchFn);
  if (!token) throw new Error('Sign in as a physio (live mode) to use AI drafting.');
  let r: Response;
  try {
    r = await fetchFn(`${c.url}/functions/v1/draft-protocol`, {
      method: 'POST', headers: { apikey: c.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, fileName }),
    });
  } catch { throw new Error('Could not reach the drafting service. Check the internet connection.'); }
  const body = (await r.json().catch(() => ({}))) as { draft?: AiDraft; error?: string };
  if (!r.ok || !body.draft) throw new Error(body.error ?? `Drafting failed (${r.status}). Is the draft-protocol function deployed?`);
  return body.draft;
}
