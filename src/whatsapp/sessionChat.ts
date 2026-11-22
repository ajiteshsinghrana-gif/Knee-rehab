/**
 * Guided exercises and form-check video requests as a WhatsApp conversation (pure logic: no network, no AI).
 *
 * WhatsApp cannot count reps, so a chat session records an exercise as "done" (all sets) or "stopped" with a reason. The same session engine
 * and the same consent wording as the app are used. A video request here does not report a warning sign and never changes a tier.
 * Buttons: at most 3 per message; longer choices are lists of at most 10 rows (paged with "More...").
 * Hindi and Bengali wording is a draft: NEEDS_NATIVE_REVIEW. Consent wording: NEEDS_LEGAL_REVIEW.
 */
import type { AnsweredBy, FormRequest, Lang, Patient, ProtocolPack, SessionLog } from '../types';
import { t } from '../i18n';
import { exerciseName } from '../exercises/library';
import { answerPain, completeExercise, doseText, exerciseFinished, planSteps, startSession, stopExercise, toSessionLog, type SState } from '../session/engine';
import { ss } from '../session/strings';
import { consentText, newFormRequest, reviewHours } from '../forms/model';
import { wa } from './strings';

type Dict = Record<string, string>;
const en: Dict = {
  intro: 'Hello {name}. Ready for today\'s exercises? I will show them one at a time.',
  start: 'Start',
  prompt: 'Exercise {i} of {n}: {name}\n{dose}\nDo it at your own pace, then tap a button.',
  done: 'Done',
  stop: 'It hurts, stop',
  help: 'I need help',
  agree: 'Yes, I agree',
  no: 'No, thanks',
  sendVideo: 'Please send a short video of the exercise now. Keep your face out of the picture.',
  videoSent: '(Demo) Video sent',
  skipVideo: 'Skip the video',
  thanks: 'Thank you. Your physio aims to look within {hours} hours. This is not for emergencies: for those, call 112.',
  declined: 'No problem. Your exercises carry on.',
  all: 'All done for today. {done} of {n} exercises finished. Please also do your daily check-in.',
  pickEx: 'Which exercise do you need help with?',
  videoIntro: 'Hello {name}. I can pass a short video of an exercise to your physio. This is not for emergencies or warning signs; for those, call 112.',
  note: 'Video attached in the WhatsApp simulation.',
  reply: 'Your physio replied to your video. Open RehabPath to read it.',
};
const hi: Dict = {
  intro: 'नमस्ते {name}। आज के व्यायाम के लिए तैयार हैं? मैं एक-एक करके दिखाऊँगा।',
  start: 'शुरू करें',
  prompt: 'व्यायाम {i} / {n}: {name}\n{dose}\nअपनी रफ़्तार से करें, फिर बटन दबाएँ।',
  done: 'हो गया',
  stop: 'दर्द है, रुकें',
  help: 'मुझे मदद चाहिए',
  agree: 'हाँ, मैं सहमत हूँ',
  no: 'नहीं, धन्यवाद',
  sendVideo: 'कृपया अभी व्यायाम का छोटा वीडियो भेजें। चेहरा फ़्रेम में न आए।',
  videoSent: '(डेमो) वीडियो भेजा',
  skipVideo: 'वीडियो छोड़ें',
  thanks: 'धन्यवाद। फ़िज़ियो {hours} घंटे के भीतर देखने की कोशिश करते हैं। यह आपातकाल के लिए नहीं है: उसके लिए 112 पर कॉल करें।',
  declined: 'कोई बात नहीं। आपके व्यायाम जारी रहेंगे।',
  all: 'आज के सारे व्यायाम हो गए। {n} में से {done} पूरे। कृपया रोज़ का चेक-इन भी करें।',
  pickEx: 'किस व्यायाम में मदद चाहिए?',
  videoIntro: 'नमस्ते {name}। मैं किसी व्यायाम का छोटा वीडियो आपके फ़िज़ियो तक पहुँचा सकता हूँ। यह आपातकाल या चेतावनी के लक्षणों के लिए नहीं है; उनके लिए 112 पर कॉल करें।',
  note: 'WhatsApp सिमुलेशन में वीडियो जोड़ा गया।',
  reply: 'आपके फ़िज़ियो ने आपके वीडियो का जवाब दिया है। पढ़ने के लिए RehabPath खोलें।',
};
const bn: Dict = {
  intro: 'নমস্কার {name}। আজকের ব্যায়ামের জন্য তৈরি? আমি একটা একটা করে দেখাব।',
  start: 'শুরু করুন',
  prompt: 'ব্যায়াম {i} / {n}: {name}\n{dose}\nনিজের গতিতে করুন, তারপর বোতাম চাপুন।',
  done: 'হয়েছে',
  stop: 'ব্যথা হচ্ছে, থামুন',
  help: 'আমার সাহায্য দরকার',
  agree: 'হ্যাঁ, আমি রাজি',
  no: 'না, ধন্যবাদ',
  sendVideo: 'দয়া করে এখন ব্যায়ামের একটি ছোট ভিডিও পাঠান। মুখ ফ্রেমে আনবেন না।',
  videoSent: '(ডেমো) ভিডিও পাঠানো',
  skipVideo: 'ভিডিও বাদ দিন',
  thanks: 'ধন্যবাদ। ফিজিও {hours} ঘণ্টার মধ্যে দেখার চেষ্টা করেন। এটি জরুরি অবস্থার জন্য নয়: সেজন্য 112-এ ফোন করুন।',
  declined: 'কোনো সমস্যা নেই। আপনার ব্যায়াম চলতে থাকবে।',
  all: 'আজকের সব ব্যায়াম শেষ। {n}টির মধ্যে {done}টি সম্পূর্ণ। দয়া করে প্রতিদিনের চেক-ইনও করুন।',
  pickEx: 'কোন ব্যায়ামে সাহায্য দরকার?',
  videoIntro: 'নমস্কার {name}। আমি একটি ব্যায়ামের ছোট ভিডিও আপনার ফিজিওর কাছে পৌঁছে দিতে পারি। এটি জরুরি অবস্থা বা সতর্কসংকেতের জন্য নয়; সেজন্য 112-এ ফোন করুন।',
  note: 'WhatsApp সিমুলেশনে ভিডিও যুক্ত হয়েছে।',
  reply: 'আপনার ফিজিও আপনার ভিডিওর উত্তর দিয়েছেন। পড়তে RehabPath খুলুন।',
};
export const WSC: Record<Lang, Dict> = { en, hi, bn };
const w = (lang: Lang, k: string, p?: Record<string, string | number>): string => {
  let s = WSC[lang][k] ?? en[k] ?? k;
  for (const [a, b] of Object.entries(p ?? {})) s = s.split(`{${a}}`).join(String(b));
  return s;
};

