/**
 * Per-exercise record for the physio (physio feedback round): each prescribed exercise, each of the last 7 days.
 * It combines the daily check-in answers, the guided sessions ("Start my exercises") and the form-check video requests.
 * Display only: it never feeds a rule or a tier.
 */
import type { Patient } from './types';
import { exerciseFinished } from './session/engine';

export type CellStatus = 'done' | 'partial' | 'skipped' | 'hurt' | 'none';
export interface Cell { status: CellStatus; reason?: string; pain?: number; help: boolean; lines: string[] }

const reasonText: Record<string, string> = { pain: 'it hurt', fear: 'was scared', time: 'no time', access: "couldn't access it", understand: "didn't understand", skipped: 'skipped it' };
const why = (r: string | undefined) => (r ? reasonText[r] ?? r : '');

export function exerciseRecord(p: Patient, exercises: string[], days: string[]): Record<string, Record<string, Cell>> {
  const out: Record<string, Record<string, Cell>> = {};
  for (const id of exercises) {
    out[id] = {};
    for (const d of days) {
      const lines: string[] = [];
      let status: CellStatus = 'none';
      let reason: string | undefined;
      let pain: number | undefined;
      // Guided sessions that day (the last one decides).
      const logs = (p.sessions ?? []).filter((s) => s.date === d).flatMap((s) => s.exercises.filter((l) => l.id === id).map((l) => ({ l, via: s.via })));
      for (const { l, via } of logs) {
        const where = via === 'whatsapp' ? 'WhatsApp session' : 'guided session';
        if (l.stopped === 'pain') { status = 'hurt'; reason = 'pain'; lines.push(`Stopped, it hurt (${where}, ${l.setsDone} of ${l.setsPlanned} sets)`); }
        else if (l.stopped) { status = 'skipped'; reason = l.stopped; lines.push(`${l.stopped === 'skipped' ? 'Skipped' : `Stopped: ${why(l.stopped)}`} (${where}, ${l.setsDone} of ${l.setsPlanned} sets)`); }
        else if (exerciseFinished(l)) { status = 'done'; lines.push(`Done in the ${where}: ${l.setsDone} of ${l.setsPlanned} sets`); }
        else if (l.repsDone > 0) { status = 'partial'; lines.push(`Part done in the ${where}: ${l.setsDone} of ${l.setsPlanned} sets`); }
        if (l.pain !== undefined) { pain = l.pain; lines.push(`Pain right after: ${l.pain}/10`); }
        if (l.struggling) lines.push('Said they were struggling with the form');
      }
      // The daily check-in answer.
      const e = p.daily.find((x) => x.date === d);
      if (e) {
        const r = e.exerciseResults?.find((x) => x.id === id);
        let ck: CellStatus = 'none';
        if (r) ck = r.done ? 'done' : 'skipped';
        else ck = e.exercises === 'all' ? 'done' : e.exercises === 'none' ? 'skipped' : 'partial';
        const rr = r && !r.done ? r.reason : !r && e.exercises === 'none' ? e.skipReason : undefined;
        lines.push(`Check-in: ${ck === 'done' ? 'done' : ck === 'partial' ? 'some exercises done (not per exercise)' : `could not do it${rr ? `, ${why(rr)}` : ''}`}${e.answeredBy === 'caregiver' ? ' (answered by a carer)' : ''}`);
        if (status === 'none') { status = ck; if (ck === 'skipped') reason = rr; }
      }
      const help = (p.formRequests ?? []).some((f) => f.exerciseId === id && f.at.slice(0, 10) === d);
      if (help) lines.push('Asked for help: sent a video to the physio');
      out[id][d] = { status, ...(reason ? { reason } : {}), ...(pain !== undefined ? { pain } : {}), help, lines };
    }
  }
  return out;
}
export const reasonLabel = why;
