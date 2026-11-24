import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeAllPatients, DEMO_TODAY_LAST } from '../src/demo/seed';
import { getPack } from '../src/engine/packs';
import { triage } from '../src/engine/triage';
import { addDays } from '../src/engine/dates';
import { getExercise } from '../src/exercises/library';
import { FormAnalyzer, type Frame, type FormEvent } from '../src/formcheck/analyze';
import { FORM_CHECK, HAND, HAND_KINDS, KINDS, KIND_EXERCISES, LM, SET_FAULTS, VARIANTS, formKindFor, type FormKind } from '../src/formcheck/config';
import { FAULT_PHYSIO, FC_STRINGS } from '../src/formcheck/strings';
import { requestForClip } from '../src/formcheck/model';
import { assess, attachClip, f1Faults, giveConsent, hasConsent, newCheckLog, pendingChecks, recordCheck, setFormLimit, withdrawConsent } from '../src/formcheck/model';
import { isPending, replyToForm } from '../src/forms/model';
import { applyDown, applyUp, downSlice, upSlice } from '../src/sync/slices';
import { exportMyData } from '../src/lifecycle';
import type { FormCheckLog, Patient } from '../src/types';

// ---------- synthetic bodies (no camera): 33 points, all visible unless a test hides them ----------
const blank = (): Frame => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 1 }));
const rad = (d: number) => (d * Math.PI) / 180;

/** Side view, lying on the back, camera sees the left side. Head on the left, leg to the right. */
function slr(lift: number, o: { kneeBend?: number; roll?: number } = {}): Frame {
  const f = blank();
  const H = { x: 0.45, y: 0.6 };
  const roll = o.roll ?? 0;
  const S = { x: H.x - 0.25 * Math.cos(rad(roll)), y: H.y - 0.25 * Math.sin(rad(roll)) };
  const K = { x: H.x + 0.2 * Math.cos(rad(lift)), y: H.y - 0.2 * Math.sin(rad(lift)) };
  const a = lift - (o.kneeBend ?? 0);
  const A = { x: K.x + 0.2 * Math.cos(rad(a)), y: K.y - 0.2 * Math.sin(rad(a)) };
  f[LM.lShoulder] = { ...S, v: 1 }; f[LM.lHip] = { ...H, v: 1 }; f[LM.lKnee] = { ...K, v: 1 }; f[LM.lAnkle] = { ...A, v: 1 };
  for (const i of [LM.rShoulder, LM.rHip, LM.rKnee, LM.rAnkle]) f[i] = { x: 0.5, y: 0.5, v: 0 };
  return f;
}
/** Front view squat. `drop` is the hip drop as a share of leg length. */
function squat(drop: number, o: { kneeIn?: number; lean?: number; footShift?: number } = {}): Frame {
  const f = blank();
  const leg = 0.4, hipY = 0.5 + drop * leg;
  const hips = [{ x: 0.45, y: hipY }, { x: 0.55, y: hipY }];
  const ank = [{ x: 0.43 - (o.footShift ?? 0) * leg, y: 0.9 }, { x: 0.57, y: 0.9 }];
  const thigh = Math.hypot(0, (0.9 - hipY) / 2);
  const knees = [0, 1].map((i) => {
    const t = 0.5;
    const x = hips[i].x + (ank[i].x - hips[i].x) * t;
    const inward = (o.kneeIn ?? 0) * thigh * (i === 0 ? 1 : -1); // left knee moves right (towards the middle), right knee moves left
    return { x: x + inward, y: hips[i].y + (ank[i].y - hips[i].y) * t };
  });
  f[LM.lHip] = { ...hips[0], v: 1 }; f[LM.rHip] = { ...hips[1], v: 1 };
  f[LM.lKnee] = { ...knees[0], v: 1 }; f[LM.rKnee] = { ...knees[1], v: 1 };
  f[LM.lAnkle] = { ...ank[0], v: 1 }; f[LM.rAnkle] = { ...ank[1], v: 1 };
  const sy = hipY - 0.25, lean = (o.lean ?? 0);
  const dx = Math.tan(rad(lean)) * 0.25;
  f[LM.lShoulder] = { x: 0.42 + dx, y: sy, v: 1 }; f[LM.rShoulder] = { x: 0.58 + dx, y: sy, v: 1 };
  return f;
}
/** Front view, left arm raised sideways by `lift` degrees. */
function abd(lift: number, o: { elbowBend?: number } = {}): Frame {
  const f = blank();
  f[LM.lShoulder] = { x: 0.4, y: 0.3, v: 1 }; f[LM.rShoulder] = { x: 0.6, y: 0.3, v: 1 };
  f[LM.lHip] = { x: 0.4, y: 0.65, v: 1 }; f[LM.rHip] = { x: 0.6, y: 0.65, v: 1 };
  const L = 0.15;
  f[LM.lElbow] = { x: 0.4 - L * Math.sin(rad(lift)), y: 0.3 + L * Math.cos(rad(lift)), v: 1 };
  const w = lift - (o.elbowBend ?? 0);
  f[LM.lWrist] = { x: f[LM.lElbow].x - L * Math.sin(rad(w)), y: f[LM.lElbow].y + L * Math.cos(rad(w)), v: 1 };
  f[LM.rElbow] = { x: 0.6, y: 0.3 + L, v: 1 }; f[LM.rWrist] = { x: 0.6, y: 0.3 + 2 * L, v: 1 };
  f[LM.lEar] = { x: 0.43, y: 0.2, v: 1 }; f[LM.rEar] = { x: 0.57, y: 0.2, v: 1 };
  return f;
}

const FPS = 15;
const DT = 1000 / FPS;
/** Runs `reps` repetitions: 10 resting frames, then each rep rises and falls over `frames` frames. */
function run(kind: FormKind, make: (v: number, i: number) => Frame, peak: number, o: { reps?: number; frames?: number; limit?: { max?: number; min?: number }; hideFrom?: number } = {}) {
  const a = new FormAnalyzer(kind, o.limit);
  const events: FormEvent[] = [];
  let t = 1000, n = 0;
  const frame = (v: number) => {
    let f = make(v, n++);
    if (o.hideFrom !== undefined && n > o.hideFrom) f = f.map((p) => ({ ...p, v: 0 }));
    events.push(...a.push(f, t, 1)); t += DT;
  };
  for (let i = 0; i < 10; i++) frame(0);
  for (let r = 0; r < (o.reps ?? 5); r++) {
    const m = o.frames ?? 40;
    for (let i = 0; i <= m; i++) frame(peak * Math.sin((Math.PI * i) / m));
    for (let i = 0; i < 4; i++) frame(0);
  }
  return { a, events, sum: a.finish() };
}
const ids = (s: ReturnType<FormAnalyzer['finish']>) => s.faults.map((f) => f.id);

