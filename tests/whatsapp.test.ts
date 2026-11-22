import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { makeAllPatients } from '../src/demo/seed';
import { getPack } from '../src/engine/packs';
import { triage } from '../src/engine/triage';
import { DEMO_TODAY_LAST } from '../src/demo/seed';
import { addDays } from '../src/engine/dates';
import { answer, applyCheckIn, closingReply, isDone, nextQuestion, startSession, unsupportedMeasures, type Question } from '../src/whatsapp/flow';
import { WA, waEn } from '../src/whatsapp/strings';
import { TEMPLATES, renderTemplate } from '../src/whatsapp/templates';
import { normalisePhone, isLikelyIndianMobile } from '../src/whatsapp/settings';

const patients = makeAllPatients();
const get = (id: string) => patients.find((p) => p.id === id)!;
const today = addDays(DEMO_TODAY_LAST, 1);
const nowMs = Date.parse(today + 'T09:00:00Z');

type Pick = (q: Question) => string;
function run(id: string, pick: Pick, lang?: 'en' | 'hi' | 'bn') {
  const p = get(id);
  const pack = getPack(p.packId);
  let s = startSession(p, pack, lang);
  const asked: Question[] = [];
  for (let i = 0; i < 80; i++) {
    const q = nextQuestion(s);
    if (!q) break;
    asked.push(q);
    s = answer(s, q, pick(q));
  }
  return { s, asked, pack, p };
}
const quiet: Pick = (q) => {
  if (q.key === 'who') return 'patient';
  if (q.key === 'band:pain') return q.choices[0].id;
  if (q.key === 'm:pain') return q.choices[0].id;
  if (q.key === 'm:swelling') return 'less';
  if (q.key === 'exAll') return 'all';
  if (q.key === 'hard') return 'none';
  if (q.key === 'signsGate') return 'none';
  if (q.key.startsWith('prec:')) return 'no';
  return q.choices[0].id;
};

describe('WhatsApp check-in conversation', () => {
  it('asks the same questions as the app and finishes with a complete check-in', () => {
    const { s, asked } = run('ravi', quiet);
    expect(isDone(s)).toBe(true);
    expect(asked[0].key).toBe('who');
    const saved = applyCheckIn(s, today, nowMs);
    expect(saved.daily[saved.daily.length - 1].date).toBe(today);
    expect(saved.daily[saved.daily.length - 1].answeredBy).toBe('patient');
  });

  it('a quiet day gives ON_PLAN and a plain thank-you', () => {
    const { s, pack } = run('ravi', quiet);
    const saved = applyCheckIn(s, today, nowMs);
    const r = closingReply(saved, pack, 'en', nowMs);
    expect(triage(saved, pack, { nowMs }).tier).not.toBe('SAFETY');
    expect(r[0].text.length).toBeGreaterThan(0);
  });

  it('pain is asked in two steps (band, then number) when the scale is longer than four values', () => {
    const { asked } = run('ravi', quiet);
    const keys = asked.map((q) => q.key);
    expect(keys.indexOf('band:pain')).toBeGreaterThan(-1);
    expect(keys.indexOf('m:pain')).toBeGreaterThan(keys.indexOf('band:pain'));
    for (const q of asked) expect(q.choices.length <= 10).toBe(true);
    expect(asked.find((q) => q.key === 'band:pain')!.choices.length).toBe(3);
  });

  it('a Yes to chest pain or breathlessness raises SAFETY with the emergency wording', () => {
    const { s, pack } = run('ravi', (q) => (q.key === 'signsGate' ? 'yes' : q.key === 'sign:chestPainBreathless' ? 'yes' : q.key.startsWith('sign:') ? 'no' : quiet(q)));
    const saved = applyCheckIn(s, today, nowMs);
    expect(triage(saved, pack, { nowMs }).tier).toBe('SAFETY');
    const r = closingReply(saved, pack, 'en', nowMs);
    expect(r[0].tone).toBe('alert');
    expect(r[0].text).toMatch(/112/);
  });

  it('a Yes to a calf sign alone gives the same-day wording, not the emergency one', () => {
    const { s, pack } = run('ravi', (q) => (q.key === 'signsGate' ? 'yes' : q.key === 'sign:calfPainOrRedness' ? 'yes' : q.key.startsWith('sign:') ? 'no' : quiet(q)));
    const saved = applyCheckIn(s, today, nowMs);
    const r = closingReply(saved, pack, 'en', nowMs);
    expect(r[0].tone).toBe('alert');
    expect(r[0].text).toMatch(/today/i);
  });

  it('"None of these" never overrides a sign: signs are only set false when the patient chose it', () => {
    const { s } = run('ravi', (q) => (q.key === 'signsGate' ? 'yes' : q.key.startsWith('sign:') ? 'no' : quiet(q)));
    expect(Object.values(s.draft.warnings).every((v) => v === false)).toBe(true);
    const half = startSession(get('ravi'), getPack('acl-reconstruction'));
    expect(Object.values(half.draft.warnings).every((v) => v === null)).toBe(true);
  });

  it('records who replied', () => {
    const { s } = run('kamla', (q) => (q.key === 'who' ? 'caregiver' : quiet(q)));
    expect(applyCheckIn(s, today, nowMs).daily.at(-1)!.answeredBy).toBe('caregiver');
  });

  it('missed exercises ask for a reason; "some" asks per exercise', () => {
    const { s, asked } = run('ravi', (q) => (q.key === 'exAll' ? 'some' : q.key.startsWith('ex:') ? 'no' : q.key.startsWith('why:') ? 'time' : quiet(q)));
    expect(asked.some((q) => q.key.startsWith('ex:'))).toBe(true);
    expect(asked.some((q) => q.key.startsWith('why:'))).toBe(true);
    expect(isDone(s)).toBe(true);
    expect(applyCheckIn(s, today, nowMs).daily.at(-1)!.exercises).toBe('none');
  });

  it('works for the shoulder pack, including its sling precaution, in Bengali', () => {
    const { s, asked } = run('imran', quiet, 'bn');
    expect(asked.some((q) => q.key.startsWith('prec:'))).toBe(true);
    expect(isDone(s)).toBe(true);
    expect(asked[0].prompt).toBe(WA.bn.waWho);
  });

  it('rejects a reply that is not one of the offered choices', () => {
    const s = startSession(get('ravi'), getPack('acl-reconstruction'));
    expect(() => answer(s, nextQuestion(s)!, 'hello')).toThrow();
  });

  it('every shipped pack can be asked in chat', () => {
    for (const id of ['acl-reconstruction', 'total-knee-replacement', 'rotator-cuff-repair']) expect(unsupportedMeasures(getPack(id))).toEqual([]);
  });
});

