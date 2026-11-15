import type { DailyCheckIn, Patient, PeriodicEntry, ProtocolPack, Value } from '../types';
import { addDays } from '../engine/dates';
import { getPack } from '../engine/packs';
import { planDefaults } from '../engine/plan';

export const DEMO_TODAY_LAST = '2026-11-14';

export const emptyWarnings = (pack: ProtocolPack): Record<string, boolean> =>
  Object.fromEntries(pack.warningSigns.map((s) => [s.id, false]));

type Ex = 'all' | 'some' | 'none';
const sessions = (ex: Ex, per: number) => (ex === 'all' ? per : ex === 'some' ? Math.max(1, per - 1) : 0);

export function dailyEntry(pack: ProtocolPack, o: {
  date: string; pain: number; swelling?: string; ex: Ex; per: number; hard: string; skip?: string; warnings?: Record<string, boolean>;
}): DailyCheckIn {
  const values: Record<string, Value> = { pain: o.pain };
  if (o.swelling) values.swelling = o.swelling;
  return {
    date: o.date, values, exercises: o.ex, sessionsPrescribed: o.per, sessionsDone: sessions(o.ex, o.per),
    hardMovement: o.hard, warnings: { ...emptyWarnings(pack), ...(o.warnings ?? {}) },
    ...(o.ex === 'none' && o.skip ? { skipReason: o.skip } : {}),
  };
}

const wk = (anchor: string, day: number, ext: number, flex: number, circ: number, lag: boolean, extra: Record<string, Value> = {}): PeriodicEntry => ({
  date: addDays(anchor, day),
  values: { extensionDeficitCm: ext, flexionDeg: flex, kneeCircumferenceDiffCm: circ, slrLag: lag, ...extra },
});

// ---------------- Ravi: the defining scenario (ACL, phase 2) ----------------
const RAVI_PAIN = [6, 6, 5, 5, 5, 4, 4, 4, 4, 4, 3, 4, 3, 3, 3, 3, 3, 2, 3, 3, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2];
const RAVI_SW = 'SSMSSLSSMSLLSLLSLLLSLLLLLLSLLLLLSLL'.split('');
const SW = { S: 'same', M: 'more', L: 'less' } as const;
const RAVI_SOME = new Set([4, 10, 17, 26]);
const RAVI_NONE = new Set([12]);
const RAVI_HARD = ['gentle-rom', 'gentle-rom', 'gentle-rom', 'none', 'walking', 'gentle-rom', 'none', 'gentle-rom', 'walking', 'none', 'gentle-rom', 'none', 'step-ups', 'walking', 'none', 'step-ups', 'gentle-rom', 'none', 'walking', 'squats', 'step-ups', 'none', 'gentle-rom', 'squats', 'none', 'walking', 'walking', 'none', 'squats', 'step-ups', 'none', 'step-ups', 'none', 'squats', 'none'];

export function makeRavi(last = DEMO_TODAY_LAST): Patient {
  const pack = getPack('acl-reconstruction');
  const t0 = addDays(last, -35);
  const daily = RAVI_PAIN.map((pain, i) => {
    const s = i + 1;
    const ex: Ex = RAVI_NONE.has(s) ? 'none' : RAVI_SOME.has(s) ? 'some' : 'all';
    return dailyEntry(pack, { date: addDays(t0, s), pain, swelling: SW[RAVI_SW[i] as 'S' | 'M' | 'L'], ex, per: 2, hard: RAVI_HARD[i], skip: 'time' });
  });
  return {
    id: 'ravi', name: 'Ravi', age: 24, packId: pack.id, language: 'en', anchorDate: t0, currentPhase: 'p2', phaseStartDate: addDays(t0, 28),
    sessionsPrescribedPerDay: 2, daily, reviewed: {}, decisions: [], ...planDefaults(),
    periodic: [
      wk(t0, 7, 3, 70, 3, true), wk(t0, 14, 2, 92, 2, true), wk(t0, 21, 1, 112, 1.5, false), wk(t0, 28, 0.5, 126, 1, false),
      wk(t0, 35, 0, 134, 0.5, false, {
        bridgeLSI: 70, calfRaiseLSI: 65, sideBridgeLSI: 75, singleLegRiseLSI: 60, bridgeReps: 12, calfRaiseReps: 10, sideBridgeSec: 18,
        singleLegRiseReps: 5, balanceEyesOpenSec: 25, balanceEyesClosedSec: 4, slSquatRating: 'fair',
      }),
      { date: addDays(t0, 30), values: { tsk11: 16 } },
    ],
  };
}

