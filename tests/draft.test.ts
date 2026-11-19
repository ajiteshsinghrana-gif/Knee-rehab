import { describe, it, expect } from 'vitest';
import { PASTE_PROMPT, draftFrom, parseDraftJson, quoteInText, requestDraft, reviewOf, type AiDraft } from '../src/import/draft';
import { buildConditionPack, validateDraft } from '../src/author/condition';
import { PACKS } from '../src/engine/packs';
import { unregisterExercise } from '../src/exercises/library';

// A made-up document and a made-up "AI answer" used only as fixtures. None of these numbers is clinical guidance.
const DOC = `Stroke upper limb rehabilitation protocol
Phase 1 (weeks 0-4): passive range of motion, positioning.
Move to phase 2 when shoulder pain is 3 or less on a 0-10 scale and
shoulder flexion is at least 90 degrees.
Red flags: sudden severe head-
ache, new weakness, chest pain. Contact the clinic at once.
Phase 2 (weeks 4-12): task practice, strengthening.
Do not lift the arm above shoulder height in phase 1.`;

const ai = (): AiDraft => ({
  condition: { en: 'Stroke upper limb', hi: 'स्ट्रोक ऊपरी अंग' }, anchorLabel: { en: 'after diagnosis', hi: 'निदान के बाद' }, population: 'Adults after stroke',
  phases: [
    { name: { en: 'Early', hi: 'शुरुआती' }, weeksMin: 0, weeksMax: 4, sessionsPerDay: null, followUpEveryDays: null, exercises: [{ name: { en: 'Positioning of the arm', hi: 'हाथ की स्थिति' } }], quote: 'Phase 1 (weeks 0-4): passive range of motion, positioning.' },
    { name: { en: 'Task practice', hi: 'कार्य अभ्यास' }, weeksMin: 4, weeksMax: 12, exercises: [{ name: { en: 'Task practice', hi: 'कार्य अभ्यास' } }], quote: 'Phase 2 (weeks 4-12): task practice, strengthening.' },
  ],
  measures: [{ id: 'm1', label: { en: 'Shoulder flexion', hi: 'कंधे का मोड़' }, unit: 'deg', min: 0, max: 180, step: 1, quote: 'shoulder flexion is at least 90 degrees' }],
  gates: [
    { fromPhase: 1, measure: 'pain', operator: '<=', value: 3, quote: 'shoulder pain is 3 or less on a 0-10 scale' },
    { fromPhase: 1, measure: 'm1', operator: '>=', value: 90, quote: 'shoulder flexion is at least 90 degrees' },
  ],
  rules: [{ measure: 'pain', operator: '>=', value: 8, tier: 'URGENT', quote: 'pain above 8 needs same-day review' }], // not in the document
  signs: [{ label: { en: 'Sudden severe headache', hi: 'अचानक तेज़ सिरदर्द' }, tier: 'URGENT', quote: 'sudden severe headache' }],
  precautions: [{ label: { en: 'Arm above shoulder', hi: 'कंधे से ऊपर हाथ' }, question: { en: 'Did you lift your arm above shoulder height?', hi: 'क्या आपने हाथ कंधे से ऊपर उठाया?' }, phases: [1], quote: 'Do not lift the arm above shoulder height in phase 1.' }],
  notStated: ['No criteria to leave phase 2'],
});