describe('camera form check: counting and measuring', () => {
  it('counts straight leg raises and flags nothing for clean ones', () => {
    const { sum } = run('slr', (v) => slr(v), 35);
    expect(sum.reps).toBe(5);
    expect(sum.faults).toEqual([]);
    expect(sum.reliable).toBe(true);
    expect(sum.paused).toBe(false);
  });
  it('does not count a small wobble below the rep threshold', () => {
    const { sum } = run('slr', (v) => slr(v), KINDS.slr.repUp - 6);
    expect(sum.reps).toBe(0);
  });
  it('measures a bent knee during the lift', () => {
    const { sum } = run('slr', (v) => slr(v, { kneeBend: v > 10 ? 35 : 0 }), 35);
    const f = sum.faults.find((x) => x.id === 'slr-knee-bent')!;
    expect(f).toBeTruthy();
    expect(f.kind).toBe('posture');
    expect(f.reps).toEqual([1, 2, 3, 4, 5]);
    expect(f.peak).toBeGreaterThan(30);
  });
  it('measures the trunk turning away from where it started', () => {
    const { sum } = run('slr', (v) => slr(v, { roll: v > 5 ? 22 : 0 }), 35);
    expect(ids(sum)).toContain('slr-trunk-shift');
    expect(sum.faults.find((x) => x.id === 'slr-trunk-shift')!.kind).toBe('compensation');
  });
  it('measures a fast lift but not a slow one', () => {
    expect(ids(run('slr', (v) => slr(v), 60, { frames: 10 }).sum)).toContain('slr-fast');
    expect(ids(run('slr', (v) => slr(v), 35, { frames: 40 }).sum)).not.toContain('slr-fast');
  });
  it('counts squats from the hip drop and measures knees moving inwards', () => {
    const clean = run('squat', (v) => squat(v / 100), 25);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    const bad = run('squat', (v) => squat(v / 100, { kneeIn: v > 6 ? 0.35 : 0 }), 25);
    expect(bad.sum.faults.find((x) => x.id === 'squat-knee-in')?.kind).toBe('posture');
  });
  it('does not take a moving person as the standing position: stepping back first causes no balance fault', () => {
    const a = new FormAnalyzer('squat');
    let t = 0;
    for (let i = 0; i < 14; i++) { const f = squat(0).map((p) => ({ ...p, x: p.x + i * 0.012 })); a.push(f, (t += DT), 1); } // still walking
    for (let i = 0; i < 12; i++) a.push(squat(0).map((p) => ({ ...p, x: p.x + 0.17 })), (t += DT), 1); // now standing still
    for (let r = 0; r < 4; r++) { for (let i = 0; i <= 40; i++) a.push(squat((25 * Math.sin((Math.PI * i) / 40)) / 100).map((p) => ({ ...p, x: p.x + 0.17 })), (t += DT), 1); for (let i = 0; i < 4; i++) a.push(squat(0).map((p) => ({ ...p, x: p.x + 0.17 })), (t += DT), 1); }
    const sum = a.finish();
    expect(sum.reps).toBe(4);
    expect(ids(sum)).not.toContain('squat-balance');
  });
  it('measures a sideways lean in the squat', () => {
    const { sum } = run('squat', (v) => squat(v / 100, { lean: v > 6 ? 18 : 0 }), 25);
    expect(ids(sum)).toContain('squat-lean');
  });
  it('a moved foot in the squat is a stability fault and asks the patient to pause', () => {
    const { sum, events } = run('squat', (v) => squat(v / 100, { footShift: v > 6 ? 0.25 : 0 }), 25);
    expect(sum.faults.find((x) => x.id === 'squat-balance')?.kind).toBe('stability');
    expect(events.some((e) => e.type === 'pause')).toBe(true);
    expect(sum.paused).toBe(true);
  });
  it('counts shoulder abduction and measures a bent elbow', () => {
    const clean = run('shoulder-abduction', (v) => abd(v), 80);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    const bent = run('shoulder-abduction', (v) => abd(v, { elbowBend: v > 20 ? 45 : 0 }), 80);
    expect(ids(bent.sum)).toContain('abd-elbow-bent');
  });
  it("the physio's maximum makes the phone ask to pause and is recorded as a patient-specific limit", () => {
    const { sum, events } = run('shoulder-abduction', (v) => abd(v), 100, { limit: { max: 90 } });
    expect(sum.faults.find((x) => x.id === 'limit-max')?.kind).toBe('precaution');
    expect(events.some((e) => e.type === 'pause')).toBe(true);
    expect(sum.paused).toBe(true);
    // Within the limit: nothing.
    expect(ids(run('shoulder-abduction', (v) => abd(v), 80, { limit: { max: 90 } }).sum)).not.toContain('limit-max');
  });
  it("the physio's minimum flags a set that stays short of the range", () => {
    const { sum } = run('slr', (v) => slr(v), 28, { limit: { min: 40 } });
    expect(sum.reps).toBe(5);
    expect(sum.faults.find((x) => x.id === 'limit-min')?.kind).toBe('range');
  });
  it('is deterministic: the same frames give the same result', () => {
    const a = run('slr', (v) => slr(v, { kneeBend: v > 10 ? 35 : 0 }), 35).sum;
    const b = run('slr', (v) => slr(v, { kneeBend: v > 10 ? 35 : 0 }), 35).sum;
    expect(b).toEqual(a);
  });
});

describe('camera form check: honesty when the camera cannot see', () => {
  it('flags nothing, and says so, when the body is out of view for much of the set', () => {
    const { sum } = run('slr', (v) => slr(v, { kneeBend: v > 10 ? 35 : 0 }), 35, { hideFrom: 40 });
    expect(sum.reliable).toBe(false);
    expect(sum.faults).toEqual([]);
    expect(sum.paused).toBe(false);
  });
  it('tells the patient when it cannot see them, and when it can again', () => {
    const a = new FormAnalyzer('slr');
    const ev: FormEvent[] = [];
    let t = 0;
    for (let i = 0; i < 20; i++) ev.push(...a.push(slr(0), (t += DT), 1));
    for (let i = 0; i < 20; i++) ev.push(...a.push(slr(0).map((p) => ({ ...p, v: 0 })), (t += DT), 1));
    for (let i = 0; i < 5; i++) ev.push(...a.push(slr(0), (t += DT), 1));
    expect(ev.filter((e) => e.type === 'unseen')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'seen')).toHaveLength(1);
  });
  it('a very short set is unreliable', () => {
    const a = new FormAnalyzer('slr');
    for (let i = 0; i < 5; i++) a.push(slr(0), i * DT, 1);
    expect(a.finish().reliable).toBe(false);
  });
  it('bad input does not crash or flag', () => {
    const a = new FormAnalyzer('squat');
    expect(() => { a.push([], 0, 1); a.push(null as unknown as Frame, 100, 1); a.push(blank(), 200, 0); }).not.toThrow();
    expect(a.finish().faults).toEqual([]);
  });
});

// ---------- the review rules ----------
const base = makeAllPatients().find((p) => p.id === 'ravi')!;
const pack = getPack(base.packId);
const today = addDays(DEMO_TODAY_LAST, 1);
const at = (k = 0) => `${addDays(today, k)}T09:00:00.000Z`;
const ctx = { nowMs: Date.parse(at()), today };
const fault = (id: string, kind: 'posture' | 'stability' = 'posture', reps = [1, 2, 3]) => ({ id, kind, reps, peak: 30, unit: 'deg' as const, firstSec: 3 });
const check = (n: number, faults = [fault('slr-knee-bent')], over: Partial<FormCheckLog> = {}): FormCheckLog => ({
  id: `c${n}`, date: addDays(today, n), startedAt: Date.parse(at(n)), endedAt: Date.parse(at(n)) + 60000, exerciseId: 'straight-leg-raise', kind: 'slr',
  repsCounted: 5, faults, usable: 0.95, reliable: true, paused: false, answeredBy: 'patient', ...over,
});

describe('rule F1: the same fault repeating', () => {
  it('needs the fault in 3 of the last 5 reliable checks', () => {
    const hist = [check(1), check(2)];
    expect(f1Faults(hist, check(3))).toEqual(['slr-knee-bent']);
    expect(f1Faults([check(1)], check(2))).toEqual([]);
    expect(f1Faults([check(1, []), check(2)], check(3))).toEqual([]);
  });
  it('ignores checks the camera could not judge, other exercises, and old checks outside the window', () => {
    expect(f1Faults([check(1, [], { reliable: false }), check(2)], check(3))).toEqual([]);
    expect(f1Faults([check(1, [fault('slr-knee-bent')], { exerciseId: 'squats' }), check(2)], check(3))).toEqual([]);
    const old = [check(1), check(2), check(3, []), check(4, []), check(5, [])];
    expect(f1Faults(old, check(6, []))).toEqual([]);
  });
  it('a fault seen in only one rep of a long set is not "present"', () => {
    const one = (n: number) => check(n, [fault('slr-knee-bent', 'posture', [2])]);
    expect(f1Faults([one(1), one(2)], one(3))).toEqual([]);
  });
});

