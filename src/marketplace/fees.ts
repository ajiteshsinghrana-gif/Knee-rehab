/**
 * The money rules. These percentages and the subscription price are PLACEHOLDERS (NEEDS_BUSINESS_REVIEW):
 * they exist so the revenue view has real arithmetic behind it, not because anyone has agreed them.
 * The platform only earns when a booking is completed, never on a booking that was cancelled or missed.
 */
import type { ConsultMode, PlanTier } from './physios';

export const FEE_CONFIG = {
  review: 'NEEDS_BUSINESS_REVIEW',
  /** Percent of the consultation fee kept by the platform, by plan and mode. Home visits carry the highest rate. */
  commissionPct: { basic: { online: 12, clinic: 12, home: 18 }, pro: { online: 8, clinic: 8, home: 14 } } as Record<PlanTier, Record<ConsultMode, number>>,
  /** Monthly subscription in rupees. Basic listing is free. */
  subscription: { basic: 0, pro: 999 } as Record<PlanTier, number>,
} as const;

export interface Split { fee: number; pct: number; commission: number; payout: number }
export function splitFee(plan: PlanTier, mode: ConsultMode, fee: number): Split {
  const pct = FEE_CONFIG.commissionPct[plan][mode];
  const commission = Math.round((fee * pct) / 100);
  return { fee, pct, commission, payout: fee - commission };
}
