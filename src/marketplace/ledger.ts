/**
 * Bookings, verification and revenue as pure functions: state in, state (or a plain-language error) out.
 * The screen can hide a button, but these functions are what actually refuse an unsafe or invalid action.
 */
import { SCREENING_PACK, screen, validateAnswers, type ScreenTier, type ScreeningAnswers } from './screening';
import { MODES, LOCALITIES, slotKey, slotsFor, type ConsultMode, type PlanTier, type Physio, type Slot } from './physios';
import { FEE_CONFIG, splitFee, type Split } from './fees';

export type BookingStatus = 'booked' | 'completed' | 'cancelled' | 'no-show';
export interface ScreeningSnapshot { tier: ScreenTier; area: string; duration: string; severity: number; function: string; recentSurgery: boolean; priorEpisodes: boolean; rules: string[]; specialties: string[] }
export interface Booking {
  id: string; physioId: string; physioName: string; patientName: string; phone: string;
  mode: ConsultMode; slot: Slot; fee: number; status: BookingStatus; createdAt: string;
  screening: ScreeningSnapshot;
  /** Fixed when the visit is marked completed, using the physio's plan at that moment. */
  split?: Split;
  /** Set once the patient has been moved into RehabPath follow-up. */
  enrolledPatientId?: string;
}
export interface MpState { v: 1; physios: Physio[]; bookings: Booking[]; seq: number }
export type Res = { ok: true; state: MpState; booking?: Booking } | { ok: false; error: string };

export const emptyMp = (physios: Physio[] = []): MpState => ({ v: 1, physios, bookings: [], seq: 0 });
const fail = (error: string): Res => ({ ok: false, error });