describe('raising a review item', () => {
  it('raises one form-check request on the 3rd repeat, with numbers only and no tier change', () => {
    let p: Patient = base;
    for (const n of [1, 2]) p = recordCheck(p, check(n), at(n)).patient;
    expect(pendingChecks(p)).toHaveLength(0);
    const r = recordCheck(p, check(3), at(3));
    expect(r.assessment.raise).toBe('F1');
    expect(r.requestId).toBeTruthy();
    const req = r.patient.formRequests!.find((x) => x.id === r.requestId)!;
    expect(req.auto).toEqual({ checkId: 'c3', reason: 'F1', faults: ['slr-knee-bent'] });
    expect(req.clip).toBeNull();
    expect(req.consent.version).toBe(FORM_CHECK.consentVersion);
    expect(isPending(req)).toBe(true);
    expect(r.patient.formChecks!.find((x) => x.id === 'c3')!.requestId).toBe(r.requestId);
    // The same triage as before: a form check never changes a tier, a trigger or a due time.
    expect(triage(r.patient, pack)).toEqual(triage(base, pack));
  });
  it('does not pile up requests while the physio has one open, and raises a new one after the reply', () => {
    let p: Patient = base;
    for (const n of [1, 2, 3]) p = recordCheck(p, check(n), at(n)).patient;
    const again = recordCheck(p, check(4), at(4));
    expect(again.requestId).toBeNull();
    expect(pendingChecks(again.patient)).toHaveLength(1);
    const id = pendingChecks(p)[0].id;
    p = replyToForm(p, id, { by: 'Dr A', text: 'Keep the knee straight', points: [], at: at(4) }, ctx);
    expect(pendingChecks(p)).toHaveLength(0);
    const later = recordCheck(p, check(9), at(9));
    expect(later.requestId).toBeTruthy();
  });
  it('a pause raises a request at once; an unreliable set raises nothing and keeps no faults', () => {
    const pause = recordCheck(base, check(1, [fault('squat-balance', 'stability', [2])], { exerciseId: 'squats', kind: 'squat', paused: true }), at(1));
    expect(pause.assessment.raise).toBe('PAUSE');
    expect(pause.patient.formRequests!.at(-1)!.auto!.reason).toBe('PAUSE');
    const unsure = recordCheck(base, check(2, [], { reliable: false }), at(2));
    expect(assess(base, check(2, [], { reliable: false })).unreliable).toBe(true);
    expect(unsure.requestId).toBeNull();
    expect(unsure.patient.formChecks).toHaveLength(1);
  });
  it('the patient can attach the clip afterwards; it follows the normal 30 day rule', () => {
    const r = recordCheck(base, check(1, [fault('squat-balance', 'stability', [2])], { paused: true }), at(1));
    const p = attachClip(r.patient, r.requestId!, { where: 'device', ref: 'vabc', mime: 'video/webm', size: 1000, durationSec: null }, at(1));
    expect(p.formRequests!.find((x) => x.id === r.requestId)!.clip!.deleteAfter).toBe(addDays(addDays(today, 1), 30));
  });
  it('a second flagged set can still send its own video while the first item is unanswered', () => {
    let p: Patient = base;
    for (const n of [1, 2, 3]) p = recordCheck(p, check(n), at(n)).patient;
    const second = check(4);
    const r = recordCheck(p, second, at(4));
    expect(r.requestId).toBeNull();
    const a = assess(p, second);
    expect(a.raise).toBe('F1');
    const v = requestForClip(r.patient, second, a, at(4));
    expect(v.requestId).toBeTruthy();
    expect(pendingChecks(v.patient)).toHaveLength(2);
    const again = requestForClip(v.patient, second, a, at(4));
    expect(again.patient.formRequests).toHaveLength(v.patient.formRequests!.length); // sending twice does not duplicate
    const clean = requestForClip(base, check(9, []), assess(base, check(9, [])), at(9));
    expect(clean.requestId).toBeTruthy(); // a clean set can still send its video, as a plain item without numbers
    expect(clean.patient.formRequests?.[0].auto).toBeUndefined();
  });
  it('consent is explicit, versioned and can be withdrawn', () => {
    expect(hasConsent(base)).toBe(false);
    const p = giveConsent(base, 'patient', at());
    expect(hasConsent(p)).toBe(true);
    expect(hasConsent(withdrawConsent(p))).toBe(false);
    expect(hasConsent({ ...p, formCheckConsent: { ...p.formCheckConsent!, version: 'old' } })).toBe(false);
  });
  it('keeps the newest 60 checks', () => {
    let p: Patient = base;
    for (let n = 0; n < 65; n++) p = recordCheck(p, check(n, []), at(n)).patient;
    expect(p.formChecks).toHaveLength(FORM_CHECK.keepChecks);
  });
});

describe("the physio's limits", () => {
  it('need a reason, are range-checked, and are written to the audit log', () => {
    expect(setFormLimit(base, 'squats', { max: 40 }, '  ', ctx)).toBe(base);
    expect(setFormLimit(base, 'shoulder-abduction', { max: 400 }, 'x', ctx)).toBe(base);
    expect(setFormLimit(base, 'shoulder-abduction', { max: 60, min: 70 }, 'x', ctx)).toBe(base);
    expect(setFormLimit(base, 'quad-set', { max: 40 }, 'x', ctx)).toBe(base);
    const p = setFormLimit(base, 'shoulder-abduction', { max: 90 }, 'Repair at 6 weeks, no overhead', ctx);
    expect(p.formLimits!['shoulder-abduction']).toMatchObject({ max: 90, by: 'physio' });
    const a = p.audit.at(-1)!;
    expect(a.action).toBe('form-limit');
    expect(a.note).toContain('no overhead');
  });
  it('removing the last limit keeps an empty set so the removal reaches the patient', () => {
    const p = setFormLimit(base, 'shoulder-abduction', { max: 90 }, 'r', ctx);
    const q = setFormLimit(p, 'shoulder-abduction', {}, 'lifted', ctx);
    expect(q.formLimits).toEqual({});
    const phone = applyDown({ ...base, formLimits: p.formLimits }, downSlice(q));
    expect(phone.formLimits).toBeUndefined();
  });
});