// ---------------- generic ACL builder for the supporting patients ----------------
const RP = ['gentle-rom', 'none', 'walking', 'none', 'step-ups', 'none', 'squats'];
function zf(o: {
  id: string; name: string; age: number; last: string; days: number; phase: 'p1' | 'p2'; phaseStartDay: number;
  pain: (i: number) => number; ex?: (i: number) => Ex; skip?: (i: number) => string | undefined;
  lastOverride?: { pain?: number; swelling?: string; warnings?: Record<string, boolean> };
  weekly: [number, Record<string, Value>][]; tsk?: [number, number][];
}): Patient {
  const pack = getPack('acl-reconstruction');
  const t0 = addDays(o.last, -o.days);
  const daily = Array.from({ length: o.days }, (_, n) => {
    const i = n + 1;
    const ex = o.ex?.(i) ?? 'all';
    const e = dailyEntry(pack, { date: addDays(t0, i), pain: o.pain(i), swelling: i % 5 === 0 ? 'same' : 'less', ex, per: 2, hard: RP[i % 7], skip: o.skip?.(i) });
    if (i === o.days && o.lastOverride) {
      const lo = o.lastOverride;
      if (lo.pain !== undefined) e.values.pain = lo.pain;
      if (lo.swelling) e.values.swelling = lo.swelling;
      e.warnings = { ...e.warnings, ...(lo.warnings ?? {}) };
    }
    return e;
  });
  return {
    id: o.id, name: o.name, age: o.age, packId: pack.id, language: 'en', anchorDate: t0, currentPhase: o.phase, phaseStartDate: addDays(t0, o.phaseStartDay),
    sessionsPrescribedPerDay: 2, daily, reviewed: {}, decisions: [], ...planDefaults(),
    periodic: [
      ...o.weekly.map(([d, v]) => ({ date: addDays(t0, d), values: v })),
      ...(o.tsk ?? []).map(([d, v]) => ({ date: addDays(t0, d), values: { tsk11: v } })),
    ],
  };
}
const W = (ext: number, flex: number, circ: number, lag: boolean, extra: Record<string, Value> = {}): Record<string, Value> => ({
  extensionDeficitCm: ext, flexionDeg: flex, kneeCircumferenceDiffCm: circ, slrLag: lag, ...extra,
});

// ---------------- Total knee replacement and rotator cuff demo patients ----------------
function makeKamla(last: string): Patient {
  const pack = getPack('total-knee-replacement');
  const days = 35;
  const t0 = addDays(last, -days);
  const daily = Array.from({ length: days }, (_, n) => dailyEntry(pack, {
    date: addDays(t0, n + 1), pain: Math.max(2, 5 - Math.floor(n / 9)), swelling: n % 6 === 5 ? 'same' : 'less', ex: n % 9 === 8 ? 'some' : 'all', per: 2,
    hard: ['heel-slides', 'none', 'quad-set', 'none', 'walking-aid', 'none', 'straight-leg-raise'][n % 7],
  }));
  return {
    id: 'kamla', name: 'Kamla', age: 67, packId: pack.id, language: 'hi', anchorDate: t0, currentPhase: 'p1', phaseStartDate: t0,
    sessionsPrescribedPerDay: 2, daily, reviewed: {}, decisions: [], ...planDefaults(),
    periodic: [
      // Tracks the expected knee-bend curve for four weeks, then drifts below the band at week 5.
      { date: addDays(t0, 7), values: { flexionDeg: 50, extensionDeficitDeg: 12, kneeCircumferenceDiffCm: 3 } },
      { date: addDays(t0, 14), values: { flexionDeg: 62, extensionDeficitDeg: 10, kneeCircumferenceDiffCm: 3 } },
      { date: addDays(t0, 21), values: { flexionDeg: 66, extensionDeficitDeg: 9, kneeCircumferenceDiffCm: 2.5 } },
      { date: addDays(t0, 28), values: { flexionDeg: 70, extensionDeficitDeg: 8, kneeCircumferenceDiffCm: 2.5 } },
      { date: addDays(t0, 35), values: { flexionDeg: 68, extensionDeficitDeg: 8, kneeCircumferenceDiffCm: 2.5 } },
    ],
  };
}
function makeImran(last: string): Patient {
  const pack = getPack('rotator-cuff-repair');
  const days = 12;
  const t0 = addDays(last, -days);
  const daily = Array.from({ length: days }, (_, n) => ({
    ...dailyEntry(pack, { date: addDays(t0, n + 1), pain: Math.max(2, 5 - Math.floor(n / 4)), ex: 'all', per: 2, hard: ['pendulum', 'hand-wrist-elbow', 'none'][n % 3] }),
    precautionBreaches: { 'sling-off': false },
  }));
  return {
    id: 'imran', name: 'Imran', age: 52, packId: pack.id, language: 'en', anchorDate: t0, currentPhase: 'p1', phaseStartDate: t0,
    sessionsPrescribedPerDay: 2, daily, reviewed: {}, decisions: [], ...planDefaults(), periodic: [{ date: addDays(t0, 7), values: { armRaiseDeg: 30 } }],
  };
}

