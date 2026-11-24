/** Physiotherapist profiles, availability and the demo roster. Everything here is made up; real clinics are added in the live clinic. */
import type { Lang } from '../types';
import { addDays } from '../engine/dates';

export type ConsultMode = 'online' | 'clinic' | 'home';
export const MODES: ConsultMode[] = ['online', 'clinic', 'home'];
export type VerifyStatus = 'verified' | 'pending' | 'rejected';
export type PlanTier = 'basic' | 'pro';

export interface Physio {
  id: string;
  name: string;
  qualification: string;
  /** Registration number the verifier checks. Demo physios use DEMO-… placeholders. */
  registration: string;
  specialties: string[];
  years: number;
  /** Where the clinic is. */
  locality: string;
  /** Localities served for home visits. */
  serves: string[];
  languages: Lang[];
  modes: ConsultMode[];
  /** Fee in rupees, per mode offered. */
  fees: Partial<Record<ConsultMode, number>>;
  /** Weekly pattern: weekdays (0 = Sunday) and start times. */
  availability: { days: number[]; times: string[] };
  rating: number;
  reviews: number;
  bio: string;
  status: VerifyStatus;
  plan: PlanTier;
  demo?: boolean;
}

export const LOCALITIES = ['Daryaganj', 'Connaught Place', 'Karol Bagh', 'Lajpat Nagar', 'Saket', 'Dwarka', 'Rohini'];
export const CITY = 'Delhi';

export interface Slot { date: string; time: string }
export const slotKey = (s: Slot): string => `${s.date} ${s.time}`;
const weekday = (date: string): number => new Date(date + 'T00:00:00Z').getUTCDay();

/** Open slots in the next `days` days (today included), minus the ones already booked with this physio. */
export function slotsFor(p: Physio, taken: Slot[], from: string, days = 7): Slot[] {
  const used = new Set(taken.map(slotKey));
  const out: Slot[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    if (!p.availability.days.includes(weekday(date))) continue;
    for (const time of p.availability.times) if (!used.has(slotKey({ date, time }))) out.push({ date, time });
  }
  return out;
}

const WK = [1, 2, 3, 4, 5, 6];
const base = { status: 'verified' as const, demo: true };

