/** Clinic sessions (physio feedback round): next session, reminders, attended / missed. Times are the clinic's local time. */
import type { ClinicVisit, Lang, Patient } from './types';
import { addDays } from './engine/dates';

/** "Now" as a "YYYY-MM-DDTHH:MM" stamp: the device clock in the live clinic, the demo calendar day at 09:00 in the demo. */
export function nowStamp(st: { today: string; live?: boolean }): string {
  if (!st.live) return `${st.today}T09:00`;
  const d = new Date(); const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
const LOCALE: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN' };
const asUtc = (at: string) => new Date(`${at}:00Z`); // the stamp is shown exactly as written, whatever the device's zone
export const visitWhen = (at: string, lang: Lang): string =>
  asUtc(at).toLocaleString(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
export const visitTime = (at: string, lang: Lang): string => asUtc(at).toLocaleTimeString(LOCALE[lang], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

export const sortedVisits = (p: Patient): ClinicVisit[] => [...(p.visits ?? [])].sort((a, b) => a.at.localeCompare(b.at));
/** The next planned session that has not started yet. */
export const nextVisit = (p: Patient, now: string): ClinicVisit | undefined => sortedVisits(p).find((v) => v.status === 'planned' && v.at >= now);
/** Planned sessions whose time has passed and that the physio has not marked yet. */
export const toMark = (p: Patient, now: string): ClinicVisit[] => sortedVisits(p).filter((v) => v.status === 'planned' && v.at < now);
export function visitCounts(p: Patient): { planned: number; attended: number; missed: number } {
  const v = p.visits ?? [];
  return { planned: v.length, attended: v.filter((x) => x.status === 'attended').length, missed: v.filter((x) => x.status === 'missed').length };
}
/** Reminder for the patient's home screen: on the day of the session, or the day before. */
export function visitReminder(p: Patient, today: string): { kind: 'today' | 'tomorrow'; visit: ClinicVisit } | null {
  const v = sortedVisits(p).find((x) => x.status === 'planned' && (x.at.slice(0, 10) === today || x.at.slice(0, 10) === addDays(today, 1)));
  if (!v) return null;
  return { kind: v.at.slice(0, 10) === today ? 'today' : 'tomorrow', visit: v };
}