describe('sync and data rights', () => {
  const withChecks = (): Patient => {
    let p: Patient = base;
    for (const n of [1, 2, 3]) p = recordCheck(p, check(n), at(n)).patient;
    return p;
  };
  it('checks and the request they raised travel patient to physio, merged by id', () => {
    const phone = withChecks();
    const physio = applyUp({ ...base, formRequests: [], formChecks: undefined }, upSlice(phone));
    expect(physio.formChecks!.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(physio.formRequests!.find((r) => r.auto)?.auto).toEqual({ checkId: 'c3', reason: 'F1', faults: ['slr-knee-bent'] });
    expect(applyUp(physio, upSlice(phone)).formChecks).toHaveLength(3); // no duplicates
  });
  it('junk in the slice is dropped field by field', () => {
    const up = { ...upSlice(withChecks()), checks: [{ ...check(1), faults: [{ id: 'x', kind: 'evil', reps: [1], peak: 1, unit: 'deg', firstSec: 0 }, fault('slr-fast')], plan: 'hack' }, { id: 5 }, null, 'x'] } as unknown;
    const got = applyUp(base, up).formChecks!;
    expect(got).toHaveLength(1);
    expect(got[0].faults.map((f) => f.id)).toEqual(['slr-fast']);
    expect((got[0] as unknown as Record<string, unknown>).plan).toBeUndefined();
  });
  it("the physio's limits travel physio to patient and are cleaned", () => {
    const physio = setFormLimit(base, 'shoulder-abduction', { max: 90 }, 'r', ctx);
    expect(applyDown(base, downSlice(physio)).formLimits).toMatchObject({ 'shoulder-abduction': { max: 90 } });
    const evil = { ...downSlice(physio), formLimits: { a: { max: 9999, at: 'x', by: 'y' }, b: 5, c: { at: 'x', by: 'y' } } };
    expect(applyDown(base, evil).formLimits).toEqual({ a: { max: 180, at: 'x', by: 'y' } });
  });
  it('a patient phone cannot send itself a limit, and the physio side ignores limits in the up slice', () => {
    const up = { ...upSlice(base), formLimits: { squats: { max: 1, at: 'x', by: 'y' } } } as unknown;
    expect(applyUp(base, up).formLimits).toBeUndefined();
  });
  it('"download my data" includes the camera checks and consent', () => {
    const p = giveConsent(withChecks(), 'patient', at());
    const d = exportMyData(p, 'ACL', Date.now()) as unknown as { cameraFormChecks: unknown[]; cameraConsent: unknown };
    expect(d.cameraFormChecks).toHaveLength(3);
    expect(d.cameraConsent).toBeTruthy();
  });
});

describe('safety and wording', () => {
  it('every threshold is a placeholder that says it needs physio sign-off', () => {
    expect(FORM_CHECK.source).toBe('NEEDS_PHYSIO_SIGNOFF');
    expect(readFileSync('src/formcheck/config.ts', 'utf8')).toContain('NEEDS_PHYSIO_SIGNOFF');
  });
  it('the measuring and rule files use no network and no AI; only the model loader reaches out, and only for model files', () => {
    for (const f of ['analyze', 'model', 'config', 'strings']) {
      const src = readFileSync(`src/formcheck/${f}.ts`, 'utf8');
      expect(src).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|openai|anthropic|\bllm\b|gpt|claude/i);
    }
    const ui = readFileSync('src/ui/FormCheck.tsx', 'utf8');
    expect(ui).not.toMatch(/fetch\(|XMLHttpRequest|openai|anthropic/i);
  });
  it('no triage or engine file mentions the form check: a fault can never raise a tier', () => {
    for (const f of ['triage', 'gates', 'actions', 'plan', 'schedule']) expect(readFileSync(`src/engine/${f}.ts`, 'utf8')).not.toMatch(/formCheck|formChecks|formcheck/);
    expect(FORM_CHECK.pauseOn).not.toContain('control' as never);
  });
  it('English, Hindi and Bengali have exactly the same keys and the same {placeholders}', () => {
    const en = Object.keys(FC_STRINGS.en).sort();
    for (const l of ['hi', 'bn'] as const) {
      expect(Object.keys(FC_STRINGS[l]).sort()).toEqual(en);
      for (const k of en) {
        const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
        expect(ph(FC_STRINGS[l][k])).toBe(ph(FC_STRINGS.en[k]));
        expect(FC_STRINGS[l][k].trim()).not.toBe('');
      }
    }
  });
  it('every fault the checks can raise has patient wording in three languages and physio wording', () => {
    const all = new Set<string>(['limit-max', 'limit-min', ...SET_FAULTS.map((x) => x.id)]);
    for (const k of Object.values(KINDS)) for (const f of k.faults) all.add(f.id);
    for (const id of all) {
      expect(FAULT_PHYSIO[id]).toBeTruthy();
      for (const l of ['en', 'hi', 'bn'] as const) expect(FC_STRINGS[l][`fault-${id}`]).toBeTruthy();
    }
  });
  it('the patient wording never claims a diagnosis or that anything is safe', () => {
    const en = Object.values(FC_STRINGS.en).join(' ').toLowerCase();
    expect(en).not.toMatch(/you are injured|you have injured|you will (get|be) hurt|dangerous|diagnos(is|ed) you/);
    expect(FC_STRINGS.en.fcNot).toMatch(/never says an exercise is safe/);
    expect(FC_STRINGS.en.fcNone).toMatch(/does not mean/);
  });
  it('exercise mapping: squats and straight leg raise exist in the library; shoulder abduction needs a physio-written exercise', () => {
    for (const id of [...KIND_EXERCISES.slr, ...KIND_EXERCISES.squat]) expect(getExercise(id)).toBeTruthy();
    expect(formKindFor('straight-leg-raise')).toBe('slr');
    expect(formKindFor('mini-squats')).toBe('squat');
    expect(formKindFor('shoulder-abduction')).toBe('shoulder-abduction');
    expect(formKindFor('walking-aid')).toBeNull();
  });
  it('newCheckLog refuses an exercise the camera cannot measure', () => {
    const summary = new FormAnalyzer('slr').finish();
    expect(() => newCheckLog({ id: 'x1', date: today, startedAt: 0, endedAt: 1, exerciseId: 'walking-aid', summary, by: 'patient' })).toThrow();
  });
});

// ---------- the other exercises: each kind counts reps, stays quiet when clean and measures its own faults ----------
/** Side view, lying: knee bends by `flex` degrees; `roll` turns the trunk. Left side visible. */
function kneeFlex(flex: number, roll = 0): Frame {
  const f = blank();
  const H = { x: 0.45, y: 0.6 };
  const S = { x: H.x - 0.25 * Math.cos(rad(roll)), y: H.y - 0.25 * Math.sin(rad(roll)) };
  const K = { x: H.x + 0.2, y: H.y };
  const A = { x: K.x + 0.2 * Math.cos(rad(flex)), y: K.y - 0.2 * Math.sin(rad(flex)) };
  f[LM.lShoulder] = { ...S, v: 1 }; f[LM.lHip] = { ...H, v: 1 }; f[LM.lKnee] = { ...K, v: 1 }; f[LM.lAnkle] = { ...A, v: 1 };
  for (const i of [LM.rShoulder, LM.rHip, LM.rKnee, LM.rAnkle]) f[i] = { x: 0.5, y: 0.5, v: 0 };
  return f;
}
/** Side view, standing: left arm raised forwards by `lift` degrees, trunk leaning by `lean` degrees. */
function armFwd(lift: number, lean = 0): Frame {
  const f = blank();
  const H = { x: 0.5, y: 0.6 };
  const S = { x: H.x + 0.25 * Math.sin(rad(lean)), y: H.y - 0.25 * Math.cos(rad(lean)) };
  const E = { x: S.x + 0.15 * Math.sin(rad(lift)), y: S.y + 0.15 * Math.cos(rad(lift)) };
  f[LM.lShoulder] = { ...S, v: 1 }; f[LM.lHip] = { ...H, v: 1 }; f[LM.lElbow] = { ...E, v: 1 };
  for (const i of [LM.rShoulder, LM.rHip, LM.rElbow]) f[i] = { x: 0.5, y: 0.5, v: 0 };
  return f;
}
/** Front view, standing: left leg moves out by `out` degrees. */
function legOut(out: number, o: { lean?: number; kneeBend?: number } = {}): Frame {
  const f = blank();
  const dx = Math.tan(rad(o.lean ?? 0)) * 0.25;
  f[LM.lShoulder] = { x: 0.42 + dx, y: 0.3, v: 1 }; f[LM.rShoulder] = { x: 0.58 + dx, y: 0.3, v: 1 };
  const H = { x: 0.45, y: 0.55 };
  const K = { x: H.x - 0.2 * Math.sin(rad(out)), y: H.y + 0.2 * Math.cos(rad(out)) };
  const a = out + (o.kneeBend ?? 0);
  const A = { x: K.x - 0.2 * Math.sin(rad(a)), y: K.y + 0.2 * Math.cos(rad(a)) };
  f[LM.lHip] = { ...H, v: 1 }; f[LM.lKnee] = { ...K, v: 1 }; f[LM.lAnkle] = { ...A, v: 1 };
  f[LM.rHip] = { x: 0.55, y: 0.55, v: 1 }; f[LM.rKnee] = { x: 0.55, y: 0.75, v: 1 }; f[LM.rAnkle] = { x: 0.55, y: 0.95, v: 1 };
  return f;
}
/** Side view, lying on the back: hips lift by `rise` (share of thigh length); a foot slides by `slide`. */
function bridge(rise: number, slide = 0): Frame {
  const f = blank();
  const thigh = Math.hypot(0.1, 0.15);
  f[LM.lHip] = { x: 0.45, y: 0.7 - rise * thigh, v: 1 }; f[LM.lKnee] = { x: 0.55, y: 0.55, v: 1 }; f[LM.lAnkle] = { x: 0.6 + slide * thigh, y: 0.7, v: 1 };
  for (const i of [LM.rHip, LM.rKnee, LM.rAnkle]) f[i] = { x: 0.5, y: 0.5, v: 0 };
  return f;
}
/** Front view, standing: heels rise by `rise` (share of leg length). */
function heels(rise: number, o: { lean?: number; sway?: number } = {}): Frame {
  const f = blank();
  const leg = 0.4, sw = (o.sway ?? 0) * leg, dx = Math.tan(rad(o.lean ?? 0)) * 0.25;
  const ay = 0.9 - rise * leg;
  f[LM.lHip] = { x: 0.45 + sw, y: 0.5, v: 1 }; f[LM.rHip] = { x: 0.55 + sw, y: 0.5, v: 1 };
  f[LM.lKnee] = { x: 0.44, y: 0.7, v: 1 }; f[LM.rKnee] = { x: 0.56, y: 0.7, v: 1 };
  f[LM.lAnkle] = { x: 0.43, y: ay, v: 1 }; f[LM.rAnkle] = { x: 0.57, y: ay, v: 1 };
  f[LM.lShoulder] = { x: 0.42 + sw + dx, y: 0.25, v: 1 }; f[LM.rShoulder] = { x: 0.58 + sw + dx, y: 0.25, v: 1 };
  return f;
}

/** Front view, standing: the left foot lifts by `lift` (share of leg length). Hips can jerk sideways, arms can go out, the trunk can lean. */
function oneLeg(lift: number, o: { jerk?: number; arms?: boolean; lean?: number } = {}): Frame {
  const f = blank();
  const leg = 0.4, dx = Math.tan(rad(o.lean ?? 0)) * 0.25, hx = (o.jerk ?? 0) * leg;
  f[LM.lHip] = { x: 0.45 + hx, y: 0.5, v: 1 }; f[LM.rHip] = { x: 0.55 + hx, y: 0.5, v: 1 };
  f[LM.lKnee] = { x: 0.44, y: 0.7, v: 1 }; f[LM.rKnee] = { x: 0.56, y: 0.7, v: 1 };
  f[LM.lAnkle] = { x: 0.43, y: 0.9 - lift * leg, v: 1 }; f[LM.rAnkle] = { x: 0.57, y: 0.9, v: 1 };
  f[LM.lShoulder] = { x: 0.42 + hx + dx, y: 0.25, v: 1 }; f[LM.rShoulder] = { x: 0.58 + hx + dx, y: 0.25, v: 1 };
  f[LM.lWrist] = o.arms ? { x: 0.2, y: 0.27, v: 1 } : { x: 0.41, y: 0.5, v: 1 };
  f[LM.rWrist] = o.arms ? { x: 0.8, y: 0.27, v: 1 } : { x: 0.59, y: 0.5, v: 1 };
  return f;
}

describe('camera form check: balance', () => {
  it('counts each held foot lift, and flags nothing for a steady hold', () => {
    const { sum } = run('balance', (v) => oneLeg(v / 100), 20, { frames: 240 });
    expect(sum.reps).toBe(5);
    expect(sum.faults).toEqual([]);
    expect(sum.holds).toHaveLength(5);
    expect(Math.min(...sum.holds!) >= FORM_CHECK.holdMinSec).toBe(true);
  });
  it('flags a wobble (hips jerking sideways) as a stability fault that asks the patient to pause', () => {
    const { sum, events } = run('balance', (v, i) => oneLeg(v / 100, { jerk: v > 8 ? (Math.floor(i / 4) % 2 ? 0.1 : -0.1) : 0 }), 20);
    expect(sum.faults.find((x) => x.id === 'bal-wobble')?.kind).toBe('stability');
    expect(events.some((e) => e.type === 'pause')).toBe(true);
  });
  it('times each hold and flags a hold shorter than the target, with how many seconds it fell short', () => {
    const { sum } = run('balance', (v) => oneLeg(v / 100), 20, { frames: 90 }); // each lift above the threshold lasts about 4 seconds
    const f = sum.faults.find((x) => x.id === 'bal-short')!;
    expect(f.kind).toBe('control');
    expect(f.unit).toBe('s');
    expect(f.reps).toEqual([1, 2, 3, 4, 5]);
    expect(f.peak).toBeGreaterThan(4);
    expect(sum.holds).toHaveLength(5);
    expect(sum.paused).toBe(false); // a short hold is a note for the physio, never a stop
  });
  it('a set that ends while the foot is still up still counts that hold', () => {
    const a = new FormAnalyzer('balance');
    let t = 0;
    for (let i = 0; i < 12; i++) a.push(oneLeg(0), (t += DT), 1);
    for (let i = 0; i < 60; i++) a.push(oneLeg(0.2), (t += DT), 1);
    const sum = a.finish();
    expect(sum.reps).toBe(1);
    expect(sum.holds).toHaveLength(1);
    expect(ids(sum)).toContain('bal-short');
    expect(a.finish().reps).toBe(1); // finishing twice does not count it twice
  });
  it('heel to toe: counts a hold when the feet come together, and flags wobble, arms and a short hold', () => {
    const line = (narrow: number, o: { jerk?: number; arms?: boolean } = {}) => {
      const f = oneLeg(0, o);
      f[LM.lAnkle] = { x: 0.43 + 0.14 * narrow, y: 0.9, v: 1 }; // feet start 14% of the frame apart, then come together
      return f;
    };
    const ok = run('balance-line', (v) => line(v / 100), 100, { frames: 240 });
    expect(ok.sum.reps).toBe(5);
    expect(ok.sum.faults).toEqual([]);
    expect(run('balance-line', (v) => line(v / 100), 100, { frames: 90 }).sum.faults.map((x) => x.id)).toContain('bal-short');
    expect(ids(run('balance-line', (v) => line(v / 100, { arms: v > 50 }), 100, { frames: 240 }).sum)).toContain('bal-arms');
  });
  it('flags arms held out to balance and a leaning trunk, but not while both feet are down', () => {
    expect(ids(run('balance', (v) => oneLeg(v / 100, { arms: v > 8 }), 20).sum)).toContain('bal-arms');
    expect(ids(run('balance', (v) => oneLeg(v / 100, { lean: v > 8 ? 16 : 0 }), 20).sum)).toContain('bal-lean');
    expect(ids(run('balance', (v) => oneLeg(v / 100, { arms: true }), 0).sum)).not.toContain('bal-arms');
  });
});

describe('camera form check: the other exercises', () => {
  it('knee bend and straighten (heel slides, gentle knee movement): counts reps, flags a rolled trunk and a fast slide', () => {
    const clean = run('knee-flex', (v) => kneeFlex(v), 70);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    expect(ids(run('knee-flex', (v) => kneeFlex(v, v > 10 ? 22 : 0), 70).sum)).toContain('flex-trunk-shift');
    expect(ids(run('knee-flex', (v) => kneeFlex(v), 100, { frames: 10 }).sum)).toContain('flex-fast');
  });
  it('sit to stand counts rises from the seated position and flags a knee moving inwards and a lean', () => {
    const clean = run('sit-to-stand', (v) => squat(-v / 100), 30);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    expect(ids(run('sit-to-stand', (v) => squat(-v / 100, { kneeIn: v > 8 ? 0.35 : 0 }), 30).sum)).toContain('sit-knee-in');
    expect(ids(run('sit-to-stand', (v) => squat(-v / 100, { lean: v > 8 ? 18 : 0 }), 30).sum)).toContain('sit-lean');
  });
  it('lunges and step-ups move a foot on purpose, so a moved foot is not a balance fault there (but it is in a squat)', () => {
    const shift = (v: number) => squat(v / 100, { footShift: v > 6 ? 0.25 : 0 });
    expect(ids(run('lunge', shift, 25).sum)).not.toContain('lunge-sway');
    expect(ids(run('squat', shift, 25).sum)).toContain('squat-balance');
    const lunge = run('lunge', (v) => squat(v / 100, { kneeIn: v > 6 ? 0.35 : 0 }), 25);
    expect(lunge.sum.reps).toBe(5);
    expect(ids(lunge.sum)).toContain('lunge-knee-in');
    const step = run('step-up', (v) => squat(-v / 100), 15);
    expect(step.sum.reps).toBe(5);
    expect(step.sum.faults).toEqual([]);
  });
  it('arm raise forwards (assisted arm raise, wall slide) counts reps, flags a leaning trunk, and a fast raise', () => {
    const clean = run('shoulder-flexion', (v) => armFwd(v), 100);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    expect(ids(run('shoulder-flexion', (v) => armFwd(v, v > 20 ? 16 : 0), 100).sum)).toContain('arm-lean');
    expect(ids(run('shoulder-flexion', (v) => armFwd(v), 120, { frames: 10 }).sum)).toContain('arm-fast');
  });
  it('hip abduction counts leg lifts to the side and flags a bent knee and a lean', () => {
    const clean = run('hip-abduction', (v) => legOut(v), 30);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    expect(ids(run('hip-abduction', (v) => legOut(v, { kneeBend: v > 8 ? 40 : 0 }), 30).sum)).toContain('hipabd-knee-bent');
    expect(ids(run('hip-abduction', (v) => legOut(v, { lean: v > 8 ? 16 : 0 }), 30).sum)).toContain('hipabd-lean');
  });
  it('bridging counts hip lifts and flags a sliding foot as a stability fault that asks for a pause', () => {
    const clean = run('bridging', (v) => bridge(v / 100), 40);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    const slid = run('bridging', (v) => bridge(v / 100, v > 8 ? 0.3 : 0), 40);
    expect(slid.sum.faults.find((x) => x.id === 'bridge-feet')?.kind).toBe('stability');
    expect(slid.sum.paused).toBe(true);
  });
  it('calf raises count heel rises and flag a sway or a lean', () => {
    const clean = run('calf-raise', (v) => heels(v / 100), 9);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    expect(ids(run('calf-raise', (v) => heels(v / 100, { sway: v > 3 ? 0.18 : 0 }), 9).sum)).toContain('calf-sway');
    expect(ids(run('calf-raise', (v) => heels(v / 100, { lean: v > 3 ? 16 : 0 }), 9).sum)).toContain('calf-lean');
  });
  it('maps every covered library exercise to a kind, and leaves exercises a phone cannot judge out', () => {
    for (const kind of Object.keys(KIND_EXERCISES) as FormKind[]) {
      for (const id of KIND_EXERCISES[kind]) {
        if (id !== 'shoulder-abduction') expect(getExercise(id)).toBeTruthy();
        expect(formKindFor(id)).toBe(kind);
      }
      expect(KINDS[kind].faults.length).toBeGreaterThan(0);
    }
    expect(formKindFor('balance')).toBe('balance');
    expect(formKindFor('walking')).toBe('walking');
    expect(formKindFor('ankle-pumps')).toBe('ankle-pump');
    expect(formKindFor('pendulum')).toBe('pendulum');
    expect(formKindFor('stationary-cycling')).toBe('cycle');
    expect(formKindFor('stairs-practice')).toBe('step-up');
    for (const id of ['walking-programme', 'walking-aid']) expect(formKindFor(id)).toBe('walking');
    for (const id of ['cycling', 'swimming', 'ice-compression', 'ice-elevation', 'quad-set', 'gait-drills']) expect(formKindFor(id)).toBeNull();
  });
});

// ---------- walking and ankle pumps ----------
/** Side view, walking: `a1` is the step length when the left foot leads, `a2` when the right foot leads (half the gap between the feet). */
function walkFrames(stepsPerDir: number[], o: { a1?: number; a2?: number } = {}): Frame[] {
  const out: Frame[] = [];
  const a1 = o.a1 ?? 0.07, a2 = o.a2 ?? 0.07, per = 12;
  let x = 0.2;
  const make = (gapFwd: number, dir: number): Frame => {
    const f = blank();
    f[LM.lShoulder] = { x, y: 0.4, v: 1 }; f[LM.lHip] = { x, y: 0.6, v: 1 };
    f[LM.rShoulder] = { x: 0.5, y: 0.5, v: 0 }; f[LM.rHip] = { x: 0.5, y: 0.5, v: 0 };
    f[LM.lAnkle] = { x: x + dir * gapFwd / 2, y: 0.95, v: 0.9 }; f[LM.rAnkle] = { x: x - dir * gapFwd / 2, y: 0.95, v: 0.6 };
    return f;
  };
  for (let i = 0; i < 12; i++) out.push(make(0, 1));
  let dir = 1;
  for (const n of stepsPerDir) {
    for (let st = 0; st < n; st++) {
      const leftLeads = st % 2 === 0;
      for (let i = 0; i < per; i++) {
        const s = Math.sin((Math.PI * i) / (per - 1));
        const gap = (leftLeads ? 2 * a1 : 2 * a2) * s;
        x += dir * 0.004;
        out.push(make(leftLeads ? gap : -gap, dir));
      }
    }
    dir = -dir;
  }
  return out;
}
const feed = (kind: FormKind, frames: Frame[]) => { const a = new FormAnalyzer(kind); let t = 0; for (const f of frames) a.push(f, (t += DT), 1); return a.finish(); };

describe('camera form check: walking', () => {
  it('counts steps and works out steps a minute', () => {
    const sum = feed('walking', walkFrames([8]));
    expect(sum.reps).toBe(8);
    expect(sum.cadence! >= 70 && sum.cadence! <= 80).toBe(true); // 12 frames a step at 15 frames a second is 75 steps a minute
    expect(sum.faults).toEqual([]);
  });
  it('flags steps of uneven length, also when the person turns and walks back', () => {
    expect(ids(feed('walking', walkFrames([8], { a1: 0.09, a2: 0.05 })))).toContain('walk-uneven');
    expect(ids(feed('walking', walkFrames([6, 6], { a1: 0.09, a2: 0.05 })))).toContain('walk-uneven');
    expect(ids(feed('walking', walkFrames([6, 6], { a1: 0.07, a2: 0.07 })))).not.toContain('walk-uneven');
  });
  it('does not judge evenness from too few steps', () => {
    expect(ids(feed('walking', walkFrames([4], { a1: 0.09, a2: 0.05 })))).not.toContain('walk-uneven');
  });
  it('a far leg that is only partly visible does not stop the count', () => {
    const frames = walkFrames([8]).map((f) => { const g = f.slice(); g[LM.rAnkle] = { ...g[LM.rAnkle], v: 0.35 }; return g; });
    expect(feed('walking', frames).reps).toBe(8);
  });
});

/** Side view, lying: the foot angle at the ankle is 90 degrees when relaxed; `p` degrees positive points the toes away. */
function foot(p: number, kneeShift = 0): Frame {
  const f = blank();
  const K = { x: 0.4 + kneeShift, y: 0.6 }, A = { x: 0.65, y: 0.6 };
  f[LM.lKnee] = { ...K, v: 1 }; f[LM.lAnkle] = { ...A, v: 1 };
  f[LM.lFoot] = { x: A.x + 0.1 * Math.sin(rad(p)), y: A.y - 0.1 * Math.cos(rad(p)), v: 1 };
  for (const i of [LM.rKnee, LM.rAnkle, LM.rFoot]) f[i] = { x: 0.5, y: 0.5, v: 0 };
  return f;
}
function pumps(n: number, o: { dorsi?: number; kneeShift?: number } = {}): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < 12; i++) out.push(foot(0));
  for (let r = 0; r < n; r++) {
    for (let i = 0; i <= 20; i++) out.push(foot(-(o.dorsi ?? 0) * Math.sin((Math.PI * i) / 20)));       // toes towards the shin
    for (let i = 0; i <= 20; i++) out.push(foot(35 * Math.sin((Math.PI * i) / 20), o.kneeShift ?? 0)); // toes away
  }
  out.push(foot(0));
  return out;
}
describe('camera form check: ankle pumps', () => {
  it('counts pumps from the toes pointing away, and flags nothing when the toes also come up', () => {
    const sum = feed('ankle-pump', pumps(6, { dorsi: 20 }));
    expect(sum.reps).toBe(6);
    expect(sum.faults).toEqual([]);
  });
  it('flags toes that do not come up towards the shin', () => {
    const sum = feed('ankle-pump', pumps(6, { dorsi: 0 }));
    const f = sum.faults.find((x) => x.id === 'pump-short-dorsi')!;
    expect(f.kind).toBe('range');
    expect(f.unit).toBe('deg');
  });
  it('flags a leg that moves while pumping', () => {
    expect(ids(feed('ankle-pump', pumps(6, { dorsi: 20, kneeShift: 0.08 })))).toContain('pump-leg-moves');
  });
});

