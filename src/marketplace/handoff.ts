/** After a visit, a physio can move the patient into RehabPath follow-up. The physio does it; nothing enrols anyone automatically. */
import type { AppState } from '../store';
import { buildPatient, newPatientId } from '../onboarding';
import { SCREENING_PACK } from './screening';
import type { Booking } from './ledger';

export function enrolInRehabPath(app: AppState, b: Booking, nowMs: number, today: string): { state: AppState; patientId: string } | { error: string } {
  if (b.status !== 'completed') return { error: 'Enrol a patient only after the visit is completed.' };
  if (b.enrolledPatientId) return { error: 'This patient is already in follow-up.' };
  const area = SCREENING_PACK.areas.find((a) => a.id === b.screening.area)?.label.en ?? b.screening.area;
  try {
    const p = buildPatient({
      name: b.patientName, age: 0, language: 'en', packId: 'general', anchorDate: today, phaseId: 'p1', exercises: [], checkInEveryDays: 1, reviewEveryDays: 7, overrides: [],
      details: { phone: b.phone, diagnosis: `${area} pain (from marketplace screening, for the physio to confirm)` },
    }, { nowMs, today, id: newPatientId(nowMs) });
    return { state: { ...app, patients: [...app.patients, p], activeId: app.activeId || p.id }, patientId: p.id };
  } catch (e) { return { error: e instanceof Error ? e.message : 'Could not enrol this patient.' }; }
}
