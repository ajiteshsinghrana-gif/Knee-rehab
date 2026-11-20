import { describe, it, expect } from 'vitest';
import { LIVE_KEY, PATIENT_KEY, STORAGE_KEY, loadState, seedState } from '../src/store';
import { modeFromHash } from '../src/mode';
import { buildPatient } from '../src/onboarding';
import { getPack } from '../src/engine/packs';
import type { Patient } from '../src/types';

const pack = getPack('total-knee-replacement');
const mk = (id: string, role?: 'physio' | 'patient'): Patient => ({ ...buildPatient({ name: id, age: 50, language: 'en', packId: pack.id, anchorDate: '2026-11-01', phaseId: 'p1', exercises: pack.phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: 1, today: '2026-11-15', id }), ...(role ? { syncKey: 'a'.repeat(32), syncRole: role } : {}) });
const fake = (init: Record<string, string> = {}) => { const m: Record<string, string> = { ...init }; return { m, getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; } } as any; };
const demoWith = (extra: Patient[]) => JSON.stringify({ ...seedState(), patients: [...seedState().patients, ...extra] });

describe('demo and live clinic are separate (Phase 6.5)', () => {
  it('demo mode is exactly as before: the six demo patients, not live', () => {
    const s = loadState(fake(), 'demo', false);
    expect(s.patients).toHaveLength(6); expect(s.live).toBeUndefined();
  });
  it('a first visit to the live clinic is empty: no demo patients', () => {
    const s = loadState(fake({ [STORAGE_KEY]: JSON.stringify(seedState()) }), 'live', false);
    expect(s.patients).toEqual([]); expect(s.live).toBe(true); expect(s.activeId).toBe('');
  });
  it('the first live visit brings over only real (synced) patients, never demo ones', () => {
    const s = loadState(fake({ [STORAGE_KEY]: demoWith([mk('real1', 'physio')]) }), 'live', false);
    expect(s.patients.map((p) => p.id)).toEqual(['real1']);
  });
  it('a patient added in the demo syncs but is never carried into the live clinic (Phase 6.9)', () => {
    const d = { ...mk('demo-added', 'physio'), demoPatient: true };
    expect(loadState(fake({ [STORAGE_KEY]: demoWith([d, mk('real1', 'physio')]) }), 'live', false).patients.map((p) => p.id)).toEqual(['real1']);
    expect(loadState(fake({ [STORAGE_KEY]: demoWith([d]) }), 'demo', false).patients.map((p) => p.id)).toContain('demo-added'); // still in the demo
  });
  it('once the live clinic has its own data, the demo storage is ignored', () => {
    const storage = fake({ [STORAGE_KEY]: demoWith([mk('real1', 'physio')]), [LIVE_KEY]: JSON.stringify({ ...seedState(), patients: [mk('live2', 'physio')], activeId: 'live2', live: true }) });
    expect(loadState(storage, 'live', false).patients.map((p) => p.id)).toEqual(['live2']);
    expect(loadState(storage, 'demo', false).patients).toHaveLength(7); // the demo store was not touched
  });
  it('a patient phone has its own store and never sees physio patients or demo patients', () => {
    const storage = fake({ [STORAGE_KEY]: demoWith([mk('mine', 'patient'), mk('docs', 'physio')]) });
    expect(loadState(storage, 'live', true).patients.map((p) => p.id)).toEqual(['mine']);
    const own = fake({ [PATIENT_KEY]: JSON.stringify({ ...seedState(), patients: [mk('mine2', 'patient')], activeId: 'mine2', live: true }), [LIVE_KEY]: JSON.stringify({ ...seedState(), patients: [mk('docs2', 'physio')], live: true }) });
    expect(loadState(own, 'live', true).patients.map((p) => p.id)).toEqual(['mine2']);
    expect(loadState(own, 'live', false).patients.map((p) => p.id)).toEqual(['docs2']);
  });
  it('the live clinic always uses the real date', () => {
    const s = loadState(fake({ [LIVE_KEY]: JSON.stringify({ ...seedState(), patients: [mk('x', 'physio')], live: true, today: '2020-01-01' }) }), 'live', false);
    expect(s.today).not.toBe('2020-01-01');
  });
  it('#live and #demo switch mode; anything else does not', () => {
    expect(modeFromHash('#live')).toBe('live'); expect(modeFromHash('#demo')).toBe('demo');
    expect(modeFromHash('#clinician')).toBeNull(); expect(modeFromHash('#join=abc')).toBeNull();
  });
});
