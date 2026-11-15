import type { Exercise, ProtocolPack } from '../types';
import { NEEDS_SIGNOFF } from '../types';

export interface SignoffItem {
  where: string;
  value: string;
  source: string;
  needsSignoff: boolean;
}

/** Every threshold-like value in a pack with its source tag. Drives the README list and tests. */
export function collectSignoffs(p: ProtocolPack): SignoffItem[] {
  const out: SignoffItem[] = [];
  const add = (where: string, value: unknown, source: string) =>
    out.push({ where: `${p.id}: ${where}`, value: String(value), source, needsSignoff: source.includes(NEEDS_SIGNOFF) });
  for (const t of ['SAFETY', 'URGENT', 'REVIEW'] as const) add(`responseHours.${t}`, `${p.responseHours[t].hours} h`, p.responseHours[t].source);
  for (const ph of p.phases) add(`phase ${ph.id} expectedWeeks / sessions / follow-up`, `${JSON.stringify(ph.expectedWeeks)}, ${ph.sessionsPerDay}/day, every ${ph.followUpEveryDays} d`, ph.source);
  for (const g of p.gates) for (const c of g.criteria) add(`gate ${g.fromPhase}->${g.toPhase} ${c.id}`, `${c.measure} ${c.operator} ${c.value}`, c.source);
  for (const c of p.expectedCurves) add(`curve ${c.measure}`, `${c.points.length} points, tolerance ${c.tolerance}`, c.source);
  for (const s of p.warningSigns) add(`warning sign ${s.id} -> tier`, `${s.tier} (${s.ruleId})`, s.source);
  for (const r of p.rules) {
    switch (r.type) {
      case 'threshold':
        r.stages.forEach((s) => add(`rule ${r.id} ${r.measure} stage weeks ${s.minWeek}-${s.maxWeek ?? 'end'}`, `${r.operator} ${s.value}`, s.source));
        break;
      case 'trend': add(`rule ${r.id} ${r.measure} ${r.direction} by`, `${r.delta} over ${r.window} check-ins`, r.deltaSource); break;
      case 'streak': add(`rule ${r.id} streak`, `${r.count}${r.windowDays ? ` in ${r.windowDays} d` : ' in a row'}${r.orAdherenceBelowPct !== undefined ? `; adherence < ${r.orAdherenceBelowPct}%` : ''}`, r.countSource); break;
      case 'silence': add(`rule ${r.id} silence`, `${r.hours} h`, r.hoursSource); break;
      case 'combination': add(`rule ${r.id} combination`, `>= ${r.minDistinct} ${r.ofTier} rules in ${r.windowDays} d`, r.countSource); break;
      default: add(`rule ${r.id} (${r.type}) tier`, r.tier, r.source);
    }
  }
  for (const pr of p.precautions) add(`precaution ${pr.id} restricted phases`, pr.phases.join(', '), pr.source);
  add('followUpProposal', `tele-review within ${p.followUpProposal.teleReviewWithinHours} h, check-ins every ${p.followUpProposal.checkInEveryDays} d for ${p.followUpProposal.forDays} d`, p.followUpProposal.source);
  for (const q of p.questionnaires) {
    add(`questionnaire ${q.id}`, `${q.items.length} items`, q.source);
    add(`questionnaire ${q.id} permission to use`, q.credit, q.licenceConfirmed ? 'PHYSIO_CONFIRMED' : NEEDS_SIGNOFF);
  }
  return out;
}

/** Exercise doses and regressions are clinical content too (Phase 2.1). */
export function collectLibrarySignoffs(lib: Exercise[]): SignoffItem[] {
  const out: SignoffItem[] = [];
  for (const e of lib) {
    out.push({ where: `exercise ${e.id} dose`, value: e.dose.text.en, source: e.dose.source, needsSignoff: e.dose.source.includes(NEEDS_SIGNOFF) });
    if (e.regressionId) out.push({ where: `exercise ${e.id} easier version`, value: e.regressionId, source: e.regressionSource ?? '', needsSignoff: (e.regressionSource ?? '').includes(NEEDS_SIGNOFF) });
  }
  return out;
}