export interface Choice { id: string; label: string }
export interface Msg { text: string; tone?: 'ok' | 'warn' | 'alert' }
export interface Turn { messages: Msg[]; choices: Choice[] }
type Phase = 'intro' | 'ex' | 'why' | 'consent' | 'video' | 'pickex' | 'end';
export interface Chat {
  kind: 'exercises' | 'video';
  lang: Lang; name: string; by: AnsweredBy; hours: number;
  steps: SState['steps'];
  /** the protocol's own skip reasons, offered when the patient stops */
  reasons: string[];
  s: SState;
  phase: Phase;
  /** the exercise a video is being requested for, and the phase to go back to afterwards */
  helpEx: string | null;
  back: Phase;
  page: number;
  startedMs: number;
  requests: FormRequest[];
}
export interface Ctx { nowMs: number; date: string; newId: () => string }

const PAGE = 8;
export function startChat(kind: Chat['kind'], patient: Patient, pack: ProtocolPack, lang: Lang, nowMs: number): { chat: Chat; turn: Turn } {
  const steps = planSteps(patient, pack);
  const chat: Chat = {
    kind, lang, name: patient.name.split(/\s+/)[0] ?? '', by: patient.caregiverMode ? 'caregiver' : 'patient', hours: reviewHours(pack),
    steps, reasons: pack.checkIn.skipReasons, s: startSession(steps, nowMs), phase: kind === 'exercises' ? 'intro' : 'pickex', helpEx: null, back: 'end', page: 0, startedMs: nowMs, requests: [],
  };
  if (kind === 'video') return { chat, turn: pickTurn(chat, [{ text: w(lang, 'videoIntro', { name: chat.name }), tone: 'warn' }]) };
  return { chat, turn: { messages: [{ text: w(lang, 'intro', { name: chat.name }) }], choices: [{ id: 'start', label: w(lang, 'start') }] } };
}

