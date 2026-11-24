/**
 * Pilot mode for the camera form check. For a physio running the check on volunteers, to find out which default thresholds are wrong.
 *
 * What it keeps, per set: the numbers the phone measured (how high each fault measure got, a thin trace of the movement), what the
 * phone flagged, and what the person watching said: was each flag real or a false alarm, and which faults did the phone miss.
 * No video, no names (a participant label such as "P07"). It lives in this browser only, apart from patient data, and is never synced.
 * It is switched on by hand and off by default, and it is not offered on a patient's own phone.
 *
 * From the ratings it can suggest a better limit for a fault. That is only a suggestion for the physio to sign off:
 * nothing here changes a threshold, a plan or a tier by itself.
 */
import { KINDS, type FormKind } from './config';
import type { FormSummary } from './analyze';

const KEY = 'rehabpath-pilot';
export const PILOT_MAX_RECORDS = 300;
/** A limit is only suggested once this many rated sets are real faults and this many are not (and this many in all). */
export const PILOT_MIN = { positive: 3, negative: 3, total: 10 } as const;

export interface PilotRecord {
  id: string;
  at: string;
  participant: string;
  kind: FormKind;
  exerciseId: string;
  seconds: number;
  /** Reps (or holds, steps) the phone counted. */
  reps: number;
  usable: number;
  reliable: boolean;
  flagged: { id: string; peak: number; unit: string; reps: number[] }[];
  /** The highest level each fault measure stayed above for the number of frames the fault needs. */
  held: Record<string, number>;
  /** The limit in force for each fault when the set was done. */
  limits: Record<string, number>;
  trace: [number, number][];
  rated: boolean;
  /** The observer's verdict on each flag the phone raised. */
  marks: Record<string, 'real' | 'false'>;
  /** Faults the observer saw that the phone did not flag. */
  missed: string[];
  /** What the observer counted. */
  observerReps: number | null;
  note: string;
}
export interface PilotStore { on: boolean; participant: string; records: PilotRecord[] }

const EMPTY: PilotStore = { on: false, participant: '', records: [] };

export function loadPilot(storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): PilotStore {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...EMPTY, records: [] };
    const j = JSON.parse(raw) as Partial<PilotStore>;
    return { on: j.on === true, participant: typeof j.participant === 'string' ? j.participant.slice(0, 20) : '', records: Array.isArray(j.records) ? j.records.filter((r) => r && typeof r.id === 'string' && r.kind in KINDS) : [] };
  } catch { return { ...EMPTY, records: [] }; }
}
export function savePilot(s: PilotStore, storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify({ ...s, records: s.records.slice(-PILOT_MAX_RECORDS) })); } catch { /* private mode or full: pilot data is best effort */ }
}
export const pilotActive = (): boolean => loadPilot().on;

/** Builds the record for a finished set. `limits` are the thresholds in force. */
export function newPilotRecord(a: { id: string; at: string; participant: string; kind: FormKind; exerciseId: string; summary: FormSummary }): PilotRecord {
  const limits: Record<string, number> = {};
  for (const f of KINDS[a.kind].faults) limits[f.id] = f.limit;
  return {
    id: a.id, at: a.at, participant: a.participant.trim().slice(0, 20) || 'P?', kind: a.kind, exerciseId: a.exerciseId,
    seconds: a.summary.seconds, reps: a.summary.reps, usable: a.summary.usable, reliable: a.summary.reliable,
    flagged: a.summary.faults.map((f) => ({ id: f.id, peak: f.peak, unit: f.unit, reps: f.reps })),
    held: a.summary.held ?? {}, limits, trace: (a.summary.trace ?? []).slice(0, 600),
    rated: false, marks: {}, missed: [], observerReps: null, note: '',
  };
}

export function rate(r: PilotRecord, v: { marks: Record<string, 'real' | 'false'>; missed: string[]; observerReps: number | null; note: string }): PilotRecord {
  const flagged = new Set(r.flagged.map((f) => f.id));
  const marks: Record<string, 'real' | 'false'> = {};
  for (const [id, m] of Object.entries(v.marks)) if (flagged.has(id) && (m === 'real' || m === 'false')) marks[id] = m;
  return { ...r, rated: true, marks, missed: v.missed.filter((id) => !flagged.has(id) && id in r.limits), observerReps: v.observerReps, note: v.note.slice(0, 300) };
}

export function upsert(s: PilotStore, r: PilotRecord): PilotStore {
  const i = s.records.findIndex((x) => x.id === r.id);
  const records = i >= 0 ? s.records.map((x, k) => (k === i ? r : x)) : [...s.records, r];
  return { ...s, records: records.slice(-PILOT_MAX_RECORDS) };
}

