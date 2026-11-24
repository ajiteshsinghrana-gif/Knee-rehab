/**
 * Pilot mode for the camera form check. For a physio running the check on volunteers, to find out which default thresholds are wrong.
 *
 * What it keeps, per set: the numbers the phone measured (how high each fault measure got, a thin trace of the movement), what the
 * phone flagged, and the observer's own verdict (faults seen, reps counted), which is entered BEFORE the phone's flags are shown.
 * No video, no names (a participant label such as "P07"). It lives in this browser only, apart from patient data, and is never synced.
 * It is a physio screen behind physio sign-in: it never appears on a patient screen and never writes to a patient record.
 *
 * Each participant is a healthy volunteer performing deliberate faults or a real patient, and is put in the tuning group or the test
 * group. Limits are suggested from the tuning group only; accuracy is reported on the test group only. A figure worked out on the
 * tuning group is labelled as same-data. Every percentage is shown with its counts.
 * A suggestion is only that, for the physio to sign off: nothing here changes a threshold, a plan or a tier by itself.
 */
import { KINDS, PACE_FAULTS, paceApplies, HOLD_FAULT, STEP_FAULT, PUMP_FAULT, type FormKind } from './config';
import type { FormSummary } from './analyze';

const KEY = 'rehabpath-pilot';
export const PILOT_MAX_RECORDS = 300;
/** A limit is only suggested once this many rated sets are real faults and this many are not (and this many in all). */
export const PILOT_MIN = { positive: 3, negative: 3, total: 10 } as const;

export type ParticipantType = 'volunteer' | 'patient';
export type PilotGroup = 'tune' | 'test';
export interface PilotParticipant { label: string; type: ParticipantType; group: PilotGroup }
export const PARTICIPANT_TYPE: Record<ParticipantType, string> = { volunteer: 'Healthy volunteer, performing deliberate faults', patient: 'Real patient' };
export const GROUP_LABEL: Record<PilotGroup, string> = { tune: 'Tuning group (limits are chosen from these)', test: 'Test group (accuracy is reported on these)' };

export interface PilotRecord {
  id: string;
  at: string;
  participant: string;
  participantType: ParticipantType;
  group: PilotGroup;
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
  /** The limit in force for each per-frame fault when the set was done. */
  limits: Record<string, number>;
  trace: [number, number][];
  /** The observer's verdict, entered before the phone's flags were shown. Null until entered. */
  observer: { faults: string[]; reps: number | null; note: string } | null;
  /** Derived from the observer's verdict: each phone flag was real or a false alarm, and which faults the phone missed. */
  rated: boolean;
  marks: Record<string, 'real' | 'false'>;
  missed: string[];
}
export interface PilotStore { participants: PilotParticipant[]; records: PilotRecord[] }

const EMPTY = (): PilotStore => ({ participants: [], records: [] });
const isType = (x: unknown): x is ParticipantType => x === 'volunteer' || x === 'patient';
const isGroup = (x: unknown): x is PilotGroup => x === 'tune' || x === 'test';

export function loadPilot(storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): PilotStore {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return EMPTY();
    const j = JSON.parse(raw) as Partial<PilotStore>;
    const participants = (Array.isArray(j.participants) ? j.participants : []).filter((x) => x && typeof x.label === 'string' && isType(x.type) && isGroup(x.group)).map((x) => ({ label: x.label.slice(0, 20), type: x.type, group: x.group }));
    // Records from before this version have no participant type or group, and no observer verdict entered blind: they are dropped.
    const records = (Array.isArray(j.records) ? j.records : []).filter((r) => r && typeof r.id === 'string' && r.kind in KINDS && isType(r.participantType) && isGroup(r.group));
    return { participants, records };
  } catch { return EMPTY(); }
}
export function savePilot(s: PilotStore, storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify({ ...s, records: s.records.slice(-PILOT_MAX_RECORDS) })); } catch { /* private mode or full: pilot data is best effort */ }
}
/** Adds or updates a participant. Labels are codes such as P07, never names. */
export function putParticipant(s: PilotStore, p: PilotParticipant): PilotStore {
  const label = p.label.trim().slice(0, 20);
  if (!label) return s;
  return { ...s, participants: [...s.participants.filter((x) => x.label !== label), { label, type: p.type, group: p.group }].sort((a, b) => a.label.localeCompare(b.label)) };
}

