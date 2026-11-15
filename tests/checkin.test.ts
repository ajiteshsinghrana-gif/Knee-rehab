import { describe, it, expect } from 'vitest';
import { applyVoice, draftFromEntry, isComplete, newDraft, saveCheckIn, saveWeekly, toDaily, unansweredSigns, weeklyMeasures, withDerived, saveQuestionnaire, dueState } from '../src/checkin';
import { parseVoice } from '../src/voice/parser';
import { getPack } from '../src/engine/packs';
import { makeAllPatients } from '../src/demo/seed';
import { diffDays } from '../src/engine/dates';
import { triage } from '../src/engine/triage';
import { DICT, t } from '../src/i18n';

const patients = makeAllPatients();
const get = (id: string) => patients.find((p) => p.id === id)!;
const ravi = get('ravi');
const pack = getPack('acl-reconstruction');

function fill(d: ReturnType<typeof newDraft>, tapAllSigns = true) {
  d.values.pain = 3; d.values.swelling = 'same'; d.exercises = 'all'; d.hardMovement = 'none';
  if (tapAllSigns) for (const k of Object.keys(d.warnings)) d.warnings[k] = false;
  return d;
}

describe('mandatory warning-sign step after voice (Phase 0.2)', () => {
  it('voice pre-fills measures but never answers a warning sign', () => {
    const v = parseVoice('pain 4, swelling same, did all my exercises, squat was hard, no fever', pack);
    const d = applyVoice(newDraft(pack, ravi), v, pack, 'x');
    expect(d.values.pain).toBe(4);
    expect(d.suggested.fever).toBe(false);
    expect(d.warnings.fever).toBe(null);
    expect(unansweredSigns(d)).toHaveLength(pack.warningSigns.length);
  });
  it('save stays disabled until every sign has been answered by a tap', () => {
    const v = parseVoice('pain 4, swelling same, did all my exercises, squat was hard, no fever', pack);
    const d = applyVoice(newDraft(pack, ravi), v, pack, 'x');
    expect(isComplete(d)).toBe(false);
    const ids = Object.keys(d.warnings);
    ids.slice(0, -1).forEach((k) => (d.warnings[k] = false));
    expect(isComplete(d)).toBe(false);
    expect(() => toDaily(d, ravi, '2026-11-15')).toThrow('incomplete');
    d.warnings[ids[ids.length - 1]] = false;
    expect(isComplete(d)).toBe(true);
  });
  it('a second voice pass clears earlier taps so signs are re-confirmed', () => {
    const d = fill(newDraft(pack, ravi));
    const d2 = applyVoice(d, parseVoice('fever', pack), pack, 'fever');
    expect(unansweredSigns(d2)).toHaveLength(pack.warningSigns.length);
    expect(d2.suggested.fever).toBe(true);
  });
  it('a voice-suggested YES that the patient taps is saved and triggers SAFETY', () => {
    const d = applyVoice(newDraft(pack, ravi), parseVoice('pain 3 swelling same all exercises no hard fever yes', pack), pack, 'x');
    fill(d, true);
    d.warnings.chestPainBreathless = true;
    const entry = toDaily(d, ravi, '2026-11-15');
    expect(entry.warnings.chestPainBreathless).toBe(true);
    const r = triage(saveCheckIn(ravi, entry), pack);
    expect(r.tier).toBe('SAFETY');
  });
  it('skipping exercises requires a reason', () => {
    const d = fill(newDraft(pack, ravi));
    d.exercises = 'none';
    expect(isComplete(d)).toBe(false);
    d.skipReason = 'time';
    expect(isComplete(d)).toBe(true);
  });
});

