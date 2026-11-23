/** The dose a patient sees for one exercise: the physio's own dose for them when set, otherwise the library text. */
import type { ExerciseDose, Lang, Patient } from '../types';
import { L, t } from '../i18n';
import { ss } from '../session/strings';
import { getExercise } from './library';

export const personalDose = (p: Pick<Patient, 'plan'>, id: string): ExerciseDose | undefined => p.plan.doses?.[id];

/** e.g. "3 sets of 10, twice... " in the patient's language. */
export function doseLine(p: Pick<Patient, 'plan'>, id: string, lang: Lang): string {
  const d = personalDose(p, id);
  if (!d) { const ex = getExercise(id); return ex ? L(ex.dose.text, lang) : ''; }
  const sets = d.sets ?? 1;
  const main = d.reps !== null && d.holdSec ? ss(lang, 'sDoseHold', { sets, reps: d.reps, sec: d.holdSec })
    : d.reps !== null ? ss(lang, 'sDose', { sets, reps: d.reps })
    : d.holdSec ? ss(lang, 'sDoseHoldOnly', { sets, sec: d.holdSec })
    : d.sets !== null ? ss(lang, 'sDoseSetsOnly', { sets }) : '';
  const per = d.perDay ? (d.perDay === 1 ? t(lang, 'oncePerDay') : t(lang, 'timesPerDay', { n: d.perDay })) : '';
  return [main, per].filter(Boolean).join(', ');
}
