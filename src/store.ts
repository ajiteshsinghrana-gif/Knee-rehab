import { isLang } from './types';
import type { CurveEdit } from './types';
import { setClinicCurves, validateCurve } from './engine/curves';
import type { Patient, PeriodicEntry, ProtocolPack, Value } from './types';
import { addDays } from './engine/dates';
import { normalizePatient, PHYSIO, planDefaults, withAuditNote } from './engine/plan';
import { getPack } from './engine/packs';
import { restoreAuthoredPack, type QuestionnaireDraft } from './author/condition';
export interface SavedQuestionnaire { id: string; name: string; q: QuestionnaireDraft }
import { DEMO_TODAY_LAST, makeAllPatients } from './demo/seed';

export const STORAGE_KEY = 'rehabpath-v1';
export const LEGACY_KEY = 'acl-rehab-v1';

export interface AppState {
  version: 1;
  patients: Patient[];
  activeId: string;
  /** Demo calendar: the date the patient is checking in for. */
  today: string;
  demoStep: number;
  /** Packs created by physio import (Phase 3.2). */
  customPacks?: ProtocolPack[];
  /** Questionnaires the physio saved for reuse across conditions (Phase 4.1). */
  questionnaires?: SavedQuestionnaire[];
  /** Expected-recovery curves the physio set for every patient of a condition, by pack id (Phase 7.1). */
  clinicCurves?: Record<string, CurveEdit[]>;
  /** Clinic settings for patient data (Phase 6.4). */
  retentionYears?: number;
  clinicContact?: string;
  /** Erasures done, with no personal data in them: when, why, and whether a patient account existed. */
  erasureLog?: { at: string; reason: string; hadAccount: boolean }[];
  /** Real clinic (not the demo): dates and times come from the device clock. */
  live?: boolean;
}

export function seedState(): AppState {
  return { version: 1, patients: makeAllPatients(), activeId: 'ravi', today: addDays(DEMO_TODAY_LAST, 1), demoStep: 0 };
}

const LEGACY_MOVE: Record<string, string> = { squat: 'squats', stairs: 'step-ups', bending: 'gentle-rom', straightening: 'gentle-rom' };
const LEGACY_SIGNS = ['givingWay', 'locking', 'calfPainOrRedness', 'fever', 'woundDischarge', 'spreadingRedness', 'numbness'];

/** Convert one patient from the acl-rehab-v1 shape. */
export function migrateLegacyPatient(old: any): Patient {
  const pack = getPack('acl-reconstruction');
  const signs = Object.fromEntries(pack.warningSigns.map((s) => [s.id, false]));
  const daily = (old.daily ?? []).map((e: any) => ({
    date: e.date,
    values: { pain: e.pain, swelling: e.swelling },
    exercises: e.exercises,
    sessionsPrescribed: e.sessionsPrescribed,
    sessionsDone: e.sessionsDone,
    ...(e.skipReason ? { skipReason: e.skipReason } : {}),
    hardMovement: LEGACY_MOVE[e.hardMovement] ?? e.hardMovement ?? 'none',
    // chest pain / breathlessness did not exist in v1: it stays false, never guessed.
    warnings: { ...signs, ...Object.fromEntries(LEGACY_SIGNS.map((k) => [k, !!e[k]])) },
    answeredBy: 'patient',
  }));
  const periodic: PeriodicEntry[] = [];
  for (const w of old.weekly ?? []) {
    const { date, phase2, flexionPhotoName, squatVideoName, ...rest } = w;
    const values: Record<string, Value> = { ...rest, ...(phase2 ?? {}) };
    periodic.push({ date, values, ...(flexionPhotoName ? { photos: { flexionDeg: flexionPhotoName } } : {}) });
  }
  for (const m of old.monthly ?? []) periodic.push({ date: m.date, values: { tsk11: m.tsk11 } });
  periodic.sort((a, b) => a.date.localeCompare(b.date));
  return {
    id: old.id, name: old.name, age: old.age, packId: pack.id, language: isLang(old.language) ? old.language : 'en',
    anchorDate: old.surgeryDate, currentPhase: `p${old.currentPhase}`, phaseStartDate: old.phaseStartDate,
    sessionsPrescribedPerDay: old.sessionsPrescribedPerDay ?? 2, daily, periodic, reviewed: {}, decisions: [], ...planDefaults(),
  };
}

