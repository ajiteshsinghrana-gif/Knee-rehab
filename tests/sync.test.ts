import { describe, it, expect } from 'vitest';
// @ts-ignore plain JS helper
import { startFake } from '../scripts/fake-supabase.mjs';
import { applyDown, applyUp, downSlice, upSlice } from '../src/sync/slices';
import { newSyncKey, pullSlice, pushSlice, validSyncKey } from '../src/sync/client';
import { syncOnce } from '../src/sync/engine';
import { applyManual } from '../src/engine/plan';
import { decodeInvite, encodeInvite } from '../src/onboarding';
import { buildPatient } from '../src/onboarding';
import { getPack } from '../src/engine/packs';
import { makeAllPatients } from '../src/demo/seed';
import { dailyEntry } from '../src/demo/seed';
import { saveCheckIn } from '../src/checkin';
import type { Patient } from '../src/types';
import type { AppState } from '../src/store';

const NOW = Date.parse('2026-11-15T09:00:00Z');
const pack = getPack('total-knee-replacement');
const mk = (): Patient => buildPatient({ name: 'Asha', age: 60, language: 'hi', packId: pack.id, anchorDate: '2026-11-01', phaseId: 'p1', exercises: pack.phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: NOW, today: '2026-11-15', id: 'asha' });
const device = (p: Patient, role: 'physio' | 'patient', key: string) => {
  let st = { version: 1, patients: [{ ...p, syncKey: key, syncRole: role }], activeId: p.id, today: '2026-11-15', demoStep: 0 } as AppState;
  return { get: () => st, set: (s: AppState) => { st = s; }, p: () => st.patients[0] };
};
const memo = () => ({ pushed: new Map<string, string>(), pulled: new Map<string, string>() });

