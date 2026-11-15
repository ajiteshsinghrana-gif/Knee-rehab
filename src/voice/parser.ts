/**
 * Voice check-in parser (regex only, no LLM). It PRE-FILLS the check-in; it never saves anything.
 *
 * Negation is resolved per clause. A clause ends at a comma, full stop, danda, or one of the
 * joiners: and, but, aur, par, lekin, और, लेकिन. Within a clause a negation word applies to the nearest
 * warning-sign keyword after it (within 2 tokens), otherwise to the nearest one before it.
 * Only signs the patient actually mentioned are returned; the rest stay unanswered.
 */
import { getExercise } from '../exercises/library';
import type { Exercises, Lang, ProtocolPack } from '../types';
import { SPEECH_LANG } from './speak';

export interface VoiceResult {
  pain?: number;
  swelling?: 'less' | 'same' | 'more';
  exercises?: Exercises;
  hardMovement?: string;
  /** sign id -> true (reported) / false (denied). Unmentioned signs are absent. */
  warnings: Record<string, boolean>;
}

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  शून्य: 0, एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10,
};
const NUM = '(\\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|शून्य|एक|दो|तीन|चार|पांच|पाँच|छह|छः|सात|आठ|नौ|दस|paanch|panch|chhe|saat|aath|teen|char|nau|das|ek)';
const toNum = (s: string): number => (/^\d+$/.test(s) ? Number(s) : WORD_NUM[s.toLowerCase()]);

const JOINERS = new Set(['and', 'but', 'aur', 'par', 'lekin', 'magar', 'और', 'लेकिन', 'मगर']);
const NEGATIONS = new Set(['no', 'not', 'without', 'nothing', 'nahi', 'nahin', 'nahi.', 'नहीं', 'नही', 'बिना', 'na']);

/** Split into clauses of tokens. */
export function clauses(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  const norm = text.toLowerCase().replace(/[,;.!?।|]+/g, ' | ');
  for (const tok of norm.split(/\s+/).filter(Boolean)) {
    if (tok === '|' || JOINERS.has(tok)) flush();
    else cur.push(tok);
  }
  flush();
  return out;
}

function matchTokens(clause: string[], re: RegExp): { start: number; end: number } | null {
  const str = clause.join(' ');
  const m = re.exec(str);
  if (!m) return null;
  const start = (str.slice(0, m.index).match(/ /g) ?? []).length;
  const end = start + (m[0].match(/ /g) ?? []).length;
  return { start, end };
}

/** `exerciseIds` = the patient's prescribed exercises; their library keywords decide "hardest movement". */
export function parseVoice(text: string, pack: ProtocolPack, exerciseIds: string[] = []): VoiceResult {
  const t = text.toLowerCase();
  const res: VoiceResult = { warnings: {} };

  // pain: "7 out of 10" first, then "pain/dard/दर्द N"
  const outOf = t.match(new RegExp(`${NUM}\\s*(?:out of|/)\\s*10`));
  const direct = t.match(new RegExp(`(?:pain|hurts?|dard|दर्द)\\D{0,12}?${NUM}(?!\\s*(?:out of|/))`));
  const rawPain = (outOf ?? direct)?.[1];
  if (rawPain !== undefined) {
    const n = toNum(rawPain);
    if (n >= 0 && n <= 10) res.pain = n;
  }

  // swelling (English, Hinglish, Hindi)
  if (/swelling|swollen|sujan|सूजन/.test(t)) {
    if (/\bmore\b|worse|bigger|zyada|jyada|badh|ज़्यादा|ज्यादा|बढ़/.test(t)) res.swelling = 'more';
    else if (/\bless\b|better|smaller|kam\b|कम|घट/.test(t)) res.swelling = 'less';
    else if (/same|waisi|waisa|vaisi|वैसी|वैसा|बराबर/.test(t)) res.swelling = 'same';
  }

  // exercises
  const exWord = /exercise|session|vyayam|kasrat|व्यायाम|कसरत|सेशन/.test(t);
  if (/skipp?ed|did ?n[o']t|didn't|no exercises?|not do|nahi kiya|nahin kiya|नहीं किया|नहीं कर/.test(t)) res.exercises = 'none';
  else if (/\ball\b|every|saare|sabhi|सारे|सभी|पूरे/.test(t) && exWord) res.exercises = 'all';
  else if (/some|half|one session|kuch|कुछ|आधे/.test(t) && exWord) res.exercises = 'some';

  // hardest movement, options come from the pack
  if (/hard|difficult|tough|painful|struggl|mushkil|kathin|मुश्किल|कठिन/.test(t)) {
    for (const id of exerciseIds) {
      if ((getExercise(id)?.voice ?? []).some((v) => new RegExp(v, 'i').test(t))) { res.hardMovement = id; break; }
    }
  }

  // warning signs, negation per clause
  for (const clause of clauses(text)) {
    const hits: { id: string; start: number; end: number }[] = [];
    for (const s of pack.warningSigns) {
      for (const v of s.voice ?? []) {
        const m = matchTokens(clause, new RegExp(v, 'i'));
        if (m) { hits.push({ id: s.id, ...m }); break; }
      }
    }
    if (!hits.length) continue;
    const negated = new Set<string>();
    clause.forEach((tok, i) => {
      if (!NEGATIONS.has(tok)) return;
      const next = hits.filter((h) => h.start > i && h.start - i - 1 <= 2 && !negated.has(h.id)).sort((a, b) => a.start - b.start)[0];
      const prev = hits.filter((h) => h.end < i && i - h.end - 1 <= 2 && !negated.has(h.id)).sort((a, b) => b.end - a.end)[0];
      const target = next ?? prev;
      if (target) negated.add(target.id);
    });
    for (const h of hits) {
      // A reported sign is never overwritten by a later denial ("breathless, no chest pain" stays YES).
      if (!negated.has(h.id)) res.warnings[h.id] = true;
      else if (res.warnings[h.id] === undefined) res.warnings[h.id] = false;
    }
  }
  return res;
}

export const voiceSupported = (): boolean => {
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
};

export function listen(lang: Lang, onText: (s: string) => void, onEnd: (err?: string) => void): () => void {
  const w = window as any;
  const Rec = w.SpeechRecognition || w.webkitSpeechRecognition;
  const r = new Rec();
  r.lang = SPEECH_LANG[lang];
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.continuous = false;
  r.onresult = (e: any) => onText(String(e.results[0][0].transcript));
  r.onerror = (e: any) => onEnd(String(e.error ?? 'error'));
  r.onend = () => onEnd();
  r.start();
  return () => { try { r.stop(); } catch { /* ignore */ } };
}
