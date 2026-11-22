// WhatsApp channel strings. English, Hindi and Bengali for everything a patient reads.
// Hindi and Bengali are drafts: NEEDS_NATIVE_REVIEW (listed in WHATSAPP.md). A test checks that all three languages have every key.
import type { Lang } from '../types';

type Dict = Record<string, string>;
export const waEn: Dict = {
  waWho: 'Who is replying?',
  waWhoPatient: 'I am {name}',
  waWhoCare: 'A family member',
  waStart: 'Start check-in',
  waPick: 'Pick a number',
  waAllEx: "Did you do all of today's exercises?",
  waDidEx: 'Did you do "{name}"?',
  waWhyNot: 'Why could you not do "{name}"?',
  waWhyAll: 'Why could you not do the exercises today?',
  waWhy: 'Why could you not do them today?',
  waHardest: 'Which movement was hardest today?',
  waSignsYes: 'Yes, at least one',
  waSignQ: 'Do you have: {sign}?',
  waThanksOn: 'Thank you. See you tomorrow.',
  waThanksReview: 'Thank you. Your physio will look at this within {h} hours.',
  waThanksUrgent: 'Thank you. Your physio team has been told and will get in touch within {h} hours.',
  waToldSafety: 'Your physio team has been told.',
  waMore: 'More…',
};
export const waHi: Dict = {
  waWho: 'जवाब कौन दे रहा है?',
  waWhoPatient: 'मैं {name} हूँ',
  waWhoCare: 'परिवार का कोई सदस्य',
  waStart: 'चेक-इन शुरू करें',
  waPick: 'एक संख्या चुनें',
  waAllEx: 'क्या आपने आज के सारे व्यायाम किए?',
  waDidEx: 'क्या आपने "{name}" किया?',
  waWhyNot: 'आप "{name}" क्यों नहीं कर पाए?',
  waWhyAll: 'आप आज व्यायाम क्यों नहीं कर पाए?',
  waWhy: 'आप आज क्यों नहीं कर पाए?',
  waHardest: 'आज सबसे कठिन हरकत कौन सी थी?',
  waSignsYes: 'हाँ, कम से कम एक',
  waSignQ: 'क्या आपको यह है: {sign}?',
  waThanksOn: 'धन्यवाद। कल मिलते हैं।',
  waThanksReview: 'धन्यवाद। आपके फ़िज़ियो {h} घंटे के भीतर इसे देखेंगे।',
  waThanksUrgent: 'धन्यवाद। आपकी फ़िज़ियो टीम को बता दिया गया है और वे {h} घंटे के भीतर संपर्क करेंगे।',
  waToldSafety: 'आपकी फ़िज़ियो टीम को बता दिया गया है।',
  waMore: 'और देखें…',
};
export const waBn: Dict = {
  waWho: 'কে উত্তর দিচ্ছেন?',
  waWhoPatient: 'আমি {name}',
  waWhoCare: 'পরিবারের একজন সদস্য',
  waStart: 'চেক-ইন শুরু করুন',
  waPick: 'একটি সংখ্যা বাছুন',
  waAllEx: 'আপনি কি আজকের সব ব্যায়াম করেছেন?',
  waDidEx: 'আপনি কি "{name}" করেছেন?',
  waWhyNot: 'আপনি "{name}" কেন করতে পারেননি?',
  waWhyAll: 'আপনি আজ ব্যায়াম কেন করতে পারেননি?',
  waWhy: 'আপনি আজ কেন করতে পারেননি?',
  waHardest: 'আজ কোন নড়াচড়াটা সবচেয়ে কঠিন ছিল?',
  waSignsYes: 'হ্যাঁ, অন্তত একটি',
  waSignQ: 'আপনার কি এটি হয়েছে: {sign}?',
  waThanksOn: 'ধন্যবাদ। কাল দেখা হবে।',
  waThanksReview: 'ধন্যবাদ। আপনার ফিজিও {h} ঘণ্টার মধ্যে এটি দেখবেন।',
  waThanksUrgent: 'ধন্যবাদ। আপনার ফিজিও দলকে জানানো হয়েছে, তাঁরা {h} ঘণ্টার মধ্যে যোগাযোগ করবেন।',
  waToldSafety: 'আপনার ফিজিও দলকে জানানো হয়েছে।',
  waMore: 'আরও দেখুন…',
};
export const WA: Record<Lang, Dict> = { en: waEn, hi: waHi, bn: waBn };

export function wa(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let s = WA[lang][key] ?? waEn[key] ?? key;
  for (const [k, v] of Object.entries(params ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
}
