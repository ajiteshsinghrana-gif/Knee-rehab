import { describe, it, expect } from 'vitest';
import { parseVoice } from '../src/voice/parser';
import { getPack } from '../src/engine/packs';

const pack = getPack('acl-reconstruction');

describe('voice parser: negation per clause (Phase 0.1)', () => {
  it('no fever, calf pain', () => {
    const r = parseVoice('no fever, calf pain', pack);
    expect(r.warnings).toEqual({ fever: false, calfPainOrRedness: true });
  });
  it('Hindi: दर्द 5, बुखार नहीं, पिंडली में दर्द', () => {
    const r = parseVoice('दर्द 5, बुखार नहीं, पिंडली में दर्द', pack);
    expect(r.pain).toBe(5);
    expect(r.warnings).toEqual({ fever: false, calfPainOrRedness: true });
  });
  it('Hinglish: fever nahi hai, pindli mein dard', () => {
    const r = parseVoice('fever nahi hai, pindli mein dard', pack);
    expect(r.warnings).toEqual({ fever: false, calfPainOrRedness: true });
  });
  it('no separators: pain 3 swelling same no calf pain', () => {
    const r = parseVoice('pain 3 swelling same no calf pain', pack);
    expect(r.pain).toBe(3);
    expect(r.swelling).toBe('same');
    expect(r.warnings).toEqual({ calfPainOrRedness: false });
  });
  it('pain 7 out of 10, chest pain and breathless', () => {
    const r = parseVoice('pain 7 out of 10, chest pain and breathless', pack);
    expect(r.pain).toBe(7);
    expect(r.warnings).toEqual({ chestPainBreathless: true });
  });
});

describe('voice parser: extra negation cases', () => {
  it('a reported sign is never overwritten by a later denial', () => {
    expect(parseVoice('breathless, no chest pain', pack).warnings).toEqual({ chestPainBreathless: true });
  });
  it('splits on "but", "aur", "लेकिन", "par"', () => {
    expect(parseVoice('no fever but calf pain', pack).warnings).toEqual({ fever: false, calfPainOrRedness: true });
    expect(parseVoice('bukhar nahi aur pindli mein dard', pack).warnings).toEqual({ fever: false, calfPainOrRedness: true });
    expect(parseVoice('बुखार नहीं लेकिन पिंडली में दर्द', pack).warnings).toEqual({ fever: false, calfPainOrRedness: true });
    expect(parseVoice('fever nahi par pindli mein dard', pack).warnings).toEqual({ fever: false, calfPainOrRedness: true });
  });
  it('negation without a comma applies to the next sign only', () => {
    expect(parseVoice('no fever calf pain', pack).warnings).toEqual({ fever: false, calfPainOrRedness: true });
  });
  it('unmentioned signs stay unanswered (voice only pre-fills)', () => {
    expect(parseVoice('pain 4', pack).warnings).toEqual({});
  });
  it('Hinglish numbness and swelling words', () => {
    const r = parseVoice('sunn hai, sujan zyada', pack);
    expect(r.warnings).toEqual({ numbness: true });
    expect(r.swelling).toBe('more');
  });
});
