/** Read-aloud via the browser's speech synthesis (no network, no LLM). */
import type { Lang } from '../types';

export const speakSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

export function speak(text: string, lang: Lang, onEnd?: () => void): () => void {
  if (!speakSupported()) { onEnd?.(); return () => {}; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
  return () => window.speechSynthesis.cancel();
}
