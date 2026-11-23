/** "My template": a physio saves a patient's plan under a name and starts new patients from it (physio feedback round). */
import type { ExerciseDose, Patient, ProtocolPack } from './types';
import { currentExercises, currentFollowUp } from './engine/plan';

export interface PlanTemplate {
  id: string;
  name: string;
  packId: string;
  phaseId: string;
  exercises: string[];
  doses: Record<string, Omit<ExerciseDose, 'at' | 'by'>>;
  exerciseNotes: Record<string, string>;
  instructions: string[];
  advice: string;
  checkInEveryDays: number;
  reviewEveryDays: number;
  diagnosis?: string;
  createdAt: string;
}

export function templateFromPatient(p: Patient, pack: ProtocolPack, name: string, today: string, nowMs: number): PlanTemplate {
  const exs = currentExercises(p, pack);
  const fu = currentFollowUp(p, pack, today);
  const doses: PlanTemplate['doses'] = {};
  for (const id of exs) { const d = p.plan.doses?.[id]; if (d) doses[id] = { sets: d.sets, reps: d.reps, holdSec: d.holdSec, perDay: d.perDay }; }
  const notes: Record<string, string> = {};
  for (const id of exs) { const n = p.plan.exerciseNotes?.[id]; if (n) notes[id] = n.text; }
  return {
    id: `t${nowMs.toString(36)}`, name: name.trim().slice(0, 80), packId: pack.id, phaseId: p.currentPhase, exercises: exs, doses, exerciseNotes: notes,
    instructions: (p.plan.instructions ?? []).map((x) => x.text), advice: p.plan.advice?.text ?? '', checkInEveryDays: fu.checkInEveryDays,
    reviewEveryDays: fu.reviewEveryDays, ...(p.details?.diagnosis && pack.id === 'general' ? { diagnosis: p.details.diagnosis } : {}), createdAt: new Date(nowMs).toISOString(),
  };
}