// ---------- pendulum, stationary cycling, plank, bird-dog ----------
/** Side view, bent forward: the left arm hangs from the shoulder and swings by `a` degrees. */
function arm(a: number): Frame {
  const f = blank();
  const S = { x: 0.5, y: 0.4 };
  f[LM.lShoulder] = { ...S, v: 1 }; f[LM.lWrist] = { x: S.x + 0.3 * Math.sin(rad(a)), y: S.y + 0.3 * Math.cos(rad(a)), v: 1 };
  for (const i of [LM.rShoulder, LM.rWrist]) f[i] = { x: 0.5, y: 0.5, v: 0 };
  return f;
}
const swings = (n: number, amp: number, per: number): Frame[] => {
  const out: Frame[] = [];
  for (let i = 0; i < 12; i++) out.push(arm(0));
  for (let c = 0; c < n; c++) for (let i = 0; i < per; i++) out.push(arm(amp * Math.sin((2 * Math.PI * i) / per)));
  out.push(arm(0));
  return out;
};
describe('camera form check: pendulum', () => {
  it('counts swings in each direction and flags nothing for a gentle swing', () => {
    const sum = feed('pendulum', swings(5, 20, 30));
    expect(sum.reps).toBe(10);
    expect(sum.faults).toEqual([]);
  });
  it('flags a very wide swing and a fast swing', () => {
    expect(ids(feed('pendulum', swings(5, 60, 30)))).toContain('pend-wide');
    expect(ids(feed('pendulum', swings(5, 45, 14)))).toContain('pend-fast');
    expect(ids(feed('pendulum', swings(5, 20, 30)))).not.toContain('pend-fast');
  });
  it("the physio's maximum applies to the swing size", () => {
    const a = new FormAnalyzer('pendulum', { max: 25 });
    let t = 0;
    for (const f of swings(5, 40, 30)) a.push(f, (t += DT), 1);
    expect(a.finish().faults.find((x) => x.id === 'limit-max')?.kind).toBe('precaution');
  });
});

