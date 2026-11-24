/**
 * Form-check video requests as pure logic. A patient who is struggling with an exercise can send a short clip and a note; the physio
 * watches it, ticks cues and writes a reply. Nothing here touches triage: a video request never changes a tier, a plan or an
 * emergency answer, and it is not a way to report a warning sign. (The screens say so, and point to 112 for emergencies.)
 *
 * NEEDS_PHYSIO_SIGNOFF: the retention days, the review time and every cue below are placeholders for the physio to confirm.
 * NEEDS_LEGAL_REVIEW: the consent text is a draft. NEEDS_NATIVE_REVIEW: Hindi and Bengali wording.
 */
import type { AnsweredBy, FormClip, FormRequest, Lang, Patient, ProtocolPack } from '../types';
import { addDays } from '../engine/dates';
import { withAuditNote, type Ctx } from '../engine/plan';

export const FORM_CONFIG = {
  /** A clip is deleted this many days after it was sent, if nobody has replied. */
  clipKeepDays: 30,
  /** After the physio replies, the clip is deleted this many days later. */
  afterReplyDays: 7,
  maxBytes: 25 * 1024 * 1024,
  /** Longest video a patient can send, in seconds (camera check safety round). */
  maxClipSec: 30,
  maxNote: 500,
  maxReply: 1000,
  mimeOk: ['video/mp4', 'video/webm', 'video/quicktime'] as string[],
  consentVersion: '2026-11-video-v1',
} as const;

export const CONSENT_TEXT: Record<Lang, { title: string; points: string[]; agree: string; draft: string }> = {
  en: {
    title: 'Before you send a video',
    points: [
      'Your physio will watch this clip to help with your exercise. Nobody else on the team sees it unless your physio decides to ask them.',
      'It is stored privately, and deleted automatically {days} days after you send it (or {after} days after your physio replies). You can delete it yourself at any time.',
      'Make sure no one else is in the picture. Your face may be in it; record only the exercise.',
      'Sending a video is optional. You can still do your check-in without it.',
      'This is not for emergencies. If you have chest pain, trouble breathing, or something frightening, call 112 or go to the nearest hospital.',
    ],
    agree: 'I agree to send this video to my physio',
    draft: 'Draft wording, to be checked by a lawyer before real patients use it.',
  },
  hi: {
    title: 'वीडियो भेजने से पहले',
    points: [
      'आपके फ़िज़ियो आपके व्यायाम में मदद के लिए यह क्लिप देखेंगे। जब तक फ़िज़ियो न चाहें, टीम में कोई और इसे नहीं देखेगा।',
      'यह निजी तौर पर रखा जाता है और भेजने के {days} दिन बाद (या फ़िज़ियो के जवाब के {after} दिन बाद) अपने आप मिट जाता है। आप कभी भी इसे खुद मिटा सकते हैं।',
      'ध्यान रखें कि तस्वीर में कोई और न हो। आपका चेहरा दिख सकता है; सिर्फ़ व्यायाम रिकॉर्ड करें।',
      'वीडियो भेजना ज़रूरी नहीं है। इसके बिना भी आप चेक-इन कर सकते हैं।',
      'यह आपातकाल के लिए नहीं है। सीने में दर्द, साँस में तकलीफ़ या कुछ डरावना हो तो 112 पर कॉल करें या नज़दीकी अस्पताल जाएँ।',
    ],
    agree: 'मैं यह वीडियो अपने फ़िज़ियो को भेजने के लिए सहमत हूँ',
    draft: 'मसौदा शब्दावली; असली मरीज़ों के उपयोग से पहले वकील से जँचवाएँ।',
  },
  bn: {
    title: 'ভিডিও পাঠানোর আগে',
    points: [
      'আপনার ব্যায়ামে সাহায্য করতে আপনার ফিজিও এই ক্লিপ দেখবেন। ফিজিও না চাইলে দলের আর কেউ এটি দেখবেন না।',
      'এটি গোপনে রাখা হয় এবং পাঠানোর {days} দিন পরে (বা ফিজিওর উত্তরের {after} দিন পরে) নিজে থেকেই মুছে যায়। আপনি যেকোনো সময় নিজেই মুছতে পারেন।',
      'খেয়াল রাখুন ছবিতে যেন আর কেউ না থাকে। আপনার মুখ দেখা যেতে পারে; শুধু ব্যায়ামটি রেকর্ড করুন।',
      'ভিডিও পাঠানো ঐচ্ছিক। এটি ছাড়াও আপনি চেক-ইন করতে পারেন।',
      'এটি জরুরি অবস্থার জন্য নয়। বুকে ব্যথা, শ্বাসকষ্ট বা ভয়ের কিছু হলে 112-এ ফোন করুন বা কাছের হাসপাতালে যান।',
    ],
    agree: 'আমি এই ভিডিও আমার ফিজিওকে পাঠাতে রাজি',
    draft: 'খসড়া ভাষা; আসল রোগীরা ব্যবহারের আগে আইনজীবীকে দিয়ে দেখিয়ে নিন।',
  },
};