function pickTurn(c: Chat, pre: Msg[]): Turn {
  const ids = c.steps.map((s) => s.exerciseId);
  const slice = ids.slice(c.page * PAGE, c.page * PAGE + PAGE);
  const choices: Choice[] = slice.map((id) => ({ id: `ex:${id}`, label: exerciseName(id, c.lang).slice(0, 24) }));
  if ((c.page + 1) * PAGE < ids.length) choices.push({ id: 'more', label: wa(c.lang, 'waMore') });
  return { messages: [...pre, { text: w(c.lang, 'pickEx') }], choices };
}
function exerciseTurn(c: Chat, pre: Msg[] = []): Turn {
  const st = c.s.steps[c.s.i];
  return {
    messages: [...pre, { text: w(c.lang, 'prompt', { i: c.s.i + 1, n: c.s.steps.length, name: exerciseName(st.exerciseId, c.lang), dose: doseText(st, c.lang) }) }],
    choices: [{ id: 'done', label: w(c.lang, 'done') }, { id: 'stop', label: w(c.lang, 'stop').slice(0, 20) }, { id: 'help', label: w(c.lang, 'help') }],
  };
}
const consentTurn = (c: Chat): Turn => {
  const k = consentText(c.lang);
  return { messages: [{ text: `${k.title}\n\n${k.points.map((p) => `• ${p}`).join('\n')}` }], choices: [{ id: 'agree', label: w(c.lang, 'agree') }, { id: 'no', label: w(c.lang, 'no') }] };
};
function endTurn(c: Chat): Turn {
  const done = c.s.logs.filter(exerciseFinished).length;
  return { messages: [{ text: w(c.lang, 'all', { done, n: c.s.steps.length }), tone: 'ok' }], choices: [] };
}
/** After a pain-skipped exercise, move on: next exercise, or the end. */
function advance(c: Chat, pre: Msg[]): { chat: Chat; turn: Turn } {
  const s = answerPain(c.s, null);
  const next = { ...c, s };
  if (s.phase === 'done') return { chat: { ...next, phase: 'end' }, turn: { ...endTurn(next), messages: [...pre, ...endTurn(next).messages] } };
  return { chat: { ...next, phase: 'ex' }, turn: exerciseTurn(next, pre) };
}

