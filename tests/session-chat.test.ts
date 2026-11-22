import { describe, it, expect } from 'vitest';
import { makeAllPatients, DEMO_TODAY_LAST } from '../src/demo/seed';
import { getPack } from '../src/engine/packs';
import { triage } from '../src/engine/triage';
import { addDays } from '../src/engine/dates';
import { TEMPLATES } from '../src/whatsapp/templates';
import { WSC, chatResult, startChat, stepChat, type Chat, type Turn } from '../src/whatsapp/sessionChat';
import { addFormRequest } from '../src/forms/model';
import { addSession } from '../src/session/engine';

const patients = makeAllPatients();
const today = addDays(DEMO_TODAY_LAST, 1);
const nowMs = Date.parse(today + 'T09:00:00Z');
let n = 0;
const ctx = { nowMs, date: today, newId: () => `wid${++n}abcd` };
const setup = (kind: 'exercises' | 'video', i = 0, lang: 'en' | 'hi' | 'bn' = 'en') => { const p = patients[i]; const pack = getPack(p.packId); return { p, pack, ...startChat(kind, p, pack, lang, nowMs) }; };
const tap = (c: Chat, id: string) => stepChat(c, id, ctx);

describe('WhatsApp guided exercises', () => {
  it('walks every exercise with Done and ends with a summary and a check-in reminder', () => {
    let { chat, turn } = setup('exercises');
    ({ chat, turn } = tap(chat, 'start'));
    let guard = 0;
    while (chat.phase === 'ex' && guard++ < 60) ({ chat, turn } = tap(chat, 'done'));
    expect(chat.phase).toBe('end');
    const out = chatResult(chat, ctx);
    expect(out.session!.via).toBe('whatsapp');
    expect(out.session!.exercises.every((x) => !x.stopped && x.setsDone >= x.setsPlanned)).toBe(true);
    expect(turn.messages.map((m) => m.text).join(' ')).toMatch(/check-in/i);
  });
  it('stopping offers the protocol\'s own reasons, records one and never says to carry on', () => {
    let { chat, turn, pack } = setup('exercises');
    ({ chat, turn } = tap(chat, 'start'));
    ({ chat, turn } = tap(chat, 'stop'));
    expect(turn.choices.map((c) => c.id)).toEqual(pack.checkIn.skipReasons.map((r) => `why:${r}`));
    const bad = tap(chat, 'why:not-a-reason');
    expect(bad.chat.phase).toBe('why');
    ({ chat, turn } = tap(chat, turn.choices[0].id));
    expect(chat.s.logs[0].stopped).toBe(pack.checkIn.skipReasons[0]);
    expect(/carry on|continue|keep going|push through/i.test(turn.messages.map((m) => m.text).join(' '))).toBe(false);
  });
  it('needing help asks consent first; "No" sends nothing; "Yes" then a video creates a request and returns to the exercise', () => {
    let { chat, turn } = setup('exercises');
    ({ chat, turn } = tap(chat, 'start'));
    const ex0 = chat.s.steps[0].exerciseId;
    ({ chat, turn } = tap(chat, 'help'));
    expect(chat.phase).toBe('consent');
    expect(turn.messages[0].text).toMatch(/112/);
    let r = tap(chat, 'no');
    expect(r.chat.requests.length).toBe(0);
    expect(r.chat.phase).toBe('ex');
    ({ chat, turn } = tap(chat, 'agree'));
    expect(chat.phase).toBe('video');
    ({ chat, turn } = tap(chat, 'sent'));
    expect(chat.requests.length).toBe(1);
    expect(chat.requests[0].exerciseId).toBe(ex0);
    expect(chat.requests[0].via).toBe('whatsapp');
    expect(chat.requests[0].consent.version.length > 0).toBe(true);
    expect(chat.phase).toBe('ex');
    expect(chat.s.logs[0].struggling).toBe(true);
  });
  it('out-of-turn taps change nothing', () => {
    const { chat } = setup('exercises');
    expect(tap(chat, 'sent').chat.requests.length).toBe(0);
    expect(tap(chat, 'agree').chat.phase).toBe('intro');
  });
});

describe('WhatsApp video request on its own', () => {
  it('picks an exercise (paged), asks consent, and never records a video without it', () => {
    let { chat, turn } = setup('video');
    expect(chat.phase).toBe('pickex');
    expect(turn.choices.length >= 1 && turn.choices.length <= 10).toBe(true);
    expect(turn.messages[0].text).toMatch(/112/);
    expect(tap(chat, 'sent').chat.requests.length).toBe(0); // no consent yet
    ({ chat, turn } = tap(chat, turn.choices[0].id));
    expect(chat.phase).toBe('consent');
    expect(tap(chat, 'sent').chat.requests.length).toBe(0);
    ({ chat, turn } = tap(chat, 'agree'));
    ({ chat, turn } = tap(chat, 'skip'));
    expect(chat.requests.length).toBe(0); // skipping the video sends nothing
  });
  it('a request changes neither the plan nor the tier', () => {
    const { p, pack, chat: c0 } = setup('video');
    let { chat } = tap(tap(c0, `ex:${c0.steps[0].exerciseId}`).chat, 'agree');
    chat = tap(chat, 'sent').chat;
    const out = chatResult(chat, ctx);
    let q = p; for (const r of out.requests) q = addFormRequest(q, r);
    expect(JSON.stringify(q.plan)).toBe(JSON.stringify(p.plan));
    expect(JSON.stringify(triage(q, pack))).toBe(JSON.stringify(triage(p, pack)));
  });
  it('a session saved from chat feeds the check-in prefill path like an app session', () => {
    let { chat } = setup('exercises');
    chat = tap(chat, 'start').chat;
    while (chat.phase === 'ex') chat = tap(chat, 'done').chat;
    const log = chatResult(chat, ctx).session!;
    expect(addSession(patients[0], log).sessions!.length).toBe(1);
  });
});

describe('WhatsApp limits and wording', () => {
  const kinds = ['exercises', 'video'] as const;
  it('every button is at most 20 characters and every list row at most 24, in all languages', () => {
    for (const lang of ['en', 'hi', 'bn'] as const) for (const kind of kinds) for (const i of [0, 1, 2, 3, 4]) {
      if (!patients[i]) continue;
      const seen: Turn[] = [];
      let { chat, turn } = setup(kind, i, lang);
      seen.push(turn);
      for (const id of ['start', 'stop', 'why:pain', 'help', 'agree', 'sent']) { const r = tap(chat, id); chat = r.chat; seen.push(r.turn); }
      for (const t of seen) { const lim = t.choices.length > 3 ? 24 : 20; for (const c of t.choices) { expect(c.label.length <= lim).toBe(true); } expect(t.choices.length <= 10).toBe(true); }
    }
  });
  it('en, hi and bn chat strings have the same keys', () => {
    const k = Object.keys(WSC.en).sort().join();
    expect(Object.keys(WSC.hi).sort().join()).toBe(k);
    expect(Object.keys(WSC.bn).sort().join()).toBe(k);
  });
  it('the form-reply template exists, is short and has no clinical detail', () => {
    const t = TEMPLATES.find((x) => x.name === 'rp_form_reply')!;
    expect(t.buttons.length).toBe(0);
    expect(t.vars.length).toBe(1);
    for (const l of ['en', 'hi', 'bn'] as const) { expect(t.body[l].length < 160).toBe(true); expect(/pain|knee|surgery|ACL|infection/i.test(t.body[l])).toBe(false); }
  });
});
