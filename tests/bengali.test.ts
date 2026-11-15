import { describe, it, expect } from 'vitest';
import { DICT, L, t } from '../src/i18n';
import { BN_CONTENT } from '../src/i18n/bn-content';
import { PACK_LIST } from '../src/engine/packs';
import { LIBRARY } from '../src/exercises/library';
import { buildPatient, decodeInvite, encodeInvite } from '../src/onboarding';
import { isLang } from '../src/types';
import { aclPack } from './helpers';

const biPairs = (o: unknown, out: Record<string, string> = {}): Record<string, string> => {
  if (Array.isArray(o)) o.forEach((x) => biPairs(x, out));
  else if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    if (typeof r.en === 'string' && typeof r.hi === 'string') out[r.en] = r.hi;
    Object.values(r).forEach((v) => biPairs(v, out));
  }
  return out;
};
const slots = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');

describe('Bengali (Phase 5.1)', () => {
  it('every screen string has a Bengali version', () => {
    const missing = Object.keys(DICT.en).filter((k) => !DICT.bn[k]);
    expect(missing).toEqual([]);
  });
  it('Bengali strings keep the same {placeholders} as English', () => {
    const bad = Object.keys(DICT.en).filter((k) => slots(DICT.en[k]) !== slots(DICT.bn[k] ?? ''));
    expect(bad).toEqual([]);
  });
  it('every built-in pack and exercise string has Bengali wording', () => {
    const all = biPairs([PACK_LIST, LIBRARY]);
    const missing = Object.keys(all).filter((en) => !BN_CONTENT[en]);
    expect(missing).toEqual([]);
  });
  it('L falls back to English (never to a wrong guess) when Bengali is missing', () => {
    expect(L({ en: 'Hello there', hi: 'नमस्ते' }, 'bn')).toBe('Hello there');
    expect(L({ en: 'Hello there', hi: 'नमस्ते', bn: 'স্বাগতম' }, 'bn')).toBe('স্বাগতম');
    expect(L({ en: 'Pain', hi: 'दर्द' }, 'bn')).toBe('ব্যথা');
    expect(L({ en: 'Pain', hi: 'दर्द' }, 'hi')).toBe('दर्द');
    expect(t('bn', 'noSuchKey')).toBe('noSuchKey');
  });
  it('a Bengali patient survives an invite round trip', () => {
    const p = buildPatient({ name: 'Anita', age: 50, language: 'bn', packId: aclPack().id, anchorDate: '2026-01-01', phaseId: 'p1', exercises: aclPack().phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: 1, today: '2026-11-15' });
    expect(p.language).toBe('bn');
    const back = decodeInvite(encodeInvite(p));
    expect(back?.patient.language).toBe('bn');
  });
  it('an unknown language code is not accepted', () => {
    expect(isLang('bn')).toBe(true);
    expect(isLang('ta')).toBe(false);
  });
});