/** One tap from the patient. Unknown or out-of-turn choices change nothing. */
export function stepChat(c: Chat, choice: string, ctx: Ctx): { chat: Chat; turn: Turn } {
  const same = (turn: Turn) => ({ chat: c, turn });
  const lang = c.lang;
  if (c.phase === 'intro' && choice === 'start') {
    if (!c.steps.length) return { chat: { ...c, phase: 'end' }, turn: { messages: [{ text: ss(lang, 'sNoExercises') }], choices: [] } };
    return { chat: { ...c, phase: 'ex', s: { ...c.s, phase: 'work' } }, turn: exerciseTurn(c) };
  }
  if (c.phase === 'ex') {
    if (choice === 'done') { const s = completeExercise({ ...c.s, phase: 'work' }); return advance({ ...c, s }, [{ text: ss(lang, 'eExDone'), tone: 'ok' }]); }
    if (choice === 'stop') return { chat: { ...c, phase: 'why' }, turn: { messages: [{ text: ss(lang, 'sStopWhy') }], choices: whyChoices(c) } };
    if (choice === 'help') return { chat: { ...c, phase: 'consent', helpEx: c.s.steps[c.s.i].exerciseId, back: 'ex' }, turn: consentTurn(c) };
  }
  if (c.phase === 'why') {
    const r = choice.startsWith('why:') ? choice.slice(4) : '';
    if (!c.reasons.includes(r)) return same({ messages: [], choices: whyChoices(c) });
    const s = stopExercise({ ...c.s, phase: 'work' }, r);
    return advance({ ...c, s }, [{ text: ss(lang, 'sStoppedMsg'), tone: 'warn' }]);
  }
  if (c.phase === 'pickex' && choice === 'more') {
    const page = (c.page + 1) * PAGE < c.steps.length ? c.page + 1 : 0;
    const n = { ...c, page };
    return { chat: n, turn: pickTurn(n, []) };
  }
  if (c.phase === 'pickex' && choice.startsWith('ex:')) {
    const id = choice.slice(3);
    if (!c.steps.some((s) => s.exerciseId === id)) return same(pickTurn(c, []));
    const n: Chat = { ...c, phase: 'consent', helpEx: id, back: 'end' };
    return { chat: n, turn: consentTurn(n) };
  }
  if (c.phase === 'consent') {
    if (choice === 'agree') return { chat: { ...c, phase: 'video' }, turn: { messages: [{ text: w(lang, 'sendVideo') }], choices: [{ id: 'sent', label: w(lang, 'videoSent') }, { id: 'skip', label: w(lang, 'skipVideo') }] } };
    if (choice === 'no') return after(c, [{ text: w(lang, 'declined') }]);
  }
  if (c.phase === 'video' && (choice === 'sent' || choice === 'skip')) {
    // Only a patient who agreed gets here. A skipped video sends nothing at all (there is no question to pass on).
    if (choice === 'skip') return after(c, [{ text: w(lang, 'declined') }]);
    const at = new Date(ctx.nowMs).toISOString();
    const req = newFormRequest({ id: ctx.newId(), exerciseId: c.helpEx!, at, note: w('en', 'note'), by: c.by, via: 'whatsapp', clip: null });
    const n = { ...c, requests: [...c.requests, req], s: c.helpEx && c.s.steps[c.s.i]?.exerciseId === c.helpEx ? struggled(c.s) : c.s };
    return after(n, [{ text: w(lang, 'thanks', { hours: c.hours }), tone: 'ok' }]);
  }
  return same({ messages: [], choices: currentChoices(c) });
}
/** A reason typed or tapped for stopping. Reasons are the protocol's own skip reasons. */
const whyChoices = (c: Chat): Choice[] => c.reasons.map((r) => ({ id: `why:${r}`, label: t(c.lang, `skip_${r}`).slice(0, 24) }));
const struggled = (s: SState): SState => ({ ...s, logs: s.logs.map((l, k) => (k === s.i ? { ...l, struggling: true } : l)) });
function after(c: Chat, pre: Msg[]): { chat: Chat; turn: Turn } {
  const n: Chat = { ...c, phase: c.back, helpEx: null };
  if (c.back === 'ex') return { chat: n, turn: exerciseTurn(n, pre) };
  return { chat: { ...n, phase: 'end' }, turn: { messages: pre, choices: [] } };
}
function currentChoices(c: Chat): Choice[] {
  switch (c.phase) {
    case 'intro': return [{ id: 'start', label: w(c.lang, 'start') }];
    case 'ex': return exerciseTurn(c).choices;
    case 'consent': return consentTurn(c).choices;
    case 'why': return whyChoices(c);
    case 'video': return [{ id: 'sent', label: w(c.lang, 'videoSent') }, { id: 'skip', label: w(c.lang, 'skipVideo') }];
    case 'pickex': return pickTurn(c, []).choices;
    default: return [];
  }
}
/** What a finished chat leaves behind: the session record (if any exercise was reached) and any video requests. */
export function chatResult(c: Chat, ctx: Ctx): { session: SessionLog | null; requests: FormRequest[] } {
  if (c.kind !== 'exercises') return { session: null, requests: c.requests };
  const log = toSessionLog(c.s, ctx.date, ctx.nowMs, c.by, 'whatsapp');
  return { session: log.exercises.some((l) => l.repsDone > 0 || l.stopped) ? log : null, requests: c.requests };
}
