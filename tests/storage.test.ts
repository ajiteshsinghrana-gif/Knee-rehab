import { describe, it, expect } from 'vitest';
import { LEGACY_KEY, STORAGE_KEY, loadState, migrateLegacy, seedState } from '../src/store';
import { triage } from '../src/engine/triage';
import { getPack } from '../src/engine/packs';

const legacyDay = (date: string, pain: number, extra: any = {}) => ({
  date, pain, swelling: 'same', exercises: 'all', sessionsPrescribed: 2, sessionsDone: 2, hardMovement: 'none',
  givingWay: false, locking: false, calfPainOrRedness: false, fever: false, woundDischarge: false, spreadingRedness: false, numbness: false, ...extra,
});
const legacy = {
  patient: {
    id: 'ravi', name: 'Ravi', age: 24, procedureType: 'reconstruction', graft: 'hamstring', surgeryDate: '2026-10-10', currentPhase: 2, phaseStartDate: '2026-11-07',
    sessionsPrescribedPerDay: 2, language: 'hi',
    daily: [8, 9, 10, 11, 12, 13].map((d) => legacyDay('2026-11-' + String(d).padStart(2, '0'), 2)).concat([legacyDay('2026-11-14', 3, { numbness: true })]),
    weekly: [{ date: '2026-11-14', extensionDeficitCm: 0, flexionDeg: 130, kneeCircumferenceDiffCm: 0.5, slrLag: false, flexionPhotoName: 'bend.jpg', phase2: { bridgeLSI: 90, bridgeReps: 22 }, slSquatRating: 'good' }],
    monthly: [{ date: '2026-11-01', tsk11: 16 }], flags: [],
  },
  others: [], today: '2026-11-15', demoStep: 2,
};
const fake = (init: Record<string, string> = {}) => {
  const m = { ...init };
  return { m, getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => void (m[k] = v) };
};

describe('rename and migration (Phase 1.7)', () => {
  it('uses a new storage key', () => {
    expect(STORAGE_KEY).not.toBe(LEGACY_KEY);
    expect(LEGACY_KEY).toBe('acl-rehab-v1');
  });
  it('migrates acl-rehab-v1 state, keeps the legacy key, and writes the new key', () => {
    const s = fake({ [LEGACY_KEY]: JSON.stringify(legacy) });
    const st = loadState(s as any);
    expect(s.m[LEGACY_KEY]).toBeTruthy();
    expect(s.m[STORAGE_KEY]).toBeTruthy();
    const p = st.patients.find((x) => x.id === 'ravi')!;
    expect(p.packId).toBe('acl-reconstruction');
    expect(p.language).toBe('hi');
    expect(p.currentPhase).toBe('p2');
    expect(p.anchorDate).toBe('2026-10-10');
    expect(p.daily[6].values).toEqual({ pain: 3, swelling: 'same' });
    expect(p.daily[6].warnings.numbness).toBe(true);
    expect(p.daily[6].warnings.chestPainBreathless).toBe(false);
    expect(p.periodic.find((e) => e.values.bridgeLSI === 90)!.values.slSquatRating).toBe('good');
    expect(p.periodic.find((e) => e.values.tsk11 === 16)).toBeTruthy();
    expect(st.demoStep).toBe(2);
    expect(st.today).toBe('2026-11-15');
  });
  it('migrated numbness becomes an amber REVIEW flag, not a red flag', () => {
    const st = migrateLegacy(legacy);
    const p = st.patients.find((x) => x.id === 'ravi')!;
    expect(triage(p, getPack(p.packId)).tier).toBe('REVIEW');
  });
  it('adds the new condition demo patients to migrated state', () => {
    const st = migrateLegacy(legacy);
    expect(st.patients.some((p) => p.packId === 'total-knee-replacement')).toBe(true);
    expect(st.patients.some((p) => p.packId === 'rotator-cuff-repair')).toBe(true);
  });
  it('prefers the new key once it exists, and falls back to seed data on garbage', () => {
    const seed = seedState();
    expect(loadState(fake({ [STORAGE_KEY]: JSON.stringify({ ...seed, demoStep: 1 }) }) as any).demoStep).toBe(1);
    expect(loadState(fake({ [STORAGE_KEY]: '{not json' }) as any).patients.length).toBe(seed.patients.length);
    expect(loadState(null).activeId).toBe('ravi');
  });
});
