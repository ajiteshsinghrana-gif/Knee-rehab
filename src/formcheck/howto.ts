/**
 * What to do, in plain words, for every camera-checked exercise: the starting position, then the movement.
 * Shown on the screen before and during the camera set. Draft wording: a physio should read each line, and Hindi and Bengali need a native reader.
 */
import type { Lang } from '../types';
import type { FormKind } from './config';

type Step = { start: string; move: string };

const en: Record<FormKind, Step> = {
  slr: { start: 'Lie on your back with the side you are checking towards the phone. Bend the other knee with the foot flat. Keep the leg you are checking straight on the floor.', move: 'Tighten the thigh and lift the straight leg up to the height of the bent knee. Hold a moment, then lower slowly.' },
  squat: { start: 'Stand facing the phone, feet about shoulder-width apart, arms by your sides. Stand still.', move: 'Bend your knees and sit back as if onto a chair, only as far as is comfortable. Then stand up slowly.' },
  'squat-side': { start: 'Stand sideways to the phone, feet about shoulder-width apart, arms in front or by your sides. Stand still.', move: 'Bend your knees and sit back as if onto a chair, only as far as is comfortable. Then stand up slowly.' },
  'shoulder-abduction': { start: 'Stand facing the phone, arms straight by your sides. Stand still.', move: 'Raise one arm out to the side, as high as is comfortable (up to shoulder height). Lower it slowly.' },
  'knee-flex': { start: 'Lie on your back with the side you are checking towards the phone, legs straight. Lie still.', move: 'Slide the heel towards your bottom to bend the knee as far as is comfortable. Then slide it back to straight.' },
  'sit-to-stand': { start: 'Sit on a firm chair facing the phone, feet flat on the floor, arms folded or in front of you. Sit still.', move: 'Lean forward a little and stand up. Then sit down slowly.' },
  lunge: { start: 'Stand facing the phone, feet together, near a support you can hold. Stand still.', move: 'Step one foot forward, bend both knees to lower down a little, then push back to the start.' },
  'lunge-side': { start: 'Stand sideways to the phone, feet together, near a support you can hold. Stand still.', move: 'Step one foot forward, bend both knees to lower down a little, then push back to the start.' },
  'step-up': { start: 'Stand facing the phone, in front of a low, firm step. Stand still.', move: 'Step one foot up, bring the other up, then step back down one foot at a time.' },
  'shoulder-flexion': { start: 'Stand sideways to the phone, arm straight by your side. Stand still.', move: 'Raise the arm forward and up as high as is comfortable. Lower it slowly.' },
  'hip-abduction': { start: 'Stand facing the phone, holding a support, legs straight and together. Stand still.', move: 'Move one leg out to the side, keeping the knee straight and the body upright. Bring it back slowly.' },
  bridging: { start: 'Lie on your back with the side you are checking towards the phone. Knees bent, feet flat on the floor. Lie still.', move: 'Lift your hips up until your body is in a line from shoulders to knees. Hold a moment, then lower slowly.' },
  'calf-raise': { start: 'Stand facing the phone, feet hip-width apart, near a support. Stand still.', move: 'Rise up onto your toes, hold a moment, then lower your heels slowly.' },
  balance: { start: 'Stand facing the phone next to a support, feet together. Stand still.', move: 'Lift one foot off the floor and hold. Keep your body upright. Put the foot down to finish a hold.' },
  'balance-line': { start: 'Stand facing the phone next to a support, with one foot in front of the other in a line. Stand still.', move: 'Hold the position without stepping out of the line.' },
  walking: { start: 'Stand sideways to the phone with room to walk across the picture.', move: 'Walk across the picture at your normal pace, then turn and walk back.' },
  'ankle-pump': { start: 'Sit or lie with your foot in view from the side, leg supported and relaxed. Keep still.', move: 'Point your toes away from you, then pull them back towards you. Keep the knee still.' },
  pendulum: { start: 'Lean forward holding a table with your good arm, the other arm hanging loose. Stay still.', move: 'Let the hanging arm swing gently forward and back, or in small circles, using your body, not the arm muscles.' },
  cycle: { start: 'Sit on the bike side-on to the phone, feet on the pedals. Sit still.', move: 'Pedal at an easy, steady pace.' },
  plank: { start: 'Get into the plank position side-on to the phone, on your forearms and knees or toes. Hold still.', move: 'Keep your body in a straight line from shoulders to ankles and hold.' },
  'bird-dog': { start: 'Go on hands and knees side-on to the phone, back flat. Stay still.', move: 'Reach one arm forward and the opposite leg back, keeping your back flat. Hold, then return.' },
  'hand-fist': { start: 'Hold your whole hand up open in front of the phone, palm towards it. Hold still.', move: 'Close your hand into a fist, then open it fully again.' },
  wrist: { start: 'Rest your forearm on a table side-on to the phone, hand hanging over the edge. Keep the forearm still.', move: 'Bend the wrist up, then down, slowly.' },
  elbow: { start: 'Stand or sit side-on to the phone, upper arm by your side, elbow straight. Keep still.', move: 'Bend the elbow to bring the hand towards the shoulder, then straighten it slowly.' },
  scap: { start: 'Stand with your back to the phone, arms by your sides, shoulders relaxed. Stand still.', move: 'Squeeze your shoulder blades together, hold a moment, then relax.' },
  'band-rot': { start: 'Stand facing the phone, elbow bent at a right angle and tucked into your side, holding the band. Stand still.', move: 'Turn your forearm outwards, keeping the elbow at your side. Return slowly.' },
};

