/**
 * The ONLY place a patient's plan changes (safety rule 2). Every function here is called from a
 * physio action in the UI, never from triage. Each change is appended to the audit log.
 */
import type { AuditEntry, FollowUp, NoticeChange, Override, Patient, Plan, ProtocolPack, Trigger } from '../types';
import { getExercise } from '../exercises/library';
import { addDays } from './dates';
import { evaluateGate } from './gates';
import { listOverridable } from './overrides';

export const PHYSIO = 'Demo physio';

export const planDefaults = (): Pick<Patient, 'plan' | 'audit' | 'notices' | 'proposalStatus'> => ({
  plan: { swaps: {}, added: [], removed: [], hold: null, followUp: null, overrides: [] },
  audit: [],
  notices: [],
  proposalStatus: {},
});

/** Fill any plan fields missing from older saved state. */
export const normalizePatient = (p: Patient): Patient => ({ ...planDefaults(), ...p, plan: { ...planDefaults().plan, ...(p.plan ?? {}) }, decisions: p.decisions ?? [], reviewed: p.reviewed ?? {} });

/** Prescribed exercises right now: phase list with the physio's swaps applied. */
export function currentExercises(p: Patient, pack: ProtocolPack): string[] {
  const phase = pack.phases.find((x) => x.id === p.currentPhase);
  const out: string[] = [];
  const base = [...(phase?.exercises ?? []).filter((x) => !(p.plan.removed ?? []).includes(x)), ...(p.plan.added ?? [])];
  for (const id of base) {
    const id2 = p.plan.swaps[id] ?? id;
    if (!out.includes(id2)) out.push(id2);
  }
  return out;
}

export function currentFollowUp(p: Patient, pack: ProtocolPack, today: string) {
  const phase = pack.phases.find((x) => x.id === p.currentPhase);
  const base = { checkInEveryDays: 1, reviewEveryDays: phase?.followUpEveryDays ?? 7, nextReviewDate: null as string | null };
  const f = p.plan.followUp;
  if (!f) return base;
  if (f.until && today > f.until && f.revertTo) return f.revertTo;
  return { checkInEveryDays: f.checkInEveryDays, reviewEveryDays: f.reviewEveryDays, nextReviewDate: f.nextReviewDate };
}

// ---------------- follow-up proposal (Phase 2.5) ----------------
export interface Proposal {
  flagKey: string;
  before: { checkInEveryDays: number; reviewEveryDays: number; nextReviewDate: string | null };
  after: { checkInEveryDays: number; teleReviewBy: string; teleReviewWithinHours: number; forDays: number; until: string };
}
/** Pending only when the flag is URGENT through a combination rule and the physio hasn't decided. */
export function pendingProposal(p: Patient, pack: ProtocolPack, tri: { tier: string; triggers: Trigger[]; flagKey: string | null }, today: string, nowMs: number): Proposal | null {
  if (!tri.flagKey || tri.tier !== 'URGENT' || !tri.triggers.some((t) => t.combinedFrom) || p.proposalStatus[tri.flagKey]) return null;
  const c = pack.followUpProposal;
  return {
    flagKey: tri.flagKey,
    before: currentFollowUp(p, pack, today),
    after: { checkInEveryDays: c.checkInEveryDays, teleReviewWithinHours: c.teleReviewWithinHours, teleReviewBy: new Date(nowMs + c.teleReviewWithinHours * 3_600_000).toISOString().slice(0, 10), forDays: c.forDays, until: addDays(today, c.forDays) },
  };
}

// ---------------- actions ----------------
export type PlanAction =
  | { type: 'regress-exercise'; exerciseId: string; note?: string }
  | { type: 'restore-exercise'; exerciseId: string; note?: string }
  | { type: 'set-exercises'; add?: string[]; remove?: string[]; note?: string; notify?: boolean }
  | { type: 'move-phase'; toPhase: string; note: string }
  | { type: 'hold-progression'; note?: string }
  | { type: 'release-hold'; note?: string }
  | { type: 'change-follow-up'; checkInEveryDays: number; reviewEveryDays?: number; nextReviewDate: string | null; until?: string | null; note?: string; flagKey?: string; proposalStatus?: 'approved' | 'modified' }
  | { type: 'reject-proposal'; flagKey: string; note?: string }
  | { type: 'sign-off-phase'; note?: string }
  | { type: 'set-override'; target: string; value: number; reason: string }
  | { type: 'remove-override'; id: string; reason?: string }
  | { type: 'record'; action: string; status: 'approved' | 'modified'; note?: string };

export interface Ctx { nowMs: number; today: string; who?: string; /** Set by applyManual only. */ manual?: boolean }

const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
const newId = (ms: number) => `${ms}-${++seq}`;

