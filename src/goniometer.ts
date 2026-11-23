/**
 * Phone goniometer maths (physio feedback round). The phone lies flat on the lower leg; its accelerometer gives the direction
 * of gravity. The knee bend is the angle between gravity measured with the leg straight and with the knee bent.
 * With the patient lying on their front the thigh stays on the bed, so the lower leg's rotation equals the knee bend.
 * This is an estimate from a consumer phone, not a clinical goniometer.
 */
export interface Vec { x: number; y: number; z: number }
const len = (v: Vec) => Math.hypot(v.x, v.y, v.z);

/** Average of a burst of samples (reduces hand shake). */
export function meanVec(xs: Vec[]): Vec | null {
  const ok = xs.filter((v) => [v.x, v.y, v.z].every(Number.isFinite) && len(v) > 4);
  if (!ok.length) return null;
  const s = ok.reduce((a, v) => ({ x: a.x + v.x, y: a.y + v.y, z: a.z + v.z }), { x: 0, y: 0, z: 0 });
  return { x: s.x / ok.length, y: s.y / ok.length, z: s.z / ok.length };
}
/** Angle in whole degrees between two gravity directions. */
export function tiltBetween(a: Vec, b: Vec): number {
  const c = (a.x * b.x + a.y * b.y + a.z * b.z) / (len(a) * len(b));
  return Math.round((Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI);
}
/** Two readings -> their average, or a request to measure again when they disagree by more than `maxGap` degrees. */
export function combineReadings(a: number, b: number, maxGap = 15): { ok: true; deg: number } | { ok: false; gap: number } {
  const gap = Math.abs(a - b);
  return gap > maxGap ? { ok: false, gap } : { ok: true, deg: Math.round((a + b) / 2) };
}