/** acl-rehab-v1 -> rehabpath-v1. The legacy key is left in place (never deleted). */
export function migrateLegacy(old: any): AppState {
  const mine = old.patient ? [migrateLegacyPatient(old.patient)] : [];
  const others = (old.others ?? []).map(migrateLegacyPatient);
  const seeded = seedState();
  const have = new Set([...mine, ...others].map((p) => p.id));
  const extra = seeded.patients.filter((p) => !have.has(p.id) && p.packId !== 'acl-reconstruction');
  return {
    version: 1,
    patients: [...mine, ...others, ...extra],
    activeId: old.patient?.id ?? 'ravi',
    today: old.today ?? seeded.today,
    demoStep: old.demoStep ?? 0,
  };
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export function loadState(storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): AppState {
  try {
    const cur = storage?.getItem(STORAGE_KEY);
    if (cur) {
      const s = JSON.parse(cur) as AppState;
      if (s?.version === 1 && Array.isArray(s.patients)) {
        for (const cp of s.customPacks ?? []) { try { restoreAuthoredPack(cp); } catch { /* an invalid saved pack is ignored, never used */ } }
        const known = (id: string) => { try { getPack(id); return true; } catch { return false; } };
        const patients = s.patients.filter((x) => known(x.packId)).map(normalizePatient);
        if (patients.length) return { ...s, patients, activeId: patients.some((x) => x.id === s.activeId) ? s.activeId : patients[0].id };
      }
    }
    const legacy = storage?.getItem(LEGACY_KEY);
    if (legacy) {
      const m = migrateLegacy(JSON.parse(legacy));
      storage?.setItem(STORAGE_KEY, JSON.stringify(m));
      return m;
    }
  } catch { /* fall through to seed */ }
  return seedState();
}

// ---------------- tiny external store ----------------
let state: AppState | null = null;
const subs = new Set<() => void>();
export const getState = (): AppState => {
  if (!state) { state = loadState(); setClinicCurves(state.clinicCurves); }
  return state;
};
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setState(next: AppState): void {
  state = next;
  setClinicCurves(next.clinicCurves);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* offline demo still works in memory */ }
  subs.forEach((f) => f());
}
export const resetState = () => setState(seedState());
export const updatePatient = (id: string, f: (p: Patient) => Patient) => {
  const s = getState();
  setState({ ...s, patients: s.patients.map((p) => (p.id === id ? f(p) : p)) });
};
/** Demo clock: 09:00 on the demo date. */
export const clockMs = (s: AppState): number => (s.live ? Date.now() : Date.parse(s.today + 'T09:00:00Z'));
/** Today's date on this device (local calendar day), as YYYY-MM-DD. */
export const realToday = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** In live mode, keep state.today on the real date. Called at start-up, on focus and every minute. */
export function refreshToday(): void {
  const s = getState();
  if (s.live && s.today !== realToday()) setState({ ...s, today: realToday() });
}

/**
 * Set the expected-recovery curve for EVERY patient of a condition (Phase 7.1). A reason is required; each of those
 * patients gets a line in their audit log. A patient's own curve still wins over this default.
 */
export function setClinicCurve(packId: string, measure: string, points: [number, number][], tolerance: number, reason: string): void {
  const why = (reason ?? '').trim();
  if (!why) throw new Error('A reason is required to change an expected-recovery curve');
  const base = getPack(packId).expectedCurves.find((x) => x.measure === measure);
  if (!base) throw new Error('This condition has no expected curve for that measure');
  const bad = validateCurve(points, tolerance);
  if (bad) throw new Error(bad);
  const st = getState();
  const nowMs = clockMs(st);
  const prev = (st.clinicCurves?.[packId] ?? []).find((x) => x.measure === measure);
  const edit: CurveEdit = { id: `${nowMs}-c`, measure, points: points.map(([w, v]) => [w, v] as [number, number]), tolerance, reason: why, by: PHYSIO, at: new Date(nowMs).toISOString() };
  const mine = [...(st.clinicCurves?.[packId] ?? []).filter((x) => x.measure !== measure), edit];
  setState({
    ...st,
    clinicCurves: { ...(st.clinicCurves ?? {}), [packId]: mine },
    patients: st.patients.map((p) => (p.packId !== packId ? p : withAuditNote(p, 'set-clinic-curve', `Clinic default expected curve for ${measure} changed (applies to every ${getPack(packId).condition.en} patient)`, prev ? { points: prev.points, tolerance: prev.tolerance } : { points: base.points, tolerance: base.tolerance }, { points: edit.points, tolerance }, why, { nowMs, today: st.today }))),
  });
}

/** Go back to the protocol's own curve for every patient of a condition. */
export function removeClinicCurve(packId: string, measure: string, reason: string): void {
  const why = (reason ?? '').trim();
  if (!why) throw new Error('A reason is required to change an expected-recovery curve');
  const st = getState();
  const prev = (st.clinicCurves?.[packId] ?? []).find((x) => x.measure === measure);
  if (!prev) throw new Error('There is no clinic default for that measure');
  const nowMs = clockMs(st);
  const left = (st.clinicCurves?.[packId] ?? []).filter((x) => x.measure !== measure);
  setState({
    ...st,
    clinicCurves: { ...(st.clinicCurves ?? {}), [packId]: left },
    patients: st.patients.map((p) => (p.packId !== packId ? p : withAuditNote(p, 'remove-clinic-curve', `Clinic default expected curve for ${measure} removed (back to the protocol curve)`, { points: prev.points, tolerance: prev.tolerance }, null, why, { nowMs, today: st.today }))),
  });
}
