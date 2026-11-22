// Message templates for the WhatsApp Business Platform (Cloud API).
// Business-started messages must use a template that Meta has approved, so these are what you submit for approval.
// Keep them short, free of clinical detail (phones are shared; lock screens show text) and in the "utility" category.
// Hindi and Bengali wording is a draft: NEEDS_NATIVE_REVIEW.
import type { Bi, Lang } from '../types';
import { L } from '../i18n';

export interface WaTemplate {
  /** Name submitted to Meta: lower case, digits and underscores only. */
  name: string;
  /** What it is for (shown to the physio). */
  purpose: string;
  /** Body text with {{1}}, {{2}}... placeholders. */
  body: Bi;
  /** Quick-reply buttons attached to the template (at most 3). */
  buttons: Bi[];
  /** What each placeholder means, in order. */
  vars: string[];
}

export const TEMPLATES: WaTemplate[] = [
  {
    name: 'rp_checkin_prompt',
    purpose: 'Opens the daily check-in',
    body: {
      en: 'Hi {{1}}, time for your daily check-in. It takes under a minute.',
      hi: '{{1}}, आज के दैनिक चेक-इन का समय हो गया है। इसमें एक मिनट से कम लगेगा।',
      bn: '{{1}}, আজকের দৈনিক চেক-ইনের সময় হয়েছে। এতে এক মিনিটের কম লাগবে।',
    },
    buttons: [{ en: 'Start check-in', hi: 'चेक-इन शुरू करें', bn: 'চেক-ইন শুরু করুন' }],
    vars: ['Patient first name'],
  },
  {
    name: 'rp_daily_reminder',
    purpose: 'Morning nudge for the day’s exercises',
    body: {
      en: "Hi {{1}}, it is time for today's exercises. There are {{2}} today.",
      hi: 'नमस्ते {{1}}। आज के व्यायाम का समय हो गया है। आज {{2}} व्यायाम हैं।',
      bn: 'নমস্কার {{1}}। আজকের ব্যায়ামের সময় হয়েছে। আজ {{2}}টি ব্যায়াম আছে।',
    },
    buttons: [{ en: 'Started', hi: 'शुरू कर दिया', bn: 'শুরু করেছি' }, { en: "Can't today", hi: 'आज नहीं कर पाऊँगी', bn: 'আজ পারব না' }],
    vars: ['Patient first name', 'Number of exercises today'],
  },
  {
    name: 'rp_missed_checkin',
    purpose: 'First nudge after a missed check-in',
    body: {
      en: '{{1}}, we did not get your check-in today. Is everything all right?',
      hi: '{{1}}, आज आपका चेक-इन नहीं मिला। सब ठीक है न?',
      bn: '{{1}}, আজ আপনার চেক-ইন পাওয়া যায়নি। সব ঠিক আছে তো?',
    },
    buttons: [{ en: 'I am fine', hi: 'मैं ठीक हूँ', bn: 'আমি ভালো আছি' }, { en: 'I need help', hi: 'मुझे मदद चाहिए', bn: 'আমার সাহায্য দরকার' }, { en: 'Call me', hi: 'मुझे फ़ोन करें', bn: 'আমাকে ফোন করুন' }],
    vars: ['Patient first name'],
  },
  {
    name: 'rp_appointment',
    purpose: 'Visit reminder',
    body: {
      en: 'Hi {{1}}, your physiotherapy visit is on {{2}} at {{3}}.',
      hi: 'नमस्ते {{1}}। आपकी फ़िज़ियोथेरेपी की मुलाकात {{2}} को {{3}} बजे है।',
      bn: 'নমস্কার {{1}}। আপনার ফিজিওথেরাপির সময় {{2}} তারিখ {{3}} টায়।',
    },
    buttons: [],
    vars: ['Patient first name', 'Date', 'Time'],
  },
  {
    name: 'rp_plan_changed',
    purpose: 'The physio changed the plan',
    body: {
      en: 'Hi {{1}}, your physio has updated your plan. Open RehabPath to see what changed.',
      hi: 'नमस्ते {{1}}। आपकी फ़िज़ियोथेरेपिस्ट ने आपकी योजना बदली है। बदलाव देखने के लिए RehabPath खोलें।',
      bn: 'নমস্কার {{1}}। আপনার ফিজিওথেরাপিস্ট আপনার পরিকল্পনা বদলেছেন। কী বদলেছে দেখতে RehabPath খুলুন।',
    },
    buttons: [],
    vars: ['Patient first name'],
  },
  {
    name: 'rp_form_reply',
    purpose: 'The physio replied to a form-check video',
    body: {
      en: 'Hi {{1}}, your physio replied to your video. Open RehabPath to read it.',
      hi: 'नमस्ते {{1}}। आपके फ़िज़ियो ने आपके वीडियो का जवाब दिया है। पढ़ने के लिए RehabPath खोलें।',
      bn: 'নমস্কার {{1}}। আপনার ফিজিও আপনার ভিডিওর উত্তর দিয়েছেন। পড়তে RehabPath খুলুন।',
    },
    buttons: [],
    vars: ['Patient first name'],
  },
];

export const templateByName = (name: string): WaTemplate | undefined => TEMPLATES.find((t) => t.name === name);

/** Fills {{1}}, {{2}}... in the template body for a language. */
export function renderTemplate(tpl: WaTemplate, lang: Lang, vars: string[]): string {
  return L(tpl.body, lang).replace(/\{\{(\d+)\}\}/g, (_, n: string) => vars[Number(n) - 1] ?? '');
}
export const templateButtons = (tpl: WaTemplate, lang: Lang): string[] => tpl.buttons.map((b) => L(b, lang));
export const firstName = (full: string): string => full.trim().split(/\s+/)[0] ?? full;
