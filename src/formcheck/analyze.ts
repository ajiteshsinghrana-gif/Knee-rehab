/**
 * Camera form check as pure logic: body points in, rep count and measured faults out.
 *
 * No camera, no network, no AI here: the screen supplies the 33 points of a pose model and the clock. Same input always gives the
 * same output. It counts reps, measures angles and distances, and compares them with the thresholds in config.ts (placeholders) and
 * the physio's own limit for the patient. It never says a movement is safe or correct, and nothing it returns changes a plan or a tier.
 *
 * Honesty rule: when the body points were not visible often enough, the result is "could not see enough" and NO fault is reported.
 */
import { angleAt, type Pt } from '../angle';
import type { FormFault, FormFaultKind, FormLimit } from '../types';
import { FORM_CHECK, KINDS, LIMIT_FAULTS, LM, type FormKind } from './config';

export interface Landmark { x: number; y: number; /** 0 to 1: how sure the model is that the point is in view */ v?: number }
export type Frame = Landmark[];

export type FormEvent =
  | { type: 'rep'; n: number }
  | { type: 'fault'; id: string; kind: FormFaultKind; rep: number }
  | { type: 'pause'; id: string }
  | { type: 'unseen' }
  | { type: 'seen' };

export interface FormSummary {
  reps: number;
  faults: FormFault[];
  usable: number;
  reliable: boolean;
  paused: boolean;
  seconds: number;
}

const RAD = 180 / Math.PI;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Smallest turn between two directions, in degrees. */
const turn = (a: number, b: number) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return Math.abs(d); };
const bend = (a: Pt, v: Pt, b: Pt): number | null => { const x = angleAt(a, v, b); return x === null ? null : 180 - x; };

interface Measure { ok: boolean; signal: number; faults: Record<string, number | null> }
interface Base { n: number; trunk: number; hipY: number; hipX: number; leg: number; ankles: [Pt, Pt] | null; ear: [number, number] | null }

export class FormAnalyzer {
  private prev: Landmark[] | null = null;
  private aspect = 1;
  private total = 0;
  private usableN = 0;
  private recent: boolean[] = [];
  private unseenNow = false;
  private t0: number | null = null;
  private tLast = 0;
  private lastSignal: number | null = null;
  private lastT = 0;
  private reps = 0;
  private inRep = false;
  private peak = 0;
  private side: 'l' | 'r' | null = null;
  private base: Base = { n: 0, trunk: 0, hipY: 0, hipX: 0, leg: 0, ankles: null, ear: null };
  private run = new Map<string, number>();
  private found = new Map<string, { kind: FormFaultKind; reps: Set<number>; peak: number; unit: FormFault['unit']; firstSec: number }>();
  private pausedIds = new Set<string>();
  private lastPauseMs = -1e9;
  private maxRun = 0;

  constructor(readonly kind: FormKind, private limit?: Pick<FormLimit, 'max' | 'min'>) {}

  get repCount(): number { return this.reps; }
  /** Share of recent frames in which the body was visible. */
  get recentUsable(): number { return this.recent.length ? this.recent.filter(Boolean).length / this.recent.length : 1; }

