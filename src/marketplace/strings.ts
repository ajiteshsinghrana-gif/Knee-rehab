/** Patient-facing wording for the Marketplace tab. English and Hindi are required; Bengali falls back like everywhere else in the app. */
import type { Bi, Lang } from '../types';
import { L } from '../i18n';

export const S = {
  find: { en: 'Find a physio', hi: 'फिज़ियो खोजें' },
  freeCheck: { en: 'Free quick check', hi: 'मुफ़्त त्वरित जाँच' },
  intro: { en: 'Answer a few questions. We check for warning signs first, then show physiotherapists who fit what you need.', hi: 'कुछ सवालों के जवाब दें। हम पहले चेतावनी के संकेत देखते हैं, फिर आपकी ज़रूरत के हिसाब से फिज़ियोथेरेपिस्ट दिखाते हैं।' },
  start: { en: 'Start', hi: 'शुरू करें' },
  stepOf: { en: 'Step {n} of {total}', hi: 'चरण {n} / {total}' },
  qArea: { en: 'Where is the problem?', hi: 'समस्या कहाँ है?' },
  qDuration: { en: 'How long has it lasted?', hi: 'यह कितने समय से है?' },
  qSeverity: { en: 'How bad is the pain right now?', hi: 'अभी दर्द कितना है?' },
  sev0: { en: '0 = no pain', hi: '0 = दर्द नहीं' },
  sev10: { en: '10 = worst', hi: '10 = सबसे ज़्यादा' },
  qFunction: { en: 'Does it stop you doing daily activities?', hi: 'क्या इससे रोज़ के काम रुकते हैं?' },
  qSurgery: { en: 'Surgery on this area in the last 12 weeks?', hi: 'पिछले 12 हफ़्तों में इस हिस्से की सर्जरी हुई है?' },
  qPrior: { en: 'Has this problem come and gone before?', hi: 'क्या यह समस्या पहले भी आकर जा चुकी है?' },
  qFlags: { en: 'Does any of this apply to you right now?', hi: 'क्या अभी इनमें से कुछ आप पर लागू होता है?' },
  flagsHint: { en: 'Tick everything that applies. If nothing does, just continue.', hi: 'जो भी लागू हो उस पर निशान लगाएँ। कुछ नहीं तो आगे बढ़ें।' },
  yes: { en: 'Yes', hi: 'हाँ' },
  no: { en: 'No', hi: 'नहीं' },
  next: { en: 'Next', hi: 'आगे' },
  back: { en: 'Back', hi: 'पीछे' },
  seeResult: { en: 'See my result', hi: 'मेरा नतीजा देखें' },
  startOver: { en: 'Start again', hi: 'फिर से शुरू करें' },
  whyThis: { en: 'Why we say this', hi: 'हम ऐसा क्यों कह रहे हैं' },
  noBooking: { en: 'Booking is switched off while a warning sign is present.', hi: 'चेतावनी का संकेत होने पर बुकिंग बंद है।' },
  findPhysios: { en: 'Physiotherapists for you', hi: 'आपके लिए फिज़ियोथेरेपिस्ट' },
  showAnyway: { en: 'I would still like to see a physiotherapist', hi: 'फिर भी मैं फिज़ियोथेरेपिस्ट देखना चाहता/चाहती हूँ' },
  visitType: { en: 'Visit type', hi: 'विज़िट का प्रकार' },
  anyType: { en: 'Any', hi: 'कोई भी' },
  online: { en: 'Online', hi: 'ऑनलाइन' },
  clinic: { en: 'At clinic', hi: 'क्लिनिक में' },
  home: { en: 'Home visit', hi: 'घर पर' },
  yourArea: { en: 'Your area', hi: 'आपका इलाक़ा' },
  budget: { en: 'Budget', hi: 'बजट' },
  anyBudget: { en: 'Any budget', hi: 'कोई भी बजट' },
  upTo: { en: 'Up to ₹{n}', hi: '₹{n} तक' },
  verified: { en: 'Verified', hi: 'सत्यापित' },
  featured: { en: 'Featured', hi: 'विशेष' },
  from: { en: 'from ₹{n}', hi: '₹{n} से' },
  yearsExp: { en: '{n} years', hi: '{n} साल का अनुभव' },
  nextFree: { en: 'Next free', hi: 'अगला खाली समय' },
  noSlots: { en: 'No free time this week', hi: 'इस हफ़्ते कोई समय खाली नहीं' },
  noMatch: { en: 'No physiotherapist fits these filters. Try a wider budget or another visit type.', hi: 'इन फ़िल्टर में कोई फिज़ियोथेरेपिस्ट नहीं मिला। बजट बढ़ाएँ या दूसरा विज़िट प्रकार चुनें।' },
  book: { en: 'Book', hi: 'बुक करें' },
  close: { en: 'Close', hi: 'बंद करें' },
  chooseTime: { en: 'Choose a time', hi: 'समय चुनें' },
  yourName: { en: 'Your name', hi: 'आपका नाम' },
  yourMobile: { en: 'Mobile number', hi: 'मोबाइल नंबर' },
  consent: { en: 'I agree to share this check\'s summary with the physiotherapist.', hi: 'मैं इस जाँच का सार फिज़ियोथेरेपिस्ट के साथ साझा करने के लिए सहमत हूँ।' },
  confirm: { en: 'Confirm booking', hi: 'बुकिंग पक्की करें' },
  booked: { en: 'Booked', hi: 'बुकिंग हो गई' },
  bookedBody: { en: '{name} on {date} at {time} ({mode}), fee ₹{fee}. Payments are not switched on in this demo.', hi: '{name}, {date} को {time} बजे ({mode}), फ़ीस ₹{fee}। इस डेमो में भुगतान चालू नहीं है।' },
  demoNote: { en: 'Demo: the physiotherapists and bookings here are made up and stay on this device.', hi: 'डेमो: यहाँ के फिज़ियोथेरेपिस्ट और बुकिंग काल्पनिक हैं और इसी डिवाइस पर रहते हैं।' },
  noPhysiosLive: { en: 'No verified physiotherapists yet. A physiotherapist registers in the Admin view and is shown here once verified.', hi: 'अभी कोई सत्यापित फिज़ियोथेरेपिस्ट नहीं है। फिज़ियोथेरेपिस्ट Admin व्यू में रजिस्टर करता है और सत्यापन के बाद यहाँ दिखता है।' },
  emergencyCall: { en: 'Call 112', hi: '112 पर कॉल करें' },
} satisfies Record<string, Bi>;

export type SKey = keyof typeof S;
export const tr = (k: SKey, lang: Lang, params?: Record<string, string | number>): string => {
  let s = L(S[k], lang);
  for (const [a, b] of Object.entries(params ?? {})) s = s.replace(`{${a}}`, String(b));
  return s;
};
