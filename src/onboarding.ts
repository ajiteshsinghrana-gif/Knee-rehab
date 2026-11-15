/** Phase 3.1: create a patient from a pack, with the physio's adjustments applied through the same audited actions. */
import { isLang } from './types';
import type { Lang, Patient, Plan } from './types';
import { getPack, PACKS } from './engine/packs';
import { buildImportedPack } from './import/apply';
import { buildConditionPack, fatDraft, slimDraft, type ConditionDraft } from './author/condition';
import { compress, decompress } from './lzss';
import type { ProtocolPack } from './types';
import { applyAction, normalizePatient, planDefaults, PHYSIO } from './engine/plan';
import { getExercise } from './exercises/library';
import { addDays } from './engine/dates';

export interface OnboardDraft {
  name: string;
  age: number;
  language: Lang;
  packId: string;
  /** Surgery (or injury) date. */
  anchorDate: string;
  phaseId: string;
  /** Exercise ids the patient should do. */
  exercises: string[];
  checkInEveryDays: number;
  reviewEveryDays: number;
  overrides: { target: string; value: number; reason: string }[];
  /** A family member or carer will usually answer for the patient (Phase 5.3). */
  caregiver?: boolean;
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function validateOnboard(d: OnboardDraft, today: string): string[] {
  const e: string[] = [];
  if (!d.name.trim()) e.push('Enter the patient name');
  if (!(d.age >= 1 && d.age <= 110)) e.push('Enter an age between 1 and 110');
  if (!PACKS[d.packId]) e.push('Choose a condition');
  if (!isDate(d.anchorDate)) e.push('Enter the surgery date');
  else if (d.anchorDate > today) e.push('The surgery date cannot be in the future');
  const pack = PACKS[d.packId];
  if (pack && !pack.phases.some((p) => p.id === d.phaseId)) e.push('Choose a phase');
  if (!d.exercises.length) e.push('Choose at least one exercise');
  if (d.exercises.some((id) => !getExercise(id))) e.push('Unknown exercise in the list');
  if (!(d.checkInEveryDays >= 1 && d.checkInEveryDays <= 14)) e.push('Check-ins must be every 1 to 14 days');
  if (!(d.reviewEveryDays >= 1 && d.reviewEveryDays <= 60)) e.push('Reviews must be every 1 to 60 days');
  return e;
}

let counter = 0;
export function newPatientId(nowMs: number): string { return `p${nowMs.toString(36)}${(++counter).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`; }

export function buildPatient(d: OnboardDraft, ctx: { nowMs: number; today: string; id?: string }): Patient {
  const errs = validateOnboard(d, ctx.today);
  if (errs.length) throw new Error(errs[0]);
  const pack = getPack(d.packId);
  const first = pack.phases[0].id === d.phaseId;
  let p: Patient = normalizePatient({
    id: ctx.id ?? newPatientId(ctx.nowMs), name: d.name.trim(), age: Math.round(d.age), packId: pack.id, language: d.language, ...(d.caregiver ? { caregiverMode: true } : {}),
    anchorDate: d.anchorDate, enrolledOn: ctx.today, currentPhase: d.phaseId, phaseStartDate: first ? d.anchorDate : ctx.today,
    sessionsPrescribedPerDay: pack.phases.find((x) => x.id === d.phaseId)?.sessionsPerDay ?? 2,
    daily: [], periodic: [], reviewed: {}, decisions: [], ...planDefaults(),
  });
  const c = { nowMs: ctx.nowMs, today: ctx.today };
  const phaseList = pack.phases.find((x) => x.id === d.phaseId)!.exercises;
  const add = d.exercises.filter((id) => !phaseList.includes(id));
  const remove = phaseList.filter((id) => !d.exercises.includes(id));
  if (add.length || remove.length) p = applyAction(p, pack, { type: 'set-exercises', add, remove, note: 'Set at onboarding' }, c);
  const phase = pack.phases.find((x) => x.id === d.phaseId)!;
  if (d.checkInEveryDays !== 1 || d.reviewEveryDays !== phase.followUpEveryDays) {
    p = applyAction(p, pack, { type: 'change-follow-up', checkInEveryDays: d.checkInEveryDays, reviewEveryDays: d.reviewEveryDays, nextReviewDate: addDays(ctx.today, d.reviewEveryDays), note: 'Set at onboarding' }, c);
  }
  for (const o of d.overrides) p = applyAction(p, pack, { type: 'set-override', target: o.target, value: o.value, reason: o.reason.trim() || 'Set at onboarding' }, c);
  // the patient is not told about their own starting plan
  p = { ...p, notices: [] };
  // approval itself is the first audit line
  p = { ...p, audit: [{ id: `${ctx.nowMs}-onb`, at: new Date(ctx.nowMs).toISOString(), who: PHYSIO, action: 'onboard', summary: `Patient onboarded on ${pack.condition.en}, ${phase.name.en}`, before: null, after: { exercises: d.exercises }, note: 'Plan approved' }, ...p.audit] };
  return p;
}

// ---------------- invite link (Phase 3.1) ----------------
interface Invite { cg?: 1; v: 1; i: string; n: string; a: number; p: string; l: Lang; d: string; ph: string; ps: string; s: number; e?: string; cp?: { base: string; file: string; fields: { target: string; value: number | string[] }[] }; ca?: Record<string, unknown>; plan: Plan }

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64bytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64bytes = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** A leading "~" marks a compressed link; older links without it still open. */
const unb64 = (s: string) => new TextDecoder().decode(s.startsWith('~') ? decompress(unb64bytes(s.slice(1))) : unb64bytes(s));
const pack64 = (json: string): string => { const plain = b64(json); const z = '~' + b64bytes(compress(new TextEncoder().encode(json))); return z.length < plain.length ? z : plain; };

/** A physio-imported pack is sent as base id + the approved fields (small), and rebuilt on the other device. */
function customPart(p: Patient): { cp?: Invite['cp']; ca?: Invite['ca'] } {
  const pk = PACKS[p.packId];
  if (pk?.authored) return { ca: slimDraft(pk.authored as ConditionDraft) };
  return pk?.basedOn && pk.imported ? { cp: { base: pk.basedOn, file: pk.imported.file, fields: pk.imported.fields } } : {};
}

export function encodeInvite(p: Patient): string {
  const inv: Invite = { v: 1, i: p.id, n: p.name, a: p.age, p: p.packId, l: p.language, ...(p.caregiverMode ? { cg: 1 as const } : {}), d: p.anchorDate, ph: p.currentPhase, ps: p.phaseStartDate, s: p.sessionsPrescribedPerDay, ...(p.enrolledOn ? { e: p.enrolledOn } : {}), ...customPart(p), plan: p.plan };
  return pack64(JSON.stringify(inv));
}

/** Returns a new, empty patient from an invite, or null if the link is damaged or for an unknown condition. */
export function decodeInvite(code: string): { patient: Patient; pack?: ProtocolPack } | null {
  try {
    const x = JSON.parse(unb64(code)) as Invite;
    if (x?.v !== 1 || typeof x.i !== 'string' || typeof x.n !== 'string' || !isDate(x.d) || !isDate(x.ps)) return null;
    let built: ProtocolPack | undefined;
    if (!PACKS[x.p] && x.ca && x.ca.id === x.p) built = buildConditionPack(fatDraft(x.ca)); // a physio-written condition: same validator as any pack
    else if (!PACKS[x.p] && x.cp && PACKS[x.cp.base]) {
      const props = x.cp.fields.map((f) => ({ target: f.target, label: f.target, kind: Array.isArray(f.value) ? 'exercises' as const : 'number' as const, current: 0, proposed: f.value, line: '' }));
      built = buildImportedPack(PACKS[x.cp.base], props, String(x.cp.file), x.p); // same validator as any import
    }
    if (!PACKS[x.p]) return null;
    const pack = PACKS[x.p];
    if (!pack.phases.some((ph) => ph.id === x.ph)) return null;
    const patient = normalizePatient({
      id: x.i, name: x.n.slice(0, 80), age: Number(x.a) || 0, packId: x.p, language: isLang(x.l) ? x.l : 'en', ...(x.cg === 1 ? { caregiverMode: true } : {}), anchorDate: x.d, ...(isDate(x.e) ? { enrolledOn: x.e } : {}), currentPhase: x.ph, phaseStartDate: x.ps,
      sessionsPrescribedPerDay: Number(x.s) || 2, daily: [], periodic: [], reviewed: {}, decisions: [], ...planDefaults(), plan: { ...planDefaults().plan, ...x.plan },
    });
    return { patient, ...(built ? { pack: built } : {}) };
  } catch { return null; }
}

export const inviteUrl = (p: Patient, base: string): string => `${base}#join=${encodeInvite(p)}`;
