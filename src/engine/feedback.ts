/** "Was this flag useful?" answers (fix phase 4), summarised per rule. A rule's hit rate = useful answers / rated flags it was part of. */
import type { Patient } from '../types';

export interface RuleHitRate { ruleId: string; rated: number; useful: number }

export function ruleHitRates(patients: Patient[]): RuleHitRate[] {
  const by = new Map<string, RuleHitRate>();
  for (const p of patients) for (const f of Object.values(p.flagFeedback ?? {})) for (const id of f.rules) {
    const row = by.get(id) ?? { ruleId: id, rated: 0, useful: 0 };
    row.rated++; if (f.useful) row.useful++;
    by.set(id, row);
  }
  return [...by.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