/** Every fault the phone can raise for a kind: the per-frame ones, and the ones judged per rep, hold, step or pump. */
export function faultsFor(kind: FormKind): string[] {
  const ids = KINDS[kind].faults.map((f) => f.id);
  if (paceApplies(kind)) ids.push(PACE_FAULTS.fast.id, PACE_FAULTS.slow.id);
  if (kind === 'balance' || kind === 'balance-line' || kind === 'plank' || kind === 'bird-dog') ids.push(HOLD_FAULT.id);
  if (kind === 'walking') ids.push(STEP_FAULT.id);
  if (kind === 'ankle-pump') ids.push(PUMP_FAULT.id);
  return [...new Set(ids)];
}

/** Builds the record for a finished set. `limits` are the thresholds in force. The observer's verdict is added with `judge`. */
export function newPilotRecord(a: { id: string; at: string; participant: PilotParticipant; kind: FormKind; exerciseId: string; summary: FormSummary }): PilotRecord {
  const limits: Record<string, number> = {};
  for (const f of KINDS[a.kind].faults) limits[f.id] = f.limit;
  return {
    id: a.id, at: a.at, participant: a.participant.label.trim().slice(0, 20) || 'P?', participantType: a.participant.type, group: a.participant.group,
    kind: a.kind, exerciseId: a.exerciseId,
    seconds: a.summary.seconds, reps: a.summary.reps, usable: a.summary.usable, reliable: a.summary.reliable,
    flagged: a.summary.faults.map((f) => ({ id: f.id, peak: f.peak, unit: f.unit, reps: f.reps })),
    held: a.summary.held ?? {}, limits, trace: (a.summary.trace ?? []).slice(0, 600),
    observer: null, rated: false, marks: {}, missed: [],
  };
}

/**
 * The observer's verdict, entered before the phone's flags are shown: the faults they saw and the reps they counted.
 * A phone flag is then real when the observer saw that fault and a false alarm when they did not; a fault the observer saw that
 * the phone did not flag is a miss. A verdict cannot be changed after the flags were shown (it would no longer be blind).
 */
export function judge(r: PilotRecord, v: { faults: string[]; reps: number | null; note: string }): PilotRecord {
  if (r.observer) return r;
  const valid = new Set(faultsFor(r.kind));
  const seen = [...new Set(v.faults.filter((id) => valid.has(id)))];
  const flagged = new Set(r.flagged.map((f) => f.id));
  const marks: Record<string, 'real' | 'false'> = {};
  for (const id of flagged) marks[id] = seen.includes(id) ? 'real' : 'false';
  const reps = v.reps === null || !Number.isFinite(v.reps) ? null : Math.max(0, Math.round(v.reps));
  return { ...r, observer: { faults: seen, reps, note: v.note.slice(0, 300) }, rated: true, marks, missed: seen.filter((id) => !flagged.has(id)) };
}

export function upsert(s: PilotStore, r: PilotRecord): PilotStore {
  const i = s.records.findIndex((x) => x.id === r.id);
  const records = i >= 0 ? s.records.map((x, k) => (k === i ? r : x)) : [...s.records, r];
  return { ...s, records: records.slice(-PILOT_MAX_RECORDS) };
}

// ---------- what the verdicts say ----------
/** "8 of 10 (80%)": a percentage is never shown without its counts. */
export const countPct = (n: number, d: number): string => (d ? `${n} of ${d} (${Math.round((n / d) * 100)}%)` : `${n} of 0 (no data)`);