export function applyAction(p: Patient, pack: ProtocolPack, a: PlanAction, ctx: Ctx): Patient {
  const who = ctx.who ?? PHYSIO;
  const at = iso(ctx.nowMs);
  let plan: Plan = { ...p.plan, swaps: { ...p.plan.swaps }, overrides: [...p.plan.overrides] };
  let out: Patient = { ...p };
  const changes: NoticeChange[] = [];
  const entry = (action: string, summary: string, before: unknown, after: unknown, note?: string): AuditEntry => ({ id: newId(ctx.nowMs), at, who, action, summary, before, after, ...(note ? { note } : {}) });
  let audit: AuditEntry;

  switch (a.type) {
    case 'regress-exercise': {
      const cur = currentExercises(p, pack);
      if (!cur.includes(a.exerciseId)) throw new Error('That exercise is not in the current plan');
      const to = getExercise(a.exerciseId)?.regressionId;
      if (!to) throw new Error('No easier version is defined for this exercise yet');
      const original = Object.entries(plan.swaps).find(([, v]) => v === a.exerciseId)?.[0] ?? a.exerciseId;
      plan.swaps[original] = to;
      changes.push({ kind: 'regress', from: a.exerciseId, to });
      audit = entry(a.type, `Regressed ${a.exerciseId} to ${to}`, { exercise: a.exerciseId }, { exercise: to }, a.note);
      break;
    }
    case 'restore-exercise': {
      const key = Object.entries(plan.swaps).find(([k, v]) => k === a.exerciseId || v === a.exerciseId)?.[0];
      if (!key) throw new Error('That exercise was not swapped');
      const was = plan.swaps[key];
      delete plan.swaps[key];
      changes.push({ kind: 'restore', exercise: key });
      audit = entry(a.type, `Restored ${key} (was ${was})`, { exercise: was }, { exercise: key }, a.note);
      break;
    }
    case 'set-exercises': {
      const phase = pack.phases.find((x) => x.id === p.currentPhase);
      const cur = currentExercises(p, pack);
      const added = new Set(plan.added ?? []);
      const removed = new Set(plan.removed ?? []);
      for (const id of a.add ?? []) {
        if (!getExercise(id)) throw new Error(`Unknown exercise ${id}`);
        if (cur.includes(id)) continue;
        removed.delete(id);
        if (!(phase?.exercises ?? []).includes(id)) added.add(id);
      }
      for (const id of a.remove ?? []) {
        added.delete(id);
        if ((phase?.exercises ?? []).includes(id)) removed.add(id);
        delete plan.swaps[id];
      }
      plan.added = [...added];
      plan.removed = [...removed];
      if (a.notify) {
        const after = currentExercises({ ...p, plan }, pack);
        const addedNow = after.filter((x) => !cur.includes(x));
        const removedNow = cur.filter((x) => !after.includes(x));
        if (addedNow.length || removedNow.length) changes.push({ kind: 'exercises', added: addedNow, removed: removedNow });
      }
      audit = entry(a.type, `Exercise list changed: +${(a.add ?? []).join(', ') || 'none'} -${(a.remove ?? []).join(', ') || 'none'}`, { exercises: cur }, { exercises: currentExercises({ ...p, plan }, pack) }, a.note);
      break;
    }
    case 'hold-progression': {
      if (plan.hold) throw new Error('Progression is already on hold');
      plan.hold = { at, by: who, ...(a.note ? { note: a.note } : {}) };
      changes.push({ kind: 'hold' });
      audit = entry(a.type, 'Progression put on hold', { hold: null }, { hold: plan.hold }, a.note);
      break;
    }
    case 'release-hold': {
      if (!plan.hold) throw new Error('Progression is not on hold');
      const was = plan.hold;
      plan.hold = null;
      changes.push({ kind: 'release' });
      audit = entry(a.type, 'Hold on progression removed', { hold: was }, { hold: null }, a.note);
      break;
    }
    case 'change-follow-up': {
      if (!(a.checkInEveryDays >= 1)) throw new Error('Check-in interval must be at least 1 day');
      const before = currentFollowUp(p, pack, ctx.today);
      const next: FollowUp = {
        checkInEveryDays: a.checkInEveryDays, reviewEveryDays: a.reviewEveryDays ?? before.reviewEveryDays, nextReviewDate: a.nextReviewDate,
        until: a.until ?? null, ...(a.until ? { revertTo: before } : {}),
      };
      plan.followUp = next;
      changes.push({ kind: 'followUp', nextReviewDate: a.nextReviewDate, checkInEveryDays: a.checkInEveryDays });
      audit = entry(a.type, `Follow-up changed: check in every ${a.checkInEveryDays} day(s), next review ${a.nextReviewDate ?? 'not set'}${a.until ? `, until ${a.until}` : ''}`, before, next, a.note);
      if (a.flagKey) out.proposalStatus = { ...p.proposalStatus, [a.flagKey]: { status: a.proposalStatus ?? 'approved', at, ...(a.note ? { note: a.note } : {}) } };
      break;
    }
    case 'reject-proposal': {
      out.proposalStatus = { ...p.proposalStatus, [a.flagKey]: { status: 'rejected', at, ...(a.note ? { note: a.note } : {}) } };
      audit = entry(a.type, 'Follow-up proposal rejected (plan unchanged)', null, null, a.note);
      break;
    }
    case 'sign-off-phase': {
      if (plan.hold) throw new Error('Progression is on hold. Remove the hold before signing off the next phase');
      const gate = evaluateGate(p, pack, ctx.today);
      if (!gate) throw new Error('There is no next phase');
      if (!gate.allMet) throw new Error('Gate criteria are not all met');
      out = { ...out, currentPhase: gate.toPhase, phaseStartDate: ctx.today };
      plan = { ...plan, swaps: {}, added: [], removed: [] };
      changes.push({ kind: 'phase', phaseId: gate.toPhase });
      audit = entry(a.type, `Phase signed off: ${gate.fromPhase} to ${gate.toPhase}`, { phase: gate.fromPhase }, { phase: gate.toPhase }, a.note);
      break;
    }
    case 'move-phase': {
      // A manual move: any direction, with or without the gate being met. The reason is mandatory and the audit says whether the protocol was overridden.
      if (!a.note || !a.note.trim()) throw new Error('A reason is required to move a patient to another phase');
      const to = pack.phases.find((x) => x.id === a.toPhase);
      if (!to) throw new Error('Unknown phase');
      if (a.toPhase === p.currentPhase) throw new Error('The patient is already in that phase');
      const order = (id: string) => pack.phases.find((x) => x.id === id)?.order ?? 0;
      const gate = evaluateGate(p, pack, ctx.today);
      const nextOnly = !!gate && gate.toPhase === a.toPhase;
      const unmet = nextOnly ? gate!.criteria.filter((c) => !c.met).map((c) => c.label.en) : [];
      const direction = order(a.toPhase) < order(p.currentPhase) ? 'back' : nextOnly ? 'next' : 'skip';
      const overrode = direction === 'back' || direction === 'skip' || unmet.length > 0 || !!plan.hold;
      out = { ...out, currentPhase: a.toPhase, phaseStartDate: ctx.today };
      plan = { ...plan, swaps: {}, added: [], removed: [] };
      changes.push({ kind: 'phase', phaseId: a.toPhase });
      audit = entry(a.type, `Phase moved by the physio: ${p.currentPhase} to ${a.toPhase} (${direction})${overrode ? ', protocol overridden' : ''}`, { phase: p.currentPhase }, { phase: a.toPhase, direction, overrodeProtocol: overrode, unmetCriteria: unmet, holdWasOn: !!plan.hold }, a.note.trim());
      break;
    }
    case 'set-override': {
      if (!a.reason || !a.reason.trim()) throw new Error('A reason is required for a per-patient override');
      const t = listOverridable(pack, p).find((x) => x.target === a.target);
      if (!t) throw new Error('That value cannot be overridden');
      if (!Number.isFinite(a.value) || a.value < 0) throw new Error('Enter a number of 0 or more');
      const existing = plan.overrides.find((o) => o.target === a.target);
      const original = existing?.original ?? t.base;
      plan.overrides = [...plan.overrides.filter((o) => o.target !== a.target), { id: newId(ctx.nowMs), target: a.target, label: t.label, original, value: a.value, reason: a.reason.trim(), by: who, at }];
      audit = entry(a.type, `Override: ${t.label} ${t.current} to ${a.value}`, { value: t.current }, { value: a.value }, a.reason.trim());
      break;
    }
    case 'remove-override': {
      const o = plan.overrides.find((x) => x.id === a.id);
      if (!o) throw new Error('Override not found');
      plan.overrides = plan.overrides.filter((x) => x.id !== a.id);
      audit = entry(a.type, `Override removed: ${o.label} back to ${o.original}`, { value: o.value }, { value: o.original }, a.reason);
      break;
    }
    case 'record': {
      audit = entry('record', `${a.action} ${a.status} (no plan change)`, null, null, a.note);
      break;
    }
  }
  out = { ...out, plan, audit: [...p.audit, audit!] };
  if (ctx.manual) out.audit = [...p.audit, { ...audit!, manual: true }];
  if (changes.length) out.notices = [...p.notices, { id: newId(ctx.nowMs), at, changes, seen: false }];
  return out;
}

/** Plan changes the physio can make on his own, apart from the suggested actions (Phase 5.4). */
export const MANUAL_TYPES = ['set-exercises', 'regress-exercise', 'restore-exercise', 'hold-progression', 'release-hold', 'change-follow-up', 'move-phase'] as const;

/**
 * A physio-initiated change. A written reason is always required (safety measure), the change is
 * flagged `manual` in the audit log, and the patient is told what changed (not the reason).
 */
export function applyManual(p: Patient, pack: ProtocolPack, a: PlanAction, reason: string, ctx: Ctx): Patient {
  const why = (reason ?? '').trim();
  if (!why) throw new Error('Write your reason for this change first');
  if (!(MANUAL_TYPES as readonly string[]).includes(a.type)) throw new Error('This change is not available as a manual change');
  const act: PlanAction = a.type === 'set-exercises' ? { ...a, note: why, notify: true } : ({ ...a, note: why } as PlanAction);
  return applyAction(p, pack, act, { ...ctx, manual: true });
}
