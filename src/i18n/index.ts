import type { Bi, Lang } from '../types';
import baseEn from './en.base.json';
import baseHi from './hi.base.json';
import { extraEn, extraHi } from './extra';

/** Neutral app name replaces "Knee Rehab Buddy" (Phase 1.7). */
export const DICT: Record<Lang, Record<string, string>> = {
  en: { ...(baseEn as Record<string, string>), ...extraEn },
  hi: { ...(baseHi as Record<string, string>), ...extraHi },
};

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let s = DICT[lang][key] ?? DICT.en[key] ?? key;
  for (const [k, v] of Object.entries(params ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
}
export const L = (b: Bi | undefined, lang: Lang): string => (b ? b[lang] || b.en : '');