export const DEMO_PHYSIOS: Physio[] = [
  { ...base, id: 'ph-asha', name: 'Dr. Asha Verma', qualification: 'BPT, MPT (Orthopaedics)', registration: 'DEMO-0001', specialties: ['spine', 'functional'], years: 12, locality: 'Karol Bagh', serves: ['Karol Bagh', 'Connaught Place', 'Daryaganj'], languages: ['en', 'hi'], modes: ['online', 'clinic', 'home'], fees: { online: 500, clinic: 700, home: 1100 }, availability: { days: WK, times: ['10:00', '11:00', '16:00', '17:00'] }, rating: 4.8, reviews: 214, plan: 'pro', bio: 'Long-standing back and neck pain, posture and desk-related problems. Explains the plan in Hindi or English.' },
  { ...base, id: 'ph-rohan', name: 'Dr. Rohan Mehta', qualification: 'BPT, MPT (Sports)', registration: 'DEMO-0002', specialties: ['sports', 'knee'], years: 8, locality: 'Lajpat Nagar', serves: ['Lajpat Nagar', 'Saket'], languages: ['en', 'hi'], modes: ['online', 'clinic'], fees: { online: 600, clinic: 900 }, availability: { days: [1, 2, 3, 4, 5, 6, 0], times: ['07:00', '08:00', '18:00', '19:00'] }, rating: 4.7, reviews: 168, plan: 'pro', bio: 'Works with club and college athletes: ligament and muscle injuries, return-to-sport planning.' },
  { ...base, id: 'ph-farida', name: 'Dr. Farida Khan', qualification: 'BPT, MPT (Neurology)', registration: 'DEMO-0003', specialties: ['functional'], years: 15, locality: 'Saket', serves: ['Saket', 'Lajpat Nagar', 'Dwarka'], languages: ['en', 'hi'], modes: ['clinic', 'home'], fees: { clinic: 800, home: 1300 }, availability: { days: [1, 2, 3, 4, 5], times: ['10:00', '12:00', '15:00'] }, rating: 4.9, reviews: 302, plan: 'basic', bio: 'Helps older adults and people with stiffness regain walking, balance and independence at home.' },
  { ...base, id: 'ph-vikram', name: 'Dr. Vikram Singh', qualification: 'BPT', registration: 'DEMO-0004', specialties: ['knee', 'post-op'], years: 6, locality: 'Dwarka', serves: ['Dwarka'], languages: ['en', 'hi'], modes: ['online', 'clinic', 'home'], fees: { online: 400, clinic: 550, home: 900 }, availability: { days: WK, times: ['09:00', '10:00', '17:00', '18:00'] }, rating: 4.5, reviews: 77, plan: 'basic', bio: 'Rehabilitation after knee and hip replacement and ligament surgery, with video follow-ups between visits.' },
  { ...base, id: 'ph-meenal', name: 'Dr. Meenal Iyer', qualification: 'BPT, MPT (Musculoskeletal)', registration: 'DEMO-0005', specialties: ['spine', 'post-op'], years: 10, locality: 'Connaught Place', serves: ['Connaught Place', 'Daryaganj', 'Karol Bagh'], languages: ['en', 'hi'], modes: ['online', 'clinic'], fees: { online: 650, clinic: 950 }, availability: { days: [1, 2, 3, 4, 5], times: ['11:00', '12:00', '14:00', '15:00'] }, rating: 4.6, reviews: 121, plan: 'pro', bio: 'Neck and back pain, and recovery after spine and shoulder procedures.' },
  { ...base, id: 'ph-sourav', name: 'Dr. Sourav Das', qualification: 'BPT, MPT (Sports)', registration: 'DEMO-0006', specialties: ['sports', 'spine'], years: 5, locality: 'Rohini', serves: ['Rohini'], languages: ['en', 'hi'], modes: ['online', 'clinic', 'home'], fees: { online: 350, clinic: 500, home: 800 }, availability: { days: WK, times: ['08:00', '09:00', '19:00', '20:00'] }, rating: 4.4, reviews: 54, plan: 'basic', bio: 'Gym and running injuries, with an affordable plan for students.' },
  { ...base, id: 'ph-kavita', name: 'Dr. Kavita Nair', qualification: 'BPT, MPT (Geriatrics)', registration: 'DEMO-0007', specialties: ['functional', 'knee'], years: 18, locality: 'Daryaganj', serves: ['Daryaganj', 'Connaught Place', 'Karol Bagh', 'Lajpat Nagar'], languages: ['en', 'hi'], modes: ['clinic', 'home', 'online'], fees: { clinic: 750, home: 1200, online: 550 }, availability: { days: [1, 2, 3, 4, 5, 6], times: ['10:00', '11:00', '13:00'] }, rating: 4.8, reviews: 256, plan: 'basic', bio: 'Arthritis, joint stiffness and mobility problems; patient and unhurried.' },
  { ...base, id: 'ph-arjun', name: 'Dr. Arjun Bose', qualification: 'BPT', registration: 'DEMO-0008', specialties: ['post-op', 'sports'], years: 4, locality: 'Saket', serves: ['Saket', 'Lajpat Nagar', 'Dwarka'], languages: ['en', 'hi'], modes: ['online', 'home'], fees: { online: 300, home: 750 }, availability: { days: [1, 2, 3, 4, 5, 6, 0], times: ['09:00', '16:00', '17:00'] }, rating: 4.3, reviews: 31, plan: 'basic', bio: 'Early-career physiotherapist focused on guided home exercise after surgery.' },
  { ...base, id: 'ph-new1', name: 'Dr. Neha Sharma', qualification: 'BPT, MPT (Sports)', registration: 'DEMO-0009', specialties: ['sports', 'knee'], years: 3, locality: 'Rohini', serves: ['Rohini'], languages: ['en', 'hi'], modes: ['online', 'clinic'], fees: { online: 350, clinic: 450 }, availability: { days: WK, times: ['10:00', '11:00'] }, rating: 0, reviews: 0, plan: 'basic', bio: 'New to the platform. Sports injuries and knee rehabilitation.', status: 'pending' },
  { ...base, id: 'ph-new2', name: 'Dr. Imran Qureshi', qualification: 'BPT', registration: 'DEMO-0010', specialties: ['spine'], years: 2, locality: 'Dwarka', serves: ['Dwarka'], languages: ['en', 'hi'], modes: ['clinic'], fees: { clinic: 400 }, availability: { days: [1, 3, 5], times: ['17:00', '18:00'] }, rating: 0, reviews: 0, plan: 'basic', bio: 'Back and neck pain.', status: 'pending' },
];
