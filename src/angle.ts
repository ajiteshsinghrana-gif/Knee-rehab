/**
 * Phase 4.1: angle from three points tapped on a photo. Plain geometry, no AI, nothing is uploaded.
 *  'between'   the angle at the middle point between the two other points (arm raise: hip, shoulder, wrist).
 *  'deviation' how far a straight line has been bent at the middle point = 180 minus that angle (knee bend: hip, knee, ankle).
 */
export interface Pt { x: number; y: number }
export type PhotoReading = 'between' | 'deviation';

/** Angle in degrees (0 to 180) at `v` between the rays towards `a` and `b`. Null if a point sits on the vertex. */
export function angleAt(a: Pt, v: Pt, b: Pt): number | null {
  const ux = a.x - v.x, uy = a.y - v.y, wx = b.x - v.x, wy = b.y - v.y;
  const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
  if (lu < 1e-9 || lw < 1e-9) return null;
  const cos = Math.min(1, Math.max(-1, (ux * wx + uy * wy) / (lu * lw)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Whole degrees, or null when the points cannot give an angle. */
export function photoAngle(reading: PhotoReading, a: Pt, v: Pt, b: Pt): number | null {
  const inner = angleAt(a, v, b);
  if (inner === null) return null;
  return Math.round(reading === 'deviation' ? 180 - inner : inner);
}