describe('check-in is generated from the patient pack (Phase 1.4)', () => {
  it('a shoulder patient never sees knee movements', () => {
    const imran = get('imran');
    const rc = getPack(imran.packId);
    const labels = JSON.stringify(rc.checkIn.hardMovements) + JSON.stringify(rc.measures) + JSON.stringify(rc.checkIn.voiceExample) + JSON.stringify(rc.phases);
    expect(/stairs|squat|\bknee\b|घुटने/i.test(labels)).toBe(false);
    expect(rc.checkIn.dailyMeasures).toEqual(['pain']);
    const d = newDraft(rc, imran);
    expect(Object.keys(d.precautionBreaches)).toEqual(['sling-off']);
  });
  it('precaution questions only appear in restricted phases', () => {
    const imran = { ...get('imran'), currentPhase: 'p2' };
    expect(Object.keys(newDraft(getPack('rotator-cuff-repair'), imran).precautionBreaches)).toEqual([]);
  });
  it('knee replacement shows its own movements and questions', () => {
    const tk = getPack('total-knee-replacement');
    expect(tk.checkIn.hardMovements.map((h) => h.id)).toContain('sit-to-stand');
    expect(tk.checkIn.hardMovements.map((h) => h.id)).not.toContain('squat');
  });
  it('an edit round-trips through a draft', () => {
    const e = ravi.daily[ravi.daily.length - 1];
    const d = draftFromEntry(pack, ravi, e);
    expect(isComplete(d)).toBe(true);
    expect(toDaily(d, ravi, e.date).values.pain).toBe(e.values.pain);
  });
});

describe('weekly self-test and questionnaire from the pack', () => {
  it('phase-2 tests are asked only in phase 2; other-leg values pair up', () => {
    const p1 = { ...ravi, currentPhase: 'p1' };
    expect(weeklyMeasures(pack, p1).map((m) => m.id)).toEqual(['extensionDeficitCm', 'flexionDeg', 'kneeCircumferenceDiffCm', 'slrLag']);
    expect(weeklyMeasures(pack, ravi).map((m) => m.id)).toContain('bridgeReps');
    expect(weeklyMeasures(pack, ravi).map((m) => m.id)).not.toContain('bridgeRepsOther');
  });
  it('limb symmetry is derived, not asked', () => {
    expect(withDerived(pack, { bridgeReps: 18, bridgeRepsOther: 20 }).bridgeLSI).toBe(90);
  });
  it('saveWeekly refuses an incomplete test and saves a complete one', () => {
    const p1 = { ...ravi, currentPhase: 'p1' };
    expect(() => saveWeekly(pack, p1, '2026-11-15', { extensionDeficitCm: 0 })).toThrow('incomplete');
    const out = saveWeekly(pack, p1, '2026-11-15', { extensionDeficitCm: 0, flexionDeg: 120, kneeCircumferenceDiffCm: 1, slrLag: false });
    expect(out.periodic[out.periodic.length - 1].values.flexionDeg).toBe(120);
  });
  it('questionnaire sums to the measure and needs every answer', () => {
    expect(() => saveQuestionnaire(pack, ravi, 'tsk11', '2026-11-15', [1, 2, null as any, 1, 1, 1, 1, 1, 1, 1, 1])).toThrow('incomplete');
    const out = saveQuestionnaire(pack, ravi, 'tsk11', '2026-11-15', Array(11).fill(2));
    expect(out.periodic[out.periodic.length - 1].values.tsk11).toBe(22);
  });
  it('packs without a questionnaire have none due', () => {
    const k = get('kamla');
    expect(dueState(getPack(k.packId), k, '2026-11-15', diffDays).questionnaireDue).toBe(false);
  });
});

describe('every patient-facing string exists in English and Hindi (rule 4)', () => {
  it('dictionaries have identical keys and no empty values', () => {
    const en = Object.keys(DICT.en).sort();
    const hi = Object.keys(DICT.hi).sort();
    expect(hi).toEqual(en);
    for (const k of en) { expect(DICT.en[k].length).toBeGreaterThan(0); expect(DICT.hi[k].length).toBeGreaterThan(0); }
  });
  it('the app is condition-neutral', () => {
    expect(t('en', 'appName')).toBe('RehabPath');
    expect(DICT.en.appName.toLowerCase()).not.toContain('knee');
  });
  it('the SAFETY banner mentions 112 in both languages', () => {
    expect(t('en', 'safetyTitle')).toContain('112');
    expect(t('hi', 'safetyTitle')).toContain('112');
  });
});
