/**
 * For every camera-checked exercise: the captions under the start / middle / end pictures, the plain-words rule for when the phone counts a rep
 * ({up} and {down} are filled in from the limits in config.ts, so the words never drift from the numbers), and which body parts the phone must see.
 * Draft wording: a physio should read each line, and Hindi and Bengali need a native reader.
 */
import type { Lang } from '../types';
import { KIND_EXERCISES, KINDS, REP, type FormKind } from './config';

export type RepInfo = { stages: [string, string, string]; why: string; see: string };

const en: Record<FormKind, RepInfo> = {
  slr: { stages: ['Lying, leg flat on the floor', 'Leg lifted, straight', 'Leg lowered back down'], why: 'A rep counts when your straight leg lifts about {up} degrees off the floor and then comes back down to about {down} degrees or lower.', see: 'your shoulder, hip, knee and ankle of the leg nearest the phone' },
  squat: { stages: ['Standing tall', 'Hips lowered, knees bent', 'Standing tall again'], why: 'A rep counts when your hips drop by about {up}% of your leg length and then rise back up to within about {down}% of where you started.', see: 'both hips, knees and ankles, and both shoulders' },
  'squat-side': { stages: ['Standing tall, side-on', 'Knees bent, sitting back', 'Standing tall again'], why: 'A rep counts when your knee bends by about {up} degrees and then straightens back to about {down} degrees or less.', see: 'your shoulder, hip, knee and ankle on the side nearest the phone' },
  'shoulder-abduction': { stages: ['Arm by your side', 'Arm raised out to the side', 'Arm lowered again'], why: 'A rep counts when your arm rises about {up} degrees from your side and then comes back down to about {down} degrees or less.', see: 'your shoulder, elbow and hip, and your other shoulder' },
  'knee-flex': { stages: ['Lying, leg straight', 'Heel slid in, knee bent', 'Leg straight again'], why: 'A rep counts when your knee bends by about {up} degrees and then straightens back to about {down} degrees or less.', see: 'your shoulder, hip, knee and ankle of the leg nearest the phone' },
  'sit-to-stand': { stages: ['Sitting on the chair', 'Standing up', 'Sitting down again'], why: 'A rep counts when your hips rise by about {up}% of your leg length and then come back down to within about {down}% of the seat.', see: 'both hips, knees and ankles, and both shoulders' },
  lunge: { stages: ['Standing, feet together', 'Stepped forward, knees bent', 'Back to standing'], why: 'A rep counts when your hips drop by about {up}% of your leg length and then rise back up to within about {down}% of where you started.', see: 'both hips, knees and ankles, and both shoulders' },
  'lunge-side': { stages: ['Standing, side-on', 'Stepped forward, knees bent', 'Back to standing'], why: 'A rep counts when your front knee bends by about {up} degrees and then straightens back to about {down} degrees or less.', see: 'your shoulder, hip, knee and ankle on the side nearest the phone' },
  'step-up': { stages: ['Standing in front of the step', 'Standing up on the step', 'Stepped back down'], why: 'A rep counts when your hips rise by about {up}% of your leg length as you step up, and then come back down to within about {down}% of where you started.', see: 'both hips, knees and ankles, and both shoulders' },
  'shoulder-flexion': { stages: ['Arm by your side', 'Arm raised forward and up', 'Arm lowered again'], why: 'A rep counts when your arm rises about {up} degrees from your side and then comes back down to about {down} degrees or less.', see: 'your shoulder, elbow, hip, knee and ankle on the side nearest the phone' },
  'hip-abduction': { stages: ['Standing, legs together', 'Leg moved out to the side', 'Leg back in'], why: 'A rep counts when your leg moves about {up} degrees out to the side and then comes back in to about {down} degrees or less.', see: 'both hips, knees and ankles, and both shoulders' },
  bridging: { stages: ['Lying, knees bent, feet flat', 'Hips lifted: shoulders to knees in a line', 'Hips lowered back down'], why: 'A rep counts when your hips lift by about {up}% of your thigh length and then come back down to about {down}% or lower. Lifting higher is welcome, but this is enough to count.', see: 'your hip, knee and ankle of the leg nearest the phone' },
  'calf-raise': { stages: ['Standing, heels down', 'Up on your toes', 'Heels lowered again'], why: 'A rep counts when your heels rise by about {up}% of your leg length and then come back down to about {down}% or lower.', see: 'both hips and both ankles' },
  balance: { stages: ['Standing on both feet', 'One foot lifted and held', 'Foot back on the floor'], why: 'A hold counts when one foot lifts about {up}% of your leg length off the floor and then goes back down to about {down}% or lower.', see: 'both hips and both ankles' },
  'balance-line': { stages: ['Feet apart, one in front', 'Feet brought into one line', 'Feet apart again'], why: 'A hold counts when your feet come about {up}% closer together than at the start, and then move apart again to about {down}% or less.', see: 'both hips and both ankles' },
  walking: { stages: ['One foot behind', 'Step taken, feet apart', 'The other foot steps through'], why: 'A step counts each time one foot moves ahead of the other by about {up}% of your trunk length and your feet then come back together to about {down}% or less.', see: 'your shoulder, hip, knee and ankle on the side nearest the phone' },
  'ankle-pump': { stages: ['Foot relaxed', 'Toes pointed away', 'Foot relaxed again'], why: 'A rep counts when your toes point about {up} degrees away from relaxed and then come back to about {down} degrees or less.', see: 'your hip, knee, ankle and foot' },
  pendulum: { stages: ['Arm hanging loose', 'Arm swung away from the body', 'Arm hanging again'], why: 'A swing counts when your arm moves about {up} degrees away from hanging and then comes back to about {down} degrees or less.', see: 'your shoulder, elbow, wrist and hip' },
  cycle: { stages: ['Pedal at the front', 'Pedal pushed down', 'Pedal back at the front'], why: 'A turn counts when a pedal travels about {up}% of the way round and then comes back to about {down}% or less. Pedal at an easy pace.', see: 'your shoulder, hip, knee and ankle on the side nearest the phone' },
  plank: { stages: ['Getting into position', 'Body in a straight line', 'Resting'], why: 'A hold counts while your body stays about {up} degrees flat or more, in a line from shoulders to ankles.', see: 'your shoulder, hip, knee and ankle on the side nearest the phone' },
  'bird-dog': { stages: ['On hands and knees', 'Arm and opposite leg stretched out', 'Back on hands and knees'], why: 'A hold counts when your back leg lifts about {up} degrees and then comes back down to about {down} degrees or less.', see: 'your shoulder, hip, knee and ankle on the side nearest the phone' },
  'hand-fist': { stages: ['Hand open', 'Hand closed in a fist', 'Hand open again'], why: 'A rep counts when your hand closes to about {up}% of a full fist and then opens back to about {down}% or less.', see: 'your whole hand, all fingers' },
  wrist: { stages: ['Wrist straight', 'Wrist bent', 'Wrist straight again'], why: 'A rep counts when your wrist bends about {up} degrees and then comes back to about {down} degrees or less.', see: 'your shoulder, elbow and wrist' },
  elbow: { stages: ['Arm straight', 'Elbow bent, hand to shoulder', 'Arm straight again'], why: 'A rep counts when your elbow bends about {up} degrees and then straightens back to about {down} degrees or less.', see: 'your shoulder, elbow, wrist and hip' },
  scap: { stages: ['Shoulders relaxed', 'Shoulder blades squeezed together', 'Shoulders relaxed again'], why: 'A rep counts when your shoulders pull in by about {up}% of their width and then relax back to about {down}% or less.', see: 'both shoulders and both hips, and both elbows and wrists' },
  'band-rot': { stages: ['Forearm in front, elbow at your side', 'Forearm turned outwards', 'Forearm back in front'], why: 'A rep counts when your forearm turns outwards by about {up}% of your upper-arm length and then comes back to about {down}% or less.', see: 'both shoulders, elbows, wrists and hips' },
};