/** Side view of a bike: the knee bends by `flex` degrees; the hips can bob and the trunk can lean. */
function pedal(flex: number, o: { bob?: number; lean?: number } = {}): Frame {
  const f = blank();
  const H = { x: 0.5, y: 0.5 + (o.bob ?? 0) };
  const th = rad(60), sh = th - rad(flex);
  const K = { x: H.x + 0.2 * Math.cos(th), y: H.y + 0.2 * Math.sin(th) };
  const A = { x: K.x + 0.2 * Math.cos(sh), y: K.y + 0.2 * Math.sin(sh) };
  const S = { x: H.x + 0.3 * Math.sin(rad(o.lean ?? 0)), y: H.y - 0.3 * Math.cos(rad(o.lean ?? 0)) };
  f[LM.lShoulder] = { ...S, v: 1 }; f[LM.lHip] = { ...H, v: 1 }; f[LM.lKnee] = { ...K, v: 1 }; f[LM.lAnkle] = { ...A, v: 1 };
  for (const i of [LM.rShoulder, LM.rHip, LM.rKnee, LM.rAnkle]) f[i] = { x: 0.5, y: 0.5, v: 0 };
  return f;
}
const turns = (n: number, o: { bob?: number; lean?: number } = {}): Frame[] => {
  const out: Frame[] = [];
  for (let c = 0; c < n; c++) for (let i = 0; i < 15; i++) { const p = Math.sin((2 * Math.PI * i) / 15); out.push(pedal(70 + 35 * p, { bob: (o.bob ?? 0) * Math.cos((2 * Math.PI * i) / 15), lean: out.length >= 30 ? o.lean : 0 })); } // a lean that starts after the first two turns
  return out;
};
describe('camera form check: stationary cycling', () => {
  it('counts pedal turns and the turns a minute', () => {
    const sum = feed('cycle', turns(10));
    expect(sum.reps >= 7 && sum.reps <= 10).toBe(true);
    expect(sum.cadence! >= 55 && sum.cadence! <= 65).toBe(true); // 15 frames a turn at 15 frames a second is 60 a minute
    expect(sum.faults).toEqual([]);
  });
  it('flags hips bobbing and a leaning trunk', () => {
    expect(ids(feed('cycle', turns(10, { bob: 0.05 })))).toContain('cyc-bob');
    expect(ids(feed('cycle', turns(10, { lean: 25 })))).toContain('cyc-lean');
  });
  it('has no per-patient limit, since a pedal position is not something a physio can cap', () => {
    expect(KINDS.cycle.noLimit).toBe(true);
    expect(setFormLimit(base, 'stationary-cycling', { max: 50 }, 'x', { nowMs: 0, today })).toBe(base);
  });
});

