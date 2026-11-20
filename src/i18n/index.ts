import type { Bi, Lang } from '../types';
import baseEn from './en.base.json';
import baseHi from './hi.base.json';
import { extraEn, extraHi } from './extra';
import { p2En, p2Hi } from './phase2';
import { p4En, p4Hi } from './phase4';
import { p5En, p5Hi } from './phase5';
import { p6En, p6Hi, p6Bn } from './phase6';
import { demoEn, demoHi, demoBn } from './demo';
import { pwaEn, pwaHi, pwaBn } from './pwa';
import { quickEn, quickHi, quickBn } from './quick';
import { bnDict } from './bn';
import { BN_CONTENT } from './bn-content';

/** Neutral app name replaces "Knee Rehab Buddy" (Phase 1.7). */
export const DICT: Record<Lang, Record<string, string>> = {
  en: { ...(baseEn as Record<string, string>), ...extraEn, ...p2En, ...p4En, ...p5En, ...p6En, ...demoEn, ...pwaEn, ...quickEn },
  hi: { ...(baseHi as Record<string, string>), ...extraHi, ...p2Hi, ...p4Hi, ...p5Hi, ...p6Hi, ...demoHi, ...pwaHi, ...quickHi },
  bn: { ...bnDict, ...p6Bn, ...demoBn, ...pwaBn, ...quickBn },
};

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let s = DICT[lang][key] ?? DICT.en[key] ?? key;
  for (const [k, v] of Object.entries(params ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
}
export const L = (b: Bi | undefined, lang: Lang): string => {
  if (!b) return '';
  if (lang === 'bn') return b.bn || BN_CONTENT[b.en] || b.en;
  return b[lang] || b.en;
};