const hi: Record<FormKind, RepInfo> = {
  slr: { stages: ['लेटे हैं, पैर ज़मीन पर सीधा', 'पैर सीधा उठा हुआ', 'पैर वापस नीचे'], why: 'रेप तब गिना जाता है जब आपका सीधा पैर ज़मीन से लगभग {up} डिग्री उठे और फिर लगभग {down} डिग्री या उससे नीचे आ जाए।', see: 'फ़ोन के पास वाले पैर का कंधा, कूल्हा, घुटना और टखना' },
  squat: { stages: ['सीधे खड़े', 'कूल्हे नीचे, घुटने मुड़े', 'फिर सीधे खड़े'], why: 'रेप तब गिना जाता है जब आपके कूल्हे पैर की लंबाई के लगभग {up}% नीचे जाएँ और फिर शुरुआत के लगभग {down}% के अंदर वापस ऊपर आ जाएँ।', see: 'दोनों कूल्हे, घुटने और टखने, और दोनों कंधे' },
  'squat-side': { stages: ['बगल से सीधे खड़े', 'घुटने मुड़े, पीछे बैठे', 'फिर सीधे खड़े'], why: 'रेप तब गिना जाता है जब आपका घुटना लगभग {up} डिग्री मुड़े और फिर लगभग {down} डिग्री या कम तक सीधा हो जाए।', see: 'फ़ोन के पास वाली तरफ़ का कंधा, कूल्हा, घुटना और टखना' },
  'shoulder-abduction': { stages: ['हाथ बगल में', 'हाथ बग़ल की ओर उठा', 'हाथ फिर नीचे'], why: 'रेप तब गिना जाता है जब आपका हाथ बगल से लगभग {up} डिग्री उठे और फिर लगभग {down} डिग्री या कम तक वापस आ जाए।', see: 'आपका कंधा, कोहनी और कूल्हा, और दूसरा कंधा' },
  'knee-flex': { stages: ['लेटे हैं, पैर सीधा', 'एड़ी अंदर खिसकी, घुटना मुड़ा', 'पैर फिर सीधा'], why: 'रेप तब गिना जाता है जब आपका घुटना लगभग {up} डिग्री मुड़े और फिर लगभग {down} डिग्री या कम तक सीधा हो जाए।', see: 'फ़ोन के पास वाले पैर का कंधा, कूल्हा, घुटना और टखना' },
  'sit-to-stand': { stages: ['कुर्सी पर बैठे', 'खड़े हो गए', 'फिर बैठे'], why: 'रेप तब गिना जाता है जब आपके कूल्हे पैर की लंबाई के लगभग {up}% ऊपर उठें और फिर सीट के लगभग {down}% के अंदर वापस आ जाएँ।', see: 'दोनों कूल्हे, घुटने और टखने, और दोनों कंधे' },
  lunge: { stages: ['खड़े, पैर साथ', 'आगे क़दम, घुटने मुड़े', 'वापस खड़े'], why: 'रेप तब गिना जाता है जब आपके कूल्हे पैर की लंबाई के लगभग {up}% नीचे जाएँ और फिर शुरुआत के लगभग {down}% के अंदर वापस ऊपर आ जाएँ।', see: 'दोनों कूल्हे, घुटने और टखने, और दोनों कंधे' },
  'lunge-side': { stages: ['बगल से खड़े', 'आगे क़दम, घुटने मुड़े', 'वापस खड़े'], why: 'रेप तब गिना जाता है जब आपका आगे वाला घुटना लगभग {up} डिग्री मुड़े और फिर लगभग {down} डिग्री या कम तक सीधा हो जाए।', see: 'फ़ोन के पास वाली तरफ़ का कंधा, कूल्हा, घुटना और टखना' },
  'step-up': { stages: ['सीढ़ी के सामने खड़े', 'सीढ़ी पर चढ़कर खड़े', 'नीचे उतर आए'], why: 'रेप तब गिना जाता है जब चढ़ते समय आपके कूल्हे पैर की लंबाई के लगभग {up}% ऊपर उठें और फिर शुरुआत के लगभग {down}% के अंदर वापस आ जाएँ।', see: 'दोनों कूल्हे, घुटने और टखने, और दोनों कंधे' },
  'shoulder-flexion': { stages: ['हाथ बगल में', 'हाथ आगे से ऊपर उठा', 'हाथ फिर नीचे'], why: 'रेप तब गिना जाता है जब आपका हाथ बगल से लगभग {up} डिग्री उठे और फिर लगभग {down} डिग्री या कम तक वापस आ जाए।', see: 'फ़ोन के पास वाली तरफ़ का कंधा, कोहनी, कूल्हा, घुटना और टखना' },
  'hip-abduction': { stages: ['खड़े, पैर साथ', 'पैर बग़ल में गया', 'पैर वापस अंदर'], why: 'रेप तब गिना जाता है जब आपका पैर बग़ल में लगभग {up} डिग्री जाए और फिर लगभग {down} डिग्री या कम तक वापस आ जाए।', see: 'दोनों कूल्हे, घुटने और टखने, और दोनों कंधे' },
  bridging: { stages: ['लेटे, घुटने मुड़े, पैर सपाट', 'कूल्हे उठे: कंधे से घुटने तक सीध', 'कूल्हे वापस नीचे'], why: 'रेप तब गिना जाता है जब आपके कूल्हे जाँघ की लंबाई के लगभग {up}% ऊपर उठें और फिर लगभग {down}% या उससे नीचे आ जाएँ। इससे ऊँचा उठाना ठीक है, पर गिनने के लिए इतना काफ़ी है।', see: 'फ़ोन के पास वाले पैर का कूल्हा, घुटना और टखना' },
  'calf-raise': { stages: ['खड़े, एड़ियाँ नीचे', 'पंजों पर ऊपर', 'एड़ियाँ फिर नीचे'], why: 'रेप तब गिना जाता है जब आपकी एड़ियाँ पैर की लंबाई के लगभग {up}% ऊपर उठें और फिर लगभग {down}% या कम तक नीचे आ जाएँ।', see: 'दोनों कूल्हे और दोनों टखने' },
  balance: { stages: ['दोनों पैरों पर खड़े', 'एक पैर उठाकर रुके', 'पैर वापस ज़मीन पर'], why: 'एक होल्ड तब गिना जाता है जब एक पैर पैर की लंबाई के लगभग {up}% ज़मीन से उठे और फिर लगभग {down}% या कम तक नीचे आ जाए।', see: 'दोनों कूल्हे और दोनों टखने' },
  'balance-line': { stages: ['पैर अलग, एक आगे', 'पैर एक सीध में लाए', 'पैर फिर अलग'], why: 'एक होल्ड तब गिना जाता है जब आपके पैर शुरुआत से लगभग {up}% पास आएँ और फिर लगभग {down}% या कम तक वापस अलग हो जाएँ।', see: 'दोनों कूल्हे और दोनों टखने' },
  walking: { stages: ['एक पैर पीछे', 'क़दम लिया, पैर अलग', 'दूसरा पैर आगे आया'], why: 'एक क़दम तब गिना जाता है जब एक पैर दूसरे से धड़ की लंबाई के लगभग {up}% आगे जाए और फिर पैर लगभग {down}% या कम तक साथ आ जाएँ।', see: 'फ़ोन के पास वाली तरफ़ का कंधा, कूल्हा, घुटना और टखना' },
  'ankle-pump': { stages: ['पैर ढीला', 'पंजे दूर की ओर', 'पैर फिर ढीला'], why: 'रेप तब गिना जाता है जब आपके पंजे ढीले से लगभग {up} डिग्री दूर जाएँ और फिर लगभग {down} डिग्री या कम तक वापस आ जाएँ।', see: 'आपका कूल्हा, घुटना, टखना और पंजा' },
  pendulum: { stages: ['हाथ ढीला लटका', 'हाथ शरीर से दूर झूला', 'हाथ फिर लटका'], why: 'एक झूला तब गिना जाता है जब आपका हाथ लटकी स्थिति से लगभग {up} डिग्री दूर जाए और फिर लगभग {down} डिग्री या कम तक वापस आ जाए।', see: 'आपका कंधा, कोहनी, कलाई और कूल्हा' },
  cycle: { stages: ['पैडल आगे', 'पैडल नीचे दबा', 'पैडल फिर आगे'], why: 'एक चक्कर तब गिना जाता है जब पैडल लगभग {up}% रास्ता तय करे और फिर लगभग {down}% या कम तक वापस आ जाए। आराम की गति से चलाएँ।', see: 'फ़ोन के पास वाली तरफ़ का कंधा, कूल्हा, घुटना और टखना' },
  plank: { stages: ['स्थिति में आ रहे हैं', 'शरीर सीधी रेखा में', 'आराम'], why: 'होल्ड तब तक गिना जाता है जब तक आपका शरीर कंधों से टखनों तक लगभग {up} डिग्री या अधिक सीधा रहे।', see: 'फ़ोन के पास वाली तरफ़ का कंधा, कूल्हा, घुटना और टखना' },
  'bird-dog': { stages: ['हाथों और घुटनों पर', 'हाथ और उलटा पैर फैला', 'फिर हाथों और घुटनों पर'], why: 'होल्ड तब गिना जाता है जब आपका पीछे वाला पैर लगभग {up} डिग्री उठे और फिर लगभग {down} डिग्री या कम तक वापस आ जाए।', see: 'फ़ोन के पास वाली तरफ़ का कंधा, कूल्हा, घुटना और टखना' },
  'hand-fist': { stages: ['हाथ खुला', 'हाथ मुट्ठी में बंद', 'हाथ फिर खुला'], why: 'रेप तब गिना जाता है जब आपका हाथ पूरी मुट्ठी के लगभग {up}% तक बंद हो और फिर लगभग {down}% या कम तक खुल जाए।', see: 'आपका पूरा हाथ, सारी उँगलियाँ' },
  wrist: { stages: ['कलाई सीधी', 'कलाई मुड़ी', 'कलाई फिर सीधी'], why: 'रेप तब गिना जाता है जब आपकी कलाई लगभग {up} डिग्री मुड़े और फिर लगभग {down} डिग्री या कम तक वापस आ जाए।', see: 'आपका कंधा, कोहनी और कलाई' },
  elbow: { stages: ['हाथ सीधा', 'कोहनी मुड़ी, हाथ कंधे तक', 'हाथ फिर सीधा'], why: 'रेप तब गिना जाता है जब आपकी कोहनी लगभग {up} डिग्री मुड़े और फिर लगभग {down} डिग्री या कम तक सीधी हो जाए।', see: 'आपका कंधा, कोहनी, कलाई और कूल्हा' },
  scap: { stages: ['कंधे ढीले', 'कंधे की हड्डियाँ पास दबीं', 'कंधे फिर ढीले'], why: 'रेप तब गिना जाता है जब आपके कंधे अपनी चौड़ाई के लगभग {up}% तक पास आएँ और फिर लगभग {down}% या कम तक ढीले हो जाएँ।', see: 'दोनों कंधे और दोनों कूल्हे, दोनों कोहनियाँ और कलाइयाँ' },
  'band-rot': { stages: ['अग्रबाहु आगे, कोहनी बगल में', 'अग्रबाहु बाहर घूमी', 'अग्रबाहु फिर आगे'], why: 'रेप तब गिना जाता है जब आपकी अग्रबाहु ऊपरी बाँह की लंबाई के लगभग {up}% तक बाहर घूमे और फिर लगभग {down}% या कम तक वापस आ जाए।', see: 'दोनों कंधे, कोहनियाँ, कलाइयाँ और कूल्हे' },
};

