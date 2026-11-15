import type { Patient, ProtocolPack, Trigger } from '../types';
import { addDays } from './dates';

export type ActionId =
  | 'call-patient'
  | 'hold-progression'
  | 'regress-exercise'
  | 'reassess-bring-visit-forward'
  | 'send-tsk11'
  | 'offer-shorter-plan'
  | 'switch-to-voice-checkins';

export const ACTION_LABELS: Record<string, { en: string; hi: string }> = {
  'call-patient': { en: 'Call the patient', hi: 'मरीज़ को फोन करें' },
  'hold-progression': { en: 'Hold progression', hi: 'अगले चरण में जाना रोकें' },
  'regress-exercise': { en: 'Regress an exercise', hi: 'कसरत आसान करें' },
  'reassess-bring-visit-forward': { en: 'Reassess / bring the visit forward', hi: 'दोबारा जांचें / मुलाकात जल्दी करें' },
  'send-tsk11': { en: 'Send the TSK-11 questionnaire', hi: 'TSK-11 प्रश्नावली भेजें' },
  'offer-shorter-plan': { en: 'Offer a shorter plan', hi: 'छोटी योजना दें' },
  'switch-to-voice-checkins': { en: 'Switch to voice check-ins', hi: 'आवाज़ वाले चेक-इन पर जाएं' },
};

/**
 * Suggested actions for the physio. NEVER auto-applied: the physio approves or modifies each one.
 * Rule -> action map comes from the pack; skip-reason routing is generic.
 */
export function suggestedActions(triggers: Trigger[], pack: ProtocolPack, patient: Patient, asOf: string): string[] {
  const out = new Set<string>();
  for (const t of triggers) pack.suggestedActions[t.ruleId]?.forEach((a) => out.add(a));
  for (let i = 0; i < 3; i++) {
    const e = patient.daily.find((x) => x.date === addDays(asOf, -i));
    if (e && e.exercises === 'none' && e.skipReason) {
      if (e.skipReason === 'fear') { out.add('send-tsk11'); out.add('call-patient'); }
      if (e.skipReason === 'time') out.add('offer-shorter-plan');
      if (e.skipReason === 'access') { out.add('switch-to-voice-checkins'); out.add('call-patient'); }
      break;
    }
  }
  return [...out];
}