  /** One camera frame. `aspect` is video width divided by height, so angles are not stretched. */
  push(frame: Frame, tMs: number, aspect = 1): FormEvent[] {
    const ev: FormEvent[] = [];
    this.aspect = aspect > 0 ? aspect : 1;
    if (this.t0 === null) this.t0 = tMs;
    this.tLast = tMs;
    this.total++;
    const sm = this.smooth(frame);
    const m = sm ? this.measure(sm) : null;
    const ok = !!m && m.ok;
    this.recent.push(ok); if (this.recent.length > 30) this.recent.shift();
    if (!ok || !m) {
      this.maxRun++;
      if (this.maxRun >= 15 && !this.unseenNow) { this.unseenNow = true; ev.push({ type: 'unseen' }); }
      return ev;
    }
    this.usableN++;
    this.maxRun = 0;
    if (this.unseenNow) { this.unseenNow = false; ev.push({ type: 'seen' }); }

    const cfg = KINDS[this.kind];
    const s = m.signal;
    // Rep counting: up past repUp, back below repDown.
    if (!this.inRep && s >= cfg.repUp) { this.inRep = true; this.peak = s; }
    else if (this.inRep) {
      this.peak = Math.max(this.peak, s);
      if (s <= cfg.repDown) {
        this.inRep = false;
        this.reps++;
        ev.push({ type: 'rep', n: this.reps });
        if (this.limit?.min !== undefined && this.peak < this.limit.min) this.record(LIMIT_FAULTS.min.id, LIMIT_FAULTS.min.kind, this.reps, this.limit.min - this.peak, cfg.signal, tMs, ev);
      }
    }
    const moving = this.inRep || s > cfg.repDown;
    const rep = this.reps + 1;
    if (moving) {
      for (const f of cfg.faults) this.watch(f.id, f.kind, f.limit, f.unit, m.faults[f.id] ?? null, rep, tMs, f.minFrames ?? cfg.minFrames, ev);
      if (this.limit?.max !== undefined) this.watch(LIMIT_FAULTS.max.id, LIMIT_FAULTS.max.kind, this.limit.max, cfg.signal, s, rep, tMs, cfg.minFrames, ev);
    } else {
      for (const f of cfg.faults) this.run.set(f.id, 0);
      this.run.set(LIMIT_FAULTS.max.id, 0);
    }
    return ev;
  }