export function makeAllPatients(last = DEMO_TODAY_LAST): Patient[] {
  return [
    makeRavi(last),
    zf({
      id: 'meera', name: 'Meera', age: 31, last, days: 20, phase: 'p1', phaseStartDay: 0,
      pain: (i) => (i < 15 ? Math.max(2, 6 - Math.floor(i / 4)) : i === 20 ? 5 : 3),
      lastOverride: { pain: 5, swelling: 'more', warnings: { calfPainOrRedness: true, fever: true } },
      weekly: [[7, W(3, 60, 3, true)], [14, W(1.5, 90, 2, false)]], tsk: [[10, 15]],
    }),
    zf({
      id: 'arjun', name: 'Arjun', age: 19, last, days: 26, phase: 'p1', phaseStartDay: 0,
      pain: (i) => Math.max(2, 5 - Math.floor(i / 6)), ex: (i) => (i >= 25 ? 'none' : 'all'), skip: () => 'access',
      weekly: [[7, W(3, 65, 3, true)], [14, W(2, 95, 2, true)], [21, W(1, 112, 1.5, false)]], tsk: [[20, 14]],
    }),
    zf({
      id: 'sana', name: 'Sana', age: 28, last, days: 63, phase: 'p2', phaseStartDay: 28, pain: (i) => (i < 20 ? 3 : 1),
      weekly: [
        [7, W(3, 72, 3, true)], [14, W(1.5, 100, 2, false)], [28, W(0, 128, 1, false)], [56, W(0, 138, 0.5, false)],
        [63, W(0, 140, 0, false, {
          slSquatRating: 'good', bridgeLSI: 97, calfRaiseLSI: 96, sideBridgeLSI: 98, singleLegRiseLSI: 91, bridgeReps: 28, calfRaiseReps: 26,
          sideBridgeSec: 38, singleLegRiseReps: 13, balanceEyesOpenSec: 47, balanceEyesClosedSec: 11,
        })],
      ],
      tsk: [[30, 14], [60, 13]],
    }),
    makeKamla(last),
    makeImran(last),
  ];
}

// ---------------- demo fast-forward (patient Ravi) ----------------
export interface DemoStep {
  title: string;
  narration: string;
  patch: { pain: number; ex: Ex; skip?: string; hard: string };
}
export const DEMO_STEPS: DemoStep[] = [
  { title: 'Day 1: a slightly worse day', narration: 'Ravi reports pain 3 and does only one of two sessions. Still within normal variation.', patch: { pain: 3, ex: 'some', hard: 'walking' } },
  { title: 'Day 2: pain keeps rising, he skips', narration: 'Pain 4 (up 2 over three check-ins). He skips today and says it hurt. Squat is hard again.', patch: { pain: 4, ex: 'none', skip: 'pain', hard: 'squats' } },
  { title: 'Day 3: second missed day, same movement', narration: 'Pain 5, second skipped day in a row, and squat is hard a third time this week.', patch: { pain: 5, ex: 'none', skip: 'pain', hard: 'squats' } },
];

/** Appends the next demo day to Ravi. Pure; returns a new patient. */
export function demoStepPatient(p: Patient, step: number): Patient {
  const s = DEMO_STEPS[step];
  if (!s) return p;
  const pack = getPack(p.packId);
  const lastE = p.daily[p.daily.length - 1];
  const e = dailyEntry(pack, { date: addDays(lastE.date, 1), pain: s.patch.pain, swelling: 'same', ex: s.patch.ex, per: p.sessionsPrescribedPerDay, hard: s.patch.hard, skip: s.patch.skip });
  return { ...p, daily: [...p.daily, e] };
}
