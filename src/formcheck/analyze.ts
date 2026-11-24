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
import { FORM_CHECK, HOLD_FAULT, KINDS, LIMIT_FAULTS, LM, PUMP, PUMP_FAULT, STEP_FAULT, WALK, type FormKind } from './config';

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
  /** Balance only: how long each hold lasted, in seconds. */
  holds?: number[];
  /** Walking only: steps a minute. */
  cadence?: number;
}

const RAD = 180 / Math.PI;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Smallest turn between two directions, in degrees. */
const turn = (a: number, b: number) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return Math.abs(d); };
const bend = (a: Pt, v: Pt, b: Pt): number | null => { const x = angleAt(a, v, b); return x === null ? null : 180 - x; };

interface Measure { ok: boolean; signal: number; faults: Record<string, number | null> }
interface Cand { mh: Pt; lA: Pt; rA: Pt; leg: number; trunk: number }
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
  private hist: { s: number; t: number }[] = [];
  private cand: Cand[] = [];
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
  private holdT0 = 0;
  private steps: { len: number; lead: number; t: number }[] = [];
  private stepSign = 1;
  private peakSign = 1;
  private lastHx = 0;
  private stepHx0 = 0;
  private dorsiNow = 0;
  private dorsiMax = 0;
  private aWin: { ang: number; k: Pt }[] = [];
  private holds: number[] = [];
  private closed = false;

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
    if (!this.inRep && s >= cfg.repUp) { this.inRep = true; this.peak = s; this.holdT0 = tMs; this.stepHx0 = this.lastHx; this.peakSign = this.stepSign; }
    else if (this.inRep) {
      if (s >= this.peak) this.peakSign = this.stepSign;
      this.peak = Math.max(this.peak, s);
      if (s <= cfg.repDown) {
        this.inRep = false;
        this.reps++;
        ev.push({ type: 'rep', n: this.reps });
        if (this.isBalance) this.endHold(tMs, ev);
        if (this.kind === 'walking') {
          // Which foot led: the sign of the feet's gap, flipped when walking leftwards, so the two walking directions agree.
          const dir = Math.sign(this.lastHx - this.stepHx0);
          this.steps.push({ len: this.peak, lead: dir === 0 ? 0 : this.peakSign * dir, t: tMs });
        }
        if (this.kind === 'ankle-pump') this.endPump(tMs, ev);
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

  private get isBalance(): boolean { return this.kind === 'balance' || this.kind === 'balance-line'; }
  /** Steps a minute, from the first to the last counted step. Needs at least 4 steps. */
  private cadence(): number | null {
    const n = this.steps.length;
    if (n < 4) return null;
    const ms = this.steps[n - 1].t - this.steps[0].t;
    return ms > 0 ? Math.round(((n - 1) * 60000) / ms) : null;
  }
  /** Walking: compares the step length when the left foot led with when the right foot led. Needs enough steps of each. */
  private judgeSteps() {
    const a = this.steps.filter((s) => s.lead > 0).map((s) => s.len), b = this.steps.filter((s) => s.lead < 0).map((s) => s.len);
    if (this.steps.length < WALK.minSteps || a.length < 2 || b.length < 2) return;
    const m = (x: number[]) => x.reduce((p, q) => p + q, 0) / x.length;
    const ma = m(a), mb = m(b);
    const diff = (Math.abs(ma - mb) / ((ma + mb) / 2)) * 100;
    if (diff > WALK.unevenPct) this.record(STEP_FAULT.id, STEP_FAULT.kind, this.reps, diff, 'pct', this.tLast, []);
  }
  /** Ankle pumps: a pump ended. Flag it if the toes did not come up towards the shin before it. */
  private endPump(tMs: number, ev: FormEvent[]) {
    if (this.dorsiMax < PUMP.dorsiMinDeg) this.record(PUMP_FAULT.id, PUMP_FAULT.kind, this.reps, PUMP.dorsiMinDeg - this.dorsiMax, 'deg', tMs, ev);
    this.dorsiMax = 0;
  }
  /** One hold ended: note how long it lasted, and flag it if it was shorter than the target. */
  private endHold(tMs: number, ev: FormEvent[]) {
    const sec = Math.max(0, (tMs - this.holdT0) / 1000);
    this.holds.push(Math.round(sec * 10) / 10);
    if (sec < FORM_CHECK.holdMinSec) this.record(HOLD_FAULT.id, HOLD_FAULT.kind, this.reps, FORM_CHECK.holdMinSec - sec, 's', tMs, ev);
  }

  /** Ends the set. Faults are listed only when the camera saw enough; otherwise nothing is flagged. */
  finish(): FormSummary {
    // A set often ends while the foot is still up: that hold counts too.
    if (!this.closed && this.isBalance && this.inRep) { this.inRep = false; this.reps++; this.endHold(this.tLast, []); }
    if (!this.closed && this.kind === 'walking') this.judgeSteps();
    this.closed = true;
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
      ...(this.isBalance && this.holds.length ? { holds: this.holds.slice(0, 30) } : {}),
      ...(this.kind === 'walking' && this.cadence() !== null ? { cadence: this.cadence()! } : {}),
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
  /** Like seen, with a lower bar: the far leg in a side view is often only partly visible. */
  private seenMin(f: Landmark[], min: number, ...ids: number[]): boolean { return ids.every((i) => (f[i]?.v ?? 0) >= min); }
  private pt(f: Landmark[], i: number): Pt { return { x: f[i].x * this.aspect, y: f[i].y }; }

  private measure(f: Landmark[]): Measure | null {
    switch (this.kind) {
      case 'slr': return this.mSlr(f);
      case 'squat': return this.legs(f, 'squat', 1, true);
      case 'sit-to-stand': return this.legs(f, 'sit', -1, true);
      case 'lunge': return this.legs(f, 'lunge', 1, false);
      case 'step-up': return this.legs(f, 'step', -1, false);
      case 'shoulder-abduction': return this.mAbd(f);
      case 'shoulder-flexion': return this.mFlex(f);
      case 'knee-flex': return this.mKneeFlex(f);
      case 'hip-abduction': return this.mHipAbd(f);
      case 'bridging': return this.mBridge(f);
      case 'calf-raise': return this.mCalf(f);
      case 'balance': case 'balance-line': return this.mBalance(f);
      case 'walking': return this.mWalk(f);
      case 'ankle-pump': return this.mPump(f);
    }
  }

  /** Learns the starting position, but only once the person has stopped moving (they may still be getting into position). */
  private learn(c: Cand): boolean {
    const b = this.base, N = FORM_CHECK.baselineFrames;
    if (b.n >= N) return true;
    this.cand.push(c);
    if (this.cand.length > N) this.cand.shift();
    if (this.cand.length < N) return false;
    const span = (g: (c: Cand) => number) => Math.max(...this.cand.map(g)) - Math.min(...this.cand.map(g));
    const leg = c.leg;
    const still = span((x) => x.mh.x) < 0.03 * leg && span((x) => x.mh.y) < 0.03 * leg && span((x) => x.lA.x) < 0.04 * leg && span((x) => x.rA.x) < 0.04 * leg && span((x) => x.lA.y) < 0.04 * leg && span((x) => x.rA.y) < 0.04 * leg;
    if (!still) return false;
    const avg = (g: (c: Cand) => number) => this.cand.reduce((a, x) => a + g(x), 0) / N;
    b.hipX = avg((x) => x.mh.x); b.hipY = avg((x) => x.mh.y); b.leg = avg((x) => x.leg); b.trunk = avg((x) => x.trunk);
    b.ankles = [{ x: avg((x) => x.lA.x), y: avg((x) => x.lA.y) }, { x: avg((x) => x.rA.x), y: avg((x) => x.rA.y) }];
    b.n = N;
    return true;
  }
  /** Side on: the body side nearest the camera, judged by how clearly its points are seen. */
  private nearSide(f: Landmark[], sets: { l: readonly number[]; r: readonly number[] }): 'l' | 'r' {
    const vis = (k: 'l' | 'r') => sets[k].reduce((s, i) => s + (f[i]?.v ?? 0), 0);
    if (!this.side || !this.seen(f, ...sets[this.side])) this.side = vis('l') >= vis('r') ? 'l' : 'r';
    return this.side;
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

  /**
   * Front view of the legs. `dir` 1: the hips go down (squat, lunge). -1: the hips go up (sit to stand, step up).
   * `feet`: judge the feet too (squat, sit to stand); lunges and step-ups move a foot on purpose, so only hip sway is judged there.
   */
  private legs(f: Landmark[], p: string, dir: 1 | -1, feet: boolean): Measure {
    if (!this.seen(f, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle)) return { ok: false, signal: 0, faults: {} };
    const lH = this.pt(f, LM.lHip), rH = this.pt(f, LM.rHip), lK = this.pt(f, LM.lKnee), rK = this.pt(f, LM.rKnee), lA = this.pt(f, LM.lAnkle), rA = this.pt(f, LM.rAnkle);
    const mh = mid(lH, rH);
    const leg = (dist(lH, lA) + dist(rH, rA)) / 2;
    if (leg < 1e-6) return { ok: false, signal: 0, faults: {} };
    const shoulders = this.seen(f, LM.lShoulder, LM.rShoulder);
    const ms = shoulders ? mid(this.pt(f, LM.lShoulder), this.pt(f, LM.rShoulder)) : null;
    const trunk = ms ? Math.atan2(ms.x - mh.x, -(ms.y - mh.y)) * RAD : 0;
    const b = this.base;
    if (!this.learn({ mh, lA, rA, leg, trunk })) return { ok: true, signal: 0, faults: {} };
    const signal = dir * ((mh.y - b.hipY) / b.leg) * 100;
    const inward = (h: Pt, k: Pt, a: Pt): number => {
      const dy = a.y - h.y;
      if (Math.abs(dy) < 1e-6) return 0;
      const lineX = h.x + ((a.x - h.x) * (k.y - h.y)) / dy;
      const d = Math.sign(mh.x - h.x) || 1;
      return (((k.x - lineX) * d) / Math.max(dist(h, k), 1e-6)) * 100;
    };
    const knee = Math.max(inward(lH, lK, lA), inward(rH, rK, rA));
    const sway = (Math.abs(mh.x - b.hipX) / b.leg) * 100;
    const foot = feet ? Math.max(dist(lA, b.ankles![0]), dist(rA, b.ankles![1])) / b.leg * 100 : 0;
    const spd = this.speed(signal);
    const rest = KINDS[this.kind].repDown;
    return { ok: true, signal, faults: {
      [`${p}-knee-in`]: signal > rest ? knee : null,
      [`${p}-lean`]: ms && signal > rest ? turn(trunk, b.trunk) : null,
      [`${p}-${feet ? 'balance' : 'sway'}`]: signal > 3 ? Math.max(foot, sway) : null,
      [`${p}-fast`]: signal > 3 ? spd : null,
    } };
  }

  /** Side view, lying or sitting: the knee bends and straightens (heel slides, gentle knee movement). */
  private mKneeFlex(f: Landmark[]): Measure {
    const sets = { l: [LM.lShoulder, LM.lHip, LM.lKnee, LM.lAnkle], r: [LM.rShoulder, LM.rHip, LM.rKnee, LM.rAnkle] } as const;
    const k = this.nearSide(f, sets);
    const [sh, hip, kn, an] = sets[k];
    if (!this.seen(f, sh, hip, kn, an)) return { ok: false, signal: 0, faults: {} };
    const S = this.pt(f, sh), H = this.pt(f, hip), K = this.pt(f, kn), A = this.pt(f, an);
    const flex = bend(H, K, A);
    if (flex === null) return { ok: false, signal: 0, faults: {} };
    const trunk = Math.atan2(H.y - S.y, H.x - S.x) * RAD;
    const rest = KINDS['knee-flex'].repDown;
    if (flex < rest && this.base.n < FORM_CHECK.baselineFrames) { this.base.trunk = (this.base.trunk * this.base.n + trunk) / (this.base.n + 1); this.base.n++; }
    const hasBase = this.base.n >= FORM_CHECK.baselineFrames;
    const speed = this.speed(flex);
    return { ok: true, signal: flex, faults: {
      'flex-trunk-shift': hasBase && flex > 5 ? turn(trunk, this.base.trunk) : null,
      'flex-fast': flex > 5 ? speed : null,
    } };
  }

  /** Side view, standing: the arm nearest the camera is raised forwards (assisted arm raise, wall slide). */
  private mFlex(f: Landmark[]): Measure {
    const sets = { l: [LM.lShoulder, LM.lHip, LM.lElbow], r: [LM.rShoulder, LM.rHip, LM.rElbow] } as const;
    const k = this.nearSide(f, sets);
    const [sh, hip, el] = sets[k];
    if (!this.seen(f, sh, hip, el)) return { ok: false, signal: 0, faults: {} };
    const S = this.pt(f, sh), H = this.pt(f, hip), E = this.pt(f, el);
    const lift = angleAt(H, S, E);
    if (lift === null) return { ok: false, signal: 0, faults: {} };
    const trunk = Math.atan2(S.x - H.x, -(S.y - H.y)) * RAD;
    const rest = KINDS['shoulder-flexion'].repDown;
    if (lift < rest && this.base.n < FORM_CHECK.baselineFrames) { this.base.trunk = (this.base.trunk * this.base.n + trunk) / (this.base.n + 1); this.base.n++; }
    const hasBase = this.base.n >= FORM_CHECK.baselineFrames;
    const speed = this.speed(lift);
    return { ok: true, signal: lift, faults: {
      'arm-lean': hasBase && lift > rest ? turn(trunk, this.base.trunk) : null,
      'arm-fast': lift > 5 ? speed : null,
    } };
  }

  /** Front view, standing: the leg that moves further out from straight down is measured. */
  private mHipAbd(f: Landmark[]): Measure {
    if (!this.seen(f, LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle)) return { ok: false, signal: 0, faults: {} };
    const hp = { l: this.pt(f, LM.lHip), r: this.pt(f, LM.rHip) };
    const kn = { l: this.pt(f, LM.lKnee), r: this.pt(f, LM.rKnee) };
    const an = { l: this.pt(f, LM.lAnkle), r: this.pt(f, LM.rAnkle) };
    const out = (k: 'l' | 'r') => Math.atan2(Math.abs(an[k].x - hp[k].x), Math.max(an[k].y - hp[k].y, 1e-6)) * RAD;
    const o = { l: out('l'), r: out('r') };
    const k: 'l' | 'r' = o.l >= o.r ? 'l' : 'r';
    const signal = o[k];
    const ms = mid(this.pt(f, LM.lShoulder), this.pt(f, LM.rShoulder)), mh = mid(hp.l, hp.r);
    const trunk = Math.atan2(ms.x - mh.x, -(ms.y - mh.y)) * RAD;
    const rest = KINDS['hip-abduction'].repDown;
    if (signal < rest && this.base.n < FORM_CHECK.baselineFrames) { this.base.trunk = (this.base.trunk * this.base.n + trunk) / (this.base.n + 1); this.base.n++; }
    const hasBase = this.base.n >= FORM_CHECK.baselineFrames;
    const knee = bend(hp[k], kn[k], an[k]);
    const speed = this.speed(signal);
    return { ok: true, signal, faults: {
      'hipabd-lean': hasBase && signal > rest ? turn(trunk, this.base.trunk) : null,
      'hipabd-knee-bent': signal > rest ? knee : null,
      'hipabd-fast': signal > 5 ? speed : null,
    } };
  }

  /** Side view, lying on the back: the hips lift. The resting hip height is learned while the person lies still. */
  private mBridge(f: Landmark[]): Measure {
    const sets = { l: [LM.lHip, LM.lKnee, LM.lAnkle], r: [LM.rHip, LM.rKnee, LM.rAnkle] } as const;
    const k = this.nearSide(f, sets);
    const [hip, kn, an] = sets[k];
    if (!this.seen(f, hip, kn, an)) return { ok: false, signal: 0, faults: {} };
    const H = this.pt(f, hip), K = this.pt(f, kn), A = this.pt(f, an);
    const thigh = dist(H, K);
    if (thigh < 1e-6) return { ok: false, signal: 0, faults: {} };
    const b = this.base;
    if (!this.learn({ mh: H, lA: A, rA: A, leg: thigh, trunk: 0 })) return { ok: true, signal: 0, faults: {} };
    const signal = ((b.hipY - H.y) / b.leg) * 100;
    const spd = this.speed(signal);
    return { ok: true, signal, faults: {
      'bridge-feet': signal > 3 ? (dist(A, b.ankles![0]) / b.leg) * 100 : null,
      'bridge-fast': signal > 3 ? spd : null,
    } };
  }

  /** Front view, standing on one leg: a foot is lifted and held. Counts each lift as one hold; judges the wobble, the lean and the arms. */
  private mBalance(f: Landmark[]): Measure {
    if (!this.seen(f, LM.lHip, LM.rHip, LM.lAnkle, LM.rAnkle)) return { ok: false, signal: 0, faults: {} };
    const lH = this.pt(f, LM.lHip), rH = this.pt(f, LM.rHip), lA = this.pt(f, LM.lAnkle), rA = this.pt(f, LM.rAnkle);
    const mh = mid(lH, rH);
    const leg = (dist(lH, lA) + dist(rH, rA)) / 2;
    if (leg < 1e-6) return { ok: false, signal: 0, faults: {} };
    const shoulders = this.seen(f, LM.lShoulder, LM.rShoulder);
    const ms = shoulders ? mid(this.pt(f, LM.lShoulder), this.pt(f, LM.rShoulder)) : null;
    const trunk = ms ? Math.atan2(ms.x - mh.x, -(ms.y - mh.y)) * RAD : 0;
    const b = this.base;
    if (!this.learn({ mh, lA, rA, leg, trunk })) return { ok: true, signal: 0, faults: {} };
    // One foot lifted: how high it is off the floor. Heel to toe: how much closer the feet look than at the start.
    const startGap = Math.abs(b.ankles![0].x - b.ankles![1].x);
    const signal = this.kind === 'balance-line'
      ? (startGap < 0.08 * b.leg ? 0 : Math.max(0, ((startGap - Math.abs(lA.x - rA.x)) / startGap) * 100))
      : (Math.max(b.ankles![0].y - lA.y, b.ankles![1].y - rA.y) / b.leg) * 100;
    const spd = this.speed(((mh.x - b.hipX) / b.leg) * 100);
    let arms: number | null = null;
    if (shoulders && this.seen(f, LM.lWrist, LM.rWrist)) {
      const a = [angleAt(lH, this.pt(f, LM.lShoulder), this.pt(f, LM.lWrist)), angleAt(rH, this.pt(f, LM.rShoulder), this.pt(f, LM.rWrist))].filter((x): x is number => x !== null);
      arms = a.length ? Math.max(...a) : null;
    }
    const rest = KINDS[this.kind].repDown;
    return { ok: true, signal, faults: {
      'bal-wobble': signal > rest ? spd : null,
      'bal-lean': ms && signal > rest ? turn(trunk, b.trunk) : null,
      'bal-arms': signal > rest ? arms : null,
    } };
  }

  /** Side view, walking across the picture: the gap between the feet rises and falls once per step. */
  private mWalk(f: Landmark[]): Measure {
    const sets = { l: [LM.lShoulder, LM.lHip], r: [LM.rShoulder, LM.rHip] } as const;
    const k = this.nearSide(f, sets);
    const [sh, hip] = sets[k];
    if (!this.seen(f, sh, hip) || !this.seenMin(f, 0.3, LM.lAnkle, LM.rAnkle)) return { ok: false, signal: 0, faults: {} };
    const S = this.pt(f, sh), H = this.pt(f, hip), lA = this.pt(f, LM.lAnkle), rA = this.pt(f, LM.rAnkle);
    const torso = dist(S, H);
    if (torso < 1e-6) return { ok: false, signal: 0, faults: {} };
    const gap = ((lA.x - rA.x) / torso) * 100;
    this.stepSign = gap >= 0 ? 1 : -1;
    this.lastHx = H.x;
    const lean = Math.abs(Math.atan2(S.x - H.x, -(S.y - H.y)) * RAD);
    return { ok: true, signal: Math.abs(gap), faults: { 'walk-lean': Math.abs(gap) > KINDS.walking.repDown ? lean : null } };
  }

  /** Side view, lying with the leg straight: the toes point away (plantar flexion) and come back. The relaxed foot angle is learned while still. */
  private mPump(f: Landmark[]): Measure {
    const sets = { l: [LM.lKnee, LM.lAnkle, LM.lFoot], r: [LM.rKnee, LM.rAnkle, LM.rFoot] } as const;
    const k = this.nearSide(f, sets);
    const [kn, an, ft] = sets[k];
    if (!this.seen(f, kn, an, ft)) return { ok: false, signal: 0, faults: {} };
    const K = this.pt(f, kn), A = this.pt(f, an), F = this.pt(f, ft);
    const ang = angleAt(K, A, F);
    const shank = dist(K, A);
    if (ang === null || shank < 1e-6) return { ok: false, signal: 0, faults: {} };
    const b = this.base, N = FORM_CHECK.baselineFrames;
    if (b.n < N) {
      this.aWin.push({ ang, k: K });
      if (this.aWin.length > N) this.aWin.shift();
      if (this.aWin.length === N) {
        const angs = this.aWin.map((x) => x.ang);
        const still = Math.max(...angs) - Math.min(...angs) < 4 && Math.max(...this.aWin.map((x) => x.k.x)) - Math.min(...this.aWin.map((x) => x.k.x)) < 0.03 * shank && Math.max(...this.aWin.map((x) => x.k.y)) - Math.min(...this.aWin.map((x) => x.k.y)) < 0.03 * shank;
        if (still) { b.trunk = angs.reduce((p, q) => p + q, 0) / N; b.hipX = this.aWin.reduce((p, x) => p + x.k.x, 0) / N; b.hipY = this.aWin.reduce((p, x) => p + x.k.y, 0) / N; b.leg = shank; b.n = N; }
      }
      return { ok: true, signal: 0, faults: {} };
    }
    const dev = ang - b.trunk;           // plus: toes pointing away; minus: toes towards the shin
    this.dorsiNow = Math.max(0, -dev);
    this.dorsiMax = Math.max(this.dorsiMax, this.dorsiNow);
    return { ok: true, signal: Math.max(0, dev), faults: { 'pump-leg-moves': (dist(K, { x: b.hipX, y: b.hipY }) / b.leg) * 100 } };
  }

  /** Front view, standing: the heels rise. The resting position is learned while the person stands still. */
  private mCalf(f: Landmark[]): Measure {
    if (!this.seen(f, LM.lHip, LM.rHip, LM.lAnkle, LM.rAnkle)) return { ok: false, signal: 0, faults: {} };
    const lH = this.pt(f, LM.lHip), rH = this.pt(f, LM.rHip), lA = this.pt(f, LM.lAnkle), rA = this.pt(f, LM.rAnkle);
    const mh = mid(lH, rH);
    const leg = (dist(lH, lA) + dist(rH, rA)) / 2;
    if (leg < 1e-6) return { ok: false, signal: 0, faults: {} };
    const shoulders = this.seen(f, LM.lShoulder, LM.rShoulder);
    const ms = shoulders ? mid(this.pt(f, LM.lShoulder), this.pt(f, LM.rShoulder)) : null;
    const trunk = ms ? Math.atan2(ms.x - mh.x, -(ms.y - mh.y)) * RAD : 0;
    const b = this.base;
    if (!this.learn({ mh, lA, rA, leg, trunk })) return { ok: true, signal: 0, faults: {} };
    const rise = (b.ankles![0].y + b.ankles![1].y - lA.y - rA.y) / 2;
    const signal = (rise / b.leg) * 100;
    const spd = this.speed(signal);
    const rest = KINDS['calf-raise'].repDown;
    return { ok: true, signal, faults: {
      'calf-lean': ms && signal > rest ? turn(trunk, b.trunk) : null,
      'calf-sway': signal > rest ? (Math.abs(mh.x - b.hipX) / b.leg) * 100 : null,
      'calf-fast': signal > rest ? spd : null,
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

  /** Speed of the main movement number per second (absolute), measured over about the last 0.3 s so camera jitter is not read as speed. */
  private speed(sig: number): number | null {
    const t = this.tLast;
    this.hist.push({ s: sig, t });
    if (this.hist.length > 5) this.hist.shift();
    const a = this.hist[0];
    if (this.hist.length < 3 || t <= a.t) return null;
    return (Math.abs(sig - a.s) / (t - a.t)) * 1000;
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
