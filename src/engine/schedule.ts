/**
 * Adaptive check-in frequency (fix phase 3). The app only SUGGESTS; nothing changes until the physio approves,
 * and the approval goes through the normal follow-up change with its reason in the audit log.
 */
import type { Patient, ProtocolPack, TriageResult } from '../types';
import { addDays, diffDays } from './dates';
import { careStart, evaluateTriggers } from './triage';
import { currentFollowUp, pendingProposal } from './plan';

export interface ScheduleSuggestion { kind: 'reduce' | 'daily'; key: string; from: number; to: number; why: string }

export const REDUCE_AFTER_DAYS = 14;
export const REDUCE_MIN_ADHERENCE = 0.8;
export const REDUCED_EVERY_DAYS = 3;

export function scheduleSuggestion(p: Patient, pack: ProtocolPack, r: TriageResult, today: string, nowMs: number): ScheduleSuggestion | null {
  const every = currentFollowUp(p, pack, today).checkInEveryDays;
  if (every > 1 && r.tier !== 'ON_PLAN') {
    // A flag on a reduced schedule: suggest going back to daily, unless the combination proposal already covers it.
    if (pendingProposal(p, pack, r, today, nowMs)) return null;
    const key = `sched-daily@${r.flagKey}`;
    if (p.proposalStatus[key]) return null;
    return { kind: 'daily', key, from: every, to: 1, why: `Flagged ${r.tier.replace('_', ' ')} while checking in every ${every} days` };
  }
  if (every !== 1 || r.tier !== 'ON_PLAN') return null;
  const asOf = r.asOf;
  const from = addDays(asOf, -(REDUCE_AFTER_DAYS - 1));
  if (careStart(p) > from) return null;
  // Every one of the last 14 days on plan (no rule fired on any of them).
  let start = from;
  for (let i = 0; i < 60; i++) {
    const d = addDays(asOf, -i);
    if (d < careStart(p)) break;
    if (evaluateTriggers(p, pack, d).length) { if (d >= from) return null; break; }
    start = d;
  }
  const entries = p.daily.filter((e) => e.date >= from && e.date <= asOf);
  const prescribed = entries.reduce((n, e) => n + e.sessionsPrescribed, 0);
  const done = entries.reduce((n, e) => n + e.sessionsDone, 0);
  if (entries.length < REDUCE_AFTER_DAYS - 4 || !(prescribed > 0)) return null;
  const adh = done / prescribed;
  if (adh < REDUCE_MIN_ADHERENCE) return null;
  const key = `sched-reduce@${start}`;
  if (p.proposalStatus[key]) return null;
  const days = diffDays(asOf, start) + 1;
  return { kind: 'reduce', key, from: 1, to: REDUCED_EVERY_DAYS, why: `On plan for ${days} days with ${Math.round(adh * 100)}% of exercise sessions done` };
}
