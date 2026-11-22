/**
 * The WhatsApp check-in conversation (pure logic, no network, no AI).
 *
 * It asks exactly the questions of the in-app check-in, from the same protocol pack, builds the same Draft and saves it with the same
 * toDaily() as the app. So a "Yes" to a red-flag sign on WhatsApp raises the same tier as it does in the app, and nothing here decides
 * anything: triage stays in engine/triage.ts. The bot never gives advice beyond the physio-signed safety wording the app already shows.
 *
 * Messages are plain buttons so they map to WhatsApp reply buttons and list messages. WhatsApp allows 3 reply buttons or 10 list rows,
 * which is why a 0 to 10 pain scale is asked in two steps (a band, then the number).
 */
import type { AnsweredBy, DailyCheckIn, Lang, Measure, Patient, ProtocolPack, Value } from '../types';
import { L, t } from '../i18n';
import { exerciseName } from '../exercises/library';
import { currentExercises } from '../engine/plan';
import { activePrecautions, isComplete, markAllExercisesDone, markNoWarnings, newDraft, saveCheckIn, toDaily, type Draft } from '../checkin';
import { triage } from '../engine/triage';
import { safetyLevel } from '../safety';
import { firstName } from './templates';
import { wa } from './strings';

export interface Choice { id: string; label: string }
export interface Question { key: string; prompt: string; choices: Choice[] }

export interface Session {
  pack: ProtocolPack;
  patient: Patient;
  lang: Lang;
  draft: Draft;
  answeredBy: AnsweredBy | null;
  /** Small memory for multi-step questions: pain band, exercise path, warning-sign gate. */
  memo: Record<string, string>;
}

export function startSession(patient: Patient, pack: ProtocolPack, lang: Lang = patient.language): Session {
  return { pack, patient, lang, draft: newDraft(pack, patient), answeredBy: null, memo: {} };
}

const YN = (lang: Lang): Choice[] => [{ id: 'yes', label: t(lang, 'yes') }, { id: 'no', label: t(lang, 'no') }];

/** Splits a numeric range into three bands so every message has at most four choices. */
function bands(lo: number, hi: number): { id: string; lo: number; hi: number }[] {
  const n = hi - lo + 1;
  const size = Math.ceil(n / 3);
  const out: { id: string; lo: number; hi: number }[] = [];
  for (let s = lo, i = 0; s <= hi; s += size, i++) out.push({ id: `b${i}`, lo: s, hi: Math.min(hi, s + size - 1) });
  return out;
}
const rangeOf = (m: Measure): [number, number] | null => (m.scale ? [m.scale.min, m.scale.max] : m.input ? [m.input.min, m.input.max] : null);

/** True when this pack asks a daily measure the chat cannot handle (the in-app check-in is then the only route). */
export const unsupportedMeasures = (pack: ProtocolPack): string[] =>
  pack.checkIn.dailyMeasures.filter((id) => { const m = pack.measures.find((x) => x.id === id); return !m || (!m.options && !rangeOf(m)); });