/** Indian mobile number: 10 digits starting 6-9, with an optional +91 or 0 in front. */
export function cleanPhone(raw: string): string | null {
  const d = raw.replace(/[\s-]/g, '').replace(/^\+?91/, '').replace(/^0/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const takenSlots = (s: MpState, physioId: string): Slot[] => s.bookings.filter((b) => b.physioId === physioId && (b.status === 'booked' || b.status === 'completed')).map((b) => b.slot);

export interface BookInput { physioId: string; mode: ConsultMode; slot: Slot; patientName: string; phone: string; answers: ScreeningAnswers; consent: boolean; nowIso: string; today: string }
export function bookSlot(s: MpState, i: BookInput): Res {
  const p = s.physios.find((x) => x.id === i.physioId);
  if (!p || p.status !== 'verified') return fail('This physiotherapist is not available for booking.');
  // The tier is worked out again here from the answers. A red-flag result can never be booked, whatever the screen sent.
  const errs = validateAnswers(i.answers);
  if (errs.length) return fail(errs[0]);
  const result = screen(i.answers);
  if (result.tier === 'RED_FLAG') return fail('Your answers include a warning sign. Please see a doctor first; booking is switched off.');
  if (!i.patientName.trim()) return fail('Enter your name.');
  const phone = cleanPhone(i.phone);
  if (!phone) return fail('Enter a 10-digit mobile number.');
  if (!i.consent) return fail('Please agree to share your screening summary with the physiotherapist.');
  if (!MODES.includes(i.mode) || !p.modes.includes(i.mode) || p.fees[i.mode] === undefined) return fail('This physiotherapist does not offer that kind of visit.');
  const open = slotsFor(p, takenSlots(s, p.id), i.today, 14);
  if (!open.some((x) => slotKey(x) === slotKey(i.slot))) return fail('That time is no longer free. Please pick another.');
  const seq = s.seq + 1;
  const booking: Booking = {
    id: `bk${seq}`, physioId: p.id, physioName: p.name, patientName: i.patientName.trim().slice(0, 80), phone, mode: i.mode, slot: { date: i.slot.date, time: i.slot.time },
    fee: p.fees[i.mode]!, status: 'booked', createdAt: i.nowIso,
    screening: { tier: result.tier, area: i.answers.area, duration: i.answers.duration, severity: i.answers.severity, function: i.answers.function, recentSurgery: i.answers.recentSurgery, priorEpisodes: i.answers.priorEpisodes, rules: result.triggered.map((t) => t.id), specialties: result.specialties },
  };
  return { ok: true, booking, state: { ...s, seq, bookings: [...s.bookings, booking] } };
}

/** booked -> completed | cancelled | no-show. Nothing else moves, and money is fixed only on completion. */
export function setBookingStatus(s: MpState, id: string, to: Exclude<BookingStatus, 'booked'>): Res {
  const b = s.bookings.find((x) => x.id === id);
  if (!b) return fail('Booking not found.');
  if (b.status !== 'booked') return fail('Only an upcoming booking can be changed.');
  const p = s.physios.find((x) => x.id === b.physioId);
  const next: Booking = { ...b, status: to, ...(to === 'completed' && p ? { split: splitFee(p.plan, b.mode, b.fee) } : {}) };
  return { ok: true, booking: next, state: { ...s, bookings: s.bookings.map((x) => (x.id === id ? next : x)) } };
}

export function markEnrolled(s: MpState, bookingId: string, patientId: string): MpState {
  return { ...s, bookings: s.bookings.map((b) => (b.id === bookingId ? { ...b, enrolledPatientId: patientId } : b)) };
}

export function decideVerification(s: MpState, physioId: string, to: 'verified' | 'rejected'): Res {
  const p = s.physios.find((x) => x.id === physioId);
  if (!p) return fail('Physiotherapist not found.');
  if (p.status !== 'pending') return fail('Only a pending application can be decided.');
  return { ok: true, state: { ...s, physios: s.physios.map((x) => (x.id === physioId ? { ...x, status: to } : x)) } };
}

export function setPlan(s: MpState, physioId: string, plan: PlanTier): MpState {
  return { ...s, physios: s.physios.map((x) => (x.id === physioId ? { ...x, plan } : x)) };
}

export interface RegisterDraft { name: string; qualification: string; registration: string; specialties: string[]; years: number; locality: string; modes: ConsultMode[]; fees: Partial<Record<ConsultMode, number>>; bio: string }
/** A new physiotherapist always starts as pending. Nobody can register themselves as verified. */
export function registerPhysio(s: MpState, d: RegisterDraft): Res {
  const spec = new Set(SCREENING_PACK.specialties.map((x) => x.id));
  if (!d.name.trim()) return fail('Enter the physiotherapist name.');
  if (!d.qualification.trim()) return fail('Enter the qualification.');
  if (!d.registration.trim()) return fail('Enter the registration number. It is what the verifier checks.');
  if (!d.specialties.length || d.specialties.some((x) => !spec.has(x))) return fail('Choose at least one specialisation.');
  if (!(d.years >= 0 && d.years <= 60)) return fail('Years of experience must be between 0 and 60.');
  if (!LOCALITIES.includes(d.locality)) return fail('Choose a locality.');
  if (!d.modes.length || d.modes.some((m) => !MODES.includes(m))) return fail('Offer at least one kind of visit.');
  for (const m of d.modes) { const f = d.fees[m]; if (!(typeof f === 'number' && f >= 100 && f <= 20000)) return fail(`Enter a fee between 100 and 20000 rupees for ${m} visits.`); }
  const seq = s.seq + 1;
  const physio: Physio = {
    id: `ph-new${seq}`, name: d.name.trim().slice(0, 80), qualification: d.qualification.trim().slice(0, 120), registration: d.registration.trim().slice(0, 40), specialties: d.specialties, years: Math.round(d.years),
    locality: d.locality, serves: [d.locality], languages: ['en', 'hi'], modes: d.modes, fees: Object.fromEntries(d.modes.map((m) => [m, d.fees[m]!])),
    availability: { days: [1, 2, 3, 4, 5, 6], times: ['10:00', '11:00', '16:00', '17:00'] }, rating: 0, reviews: 0, bio: d.bio.trim().slice(0, 300), status: 'pending', plan: 'basic',
  };
  return { ok: true, state: { ...s, seq, physios: [...s.physios, physio] } };
}

export interface Revenue {
  completed: number; cancelled: number; noShow: number; upcoming: number;
  /** Total fees paid for completed visits. */
  gmv: number; commission: number; payouts: number;
  /** Monthly subscription income from verified physiotherapists on Pro. */
  subscriptions: number; proCount: number;
  byMode: Record<ConsultMode, { count: number; gmv: number; commission: number }>;
}
export function revenue(s: MpState): Revenue {
  const r: Revenue = { completed: 0, cancelled: 0, noShow: 0, upcoming: 0, gmv: 0, commission: 0, payouts: 0, subscriptions: 0, proCount: 0, byMode: { online: { count: 0, gmv: 0, commission: 0 }, clinic: { count: 0, gmv: 0, commission: 0 }, home: { count: 0, gmv: 0, commission: 0 } } };
  for (const b of s.bookings) {
    if (b.status === 'cancelled') r.cancelled++; else if (b.status === 'no-show') r.noShow++; else if (b.status === 'booked') r.upcoming++;
    else if (b.split) { r.completed++; r.gmv += b.split.fee; r.commission += b.split.commission; r.payouts += b.split.payout; const m = r.byMode[b.mode]; m.count++; m.gmv += b.split.fee; m.commission += b.split.commission; }
  }
  for (const p of s.physios) if (p.status === 'verified' && p.plan === 'pro') { r.proCount++; r.subscriptions += FEE_CONFIG.subscription.pro; }
  return r;
}
