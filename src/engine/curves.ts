/**
 * Expected-recovery curves a physio can replace (Phase 7.1).
 * Precedence for one patient: their own curve, then the clinic default for the condition, then the protocol's curve.
 * The protocol pack itself is never changed; the replacement is applied to a copy (see effectivePack).
 */
import type { CurveEdit, ExpectedCurve } from '../types';

/** Clinic defaults by pack id. The store keeps this in step with its saved state. */
let clinic: Record<string, CurveEdit[]> = {};
export const setClinicCurves = (m: Record<string, CurveEdit[]> | undefined): void => { clinic = m ?? {}; };
export const clinicCurvesFor = (packId: string): CurveEdit[] => clinic[packId] ?? [];

/** Why a curve cannot be used, or null when it can. */
export function validateCurve(points: [number, number][], tolerance: number): string | null {
  if (!Array.isArray(points) || points.length < 2) return 'A curve needs at least two points';
  if (points.some(([w, v]) => !Number.isFinite(w) || !Number.isFinite(v))) return 'Every week and value must be a number';
  if (points.some(([w]) => w < 0)) return 'Weeks cannot be negative';
  for (let i = 1; i < points.length; i++) if (!(points[i][0] > points[i - 1][0])) return 'Weeks must go up, one point per week';
  if (!Number.isFinite(tolerance) || tolerance <= 0) return 'The allowed difference must be more than 0';
  return null;
}

export type CurveOrigin = 'placeholder' | 'protocol' | 'clinic' | 'patient';
/** Where the curve a patient is judged against came from. */
export function curveOrigin(c: ExpectedCurve): CurveOrigin {
  if (c.source.startsWith('PHYSIO_OVERRIDE')) return 'patient';
  if (c.source.startsWith('PHYSIO_CLINIC')) return 'clinic';
  if (/NEEDS_PHYSIO_SIGNOFF|PLACEHOLDER/.test(c.source)) return 'placeholder';
  return 'protocol';
}

export const PLACEHOLDER_NOTE = 'Placeholder curve: not clinically validated, awaiting physio sign-off.';