/** The next question, or null when the check-in is complete. */
export function nextQuestion(s: Session): Question | null {
  const { pack, lang, draft: d } = s;
  if (s.answeredBy === null) {
    return { key: 'who', prompt: wa(lang, 'waWho'), choices: [{ id: 'patient', label: wa(lang, 'waWhoPatient', { name: firstName(s.patient.name) }) }, { id: 'caregiver', label: wa(lang, 'waWhoCare') }] };
  }
  for (const id of pack.checkIn.dailyMeasures) {
    if (d.values[id] !== null) continue;
    const m = pack.measures.find((x) => x.id === id)!;
    const prompt = L(m.question ?? m.label, lang);
    if (m.options) return { key: `m:${id}`, prompt, choices: m.options.map((o) => ({ id: o.id, label: L(o.label, lang) })) };
    const [lo, hi] = rangeOf(m)!;
    const band = s.memo[`band:${id}`];
    if (hi - lo + 1 <= 4) return { key: `m:${id}`, prompt, choices: Array.from({ length: hi - lo + 1 }, (_, i) => ({ id: String(lo + i), label: String(lo + i) })) };
    if (!band) return { key: `band:${id}`, prompt, choices: bands(lo, hi).map((b) => ({ id: b.id, label: `${b.lo} - ${b.hi}` })) };
    const b = bands(lo, hi).find((x) => x.id === band)!;
    return { key: `m:${id}`, prompt: wa(lang, 'waPick'), choices: Array.from({ length: b.hi - b.lo + 1 }, (_, i) => ({ id: String(b.lo + i), label: String(b.lo + i) })) };
  }
  const exIds = Object.keys(d.results);
  if (exIds.length) {
    if (!s.memo.exAll) return { key: 'exAll', prompt: wa(lang, 'waAllEx'), choices: [{ id: 'all', label: t(lang, 'exAllDone') }, { id: 'some', label: t(lang, 'ex_some') }, { id: 'none', label: t(lang, 'ex_none') }] };
    if (s.memo.exAll === 'none' && d.results[exIds[0]].reason === null) return { key: 'reasonAll', prompt: wa(lang, 'waWhyAll'), choices: pack.checkIn.skipReasons.map((r) => ({ id: r, label: t(lang, `skip_${r}`) })) };
    if (s.memo.exAll === 'some') {
      const pending = exIds.find((id) => d.results[id].done === null);
      if (pending) return { key: `ex:${pending}`, prompt: wa(lang, 'waDidEx', { name: exerciseName(pending, lang) }), choices: YN(lang) };
      const why = exIds.find((id) => d.results[id].done === false && d.results[id].reason === null);
      if (why) return { key: `why:${why}`, prompt: wa(lang, 'waWhyNot', { name: exerciseName(why, lang) }), choices: pack.checkIn.skipReasons.map((r) => ({ id: r, label: t(lang, `skip_${r}`) })) };
    }
  } else {
    if (d.exercises === null) return { key: 'exAllLegacy', prompt: wa(lang, 'waAllEx'), choices: [{ id: 'all', label: t(lang, 'exAllDone') }, { id: 'some', label: t(lang, 'ex_some') }, { id: 'none', label: t(lang, 'ex_none') }] };
    if (d.exercises !== 'all' && d.skipReason === null) return { key: 'skipLegacy', prompt: wa(lang, 'waWhy'), choices: pack.checkIn.skipReasons.map((r) => ({ id: r, label: t(lang, `skip_${r}`) })) };
  }
  if (d.hardMovement === null) {
    // A WhatsApp list holds 10 rows, so a long exercise list is shown in pages of 8 with "More".
    const page = Number(s.memo.hardPage ?? 0);
    const all = exIds.map((id) => ({ id, label: exerciseName(id, lang) }));
    const shown = all.length > 9 ? all.slice(page * 8, page * 8 + 8) : all;
    const more = all.length > 9 && (page + 1) * 8 < all.length;
    return { key: 'hard', prompt: wa(lang, 'waHardest'), choices: [...shown, ...(more ? [{ id: 'more', label: wa(lang, 'waMore') }] : []), { id: 'none', label: t(lang, 'hm_none') }] };
  }
  const signsOpen = pack.warningSigns.filter((w) => d.warnings[w.id] === null);
  if (signsOpen.length) {
    if (!s.memo.signsGate) {
      return { key: 'signsGate', prompt: `${t(lang, 'q_safety')}\n${pack.warningSigns.map((w) => `• ${L(w.label, lang)}`).join('\n')}`, choices: [{ id: 'none', label: t(lang, 'noneOfThese') }, { id: 'yes', label: wa(lang, 'waSignsYes') }] };
    }
    const w = signsOpen[0];
    return { key: `sign:${w.id}`, prompt: wa(lang, 'waSignQ', { sign: L(w.label, lang) }), choices: YN(lang) };
  }
  const prec = activePrecautions(pack, s.patient).find((x) => d.precautionBreaches[x.id] === null);
  if (prec) return { key: `prec:${prec.id}`, prompt: L(prec.question, lang), choices: YN(lang) };
  return null;
}

