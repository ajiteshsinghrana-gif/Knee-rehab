/** Ranking of verified physiotherapists for one screening result. Plain scoring, no learning: every point has a reason the patient can read. */
import type { Bi, Lang } from '../types';
import { SCREENING_PACK, type ScreeningResult } from './screening';
import { slotsFor, type ConsultMode, type Physio, type Slot } from './physios';

export interface Prefs { mode: ConsultMode | 'any'; locality: string; maxFee: number | null; language: Lang }
export interface Match { physio: Physio; score: number; reasons: Bi[]; next: Slot | null; fromFee: number; modes: ConsultMode[]; featured: boolean }

const specLabel = (id: string): Bi => SCREENING_PACK.specialties.find((s) => s.id === id)?.label ?? { en: id, hi: id };
/** Whether this physio can see this person in this mode (home visits only inside the localities they serve). */
export const offersMode = (p: Physio, m: ConsultMode, locality: string): boolean => p.modes.includes(m) && p.fees[m] !== undefined && (m !== 'home' || !locality || p.serves.includes(locality));

export function matchPhysios(result: ScreeningResult, prefs: Prefs, physios: Physio[], taken: (physioId: string) => Slot[], today: string): Match[] {
  const out: Match[] = [];
  for (const p of physios) {
    if (p.status !== 'verified') continue; // an unverified physio is never shown to a patient
    const modes = (prefs.mode === 'any' ? p.modes : [prefs.mode]).filter((m) => offersMode(p, m, prefs.locality));
    const fees = modes.map((m) => p.fees[m]!).filter((f) => prefs.maxFee === null || f <= prefs.maxFee);
    if (!modes.length || !fees.length) continue;
    const reasons: Bi[] = [];
    let score = 0;
    const hits = p.specialties.filter((s) => result.specialties.includes(s));
    if (hits.length) {
      score += hits.length * 10;
      if (p.specialties[0] === result.specialties[0] || (hits[0] && p.specialties[0] === hits[0])) score += 4;
      const l = specLabel(hits[0]);
      reasons.push({ en: `Specialises in ${l.en.toLowerCase()}`, hi: `${l.hi} में विशेषज्ञता` });
    }
    if (prefs.locality && modes.some((m) => m !== 'online') && (p.locality === prefs.locality || p.serves.includes(prefs.locality))) {
      score += p.locality === prefs.locality ? 5 : 3;
      reasons.push(p.locality === prefs.locality ? { en: `Clinic in ${p.locality}`, hi: `${p.locality} में क्लिनिक` } : { en: `Serves ${prefs.locality}`, hi: `${prefs.locality} में सेवा देते हैं` });
    }
    if (p.languages.includes(prefs.language)) score += 2;
    const next = slotsFor(p, taken(p.id), today, 7)[0] ?? null;
    if (next) {
      const days = Math.round((Date.parse(next.date) - Date.parse(today)) / 86_400_000);
      if (days <= 2) { score += 3; reasons.push({ en: days === 0 ? 'Has a slot today' : days === 1 ? 'Has a slot tomorrow' : 'Has a slot in 2 days', hi: days === 0 ? 'आज स्लॉट खाली है' : days === 1 ? 'कल स्लॉट खाली है' : '2 दिन में स्लॉट खाली है' }); } else score += 1;
    } else score -= 5; // nothing to book this week: still shown, but last
    if (p.reviews >= 10) score += (p.rating - 4) * 2;
    const featured = p.plan === 'pro';
    if (featured) score += 1; // a paid plan can break a tie, never outrank a clearly better match
    out.push({ physio: p, score, reasons, next, fromFee: Math.min(...fees), modes, featured });
  }
  return out.sort((a, b) => b.score - a.score || b.physio.rating - a.physio.rating || a.physio.name.localeCompare(b.physio.name));
}
