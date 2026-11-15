import type { Patient, PeriodicEntry, ProtocolPack, Value } from './types';
import { addDays } from './engine/dates';
import { normalizePatient, planDefaults } from './engine/plan';
import { getPack, registerPack } from './engine/packs';
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
    id: old.id, name: old.name, age: old.age, packId: pack.id, language: old.language === 'hi' ? 'hi' : 'en',
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
        for (const cp of s.customPacks ?? []) { try { registerPack(cp); } catch { /* an invalid saved pack is ignored, never used */ } }
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
export const getState = (): AppState => (state ??= loadState());
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setState(next: AppState): void {
  state = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* offline demo still works in memory */ }
  subs.forEach((f) => f());
}
export const resetState = () => setState(seedState());
export const updatePatient = (id: string, f: (p: Patient) => Patient) => {
  const s = getState();
  setState({ ...s, patients: s.patients.map((p) => (p.id === id ? f(p) : p)) });
};
/** Demo clock: 09:00 on the demo date. */
export const clockMs = (s: AppState): number => Date.parse(s.today + 'T09:00:00Z');
