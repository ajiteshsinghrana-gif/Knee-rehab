/**
 * Missed check-ins (fix phase 5), simulated: after 1 missed check-in a WhatsApp reminder to the patient, after 2 one to the carer,
 * after that rule S1 flags the physio. Nothing is sent; this only says what would be sent and when.
 */
import type { Patient, ProtocolPack } from './types';
import { addDays, diffDays } from './engine/dates';
import { currentFollowUp } from './engine/plan';
import { careStart } from './engine/triage';

export interface ReminderStep { kind: 'patient' | 'carer'; date: string }
export interface MissedState { missed: number; lastDate: string; every: number; steps: ReminderStep[] }

export function missedCheckIns(p: Patient, pack: ProtocolPack, today: string): MissedState {
  const every = currentFollowUp(p, pack, today).checkInEveryDays;
  const lastDate = p.daily.length ? p.daily[p.daily.length - 1].date : addDays(careStart(p), -1);
  // Scheduled check-in days after the last one, up to yesterday (today is not missed yet).
  const missed = Math.max(0, Math.floor((diffDays(today, lastDate) - 1) / every));
  const steps: ReminderStep[] = [];
  if (missed >= 1) steps.push({ kind: 'patient', date: addDays(lastDate, every + 1) });
  if (missed >= 2) steps.push({ kind: 'carer', date: addDays(lastDate, 2 * every + 1) });
  return { missed, lastDate, every, steps };
}
