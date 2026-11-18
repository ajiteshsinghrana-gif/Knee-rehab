import type { Patient } from './types';

/**
 * Two levels of "warning sign" advice (Phase 6.3).
 * Emergency: signs that can mean a life-threatening problem (chest pain or breathlessness = possible clot in the lung).
 * Everything else that triggers the safety banner (calf pain/redness, fever, wound fluid, spreading redness) is
 * "same-day": contact the surgeon or clinic today, and go to hospital / call 112 if they cannot be reached or it gets worse.
 * These are our own safety defaults, not from the protocol source. They need physio sign-off (see README).
 */
export const EMERGENCY_SIGNS = ['chestPainBreathless'];

/** True when any emergency sign is reported. */
export const hasEmergencySign = (warnings: Record<string, boolean> | undefined): boolean =>
  !!warnings && EMERGENCY_SIGNS.some((id) => warnings[id]);

/**
 * Level for the patient's latest check-in. If the signs cannot be determined (no check-in, or no sign data)
 * we fall back to the stronger message, never the weaker one.
 */
export function safetyLevel(p: Patient): 'emergency' | 'sameDay' {
  const last = [...p.daily].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!last || !last.warnings || Object.keys(last.warnings).length === 0) return 'emergency';
  return hasEmergencySign(last.warnings) ? 'emergency' : 'sameDay';
}