const bn: Record<FormKind, RepInfo> = {
  slr: { stages: ['শুয়ে, পা মাটিতে সোজা', 'পা সোজা তোলা', 'পা আবার নামানো'], why: 'আপনার সোজা পা মাটি থেকে প্রায় {up} ডিগ্রি উঠে আবার প্রায় {down} ডিগ্রি বা তার নিচে নামলে একটি রেপ গোনা হয়।', see: 'ফোনের কাছের পায়ের কাঁধ, কোমর, হাঁটু ও গোড়ালি' },
  squat: { stages: ['সোজা দাঁড়িয়ে', 'নিতম্ব নিচে, হাঁটু ভাঁজ', 'আবার সোজা'], why: 'আপনার নিতম্ব পায়ের দৈর্ঘ্যের প্রায় {up}% নিচে নেমে আবার শুরুর প্রায় {down}%-এর মধ্যে উঠে এলে একটি রেপ গোনা হয়।', see: 'দুই কোমর, হাঁটু ও গোড়ালি এবং দুই কাঁধ' },
  'squat-side': { stages: ['পাশ থেকে সোজা', 'হাঁটু ভাঁজ, পিছনে বসা', 'আবার সোজা'], why: 'আপনার হাঁটু প্রায় {up} ডিগ্রি ভাঁজ হয়ে আবার প্রায় {down} ডিগ্রি বা কম সোজা হলে একটি রেপ গোনা হয়।', see: 'ফোনের কাছের দিকের কাঁধ, কোমর, হাঁটু ও গোড়ালি' },
  'shoulder-abduction': { stages: ['হাত পাশে', 'হাত পাশে তোলা', 'হাত আবার নামানো'], why: 'আপনার হাত পাশ থেকে প্রায় {up} ডিগ্রি উঠে আবার প্রায় {down} ডিগ্রি বা কমে নামলে একটি রেপ গোনা হয়।', see: 'আপনার কাঁধ, কনুই ও কোমর এবং অন্য কাঁধ' },
  'knee-flex': { stages: ['শুয়ে, পা সোজা', 'গোড়ালি টেনে হাঁটু ভাঁজ', 'পা আবার সোজা'], why: 'আপনার হাঁটু প্রায় {up} ডিগ্রি ভাঁজ হয়ে আবার প্রায় {down} ডিগ্রি বা কম সোজা হলে একটি রেপ গোনা হয়।', see: 'ফোনের কাছের পায়ের কাঁধ, কোমর, হাঁটু ও গোড়ালি' },
  'sit-to-stand': { stages: ['চেয়ারে বসা', 'উঠে দাঁড়ানো', 'আবার বসা'], why: 'আপনার নিতম্ব পায়ের দৈর্ঘ্যের প্রায় {up}% উঠে আবার আসনের প্রায় {down}%-এর মধ্যে ফিরে এলে একটি রেপ গোনা হয়।', see: 'দুই কোমর, হাঁটু ও গোড়ালি এবং দুই কাঁধ' },
  lunge: { stages: ['দাঁড়িয়ে, পা একসাথে', 'সামনে পা, হাঁটু ভাঁজ', 'আবার দাঁড়ানো'], why: 'আপনার নিতম্ব পায়ের দৈর্ঘ্যের প্রায় {up}% নিচে নেমে আবার শুরুর প্রায় {down}%-এর মধ্যে উঠে এলে একটি রেপ গোনা হয়।', see: 'দুই কোমর, হাঁটু ও গোড়ালি এবং দুই কাঁধ' },
  'lunge-side': { stages: ['পাশ থেকে দাঁড়িয়ে', 'সামনে পা, হাঁটু ভাঁজ', 'আবার দাঁড়ানো'], why: 'সামনের হাঁটু প্রায় {up} ডিগ্রি ভাঁজ হয়ে আবার প্রায় {down} ডিগ্রি বা কম সোজা হলে একটি রেপ গোনা হয়।', see: 'ফোনের কাছের দিকের কাঁধ, কোমর, হাঁটু ও গোড়ালি' },
  'step-up': { stages: ['ধাপের সামনে দাঁড়িয়ে', 'ধাপে উঠে দাঁড়ানো', 'নিচে নামা'], why: 'ধাপে ওঠার সময় আপনার নিতম্ব পায়ের দৈর্ঘ্যের প্রায় {up}% উঠে আবার শুরুর প্রায় {down}%-এর মধ্যে ফিরে এলে একটি রেপ গোনা হয়।', see: 'দুই কোমর, হাঁটু ও গোড়ালি এবং দুই কাঁধ' },
  'shoulder-flexion': { stages: ['হাত পাশে', 'হাত সামনে দিয়ে ওপরে', 'হাত আবার নামানো'], why: 'আপনার হাত পাশ থেকে প্রায় {up} ডিগ্রি উঠে আবার প্রায় {down} ডিগ্রি বা কমে নামলে একটি রেপ গোনা হয়।', see: 'ফোনের কাছের দিকের কাঁধ, কনুই, কোমর, হাঁটু ও গোড়ালি' },
  'hip-abduction': { stages: ['দাঁড়িয়ে, পা একসাথে', 'পা পাশে সরানো', 'পা আবার ভিতরে'], why: 'আপনার পা পাশে প্রায় {up} ডিগ্রি সরে আবার প্রায় {down} ডিগ্রি বা কমে ফিরে এলে একটি রেপ গোনা হয়।', see: 'দুই কোমর, হাঁটু ও গোড়ালি এবং দুই কাঁধ' },
  bridging: { stages: ['শুয়ে, হাঁটু ভাঁজ, পা সমতল', 'নিতম্ব উঁচু: কাঁধ থেকে হাঁটু এক রেখায়', 'নিতম্ব আবার নামানো'], why: 'আপনার নিতম্ব উরুর দৈর্ঘ্যের প্রায় {up}% উঠে আবার প্রায় {down}% বা তার নিচে নামলে একটি রেপ গোনা হয়। আরও উঁচুতে তোলা সুবিধার, কিন্তু গোনার জন্য এটুকুই যথেষ্ট।', see: 'ফোনের কাছের পায়ের কোমর, হাঁটু ও গোড়ালি' },
  'calf-raise': { stages: ['দাঁড়িয়ে, গোড়ালি নিচে', 'পায়ের পাতায় উঠে', 'গোড়ালি আবার নিচে'], why: 'আপনার গোড়ালি পায়ের দৈর্ঘ্যের প্রায় {up}% উঠে আবার প্রায় {down}% বা কমে নামলে একটি রেপ গোনা হয়।', see: 'দুই কোমর ও দুই গোড়ালি' },
  balance: { stages: ['দুই পায়ে দাঁড়িয়ে', 'এক পা তুলে ধরে', 'পা আবার মাটিতে'], why: 'এক পা পায়ের দৈর্ঘ্যের প্রায় {up}% মাটি থেকে উঠে আবার প্রায় {down}% বা কমে নামলে একটি হোল্ড গোনা হয়।', see: 'দুই কোমর ও দুই গোড়ালি' },
  'balance-line': { stages: ['পা আলাদা, একটি সামনে', 'পা এক রেখায় আনা', 'পা আবার আলাদা'], why: 'আপনার পা শুরুর চেয়ে প্রায় {up}% কাছে এসে আবার প্রায় {down}% বা কমে আলাদা হলে একটি হোল্ড গোনা হয়।', see: 'দুই কোমর ও দুই গোড়ালি' },
  walking: { stages: ['এক পা পিছনে', 'পা ফেলা, পা আলাদা', 'অন্য পা সামনে এল'], why: 'এক পা অন্য পায়ের চেয়ে ধড়ের দৈর্ঘ্যের প্রায় {up}% এগিয়ে গিয়ে আবার প্রায় {down}% বা কমে কাছে এলে একটি পদক্ষেপ গোনা হয়।', see: 'ফোনের কাছের দিকের কাঁধ, কোমর, হাঁটু ও গোড়ালি' },
  'ankle-pump': { stages: ['পা শিথিল', 'পায়ের পাতা দূরে', 'পা আবার শিথিল'], why: 'আপনার পায়ের পাতা শিথিল অবস্থা থেকে প্রায় {up} ডিগ্রি দূরে গিয়ে আবার প্রায় {down} ডিগ্রি বা কমে ফিরলে একটি রেপ গোনা হয়।', see: 'আপনার কোমর, হাঁটু, গোড়ালি ও পায়ের পাতা' },
  pendulum: { stages: ['হাত ঢিলে ঝুলছে', 'হাত শরীর থেকে দূরে দুলল', 'হাত আবার ঝুলছে'], why: 'আপনার হাত ঝুলন্ত অবস্থা থেকে প্রায় {up} ডিগ্রি সরে আবার প্রায় {down} ডিগ্রি বা কমে ফিরলে একটি দোলা গোনা হয়।', see: 'আপনার কাঁধ, কনুই, কবজি ও কোমর' },
  cycle: { stages: ['প্যাডেল সামনে', 'প্যাডেল নিচে চাপা', 'প্যাডেল আবার সামনে'], why: 'প্যাডেল প্রায় {up}% পথ ঘুরে আবার প্রায় {down}% বা কমে ফিরলে একটি পাক গোনা হয়। আরামের গতিতে চালান।', see: 'ফোনের কাছের দিকের কাঁধ, কোমর, হাঁটু ও গোড়ালি' },
  plank: { stages: ['অবস্থানে আসছেন', 'শরীর এক সরলরেখায়', 'বিশ্রাম'], why: 'আপনার শরীর কাঁধ থেকে গোড়ালি পর্যন্ত প্রায় {up} ডিগ্রি বা বেশি সোজা থাকলে হোল্ড গোনা হয়।', see: 'ফোনের কাছের দিকের কাঁধ, কোমর, হাঁটু ও গোড়ালি' },
  'bird-dog': { stages: ['হাত ও হাঁটুতে', 'হাত ও উল্টো পা প্রসারিত', 'আবার হাত ও হাঁটুতে'], why: 'আপনার পিছনের পা প্রায় {up} ডিগ্রি উঠে আবার প্রায় {down} ডিগ্রি বা কমে নামলে একটি হোল্ড গোনা হয়।', see: 'ফোনের কাছের দিকের কাঁধ, কোমর, হাঁটু ও গোড়ালি' },
  'hand-fist': { stages: ['হাত খোলা', 'হাত মুঠো করা', 'হাত আবার খোলা'], why: 'আপনার হাত পুরো মুঠোর প্রায় {up}% বন্ধ হয়ে আবার প্রায় {down}% বা কমে খুললে একটি রেপ গোনা হয়।', see: 'আপনার পুরো হাত, সব আঙুল' },
  wrist: { stages: ['কবজি সোজা', 'কবজি বাঁকানো', 'কবজি আবার সোজা'], why: 'আপনার কবজি প্রায় {up} ডিগ্রি বেঁকে আবার প্রায় {down} ডিগ্রি বা কমে ফিরলে একটি রেপ গোনা হয়।', see: 'আপনার কাঁধ, কনুই ও কবজি' },
  elbow: { stages: ['হাত সোজা', 'কনুই ভাঁজ, হাত কাঁধে', 'হাত আবার সোজা'], why: 'আপনার কনুই প্রায় {up} ডিগ্রি ভাঁজ হয়ে আবার প্রায় {down} ডিগ্রি বা কম সোজা হলে একটি রেপ গোনা হয়।', see: 'আপনার কাঁধ, কনুই, কবজি ও কোমর' },
  scap: { stages: ['কাঁধ শিথিল', 'কাঁধের হাড় একসাথে চাপা', 'কাঁধ আবার শিথিল'], why: 'আপনার কাঁধ নিজের প্রস্থের প্রায় {up}% কাছে এসে আবার প্রায় {down}% বা কমে শিথিল হলে একটি রেপ গোনা হয়।', see: 'দুই কাঁধ ও দুই কোমর, দুই কনুই ও কবজি' },
  'band-rot': { stages: ['বাহুর নিচের অংশ সামনে, কনুই পাশে', 'বাহুর নিচের অংশ বাইরে ঘোরানো', 'আবার সামনে'], why: 'আপনার বাহুর নিচের অংশ ওপরের বাহুর দৈর্ঘ্যের প্রায় {up}% বাইরে ঘুরে আবার প্রায় {down}% বা কমে ফিরলে একটি রেপ গোনা হয়।', see: 'দুই কাঁধ, কনুই, কবজি ও কোমর' },
};