/** Generic form-check cues the physio can tick. NEEDS_PHYSIO_SIGNOFF. They give no diagnosis and no new limits. */
export const CUES: { id: string; en: string; hi: string; bn: string }[] = [
  { id: 'slow', en: 'Move slowly and stay in control, both going up and coming back.', hi: 'धीरे और नियंत्रण में करें, ऊपर जाते और वापस आते दोनों समय।', bn: 'ধীরে ও নিয়ন্ত্রণে করুন, ওঠা ও নামা দুই সময়েই।' },
  { id: 'range', en: 'Only go as far as is comfortable. Stop short of sharp pain.', hi: 'उतना ही करें जितना आरामदायक हो। तेज़ दर्द से पहले रुक जाएँ।', bn: 'যতটা আরামদায়ক ততটাই করুন। তীব্র ব্যথার আগেই থামুন।' },
  { id: 'align', en: 'Keep your knee and foot lined up, as in the demonstration.', hi: 'घुटना और पैर एक सीध में रखें, जैसा डेमो में दिखाया है।', bn: 'ডেমোতে যেমন দেখানো আছে, হাঁটু ও পা এক সারিতে রাখুন।' },
  { id: 'breathe', en: 'Keep breathing. Do not hold your breath.', hi: 'साँस लेते रहें। साँस न रोकें।', bn: 'শ্বাস নিতে থাকুন। দম আটকে রাখবেন না।' },
  { id: 'start', en: 'Check your starting position before each repetition.', hi: 'हर बार शुरू करने से पहले अपनी शुरुआती स्थिति देखें।', bn: 'প্রতিবার শুরুর আগে আপনার শুরুর অবস্থান দেখে নিন।' },
  { id: 'again', en: 'Please record another short clip after trying this.', hi: 'यह आज़माने के बाद एक और छोटी क्लिप भेजें।', bn: 'এটি চেষ্টা করার পর আরেকটি ছোট ক্লিপ পাঠান।' },
  { id: 'good', en: 'This looks fine to carry on with.', hi: 'इसे जारी रखना ठीक लग रहा है।', bn: 'এটি চালিয়ে যাওয়া ঠিক মনে হচ্ছে।' },
];
export const cueText = (id: string, lang: Lang): string => { const c = CUES.find((x) => x.id === id); return c ? c[lang] : ''; };
export const consentText = (lang: Lang) => {
  const c = CONSENT_TEXT[lang];
  return { ...c, points: c.points.map((s) => s.split('{days}').join(String(FORM_CONFIG.clipKeepDays)).split('{after}').join(String(FORM_CONFIG.afterReplyDays))) };
};

const dateOf = (iso: string) => iso.slice(0, 10);