  /** Ends the set. Faults are listed only when the camera saw enough; otherwise nothing is flagged. */
  finish(): FormSummary {
    const usable = this.total ? this.usableN / this.total : 0;
    const reliable = this.total >= FORM_CHECK.minTotalFrames && usable >= FORM_CHECK.minUsable;
    const faults: FormFault[] = reliable
      ? [...this.found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, f]) => ({
        id, kind: f.kind, reps: [...f.reps].sort((a, b) => a - b), peak: Math.round(f.peak * 10) / 10, unit: f.unit, firstSec: Math.round(f.firstSec * 10) / 10,
      }))
      : [];
    return {
      reps: this.reps, faults, usable: Math.round(usable * 100) / 100, reliable,
      paused: reliable && this.pausedIds.size > 0,
      seconds: this.t0 === null ? 0 : Math.round(((this.tLast - this.t0) / 1000) * 10) / 10,
    };
  }

  // ---- internals ----
  private smooth(frame: Frame): Landmark[] | null {
    if (!Array.isArray(frame) || frame.length < 29) return null;
    const a = FORM_CHECK.smoothing;
    const out = frame.map((c, i) => {
      const p = this.prev?.[i];
      const vis = c.v ?? 1;
      if (!p || vis < FORM_CHECK.minVisibility) return { x: c.x, y: c.y, v: vis };
      return { x: p.x * (1 - a) + c.x * a, y: p.y * (1 - a) + c.y * a, v: vis };
    });
    this.prev = out;
    return out;
  }
  private seen(f: Landmark[], ...ids: number[]): boolean { return ids.every((i) => (f[i]?.v ?? 0) >= FORM_CHECK.minVisibility); }
  private pt(f: Landmark[], i: number): Pt { return { x: f[i].x * this.aspect, y: f[i].y }; }

  private measure(f: Landmark[]): Measure | null {
    if (this.kind === 'slr') return this.mSlr(f);
    if (this.kind === 'squat') return this.mSquat(f);
    return this.mAbd(f);
  }

  /** Side view, lying on the back: the leg nearest the camera is measured. */
  private mSlr(f: Landmark[]): Measure {
    const sets = { l: [LM.lShoulder, LM.lHip, LM.lKnee, LM.lAnkle], r: [LM.rShoulder, LM.rHip, LM.rKnee, LM.rAnkle] } as const;
    const vis = (k: 'l' | 'r') => sets[k].reduce((s, i) => s + (f[i]?.v ?? 0), 0);
    if (!this.side || !this.seen(f, ...sets[this.side])) this.side = vis('l') >= vis('r') ? 'l' : 'r';
    const [sh, hip, kn, an] = sets[this.side];
    if (!this.seen(f, sh, hip, kn, an)) return { ok: false, signal: 0, faults: {} };
    const S = this.pt(f, sh), H = this.pt(f, hip), K = this.pt(f, kn), A = this.pt(f, an);
    const lift = bend(S, H, K);
    const knee = bend(H, K, A);
    if (lift === null || knee === null) return { ok: false, signal: 0, faults: {} };
    const trunk = Math.atan2(H.y - S.y, H.x - S.x) * RAD;
    if (lift < KINDS.slr.repDown && this.base.n < FORM_CHECK.baselineFrames) { this.base.trunk = (this.base.trunk * this.base.n + trunk) / (this.base.n + 1); this.base.n++; }
    const hasBase = this.base.n >= FORM_CHECK.baselineFrames;
    const speed = this.speed(lift);
    return { ok: true, signal: lift, faults: {
      'slr-knee-bent': lift > 10 ? knee : null,
      'slr-trunk-shift': hasBase && lift > 5 ? turn(trunk, this.base.trunk) : null,
      'slr-fast': lift > 5 ? speed : null,
    } };
  }

  /** Front view: hips drop, knees, trunk, feet. */
  private mSquat(f: Landmark[]): Measure {
    if (!this.seen(f, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle)) return { ok: false, signal: 0, faults: {} };
    const lH = this.pt(f, LM.lHip), rH = this.pt(f, LM.rHip), lK = this.pt(f, LM.lKnee), rK = this.pt(f, LM.rKnee), lA = this.pt(f, LM.lAnkle), rA = this.pt(f, LM.rAnkle);
    const mh = mid(lH, rH);
    const leg = (dist(lH, lA) + dist(rH, rA)) / 2;
    if (leg < 1e-6) return { ok: false, signal: 0, faults: {} };
    const shoulders = this.seen(f, LM.lShoulder, LM.rShoulder);
    const ms = shoulders ? mid(this.pt(f, LM.lShoulder), this.pt(f, LM.rShoulder)) : null;
    const trunk = ms ? Math.atan2(ms.x - mh.x, -(ms.y - mh.y)) * RAD : 0;
    const b = this.base;
    if (b.n < FORM_CHECK.baselineFrames) {
      // Learn the standing position (the patient starts upright).
      const n = b.n;
      b.hipY = (b.hipY * n + mh.y) / (n + 1); b.hipX = (b.hipX * n + mh.x) / (n + 1); b.leg = (b.leg * n + leg) / (n + 1); b.trunk = (b.trunk * n + trunk) / (n + 1);
      b.ankles = b.ankles ? [{ x: (b.ankles[0].x * n + lA.x) / (n + 1), y: (b.ankles[0].y * n + lA.y) / (n + 1) }, { x: (b.ankles[1].x * n + rA.x) / (n + 1), y: (b.ankles[1].y * n + rA.y) / (n + 1) }] : [lA, rA];
      b.n++;
      return { ok: true, signal: 0, faults: {} };
    }
    const signal = ((mh.y - b.hipY) / b.leg) * 100;
    const inward = (h: Pt, k: Pt, a: Pt): number => {
      const dy = a.y - h.y;
      if (Math.abs(dy) < 1e-6) return 0;
      const lineX = h.x + ((a.x - h.x) * (k.y - h.y)) / dy;
      const dir = Math.sign(mh.x - h.x) || 1;
      return (((k.x - lineX) * dir) / Math.max(dist(h, k), 1e-6)) * 100;
    };
    const knee = Math.max(inward(lH, lK, lA), inward(rH, rK, rA));
    const foot = Math.max(dist(lA, b.ankles![0]), dist(rA, b.ankles![1])) / b.leg * 100;
    const sway = (Math.abs(mh.x - b.hipX) / b.leg) * 100;
    const spd = this.speed(signal);
    return { ok: true, signal, faults: {
      'squat-knee-in': signal > KINDS.squat.repDown ? knee : null,
      'squat-lean': ms && signal > KINDS.squat.repDown ? turn(trunk, b.trunk) : null,
      'squat-balance': signal > 3 ? Math.max(foot, sway) : null,
      'squat-fast': signal > 3 ? spd : null,
    } };
  }

  /** Front view: the arm that rises more is measured. */
  private mAbd(f: Landmark[]): Measure {
    if (!this.seen(f, LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip, LM.lElbow, LM.rElbow)) return { ok: false, signal: 0, faults: {} };
    const sh = { l: this.pt(f, LM.lShoulder), r: this.pt(f, LM.rShoulder) };
    const hp = { l: this.pt(f, LM.lHip), r: this.pt(f, LM.rHip) };
    const el = { l: this.pt(f, LM.lElbow), r: this.pt(f, LM.rElbow) };
    const lift = { l: angleAt(hp.l, sh.l, el.l), r: angleAt(hp.r, sh.r, el.r) };
    if (lift.l === null || lift.r === null) return { ok: false, signal: 0, faults: {} };
    if (!this.side) this.side = lift.l >= lift.r ? 'l' : 'r';
    else if (lift[this.side === 'l' ? 'r' : 'l']! > lift[this.side]! + 15) this.side = this.side === 'l' ? 'r' : 'l';
    const k = this.side;
    const signal = lift[k]!;
    const ms = mid(sh.l, sh.r), mh = mid(hp.l, hp.r);
    const trunk = Math.atan2(ms.x - mh.x, -(ms.y - mh.y)) * RAD;
    const torso = Math.max(dist(ms, mh), 1e-6);
    const earId = { l: LM.lEar, r: LM.rEar };
    const earOk = this.seen(f, earId.l, earId.r);
    const ear: [number, number] | null = earOk ? [dist(sh.l, this.pt(f, earId.l)) / torso, dist(sh.r, this.pt(f, earId.r)) / torso] : null;
    const b = this.base;
    if (signal < KINDS['shoulder-abduction'].repDown && b.n < FORM_CHECK.baselineFrames) {
      const n = b.n;
      b.trunk = (b.trunk * n + trunk) / (n + 1);
      if (ear) b.ear = b.ear ? [(b.ear[0] * n + ear[0]) / (n + 1), (b.ear[1] * n + ear[1]) / (n + 1)] : ear;
      b.n++;
    }
    const hasBase = b.n >= FORM_CHECK.baselineFrames;
    const wrist = k === 'l' ? LM.lWrist : LM.rWrist;
    const elbowBend = this.seen(f, wrist) ? bend(sh[k], el[k], this.pt(f, wrist)) : null;
    const i = k === 'l' ? 0 : 1;
    const shrug = hasBase && ear && b.ear ? ((b.ear[i] - ear[i]) / b.ear[i]) * 100 : null;
    const rest = KINDS['shoulder-abduction'].repDown;
    const spd = this.speed(signal);
    return { ok: true, signal, faults: {
      'abd-elbow-bent': signal > rest ? elbowBend : null,
      'abd-lean': hasBase && signal > rest ? turn(trunk, b.trunk) : null,
      'abd-shrug': signal > rest ? shrug : null,
      'abd-fast': signal > 5 ? spd : null,
    } };
  }

  /** Speed of the main movement number per second (absolute), from the last usable frame. */
  private speed(sig: number): number | null {
    const t = this.tLast;
    const out = this.lastSignal === null || t <= this.lastT ? null : (Math.abs(sig - this.lastSignal) / (t - this.lastT)) * 1000;
    this.lastSignal = sig; this.lastT = t;
    return out;
  }

  private watch(id: string, kind: FormFaultKind, limit: number, unit: FormFault['unit'], v: number | null, rep: number, tMs: number, minFrames: number, ev: FormEvent[]) {
    const over = v !== null && Number.isFinite(v) && v > limit;
    const n = over ? (this.run.get(id) ?? 0) + 1 : 0;
    this.run.set(id, n);
    if (over && n >= minFrames) this.record(id, kind, rep, v!, unit, tMs, ev);
  }

  private record(id: string, kind: FormFaultKind, rep: number, value: number, unit: FormFault['unit'], tMs: number, ev: FormEvent[]) {
    let f = this.found.get(id);
    if (!f) { f = { kind, reps: new Set(), peak: value, unit, firstSec: ((tMs - (this.t0 ?? tMs)) / 1000) }; this.found.set(id, f); }
    f.peak = Math.max(f.peak, value);
    if (!f.reps.has(rep)) { f.reps.add(rep); ev.push({ type: 'fault', id, kind, rep }); }
    // A pause is asked only when the camera has been seeing the body well, and not more than once every 5 seconds.
    if (FORM_CHECK.pauseEnabled && FORM_CHECK.pauseOn.includes(kind) && this.recentUsable >= 0.8 && tMs - this.lastPauseMs > 5000) {
      this.lastPauseMs = tMs;
      this.pausedIds.add(id);
      ev.push({ type: 'pause', id });
    }
  }
}