export const REPINFO: Record<Lang, Record<FormKind, RepInfo>> = { en, hi, bn };

/** The counting band the phone really uses for a kind (eased in config.ts), rounded for display. */
export function repBand(kind: FormKind): { up: number; down: number } {
  const c = KINDS[kind];
  const up = c.repUp * REP.upFactor;
  const down = Math.min(c.repDown * REP.downFactor, up * 0.8);
  return { up, down };
}
const nice = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
/** The rule for a rep, in plain words, with the numbers filled in. */
export function repRule(lang: Lang, kind: FormKind): string {
  const { up, down } = repBand(kind);
  return (REPINFO[lang]?.[kind] ?? en[kind]).why.split('{up}').join(String(nice(up))).split('{down}').join(String(nice(down)));
}
export const repInfo = (lang: Lang, kind: FormKind): RepInfo => REPINFO[lang]?.[kind] ?? en[kind];

/**
 * The picture strip (start, middle, end side by side) for a kind. Variants and second angles share the strip of the exercise they belong to;
 * the shoulder side raise has no exercise in the library, so it has no picture (the captions still show).
 */
const STRIP_ID: Partial<Record<FormKind, string>> = { 'squat-side': 'squats', 'lunge-side': 'lunges', 'balance-line': 'balance', 'bird-dog': 'core', wrist: 'hand-wrist-elbow', elbow: 'hand-wrist-elbow' };
export function stageStrip(kind: FormKind): string | undefined {
  if (kind === 'shoulder-abduction') return undefined;
  const id = STRIP_ID[kind] ?? KIND_EXERCISES[kind]?.[0];
  return id ? `media/stages/${id}.png` : undefined;
}