export function validClip(mime: string, size: number): string | null {
  if (!FORM_CONFIG.mimeOk.includes(mime.split(';')[0].toLowerCase())) return 'type';
  if (size <= 0) return 'empty';
  if (size > FORM_CONFIG.maxBytes) return 'size';
  return null;
}

export function newFormRequest(a: { id: string; exerciseId: string; at: string; note: string; by: AnsweredBy; clip: Omit<FormClip, 'deleteAfter'> | null; via?: 'app' | 'whatsapp' }): FormRequest {
  return {
    id: a.id, exerciseId: a.exerciseId, at: a.at, note: a.note.trim().slice(0, FORM_CONFIG.maxNote),
    consent: { by: a.by, at: a.at, version: FORM_CONFIG.consentVersion }, ...(a.via ? { via: a.via } : {}),
    clip: a.clip ? { ...a.clip, deleteAfter: addDays(dateOf(a.at), FORM_CONFIG.clipKeepDays) } : null,
  };
}
export const addFormRequest = (p: Patient, r: FormRequest): Patient => ({ ...p, formRequests: [...(p.formRequests ?? []).filter((x) => x.id !== r.id), r] });

/** Hours the physio has to look at a clip: the pack's REVIEW response time (nothing new invented). */
export const reviewHours = (pack: ProtocolPack): number => pack.responseHours.REVIEW.hours;
export const dueAtMs = (r: FormRequest, pack: ProtocolPack): number => Date.parse(r.at) + reviewHours(pack) * 3600_000;
export const isPending = (r: FormRequest): boolean => !r.reply;
export const isOverdue = (r: FormRequest, pack: ProtocolPack, nowMs: number): boolean => isPending(r) && nowMs > dueAtMs(r, pack);
export const pendingForms = (p: Patient): FormRequest[] => (p.formRequests ?? []).filter(isPending);

/** The physio replies. The clip is then kept only a few more days. Recorded in the audit log; the plan and tier are untouched. */
export function replyToForm(p: Patient, id: string, a: { by: string; text: string; points: string[]; at: string }, ctx: Ctx): Patient {
  const r = (p.formRequests ?? []).find((x) => x.id === id);
  if (!r || r.reply) return p;
  const known = new Set(CUES.map((c) => c.id));
  const reply = { at: a.at, by: a.by.slice(0, 80), text: a.text.trim().slice(0, FORM_CONFIG.maxReply), points: a.points.filter((x) => known.has(x)) };
  if (!reply.text && reply.points.length === 0) return p;
  const soon = addDays(dateOf(a.at), FORM_CONFIG.afterReplyDays);
  const clip = r.clip ? { ...r.clip, deleteAfter: r.clip.deleteAfter < soon ? r.clip.deleteAfter : soon } : null;
  const next = { ...p, formRequests: (p.formRequests ?? []).map((x) => (x.id === id ? { ...x, reply, clip } : x)) };
  return withAuditNote(next, 'form-reply', `Replied to a form-check video (${r.exerciseId})`, null, { cues: reply.points }, '', ctx);
}
/** Delete the clip (either side, or the retention rule). The request and any reply stay as a record. */
export const deleteClip = (p: Patient, id: string, at: string): Patient => ({
  ...p, formRequests: (p.formRequests ?? []).map((x) => (x.id === id && x.clip ? { ...x, clip: null, clipGone: at } : x)),
});
export const markReplySeen = (p: Patient, id: string, at: string): Patient => ({
  ...p, formRequests: (p.formRequests ?? []).map((x) => (x.id === id && x.reply && !x.replySeenAt ? { ...x, replySeenAt: at } : x)),
});
/** Clips whose delete-by date has come. */
export const expiredClips = (p: Patient, today: string): FormRequest[] => (p.formRequests ?? []).filter((r) => r.clip && r.clip.deleteAfter <= today);
export const unreadReplies = (p: Patient): FormRequest[] => (p.formRequests ?? []).filter((r) => r.reply && !r.replySeenAt);