describe('AI protocol drafting (reader only, physio approves)', () => {
  it('finds quotes despite line breaks, hyphenation and case', () => {
    expect(quoteInText('Sudden severe headache', DOC)).toBe(true);
    expect(quoteInText('shoulder pain is 3 or less on a 0-10 scale and shoulder flexion', DOC)).toBe(true);
    expect(quoteInText('pain above 8 needs same-day review', DOC)).toBe(false);
    expect(quoteInText('ok', DOC)).toBe(false); // too short to count
  });

  it('flags an invented quote and starts it unticked-worthy; drops items with no quote or invalid numbers', () => {
    const d = ai();
    d.signs!.push({ label: { en: 'No quote', hi: 'x' }, tier: 'URGENT', quote: '' });
    d.gates!.push({ fromPhase: 1, measure: 'pain', operator: 'bigger' as never, value: 3, quote: 'shoulder pain is 3 or less' });
    const r = reviewOf(d, DOC);
    const rule = r.items.find((i) => i.kind === 'rule')!;
    expect(rule.quoteFound).toBe(false);
    expect(r.items.filter((i) => i.kind === 'sign')).toHaveLength(1);
    expect(r.items.filter((i) => i.kind === 'gate')).toHaveLength(2);
    expect(r.items.filter((i) => i.quoteFound).length).toBe(r.items.length - 1);
    expect(r.notStated).toEqual(['No criteria to leave phase 2']);
  });

  it('only ticked items reach the draft; placeholders are labelled; the draft passes the normal validator after the physio fills gaps', () => {
    const d = ai();
    const r = reviewOf(d, DOC);
    const ok = new Set(r.items.filter((i) => i.quoteFound).map((i) => i.id));
    const { draft, notes, sources } = draftFrom(d, ok, 'custom-aitest1', 'stroke.pdf');
    expect(draft.rules).toHaveLength(0); // the invented rule was not ticked
    expect(draft.phases).toHaveLength(2);
    expect(draft.measures.map((m) => m.id)).toEqual(['m1']);
    expect(draft.gates[0].criteria).toHaveLength(2);
    expect(draft.signs).toHaveLength(1);
    expect(draft.precautions[0].phases).toEqual([0]);
    expect(draft.phases[0].sessionsPerDay).toBe(2);
    expect(notes.some((n) => /placeholder/.test(n))).toBe(true);
    expect(draft.alerts?.source.hours).toBe('placeholder');
    expect(sources.every((s) => s.quote.length > 0)).toBe(true);
    expect(validateDraft(draft)).toEqual([]);
    const pack = buildConditionPack(draft);
    try {
      expect(pack.gates[0].criteria.map((c) => c.value)).toEqual([3, 90]);
      expect(pack.sources.join(' ')).toContain('stroke.pdf');
    } finally { delete (PACKS as Record<string, unknown>)[pack.id]; draft.exercises.forEach((e) => unregisterExercise(e.id)); }
  });

  it('skips items that depend on something the physio did not keep, and says so', () => {
    const d = ai();
    const r = reviewOf(d, DOC);
    const ok = new Set(r.items.filter((i) => i.quoteFound && i.id !== 'measure:0' && i.id !== 'phase:0').map((i) => i.id));
    const { draft, notes } = draftFrom(d, ok, 'custom-aitest2', 'stroke.pdf');
    expect(draft.measures).toHaveLength(0);
    expect(draft.gates.flatMap((g) => g.criteria)).toHaveLength(0); // phase 1 and its measure were not kept
    expect(notes.some((n) => /skipped/.test(n))).toBe(true);
    expect(draft.precautions).toHaveLength(0);
  });

  it('refuses plainly when there is no clinic connection or no physio sign-in (no request reaches the AI service)', async () => {
    const urls: string[] = [];
    const noConfig = (async (url: string) => { urls.push(url); return new Response('', { status: 404 }); }) as unknown as typeof fetch;
    const withConfig = (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ url: 'https://x.supabase.co', anonKey: 'k', auth: true })); }) as unknown as typeof fetch;
    const msg = async (f: typeof fetch) => { try { await requestDraft(DOC, 'a.pdf', f); return ''; } catch (e) { return (e as Error).message; } };
    expect(await msg(noConfig)).toMatch(/clinic connection/);
    expect(await msg(withConfig)).toMatch(/Sign in/);
    expect(urls.some((u) => u.includes('/functions/v1/'))).toBe(false);
  });

  it('reads pasted JSON from an AI chat: code fences and a wrapper are fine, junk is refused', () => {
    const body = JSON.stringify(ai());
    expect(parseDraftJson('Here you go:\n```json\n' + body + '\n```').phases).toHaveLength(2);
    expect(parseDraftJson(JSON.stringify({ draft: ai() })).phases).toHaveLength(2);
    expect(() => parseDraftJson('no json here')).toThrow(/not JSON/);
    expect(() => parseDraftJson('{"phases": [oops}')).toThrow(/damaged/);
    expect(() => parseDraftJson('{"condition": {}}')).toThrow(/phases/);
    // the same quote check applies to pasted JSON
    const r = reviewOf(parseDraftJson(body), DOC);
    expect(r.items.find((i) => i.kind === 'rule')!.quoteFound).toBe(false);
    expect(PASTE_PROMPT).toContain('ONLY what the document explicitly states');
  });
});