/** Side view on the floor: `flat` degrees from upright (0) to flat (90); `sag` is how far the hips hang below the line, as a share of body length. */
function plankFrame(flat: number, sag = 0): Frame {
  const f = blank();
  const L = 0.7, th = rad(90 - flat);
  const S = { x: 0.15, y: 0.3 }, A = { x: S.x + L * Math.cos(th), y: S.y + L * Math.sin(th) };
  const H = { x: (S.x + A.x) / 2, y: (S.y + A.y) / 2 + sag * L };
  f[LM.lShoulder] = { ...S, v: 1 }; f[LM.lHip] = { ...H, v: 1 }; f[LM.lAnkle] = { ...A, v: 1 };
  for (const i of [LM.rShoulder, LM.rHip, LM.rAnkle]) f[i] = { x: 0.5, y: 0.5, v: 0 };
  return f;
}
const plankSet = (sag: number): Frame[] => {
  const out: Frame[] = [];
  for (let i = 0; i < 12; i++) out.push(plankFrame(0));
  for (let i = 1; i <= 6; i++) out.push(plankFrame((85 * i) / 6, sag * (i / 6)));
  for (let i = 0; i < 190; i++) out.push(plankFrame(85, sag));
  for (let i = 1; i <= 6; i++) out.push(plankFrame(85 - (85 * i) / 6, sag * (1 - i / 6)));
  out.push(plankFrame(0));
  return out;
};
describe('camera form check: plank', () => {
  it('times the hold and flags nothing for a straight body', () => {
    const sum = feed('plank', plankSet(0));
    expect(sum.reps).toBe(1);
    expect(sum.holds![0] >= FORM_CHECK.holdMinSec).toBe(true);
    expect(sum.faults).toEqual([]);
  });
  it('flags sagging and piked hips', () => {
    expect(ids(feed('plank', plankSet(0.12)))).toContain('plank-sag');
    expect(ids(feed('plank', plankSet(-0.14)))).toContain('plank-pike');
  });
});

/** Side view, on hands and knees: the back leg is lifted by `lift` degrees; the back can tilt by `tilt` degrees. */
function birdFrame(lift: number, tilt = 0): Frame {
  const f = blank();
  const H = { x: 0.5, y: 0.5 }, S = { x: 0.2, y: 0.5 - Math.tan(rad(tilt)) * 0.3 };
  const dir = rad(45 - lift);
  const A = { x: H.x + 0.25 * Math.cos(dir), y: H.y + 0.25 * Math.sin(dir) };
  f[LM.lShoulder] = { ...S, v: 1 }; f[LM.lHip] = { ...H, v: 1 }; f[LM.lAnkle] = { ...A, v: 1 };
  for (const i of [LM.rShoulder, LM.rHip, LM.rAnkle]) f[i] = { x: 0.5, y: 0.5, v: 0 };
  return f;
}
const birdSet = (tilt: number): Frame[] => {
  const out: Frame[] = [];
  for (let i = 0; i < 12; i++) out.push(birdFrame(0));
  for (let i = 1; i <= 5; i++) out.push(birdFrame((40 * i) / 5, tilt * (i / 5)));
  for (let i = 0; i < 190; i++) out.push(birdFrame(40, tilt));
  for (let i = 1; i <= 5; i++) out.push(birdFrame(40 - (40 * i) / 5, tilt * (1 - i / 5)));
  out.push(birdFrame(0));
  return out;
};
describe('camera form check: bird-dog', () => {
  it('times the hold of the stretched leg and flags nothing for a steady back', () => {
    const sum = feed('bird-dog', birdSet(0));
    expect(sum.reps).toBe(1);
    expect(sum.holds![0] >= FORM_CHECK.holdMinSec).toBe(true);
    expect(sum.faults).toEqual([]);
  });
  it('flags a back that tilts while the leg is lifted', () => {
    expect(ids(feed('bird-dog', birdSet(18)))).toContain('bird-tilt');
  });
  it('core exercises offer plank and bird-dog; the library exercise maps to the first', () => {
    expect(formKindFor('core')).toBe('plank');
  });
});