const hi: Record<FormKind, Step> = {
  slr: { start: 'पीठ के बल लेटें, जिस तरफ़ की जाँच करनी है वह फ़ोन की ओर रहे। दूसरा घुटना मोड़कर पैर ज़मीन पर रखें। जाँच वाला पैर सीधा ज़मीन पर रखें।', move: 'जाँघ कसें और सीधे पैर को मुड़े घुटने की ऊँचाई तक उठाएँ। एक पल रुकें, फिर धीरे से नीचे लाएँ।' },
  squat: { start: 'फ़ोन की ओर मुँह करके खड़े हों, पैर कंधों जितने खुले, हाथ बगल में। स्थिर खड़े रहें।', move: 'घुटने मोड़ें और कुर्सी पर बैठने की तरह पीछे जाएँ, जितना आराम से हो सके। फिर धीरे से खड़े हों।' },
  'squat-side': { start: 'फ़ोन की ओर बगल से खड़े हों, पैर कंधों जितने खुले, हाथ आगे या बगल में। स्थिर खड़े रहें।', move: 'घुटने मोड़ें और कुर्सी पर बैठने की तरह पीछे जाएँ, जितना आराम से हो सके। फिर धीरे से खड़े हों।' },
  'shoulder-abduction': { start: 'फ़ोन की ओर मुँह करके खड़े हों, हाथ सीधे बगल में। स्थिर खड़े रहें।', move: 'एक हाथ को बग़ल की ओर उठाएँ, जितना आराम से हो सके (कंधे की ऊँचाई तक)। धीरे से नीचे लाएँ।' },
  'knee-flex': { start: 'पीठ के बल लेटें, जाँच वाली तरफ़ फ़ोन की ओर, पैर सीधे। स्थिर लेटे रहें।', move: 'एड़ी को नितंब की ओर खिसकाकर घुटना जितना आराम से हो सके मोड़ें। फिर वापस सीधा करें।' },
  'sit-to-stand': { start: 'फ़ोन की ओर मुँह करके मज़बूत कुर्सी पर बैठें, पैर ज़मीन पर सपाट, हाथ मोड़े हुए या आगे। स्थिर बैठे रहें।', move: 'थोड़ा आगे झुकें और खड़े हों। फिर धीरे से बैठें।' },
  lunge: { start: 'फ़ोन की ओर मुँह करके खड़े हों, पैर साथ, पकड़ने के लिए सहारा पास हो। स्थिर खड़े रहें।', move: 'एक पैर आगे रखें, दोनों घुटने मोड़कर थोड़ा नीचे जाएँ, फिर वापस शुरुआत में आएँ।' },
  'lunge-side': { start: 'फ़ोन की ओर बगल से खड़े हों, पैर साथ, पकड़ने के लिए सहारा पास हो। स्थिर खड़े रहें।', move: 'एक पैर आगे रखें, दोनों घुटने मोड़कर थोड़ा नीचे जाएँ, फिर वापस शुरुआत में आएँ।' },
  'step-up': { start: 'फ़ोन की ओर मुँह करके एक नीची, मज़बूत सीढ़ी के सामने खड़े हों। स्थिर खड़े रहें।', move: 'एक पैर ऊपर रखें, दूसरा भी ऊपर लाएँ, फिर एक-एक पैर करके नीचे उतरें।' },
  'shoulder-flexion': { start: 'फ़ोन की ओर बगल से खड़े हों, हाथ सीधा बगल में। स्थिर खड़े रहें।', move: 'हाथ को आगे से ऊपर उठाएँ, जितना आराम से हो सके। धीरे से नीचे लाएँ।' },
  'hip-abduction': { start: 'फ़ोन की ओर मुँह करके सहारा पकड़कर खड़े हों, पैर सीधे और साथ। स्थिर खड़े रहें।', move: 'एक पैर को बग़ल में ले जाएँ, घुटना सीधा और शरीर सीधा रखें। धीरे से वापस लाएँ।' },
  bridging: { start: 'पीठ के बल लेटें, जाँच वाली तरफ़ फ़ोन की ओर। घुटने मुड़े, पैर ज़मीन पर सपाट। स्थिर लेटे रहें।', move: 'कूल्हे ऊपर उठाएँ जब तक कंधों से घुटनों तक शरीर एक सीध में न आ जाए। एक पल रुकें, फिर धीरे से नीचे लाएँ।' },
  'calf-raise': { start: 'फ़ोन की ओर मुँह करके खड़े हों, पैर कूल्हों जितने खुले, सहारा पास हो। स्थिर खड़े रहें।', move: 'पंजों के बल ऊपर उठें, एक पल रुकें, फिर एड़ियाँ धीरे से नीचे लाएँ।' },
  balance: { start: 'फ़ोन की ओर मुँह करके सहारे के पास खड़े हों, पैर साथ। स्थिर खड़े रहें।', move: 'एक पैर ज़मीन से उठाकर रुकें। शरीर सीधा रखें। रुकना ख़त्म करने के लिए पैर नीचे रखें।' },
  'balance-line': { start: 'फ़ोन की ओर मुँह करके सहारे के पास खड़े हों, एक पैर दूसरे के आगे एक सीध में। स्थिर खड़े रहें।', move: 'सीध से बाहर क़दम रखे बिना इसी स्थिति में रुकें।' },
  walking: { start: 'फ़ोन की ओर बगल से खड़े हों, तस्वीर के आर-पार चलने की जगह रखें।', move: 'अपनी सामान्य चाल से तस्वीर के आर-पार चलें, फिर मुड़कर वापस आएँ।' },
  'ankle-pump': { start: 'बैठें या लेटें, पैर बगल से तस्वीर में दिखे, टाँग को सहारा दें और ढीला रखें। स्थिर रहें।', move: 'पंजे अपने से दूर करें, फिर अपनी ओर खींचें। घुटना स्थिर रखें।' },
  pendulum: { start: 'आगे झुककर अपने ठीक हाथ से मेज़ पकड़ें, दूसरा हाथ ढीला लटका हो। स्थिर रहें।', move: 'लटके हाथ को हल्के से आगे-पीछे या छोटे गोलों में झूलने दें, हाथ की मांसपेशियों से नहीं, शरीर से।' },
  cycle: { start: 'फ़ोन की ओर बगल से साइकिल पर बैठें, पैर पैडल पर। स्थिर बैठे रहें।', move: 'आराम से, एक समान गति से पैडल चलाएँ।' },
  plank: { start: 'फ़ोन की ओर बगल से प्लैंक की स्थिति में आएँ, कोहनियों और घुटनों या पंजों पर। स्थिर रहें।', move: 'कंधों से टखनों तक शरीर सीधी रेखा में रखें और रुकें।' },
  'bird-dog': { start: 'फ़ोन की ओर बगल से हाथों और घुटनों पर आएँ, पीठ सपाट। स्थिर रहें।', move: 'एक हाथ आगे और उलटा पैर पीछे फैलाएँ, पीठ सपाट रखें। रुकें, फिर वापस आएँ।' },
  'hand-fist': { start: 'अपना पूरा हाथ खुला करके फ़ोन के सामने रखें, हथेली फ़ोन की ओर। स्थिर रखें।', move: 'हाथ की मुट्ठी बंद करें, फिर पूरा खोल दें।' },
  wrist: { start: 'कलाई का अगला हिस्सा मेज़ पर रखें, फ़ोन की ओर बगल से, हाथ मेज़ के किनारे से बाहर लटका हो। अग्रबाहु स्थिर रखें।', move: 'कलाई को धीरे से ऊपर मोड़ें, फिर नीचे।' },
  elbow: { start: 'फ़ोन की ओर बगल से खड़े या बैठें, ऊपरी बाँह बगल में, कोहनी सीधी। स्थिर रहें।', move: 'कोहनी मोड़कर हाथ को कंधे की ओर लाएँ, फिर धीरे से सीधा करें।' },
  scap: { start: 'फ़ोन की ओर पीठ करके खड़े हों, हाथ बगल में, कंधे ढीले। स्थिर खड़े रहें।', move: 'कंधे की हड्डियों को पीछे एक साथ दबाएँ, एक पल रुकें, फिर ढीला छोड़ें।' },
  'band-rot': { start: 'फ़ोन की ओर मुँह करके खड़े हों, कोहनी समकोण पर मुड़ी और बगल से सटी, बैंड पकड़े हुए। स्थिर खड़े रहें।', move: 'कोहनी को बगल से सटाए रखकर अग्रबाहु को बाहर की ओर घुमाएँ। धीरे से वापस आएँ।' },
};

