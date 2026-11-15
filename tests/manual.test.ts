import { describe, it, expect } from 'vitest';
import { applyManual, currentExercises } from '../src/engine/plan';
import { buildPatient } from '../src/onboarding';
import { getPack } from '../src/engine/packs';
import { noticeText } from '../src/notices';
import { DICT } from '../src/i18n';

const NOW = Date.parse('2026-11-15T09:00:00Z');
const ctx = { nowMs: NOW, today: '2026-11-15' };
const pack = getPack('total-knee-replacement');
const mk = () => buildPatient({ name: 'Test', age: 60, language: 'hi', packId: pack.id, anchorDate: '2026-11-01', phaseId: 'p1', exercises: pack.phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: NOW, today: '2026-11-15', id: 't' });

describe('physio-initiated changes (Phase 5.4)', () => {
  it('every manual change needs a written reason', () => {
    for (const r of ['', '   ']) expect(() => applyManual(mk(), pack, { type: 'hold-progression' }, r, ctx)).toThrow(/reason/i);
    expect(() => applyManual(mk(), pack, { type: 'move-phase', toPhase: 'p2', note: '' }, '', ctx)).toThrow(/reason/i);
  });
  it('a manual move-phase cannot skip the reason even through applyAction', async () => {
    const { applyAction } = await import('../src/engine/plan');
    expect(() => applyAction(mk(), pack, { type: 'move-phase', toPhase: 'p2', note: ' ' }, ctx)).toThrow(/reason/i);
  });
  it('adding and removing exercises tells the patient, in their language, and logs the reason', () => {
    const extra = 'swimming';
    const p = applyManual(mk(), pack, { type: 'set-exercises', add: [extra] }, 'Pool access, good wound healing', ctx);
    expect(currentExercises(p, pack)).toContain(extra);
    expect(p.notices).toHaveLength(1);
    expect(p.notices[0].changes[0]).toMatchObject({ kind: 'exercises', added: [extra], removed: [] });
    expect(noticeText(p.notices[0], 'en', pack)).toMatch(/added Swimming/);
    expect(noticeText(p.notices[0], 'hi', pack)).toMatch(/आपकी कसरतें/);
    expect(noticeText(p.notices[0], 'bn', pack)).toMatch(/আপনার ব্যায়াম/);
    const last = p.audit.at(-1)!;
    expect(last.manual).toBe(true);
    expect(last.note).toBe('Pool access, good wound healing');
    const gone = applyManual(p, pack, { type: 'set-exercises', remove: [extra] }, 'Wound review', ctx);
    expect(currentExercises(gone, pack)).not.toContain(extra);
    expect(gone.notices.at(-1)!.changes[0]).toMatchObject({ kind: 'exercises', removed: [extra] });
  });
  it('a change that changes nothing tells the patient nothing', () => {
    const first = currentExercises(mk(), pack)[0];
    const p = applyManual(mk(), pack, { type: 'set-exercises', add: [first] }, 'already there', ctx);
    expect(p.notices).toHaveLength(0);
  });
  it('the physio can move a patient to a phase before the gate is met, and back, with the override recorded', () => {
    const p = applyManual(mk(), pack, { type: 'move-phase', toPhase: 'p2', note: 'x' }, 'Ahead of schedule on clinic assessment', ctx);
    expect(p.currentPhase).toBe('p2');
    expect(p.phaseStartDate).toBe('2026-11-15');
    const a = p.audit.at(-1)!;
    expect(a.manual).toBe(true);
    expect((a.after as any).overrodeProtocol).toBe(true);
    expect((a.after as any).unmetCriteria.length).toBeGreaterThan(0);
    expect(p.notices.at(-1)!.changes[0]).toEqual({ kind: 'phase', phaseId: 'p2' });
    const back = applyManual(p, pack, { type: 'move-phase', toPhase: 'p1', note: 'x' }, 'Flare-up, go back', ctx);
    expect(back.currentPhase).toBe('p1');
    expect((back.audit.at(-1)!.after as any).direction).toBe('back');
  });
  it('moving phase drops the old phase swaps and additions', () => {
    let p = applyManual(mk(), pack, { type: 'set-exercises', add: ['swimming'] }, 'r', ctx);
    p = applyManual(p, pack, { type: 'move-phase', toPhase: 'p2', note: 'x' }, 'r', ctx);
    expect(p.plan.added).toEqual([]);
  });
  it('unknown phase and same phase are refused', () => {
    expect(() => applyManual(mk(), pack, { type: 'move-phase', toPhase: 'nope', note: 'x' }, 'r', ctx)).toThrow();
    expect(() => applyManual(mk(), pack, { type: 'move-phase', toPhase: 'p1', note: 'x' }, 'r', ctx)).toThrow(/already/);
  });
  it('hold and release are manual too and tell the patient', () => {
    const h = applyManual(mk(), pack, { type: 'hold-progression' }, 'Swelling', ctx);
    expect(h.plan.hold).not.toBeNull();
    expect(h.notices.at(-1)!.changes[0].kind).toBe('hold');
    const r = applyManual(h, pack, { type: 'release-hold' }, 'Settled', ctx);
    expect(r.plan.hold).toBeNull();
  });
  it('only plan changes are allowed as manual changes', () => {
    expect(() => applyManual(mk(), pack, { type: 'record', action: 'x', status: 'approved' }, 'r', ctx)).toThrow(/not available/);
  });
  it('new notice wording exists in all three languages', () => {
    for (const l of ['en', 'hi', 'bn'] as const) for (const k of ['change_exAdded', 'change_exRemoved', 'change_exercises']) expect(DICT[l][k]).toBeDefined();
  });
});
