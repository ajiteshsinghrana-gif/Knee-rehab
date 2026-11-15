/** Read-aloud via the browser's speech synthesis (no network, no LLM). */
import type { Lang } from '../types';

export const SPEECH_LANG: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN' };

/** True when the browser can speak. With a language, also false when the device has loaded its voices and none speaks that language (Bengali is not on every phone). */
export const speakSupported = (lang?: Lang): boolean => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;
  if (!lang) return true;
  const voices = window.speechSynthesis.getVoices();
  return voices.length === 0 || voices.some((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang));
};

export function speak(text: string, lang: Lang, onEnd?: () => void): () => void {
  if (!speakSupported()) { onEnd?.(); return () => {}; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG[lang];
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
  return () => window.speechSynthesis.cancel();
}
