import { describe, it, expect } from 'vitest';
import { t } from '../src/i18n';
import { safetyLevel, hasEmergencySign } from '../src/safety';
import { auditCsv } from '../src/audit';
import { applyManual } from '../src/engine/plan';
import { changeText } from '../src/notices';
import { downSlice, applyDown } from '../src/sync/slices';
import { onlyOwnPatients } from '../src/device';
import { buildPatient } from '../src/onboarding';
import { getPack } from '../src/engine/packs';
import { dailyEntry } from '../src/demo/seed';
import type { Patient } from '../src/types';
import type { AppState } from '../src/store';

const NOW = Date.parse('2026-11-15T09:00:00Z');
const pack = getPack('total-knee-replacement');
const mk = (): Patient => buildPatient({ name: 'Asha', age: 60, language: 'en', packId: pack.id, anchorDate: '2026-11-01', phaseId: 'p1', exercises: pack.phases[0].exercises, checkInEveryDays: 1, reviewEveryDays: 7, overrides: [] }, { nowMs: NOW, today: '2026-11-15', id: 'asha' });
const withSigns = (p: Patient, signs: string[]): Patient => {
  const e = dailyEntry(pack, { date: '2026-11-15', pain: 4, swelling: 'same', ex: 'all', per: 2, hard: 'none' });
  const warnings = Object.fromEntries(pack.warningSigns.map((w) => [w.id, signs.includes(w.id)]));
  return { ...p, daily: [{ ...e, warnings }] };
};

describe('two levels of warning advice (Phase 6.3)', () => {
  it('chest pain or breathlessness is an emergency; calf pain, fever and wound signs are same-day', () => {
    expect(safetyLevel(withSigns(mk(), ['chestPainBreathless']))).toBe('emergency');
    for (const id of ['calfPainOrRedness', 'fever', 'woundDischarge', 'spreadingRedness']) {
      if (pack.warningSigns.some((w) => w.id === id)) expect(safetyLevel(withSigns(mk(), [id]))).toBe('sameDay');
    }
  });
  it('an emergency sign wins when both are reported', () => {
    expect(safetyLevel(withSigns(mk(), ['calfPainOrRedness', 'chestPainBreathless']))).toBe('emergency');
  });
  it('when the signs cannot be determined, the stronger message is used, never the weaker', () => {
    expect(safetyLevel(mk())).toBe('emergency');
    expect(hasEmergencySign(undefined)).toBe(false);
  });
  it('both levels exist in every language; emergency says call 112, same-day says contact the clinic and keeps 112 as the fallback', () => {
    for (const l of ['en', 'hi', 'bn'] as const) {
      expect(t(l, 'safetyTitle')).toContain('112');
      expect(t(l, 'safetyTodayTitle')).not.toBe('safetyTodayTitle');
      expect(t(l, 'safetyTodayBody')).toContain('112');
      expect(t(l, 'safetyTodayTitle')).not.toContain('112');
    }
  });
});

describe('physio writes his own instruction (Phase 6.3)', () => {
  const ctx = { nowMs: NOW, today: '2026-11-15' };
  it('needs a reason and text, is audit-logged as physio-initiated, and notifies the patient with the text but not the reason', () => {
    expect(() => applyManual(mk(), pack, { type: 'add-instruction', text: 'Use a brace outdoors' }, '', ctx)).toThrow(/reason/i);
    expect(() => applyManual(mk(), pack, { type: 'add-instruction', text: '   ' }, 'because', ctx)).toThrow(/instruction/i);
    const p = applyManual(mk(), pack, { type: 'add-instruction', text: 'Use a brace outdoors' }, 'Swelling after the walk', ctx);
    expect(p.plan.instructions?.map((x) => x.text)).toEqual(['Use a brace outdoors']);
    const a = p.audit[p.audit.length - 1];
    expect(a.manual).toBe(true); expect(a.note).toBe('Swelling after the walk'); expect(a.summary).toContain('Use a brace outdoors');
    const c = p.notices[p.notices.length - 1].changes[0];
    expect(changeText(c, 'en', pack)).toContain('Use a brace outdoors');
    expect(JSON.stringify(c)).not.toContain('Swelling after the walk');
  });
  it('can be removed, with a reason, and the patient is told', () => {
    const p1 = applyManual(mk(), pack, { type: 'add-instruction', text: 'No stairs today' }, 'sore', ctx);
    const id = p1.plan.instructions![0].id;
    expect(() => applyManual(p1, pack, { type: 'remove-instruction', id: 'nope' }, 'x', ctx)).toThrow(/not found/i);
    const p2 = applyManual(p1, pack, { type: 'remove-instruction', id }, 'healed', ctx);
    expect(p2.plan.instructions).toEqual([]);
    expect(changeText(p2.notices[p2.notices.length - 1].changes[0], 'hi', pack)).toContain('No stairs today');
    expect(p2.audit).toHaveLength(mk().audit.length + 2);
  });
  it('reaches the patient over sync without the reason', () => {
    const p = applyManual(mk(), pack, { type: 'add-instruction', text: 'Ice for 15 minutes' }, 'private reason', ctx);
    const slice = downSlice(p);
    expect(JSON.stringify(slice)).not.toContain('private reason');
    const phone = applyDown(mk(), JSON.parse(JSON.stringify(slice)));
    expect(phone.plan.instructions?.[0].text).toBe('Ice for 15 minutes');
  });
});

describe('audit log CSV (Phase 6.3)', () => {
  it('has a header, one row per change, includes the reason, quotes commas and quotes, and blocks spreadsheet formulas', () => {
    const ctx = { nowMs: NOW, today: '2026-11-15' };
    let p = applyManual(mk(), pack, { type: 'add-instruction', text: 'Say "hi", then walk' }, '=HYPERLINK("x")', ctx);
    p = applyManual(p, pack, { type: 'hold-progression' }, 'slow, careful', ctx);
    const rows = auditCsv(p).trim().split('\r\n');
    const base = mk().audit.length;
    expect(rows).toHaveLength(1 + base + 2);
    expect(rows[0]).toContain('Reason');
    expect(rows[1 + base]).toContain('""hi""');
    expect(rows[1 + base]).toContain(`"'=HYPERLINK`);
    expect(rows[2 + base]).toContain('"slow, careful"');
  });
  it('is just the header for a patient with no changes', () => { expect(auditCsv(mk()).trim().split('\r\n')).toHaveLength(1 + mk().audit.length); });
});

describe('patient device (Phase 6.3)', () => {
  it('drops the demo patients and keeps only people who joined by invite', () => {
    const mine = { ...mk(), syncKey: 'k'.repeat(32), syncRole: 'patient' as const };
    const demo = { ...mk(), id: 'ravi' };
    const s = onlyOwnPatients({ version: 1, patients: [demo, mine], activeId: 'ravi', today: '2026-11-15', demoStep: 0 } as AppState);
    expect(s.patients.map((p) => p.id)).toEqual(['asha']);
    expect(s.activeId).toBe('asha');
    expect(onlyOwnPatients({ version: 1, patients: [demo], activeId: 'ravi', today: 'x', demoStep: 0 } as AppState).patients).toEqual([]);
  });
});