export interface Counts { sets: number; tp: number; fp: number; fn: number; tn: number }
/** Counts for one fault over judged, reliable sets of one group. */
export function counts(recs: PilotRecord[], kind: FormKind, id: string, group: PilotGroup): Counts {
  const c: Counts = { sets: 0, tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const r of recs) {
    if (r.kind !== kind || r.group !== group || !r.rated || !r.reliable || !r.observer) continue;
    c.sets++;
    const flagged = r.flagged.some((f) => f.id === id), real = r.observer.faults.includes(id);
    if (flagged && real) c.tp++; else if (flagged) c.fp++; else if (real) c.fn++; else c.tn++;
  }
  return c;
}
/** Reps: how often the phone's count matched the observer's exactly, over judged sets of one group. */
export function repAgreement(recs: PilotRecord[], group: PilotGroup): { sets: number; exact: number; within1: number } {
  const rows = recs.filter((r) => r.group === group && r.rated && r.reliable && r.observer && r.observer.reps !== null);
  return { sets: rows.length, exact: rows.filter((r) => r.reps === r.observer!.reps).length, within1: rows.filter((r) => Math.abs(r.reps - r.observer!.reps!) <= 1).length };
}

export interface Suggestion { enough: boolean; positives: number; negatives: number; limit?: number; precision?: number; recall?: number; currentPrecision?: number; currentRecall?: number }

/** For one per-frame fault: the verdict on every judged, reliable set of the tuning group. True: the fault really happened. */
function labelled(recs: PilotRecord[], kind: FormKind, id: string): { level: number; real: boolean }[] {
  const out: { level: number; real: boolean }[] = [];
  for (const r of recs) {
    if (r.kind !== kind || r.group !== 'tune' || !r.rated || !r.reliable || !r.observer || !(id in r.limits)) continue;
    out.push({ level: r.held[id] ?? 0, real: r.observer.faults.includes(id) });
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

/**
 * The limit that best separates real faults from the rest in the TUNING group (best F1; the higher limit on a tie, so fewer false
 * alarms). Its precision and recall are on the same data it was chosen from, so they look better than real use: say so wherever shown.
 */
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

export interface FaultStats {
  kind: FormKind; id: string;
  /** Accuracy on the test group (the only honest figure), and the same counts on the tuning group (same-data). */
  test: Counts; tune: Counts;
  limit: number | null; unit: string | null;
  /** From the tuning group only. Null for faults judged per rep, hold, step or pump (no frame limit to tune). */
  suggestion: Suggestion | null;
}
export function summarise(recs: PilotRecord[]): FaultStats[] {
  const out: FaultStats[] = [];
  for (const kind of [...new Set(recs.map((r) => r.kind))]) {
    if (!recs.some((r) => r.kind === kind && r.rated)) continue;
    for (const id of faultsFor(kind)) {
      const f = KINDS[kind].faults.find((x) => x.id === id);
      out.push({ kind, id, test: counts(recs, kind, id, 'test'), tune: counts(recs, kind, id, 'tune'), limit: f?.limit ?? null, unit: f?.unit ?? null, suggestion: f ? suggest(recs, kind, id) : null });
    }
  }
  return out;
}

// ---------- export ----------
const q = (v: string | number | boolean | null | undefined) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** One row per set per fault the exercise can flag: easy to open in a spreadsheet and sort. */
export function toCsv(recs: PilotRecord[]): string {
  const head = ['participant', 'participant_type', 'group', 'when', 'exercise', 'kind', 'fault', 'level_held', 'limit_in_force', 'phone_flagged', 'observer_saw_it', 'verdict', 'judged', 'camera_reliable', 'share_frames_seen', 'reps_phone', 'reps_observer', 'seconds', 'note'];
  const rows = [head.join(',')];
  for (const r of recs) {
    for (const id of faultsFor(r.kind)) {
      const flagged = r.flagged.some((x) => x.id === id), saw = !!r.observer?.faults.includes(id);
      const verdict = !r.observer ? '' : flagged && saw ? 'true_positive' : flagged ? 'false_alarm' : saw ? 'missed' : 'true_negative';
      rows.push([r.participant, r.participantType, r.group, r.at, r.exerciseId, r.kind, id, r.held[id] ?? '', r.limits[id] ?? '', flagged, r.observer ? saw : '', verdict, r.rated, r.reliable, r.usable, r.reps, r.observer?.reps ?? '', r.seconds, r.observer?.note ?? ''].map(q).join(','));
    }
  }
  return rows.join('\n');
}
export const toJson = (recs: PilotRecord[]): string => JSON.stringify({ app: 'rehabpath-form-check-pilot', exportedAt: new Date().toISOString(), note: 'Limits are suggested from the tuning group only; accuracy is reported on the test group only.', records: recs }, null, 2);