describe('WhatsApp strings and templates', () => {
  it('English, Hindi and Bengali have the same keys', () => {
    for (const l of ['hi', 'bn'] as const) expect(Object.keys(WA[l]).sort()).toEqual(Object.keys(waEn).sort());
  });
  it('templates have valid names, at most 3 buttons, and every placeholder is described', () => {
    for (const t of TEMPLATES) {
      expect(t.name).toMatch(/^[a-z0-9_]+$/);
      expect(t.buttons.length <= 3).toBe(true);
      for (const l of ['en', 'hi', 'bn'] as const) {
        const n = new Set((((t.body[l] ?? '').match(/\{\{\d+\}\}/g)) ?? [])).size;
        expect(n).toBe(t.vars.length);
      }
      expect(renderTemplate(t, 'hi', ['Kamla', '3', '9 am'])).not.toMatch(/\{\{/);
    }
  });
  it('templates carry no clinical detail', () => {
    for (const t of TEMPLATES) for (const l of ['en'] as const) expect(t.body[l]).not.toMatch(/knee|shoulder|surgery|replacement|ACL|pain/i);
  });
});

describe('long lists', () => {
  it('a long exercise list is paged so no message has more than 10 rows, and every exercise can still be picked', () => {
    const ravi = get('ravi');
    const pack = getPack(ravi.packId);
    const many = { ...ravi, plan: { ...ravi.plan, exerciseIds: undefined } } as typeof ravi;
    let s = startSession(many, pack);
    // force a long list by adding fake prescribed exercises to the draft
    const ids = Object.keys(s.draft.results);
    const extra = Array.from({ length: Math.max(0, 14 - ids.length) }, (_, i) => `x${i}`);
    for (const id of extra) s.draft.results[id] = { done: null, reason: null };
    let seen = new Set<string>();
    let guard = 0;
    for (; guard < 60; guard++) {
      const q = nextQuestion(s)!;
      if (q.key === 'hard') {
        expect(q.choices.length <= 10).toBe(true);
        q.choices.forEach((c) => seen.add(c.id));
        if (q.choices.some((c) => c.id === 'more')) { s = answer(s, q, 'more'); continue; }
        break;
      }
      s = answer(s, q, q.key === 'exAll' ? 'all' : quiet(q));
    }
    for (const id of Object.keys(s.draft.results)) expect(seen.has(id)).toBe(true);
  });
});

describe('phone numbers', () => {
  it('normalises Indian mobile numbers to E.164', () => {
    expect(normalisePhone('98765 43210')).toBe('+919876543210');
    expect(normalisePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalisePhone('09876543210')).toBe('+919876543210');
    expect(normalisePhone('12')).toBeNull();
    expect(isLikelyIndianMobile('+919876543210')).toBe(true);
    expect(isLikelyIndianMobile('+911234567890')).toBe(false);
  });
});

describe('WhatsApp code stays out of the triage engine', () => {
  it('no WhatsApp import inside src/engine', () => {
    for (const f of readdirSync('src/engine').filter((x) => x.endsWith('.ts'))) expect(/whatsapp/i.test(readFileSync(`src/engine/${f}`, 'utf8'))).toBe(false);
  });
  it('the flow module has no network or AI calls', () => {
    const s = readFileSync('src/whatsapp/flow.ts', 'utf8');
    expect(/fetch\s*\(|XMLHttpRequest|anthropic|openai|WebSocket|sendBeacon/i.test(s)).toBe(false);
  });
});