describe('live sync (Phase 6.1)', () => {
  it('a patient check-in reaches the physio, and a physio plan change reaches the patient', async () => {
    const fake = await startFake();
    const cfg = { url: `http://127.0.0.1:${fake.port}`, anonKey: 'anon' };
    const key = newSyncKey();
    const base = mk();
    const physio = device(base, 'physio', key);
    const phone = device(decodeInvite(encodeInvite({ ...base, syncKey: key, syncRole: 'physio' }))!.patient, 'patient', key);
    expect(phone.p().syncRole).toBe('patient');
    const mP = memo(), mH = memo();
    const penv = { getState: physio.get, setState: physio.set, config: cfg };
    const henv = { getState: phone.get, setState: phone.set, config: cfg };

    // patient answers on their phone
    const entry = dailyEntry(pack, { date: '2026-11-15', pain: 6, swelling: 'more', ex: 'some', per: 2, hard: 'stairs' });
    phone.set({ ...phone.get(), patients: [saveCheckIn(phone.p(), { ...entry, answeredBy: 'caregiver' })] });
    await syncOnce(henv, mH);
    await syncOnce(penv, mP);
    expect(physio.p().daily).toHaveLength(1);
    expect(physio.p().daily[0].values.pain).toBe(6);
    expect(physio.p().daily[0].answeredBy).toBe('caregiver');

    // physio changes the plan, with a private reason
    physio.set({ ...physio.get(), patients: [applyManual(physio.p(), pack, { type: 'set-exercises', add: ['swimming'] }, 'PRIVATE reason: wound healed', { nowMs: NOW, today: '2026-11-15' })] });
    await syncOnce(penv, mP);
    await syncOnce(henv, mH);
    expect(phone.p().plan.added).toContain('swimming');
    expect(phone.p().notices).toHaveLength(1);
    // the reason stays on the physio's computer
    expect(JSON.stringify([...fake.rows.values()])).not.toContain('PRIVATE reason');
    expect(JSON.stringify(phone.p())).not.toContain('PRIVATE reason');
    expect(physio.p().audit.map((a) => a.action)).toEqual(['onboard', 'set-exercises']);
    expect(phone.p().audit.length).toBe(0);

    // patient sees the notice; the physio's copy learns it was seen
    phone.set({ ...phone.get(), patients: [{ ...phone.p(), notices: phone.p().notices.map((n) => ({ ...n, seen: true })) }] });
    await syncOnce(henv, mH);
    await syncOnce(penv, mP);
    expect(physio.p().notices[0].seen).toBe(true);
    await syncOnce(penv, mP); await syncOnce(henv, mH);
    expect(phone.p().notices[0].seen).toBe(true); // settles, no flip-flop
    await fake.close();
  });

  it('unchanged data is not sent again', async () => {
    const fake = await startFake();
    const cfg = { url: `http://127.0.0.1:${fake.port}`, anonKey: 'a' };
    const d = device(mk(), 'physio', newSyncKey()); const m = memo();
    await syncOnce({ getState: d.get, setState: d.set, config: cfg }, m);
    const posts = () => fake.log.filter((x: string) => x.startsWith('POST')).length;
    const first = posts();
    await syncOnce({ getState: d.get, setState: d.set, config: cfg }, m);
    expect(posts()).toBe(first);
    await fake.close();
  });

  it("the wrong key sees nothing and cannot write another patient's rows", async () => {
    const fake = await startFake();
    const cfg = { url: `http://127.0.0.1:${fake.port}`, anonKey: 'a' };
    const k1 = newSyncKey(), k2 = newSyncKey();
    await pushSlice(cfg, k1, 'up', { v: 1, secret: true });
    expect(await pullSlice(cfg, k1, 'up')).not.toBeNull();
    // someone holding k2 asks for k1's row
    const f = (u: any, i: any) => fetch(u, { ...i, headers: { ...(i?.headers ?? {}), 'x-sync-key': k2 } });
    expect(await pullSlice(cfg, k1, 'up', f as typeof fetch)).toBeNull();
    let msg = '';
    try { await pushSlice(cfg, k1, 'down', { v: 1 }, f as typeof fetch); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/403/);
    await fake.close();
  });

  it('an unreachable server leaves the app working and reports the problem', async () => {
    const d = device(mk(), 'patient', newSyncKey());
    const before = d.p();
    await syncOnce({ getState: d.get, setState: d.set, config: { url: 'http://127.0.0.1:1', anonKey: 'a' } }, memo());
    expect(d.p()).toBe(before);
    const { getSyncStatus } = await import('../src/sync/engine');
    expect(getSyncStatus().state).toBe('error');
  });

  it('the patient side can never change the plan, whatever it sends', () => {
    const physio = mk();
    const evil = { ...upSlice(physio), plan: { swaps: { a: 'b' }, added: ['swimming'], removed: [], hold: null, followUp: null, overrides: [] }, currentPhase: 'p3', name: 'Hacked', audit: [1], syncKey: 'x' } as unknown;
    const after = applyUp(physio, evil);
    expect(after.plan).toEqual(physio.plan);
    expect(after.currentPhase).toBe(physio.currentPhase);
    expect(after.name).toBe('Asha');
    expect(after.audit).toEqual(physio.audit);
  });

  it('damaged check-ins are dropped, not used', () => {
    const p = mk();
    const good = dailyEntry(pack, { date: '2026-11-15', pain: 3, swelling: 'same', ex: 'all', per: 2, hard: 'none' });
    const up = { ...upSlice(p), daily: [good, { date: 'yesterday' }, { ...good, date: '2026-11-14', values: { pain: { x: 1 } } }, null, 5, { ...good, date: '2026-11-13', exercises: 'maybe' }] };
    expect(applyUp(p, up).daily).toHaveLength(1);
    expect(applyUp(p, { v: 2 })).toBe(p);
    expect(applyUp(p, 'garbage')).toBe(p);
  });

  it('the phone refuses a damaged plan from the server and keeps what it had', () => {
    const p = mk();
    expect(applyDown(p, { v: 1, plan: 'nope' })).toBe(p);
    const d = downSlice(p);
    expect(applyDown(p, { ...d, currentPhase: 'p99' })).toBe(p);
    expect(applyDown(p, { ...d, phaseStartDate: 'soon' })).toBe(p);
    expect(applyDown(p, { ...d, currentPhase: 'p2' }).currentPhase).toBe('p2');
  });

  it('sync keys are random, valid, and travel in the invite only for synced patients', () => {
    const a = newSyncKey(), b = newSyncKey();
    expect(a).not.toBe(b);
    expect(validSyncKey(a)).toBe(true);
    expect(validSyncKey('short')).toBe(false);
    expect(decodeInvite(encodeInvite(mk()))!.patient.syncKey).toBeUndefined();
    const inv = decodeInvite(encodeInvite({ ...mk(), syncKey: a, syncRole: 'physio' }))!.patient;
    expect(inv.syncKey).toBe(a);
    expect(inv.syncRole).toBe('patient');
  });

  it('the demo patients are not synced, so the demo is unchanged', () => {
    expect(makeAllPatients().some((p) => p.syncKey || p.syncRole)).toBe(false);
  });
});