// ---------- hand, wrist and elbow; shoulder blade squeeze; band rotation ----------
/** 33 body points all unseen, then 21 hand points (so the hand model alone can drive a check). */
const noBody = (): Frame => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 0 }));
const handPts = (W: { x: number; y: number }, tips: number, mcp: number, seen = true, M?: { x: number; y: number }): Frame => {
  const pts = Array.from({ length: 21 }, () => ({ x: W.x, y: W.y, v: seen ? 1 : 0 }));
  const dirs: Record<number, number> = { 5: -0.3, 9: -0.1, 13: 0.1, 17: 0.3 };
  for (const m of [5, 9, 13, 17]) {
    const a = dirs[m];
    pts[m] = { x: W.x + mcp * Math.sin(a), y: W.y - mcp * Math.cos(a), v: seen ? 1 : 0 };
    pts[m + 3] = { x: W.x + tips * Math.sin(a), y: W.y - tips * Math.cos(a), v: seen ? 1 : 0 };
  }
  if (M) pts[9] = { ...M, v: seen ? 1 : 0 };
  return pts;
};
/** Close-up of a hand: `curl` 0 is open, 100 a tight fist. `shift` moves the wrist across the picture, as a share of palm length. */
function fist(curl: number, o: { shift?: number; seen?: boolean } = {}): Frame {
  const palm = 0.1, r = 1.9 - (1.2 * curl) / 100;
  const W = { x: 0.5 + (curl > 3 ? (o.shift ?? 0) * palm : 0), y: 0.7 };
  return [...noBody(), ...handPts(W, palm * r, palm, o.seen ?? true)];
}
/** Side on: elbow on the left, forearm along the table, hand bent by `ang` degrees. `elbow` moves the elbow (share of forearm length). */
function wristF(ang: number, o: { elbow?: number; seen?: boolean } = {}): Frame {
  const body = noBody();
  const fore = 0.2;
  const E = { x: 0.3 - (ang > 3 ? (o.elbow ?? 0) * fore : 0), y: 0.5 };
  body[LM.lElbow] = { ...E, v: 1 };
  const W = { x: 0.5, y: 0.5 }, M = { x: W.x + 0.1 * Math.cos(rad(ang)), y: W.y - 0.1 * Math.sin(rad(ang)) };
  return [...body, ...handPts(W, 0.15, 0.1, o.seen ?? true, M)];
}
/** Side on, seated: the upper arm hangs from the shoulder; the elbow bends by `flex`. `arm` swings the upper arm. */
function elbowF(flex: number, o: { arm?: number } = {}): Frame {
  const f = noBody();
  const arm = flex > 25 ? o.arm ?? 0 : 0;
  const S = { x: 0.5, y: 0.3 };
  const E = { x: S.x + 0.2 * Math.sin(rad(arm)), y: S.y + 0.2 * Math.cos(rad(arm)) };
  const d = rad(arm + flex);
  f[LM.lShoulder] = { ...S, v: 1 }; f[LM.lElbow] = { ...E, v: 1 }; f[LM.lWrist] = { x: E.x + 0.2 * Math.sin(d), y: E.y + 0.2 * Math.cos(d), v: 1 };
  return f;
}
/** From behind: the shoulder points pull in by `sq` percent of their width. `shrug` lifts them, `lean` tilts the trunk. */
function scapF(sq: number, o: { shrug?: number; lean?: number } = {}): Frame {
  const f = noBody();
  const on = sq > 1.5, half = 0.15 * (1 - sq / 100);
  const y = 0.4 - (on ? o.shrug ?? 0 : 0) * 0.2, dx = on ? Math.tan(rad(o.lean ?? 0)) * 0.3 : 0;
  f[LM.lShoulder] = { x: 0.5 - half + dx, y, v: 1 }; f[LM.rShoulder] = { x: 0.5 + half + dx, y, v: 1 };
  f[LM.lHip] = { x: 0.4, y: 0.7, v: 1 }; f[LM.rHip] = { x: 0.6, y: 0.7, v: 1 };
  return f;
}
/** Facing the camera, elbows bent at the sides: the left forearm turns outwards by `out` percent of upper-arm length. */
function rotF(out: number, o: { away?: number; lean?: number; right?: boolean } = {}): Frame {
  const f = noBody();
  const on = Math.abs(out) > 3, dx = on ? Math.tan(rad(o.lean ?? 0)) * 0.35 : 0;
  const S = [{ x: 0.4 + dx, y: 0.3 }, { x: 0.6 + dx, y: 0.3 }];
  const upper = Math.hypot(0.02, 0.2);
  const away = on ? (o.away ?? 0) * upper : 0;
  const mk = (i: 0 | 1, o2: number, away2: number) => {
    const dir = i === 0 ? -1 : 1;
    const E = { x: (i === 0 ? 0.38 : 0.62) + dir * away2, y: 0.5 };
    return { E, W: { x: E.x + dir * (o2 / 100) * upper, y: 0.48 } };
  };
  const L = mk(0, o.right ? 0 : out, o.right ? 0 : away), R = mk(1, o.right ? out : 0, o.right ? away : 0);
  f[LM.lShoulder] = { ...S[0], v: 1 }; f[LM.rShoulder] = { ...S[1], v: 1 };
  f[LM.lHip] = { x: 0.42, y: 0.65, v: 1 }; f[LM.rHip] = { x: 0.58, y: 0.65, v: 1 };
  f[LM.lElbow] = { ...L.E, v: 1 }; f[LM.lWrist] = { ...L.W, v: 1 }; f[LM.rElbow] = { ...R.E, v: 1 }; f[LM.rWrist] = { ...R.W, v: 1 };
  return f;
}

describe('camera form check: hand, wrist and elbow', () => {
  it('maps the exercise to three versions and loads the hand model only for the two that need it', () => {
    expect(formKindFor('hand-wrist-elbow')).toBe('hand-fist');
    expect(VARIANTS['hand-wrist-elbow'].map((v) => v.kind)).toEqual(['hand-fist', 'wrist', 'elbow']);
    expect(HAND_KINDS).toEqual(['hand-fist', 'wrist']);
    expect(HAND).toBe(33);
  });
  it('counts fists from the hand model alone, with no body in the picture, and flags nothing for a steady hand', () => {
    const r = run('hand-fist', (v) => fist(v), 70);
    expect(r.sum.reps).toBe(5);
    expect(r.sum.reliable).toBe(true);
    expect(r.sum.faults).toEqual([]);
  });
  it('flags a hand that wanders and a fist closed very fast', () => {
    expect(ids(run('hand-fist', (v) => fist(v, { shift: 1.2 }), 70).sum)).toContain('fist-wrist-moves');
    expect(ids(run('hand-fist', (v) => fist(v), 100, { frames: 8 }).sum)).toContain('fist-fast');
  });
  it('says it could not see enough, and flags nothing, when the hand is not found', () => {
    const r = run('hand-fist', (v) => fist(v, { seen: false, shift: 1.5 }), 70);
    expect(r.sum.reliable).toBe(false);
    expect(r.sum.faults).toEqual([]);
  });
  it("a physio's limit on the fist works like any other limit", () => {
    const r = run('hand-fist', (v) => fist(v), 70, { limit: { max: 55 } });
    expect(r.sum.faults.find((x) => x.id === 'limit-max')?.kind).toBe('precaution');
  });
  it('counts wrist bends and flags an elbow that moves or a fast bend', () => {
    const clean = run('wrist', (v) => wristF(v), 40);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    expect(ids(run('wrist', (v) => wristF(v, { elbow: 0.3 }), 40).sum)).toContain('wrist-elbow-moves');
    expect(ids(run('wrist', (v) => wristF(v), 60, { frames: 8 }).sum)).toContain('wrist-fast');
  });
  it('wrist: nothing is flagged when the hand is not seen', () => {
    const r = run('wrist', (v) => wristF(v, { seen: false, elbow: 0.5 }), 40);
    expect(r.sum.reliable).toBe(false);
    expect(r.sum.faults).toEqual([]);
  });
  it('counts elbow bends and flags a swinging upper arm or a fast bend', () => {
    const clean = run('elbow', (v) => elbowF(v), 100);
    expect(clean.sum.reps).toBe(5);
    expect(clean.sum.faults).toEqual([]);
    expect(ids(run('elbow', (v) => elbowF(v, { arm: 28 }), 100).sum)).toContain('elbow-arm-moves');
    expect(ids(run('elbow', (v) => elbowF(v), 100, { frames: 10 }).sum)).toContain('elbow-fast');
  });
});

describe('camera form check: shoulder blade squeeze', () => {
  it('maps the library exercise and counts squeezes seen from behind', () => {
    expect(formKindFor('shoulder-blade-squeeze')).toBe('scap');
    const r = run('scap', (v) => scapF(v), 8);
    expect(r.sum.reps).toBe(5);
    expect(r.sum.faults).toEqual([]);
  });
  it('flags shoulders that rise, a lean, and a very fast squeeze', () => {
    expect(ids(run('scap', (v) => scapF(v, { shrug: 0.25 }), 8).sum)).toContain('scap-shrug');
    expect(ids(run('scap', (v) => scapF(v, { lean: 16 }), 8).sum)).toContain('scap-lean');
    expect(ids(run('scap', (v) => scapF(v), 15, { frames: 8 }).sum)).toContain('scap-fast');
  });
  it('does not count a squeeze that is too small to tell from camera noise', () => {
    expect(run('scap', (v) => scapF(v), 2.5).sum.reps).toBe(0);
  });
  it('a physio minimum flags a squeeze that is too small to reach it', () => {
    const r = run('scap', (v) => scapF(v), 8, { limit: { min: 12 } });
    expect(r.sum.faults.find((x) => x.id === 'limit-min')?.kind).toBe('range');
  });
});

describe('camera form check: band rotation', () => {
  it('maps the library exercise and counts outward turns of either arm', () => {
    expect(formKindFor('band-rotation')).toBe('band-rot');
    expect(run('band-rot', (v) => rotF(v), 80).sum.reps).toBe(5);
    const right = run('band-rot', (v) => rotF(v, { right: true }), 80);
    expect(right.sum.reps).toBe(5);
    expect(right.sum.faults).toEqual([]);
    expect(run('band-rot', (v) => rotF(v), 80).sum.faults).toEqual([]);
  });
  it('flags an elbow that leaves the side, a lean, and a fast turn', () => {
    expect(ids(run('band-rot', (v) => rotF(v, { away: 0.4 }), 80).sum)).toContain('rot-elbow-away');
    expect(ids(run('band-rot', (v) => rotF(v, { lean: 16 }), 80).sum)).toContain('rot-lean');
    expect(ids(run('band-rot', (v) => rotF(v), 80, { frames: 10 }).sum)).toContain('rot-fast');
  });
  it('turning inwards is not counted', () => {
    expect(run('band-rot', (v) => rotF(-v), 80).sum.reps).toBe(0);
  });
  it("a physio's maximum for a rotator cuff patient raises a pause", () => {
    const r = run('band-rot', (v) => rotF(v), 80, { limit: { max: 60 } });
    expect(r.sum.faults.find((x) => x.id === 'limit-max')?.kind).toBe('precaution');
    expect(r.sum.paused).toBe(true);
  });
});