/** Applies a tapped choice to the question that was shown. Returns a new session. */
export function answer(s: Session, q: Question, choiceId: string): Session {
  if (!q.choices.some((c) => c.id === choiceId)) throw new Error(`Not a choice for ${q.key}: ${choiceId}`);
  const d: Draft = { ...s.draft, values: { ...s.draft.values }, results: { ...s.draft.results }, warnings: { ...s.draft.warnings }, precautionBreaches: { ...s.draft.precautionBreaches } };
  const memo = { ...s.memo };
  let answeredBy = s.answeredBy;
  const [kind, id] = q.key.split(':') as [string, string | undefined];
  let nd = d;
  switch (kind) {
    case 'who': answeredBy = choiceId as AnsweredBy; break;
    case 'band': memo[`band:${id}`] = choiceId; break;
    case 'm': {
      const m = s.pack.measures.find((x) => x.id === id)!;
      d.values[id!] = m.options ? choiceId : Number(choiceId);
      break;
    }
    case 'exAll':
      memo.exAll = choiceId;
      if (choiceId === 'all') nd = markAllExercisesDone(d);
      else if (choiceId === 'none') for (const k of Object.keys(d.results)) d.results[k] = { done: false, reason: null };
      break;
    case 'reasonAll': for (const k of Object.keys(d.results)) d.results[k] = { done: false, reason: choiceId }; break;
    case 'ex': d.results[id!] = { done: choiceId === 'yes', reason: null }; break;
    case 'why': d.results[id!] = { done: false, reason: choiceId }; break;
    case 'exAllLegacy': d.exercises = choiceId as 'all' | 'some' | 'none'; break;
    case 'skipLegacy': d.skipReason = choiceId; break;
    case 'hard': if (choiceId === 'more') memo.hardPage = String(Number(memo.hardPage ?? 0) + 1); else d.hardMovement = choiceId; break;
    case 'signsGate':
      memo.signsGate = choiceId;
      if (choiceId === 'none') nd = markNoWarnings(d);
      break;
    case 'sign': d.warnings[id!] = choiceId === 'yes'; break;
    case 'prec': d.precautionBreaches[id!] = choiceId === 'yes'; break;
  }
  return { ...s, draft: nd, memo, answeredBy };
}

export const isDone = (s: Session): boolean => nextQuestion(s) === null && isComplete(s.draft);

/** Builds the check-in exactly as the app does. Throws if the conversation is not finished. */
export const toCheckIn = (s: Session, date: string, recordedAt: number): DailyCheckIn => toDaily(s.draft, s.patient, date, { answeredBy: s.answeredBy ?? 'patient', recordedAt });

export interface Reply { text: string; tone: 'ok' | 'warn' | 'alert'; tier: string }

/** What the patient is told after the check-in is saved. Wording for warning signs is the app's own (physio sign-off pending, see README). */
export function closingReply(saved: Patient, pack: ProtocolPack, lang: Lang, nowMs: number): Reply[] {
  const tri = triage(saved, pack, { nowMs });
  const h = tri.responseHours ?? 0;
  switch (tri.tier) {
    case 'SAFETY': {
      const k = safetyLevel(saved) === 'emergency' ? 'safety' : 'safetyToday';
      return [{ tone: 'alert', tier: tri.tier, text: `${t(lang, `${k}Title`)}\n${t(lang, `${k}Body`)}` }, { tone: 'ok', tier: tri.tier, text: wa(lang, 'waToldSafety') }];
    }
    case 'URGENT': return [{ tone: 'warn', tier: tri.tier, text: wa(lang, 'waThanksUrgent', { h }) }];
    case 'REVIEW': return [{ tone: 'ok', tier: tri.tier, text: wa(lang, 'waThanksReview', { h }) }];
    default: return [{ tone: 'ok', tier: tri.tier, text: wa(lang, 'waThanksOn') }];
  }
}

/** Saves the finished check-in into a copy of the patient (the caller decides whether to keep it). */
export const applyCheckIn = (s: Session, date: string, recordedAt: number): Patient => saveCheckIn(s.patient, toCheckIn(s, date, recordedAt));
export const prescribedToday = (p: Patient, pack: ProtocolPack): number => currentExercises(p, pack).length;
export type { Value };