// ---------- what the ratings say ----------
export interface FaultStats {
  kind: FormKind; id: string;
  /** Rated sets the camera saw well enough to judge. */
  sets: number;
  real: number; falseAlarm: number; missed: number;
  limit: number; unit: string;
  suggestion: Suggestion | null;
}
export interface Suggestion { enough: boolean; positives: number; negatives: number; limit?: number; precision?: number; recall?: number; currentPrecision?: number; currentRecall?: number }

/** For one fault: the verdict on every rated, reliable set. True: the fault really happened. Only sets with a clear verdict count. */
function labelled(recs: PilotRecord[], kind: FormKind, id: string): { level: number; real: boolean }[] {
  const out: { level: number; real: boolean }[] = [];
  for (const r of recs) {
    if (r.kind !== kind || !r.rated || !r.reliable || !(id in r.limits)) continue;
    const flagged = r.flagged.some((f) => f.id === id);
    const level = r.held[id] ?? 0;
    if (flagged) { const m = r.marks[id]; if (m) out.push({ level, real: m === 'real' }); }
    else out.push({ level, real: r.missed.includes(id) });
  }
  return out;
}

const score = (rows: { level: number; real: boolean }[], limit: number) => {
  let tp = 0, fp = 0, fn = 0;
  for (const x of rows) { const hit = x.level > limit; if (hit && x.real) tp++; else if (hit) fp++; else if (x.real) fn++; }
  const precision = tp + fp ? tp / (tp + fp) : 1, recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
};

/** The limit that best separates real faults from the rest in the rated sets (best F1; the higher limit on a tie, so fewer false alarms). */
export function suggest(recs: PilotRecord[], kind: FormKind, id: string): Suggestion {
  const rows = labelled(recs, kind, id);
  const positives = rows.filter((x) => x.real).length, negatives = rows.length - positives;
  const cfg = KINDS[kind].faults.find((f) => f.id === id);
  if (!cfg || rows.length < PILOT_MIN.total || positives < PILOT_MIN.positive || negatives < PILOT_MIN.negative) return { enough: false, positives, negatives };
  const levels = [...new Set(rows.map((x) => x.level))].sort((a, b) => a - b);
  const cands = [levels[0] - 1, ...levels.slice(1).map((v, i) => (v + levels[i]) / 2)];
  let best = { limit: cands[0], f1: -1, precision: 0, recall: 0 };
  for (const c of cands) { const s = score(rows, c); if (s.f1 > best.f1 || (s.f1 === best.f1 && c > best.limit)) best = { limit: c, ...s }; }
  const cur = score(rows, cfg.limit);
  const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100;
  return { enough: true, positives, negatives, limit: r1(Math.max(0, best.limit)), precision: r2(best.precision), recall: r2(best.recall), currentPrecision: r2(cur.precision), currentRecall: r2(cur.recall) };
}

export function summarise(recs: PilotRecord[]): FaultStats[] {
  const out: FaultStats[] = [];
  const kinds = [...new Set(recs.map((r) => r.kind))];
  for (const kind of kinds) {
    for (const f of KINDS[kind].faults) {
      const rows = recs.filter((r) => r.kind === kind && r.rated && r.reliable);
      if (!rows.length) continue;
      out.push({
        kind, id: f.id, sets: rows.length,
        real: rows.filter((r) => r.marks[f.id] === 'real').length,
        falseAlarm: rows.filter((r) => r.marks[f.id] === 'false').length,
        missed: rows.filter((r) => r.missed.includes(f.id)).length,
        limit: f.limit, unit: f.unit, suggestion: suggest(recs, kind, f.id),
      });
    }
  }
  return out;
}

// ---------- export ----------
const q = (v: string | number | boolean | null | undefined) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** One row per set per fault the exercise can flag: easy to open in a spreadsheet and sort. */
export function toCsv(recs: PilotRecord[]): string {
  const head = ['participant', 'when', 'exercise', 'kind', 'fault', 'level_held', 'limit_in_force', 'phone_flagged', 'observer_verdict', 'observer_saw_it_missed', 'rated', 'camera_reliable', 'share_frames_seen', 'reps_phone', 'reps_observer', 'seconds', 'note'];
  const rows = [head.join(',')];
  for (const r of recs) {
    for (const f of KINDS[r.kind].faults) {
      const flagged = r.flagged.some((x) => x.id === f.id);
      rows.push([r.participant, r.at, r.exerciseId, r.kind, f.id, r.held[f.id] ?? '', r.limits[f.id] ?? f.limit, flagged, r.marks[f.id] ?? '', r.missed.includes(f.id), r.rated, r.reliable, r.usable, r.reps, r.observerReps ?? '', r.seconds, r.note].map(q).join(','));
    }
  }
  return rows.join('\n');
}
export const toJson = (recs: PilotRecord[]): string => JSON.stringify({ app: 'rehabpath-form-check-pilot', exportedAt: new Date().toISOString(), records: recs }, null, 2);