const bn: Record<FormKind, Step> = {
  slr: { start: 'চিৎ হয়ে শুয়ে পড়ুন, যে দিকটা দেখা হবে সেটি ফোনের দিকে থাকুক। অন্য হাঁটু ভাঁজ করে পা মাটিতে রাখুন। যে পা দেখা হবে সেটি সোজা মাটিতে রাখুন।', move: 'উরু শক্ত করে সোজা পা ভাঁজ করা হাঁটুর উচ্চতা পর্যন্ত তুলুন। একটু থামুন, তারপর ধীরে নামান।' },
  squat: { start: 'ফোনের দিকে মুখ করে দাঁড়ান, পা কাঁধ-চওড়া, হাত দুপাশে। স্থির থাকুন।', move: 'হাঁটু ভাঁজ করে চেয়ারে বসার মতো পিছনে যান, যতটা আরামে পারেন। তারপর ধীরে উঠুন।' },
  'squat-side': { start: 'ফোনের দিকে পাশ ফিরে দাঁড়ান, পা কাঁধ-চওড়া, হাত সামনে বা দুপাশে। স্থির থাকুন।', move: 'হাঁটু ভাঁজ করে চেয়ারে বসার মতো পিছনে যান, যতটা আরামে পারেন। তারপর ধীরে উঠুন।' },
  'shoulder-abduction': { start: 'ফোনের দিকে মুখ করে দাঁড়ান, হাত সোজা দুপাশে। স্থির থাকুন।', move: 'একটি হাত পাশে তুলুন, যতটা আরামে পারেন (কাঁধ পর্যন্ত)। ধীরে নামান।' },
  'knee-flex': { start: 'চিৎ হয়ে শুয়ে পড়ুন, যে দিক দেখা হবে সেটি ফোনের দিকে, পা সোজা। স্থির শুয়ে থাকুন।', move: 'গোড়ালি নিতম্বের দিকে টেনে হাঁটু যতটা আরামে পারেন ভাঁজ করুন। তারপর আবার সোজা করুন।' },
  'sit-to-stand': { start: 'ফোনের দিকে মুখ করে শক্ত চেয়ারে বসুন, পা মাটিতে সমতল, হাত ভাঁজ করা বা সামনে। স্থির বসে থাকুন।', move: 'একটু সামনে ঝুঁকে উঠে দাঁড়ান। তারপর ধীরে বসুন।' },
  lunge: { start: 'ফোনের দিকে মুখ করে দাঁড়ান, পা একসাথে, ধরার মতো কিছু কাছে রাখুন। স্থির থাকুন।', move: 'এক পা সামনে রাখুন, দুই হাঁটু ভাঁজ করে একটু নামুন, তারপর শুরুর অবস্থায় ফিরুন।' },
  'lunge-side': { start: 'ফোনের দিকে পাশ ফিরে দাঁড়ান, পা একসাথে, ধরার মতো কিছু কাছে রাখুন। স্থির থাকুন।', move: 'এক পা সামনে রাখুন, দুই হাঁটু ভাঁজ করে একটু নামুন, তারপর শুরুর অবস্থায় ফিরুন।' },
  'step-up': { start: 'ফোনের দিকে মুখ করে একটি নিচু, শক্ত ধাপের সামনে দাঁড়ান। স্থির থাকুন।', move: 'এক পা ধাপে তুলুন, অন্য পা তুলে আনুন, তারপর এক এক পা করে নামুন।' },
  'shoulder-flexion': { start: 'ফোনের দিকে পাশ ফিরে দাঁড়ান, হাত সোজা পাশে। স্থির থাকুন।', move: 'হাত সামনে দিয়ে ওপরে তুলুন, যতটা আরামে পারেন। ধীরে নামান।' },
  'hip-abduction': { start: 'ফোনের দিকে মুখ করে কিছু ধরে দাঁড়ান, পা সোজা ও একসাথে। স্থির থাকুন।', move: 'এক পা পাশে সরান, হাঁটু সোজা ও শরীর খাড়া রেখে। ধীরে ফিরিয়ে আনুন।' },
  bridging: { start: 'চিৎ হয়ে শুয়ে পড়ুন, যে দিক দেখা হবে সেটি ফোনের দিকে। হাঁটু ভাঁজ, পা মাটিতে সমতল। স্থির শুয়ে থাকুন।', move: 'নিতম্ব তুলুন যতক্ষণ না কাঁধ থেকে হাঁটু এক সরলরেখায় আসে। একটু থামুন, তারপর ধীরে নামান।' },
  'calf-raise': { start: 'ফোনের দিকে মুখ করে দাঁড়ান, পা কোমর-চওড়া, কাছে ধরার কিছু রাখুন। স্থির থাকুন।', move: 'পায়ের পাতার ওপর ভর দিয়ে উঠুন, একটু থামুন, তারপর গোড়ালি ধীরে নামান।' },
  balance: { start: 'ফোনের দিকে মুখ করে ধরার জিনিসের পাশে দাঁড়ান, পা একসাথে। স্থির থাকুন।', move: 'এক পা মাটি থেকে তুলে ধরে রাখুন। শরীর খাড়া রাখুন। শেষ করতে পা নামান।' },
  'balance-line': { start: 'ফোনের দিকে মুখ করে ধরার জিনিসের পাশে দাঁড়ান, এক পা অন্য পায়ের সামনে এক সরলরেখায়। স্থির থাকুন।', move: 'রেখা থেকে বেরিয়ে না গিয়ে এই অবস্থায় থাকুন।' },
  walking: { start: 'ফোনের দিকে পাশ ফিরে দাঁড়ান, ছবির এপার-ওপার হাঁটার জায়গা রাখুন।', move: 'স্বাভাবিক গতিতে ছবির এপার-ওপার হাঁটুন, তারপর ঘুরে ফিরে আসুন।' },
  'ankle-pump': { start: 'বসুন বা শুয়ে পড়ুন, পা পাশ থেকে ছবিতে দেখা যাক, পায়ে ঠেকা দিন ও শিথিল রাখুন। স্থির থাকুন।', move: 'পায়ের পাতা নিজের থেকে দূরে, তারপর নিজের দিকে টানুন। হাঁটু স্থির রাখুন।' },
  pendulum: { start: 'সামনে ঝুঁকে সুস্থ হাত দিয়ে টেবিল ধরুন, অন্য হাত ঢিলে ঝুলুক। স্থির থাকুন।', move: 'ঝুলন্ত হাতকে আলতো করে সামনে-পিছনে বা ছোট বৃত্তে দুলতে দিন, হাতের পেশি দিয়ে নয়, শরীর দিয়ে।' },
  cycle: { start: 'ফোনের দিকে পাশ ফিরে সাইকেলে বসুন, পা প্যাডেলে। স্থির বসুন।', move: 'আরামে, সমান গতিতে প্যাডেল করুন।' },
  plank: { start: 'ফোনের দিকে পাশ ফিরে প্ল্যাঙ্ক অবস্থায় আসুন, কনুই ও হাঁটু বা পায়ের পাতায়। স্থির থাকুন।', move: 'কাঁধ থেকে গোড়ালি পর্যন্ত শরীর সোজা রেখে থামুন।' },
  'bird-dog': { start: 'ফোনের দিকে পাশ ফিরে হাত ও হাঁটুতে ভর দিন, পিঠ সমতল। স্থির থাকুন।', move: 'এক হাত সামনে ও উল্টো পা পিছনে বাড়ান, পিঠ সমতল রেখে। থামুন, তারপর ফিরে আসুন।' },
  'hand-fist': { start: 'পুরো হাত খোলা অবস্থায় ফোনের সামনে ধরুন, তালু ফোনের দিকে। স্থির রাখুন।', move: 'হাত মুঠো করুন, তারপর পুরো খুলে দিন।' },
  wrist: { start: 'কবজির সামনের অংশ টেবিলে রাখুন, ফোনের দিকে পাশ ফিরে, হাত টেবিলের কিনারার বাইরে ঝুলুক। বাহুর নিচের অংশ স্থির রাখুন।', move: 'কবজি ধীরে ওপরে, তারপর নিচে বাঁকান।' },
  elbow: { start: 'ফোনের দিকে পাশ ফিরে দাঁড়ান বা বসুন, ওপরের বাহু পাশে, কনুই সোজা। স্থির থাকুন।', move: 'কনুই ভাঁজ করে হাত কাঁধের দিকে আনুন, তারপর ধীরে সোজা করুন।' },
  scap: { start: 'ফোনের দিকে পিঠ করে দাঁড়ান, হাত দুপাশে, কাঁধ শিথিল। স্থির থাকুন।', move: 'কাঁধের হাড় পিছনে একসাথে চেপে ধরুন, একটু থামুন, তারপর শিথিল করুন।' },
  'band-rot': { start: 'ফোনের দিকে মুখ করে দাঁড়ান, কনুই সমকোণে ভাঁজ করে পাশে লাগানো, ব্যান্ড ধরে। স্থির থাকুন।', move: 'কনুই পাশে লাগিয়ে রেখে বাহুর নিচের অংশ বাইরের দিকে ঘোরান। ধীরে ফিরে আসুন।' },
};

export const HOWTO: Record<Lang, Record<FormKind, Step>> = { en, hi, bn };
export const howTo = (lang: Lang, kind: FormKind): Step => HOWTO[lang]?.[kind] ?? en[kind];
