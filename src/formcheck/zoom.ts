/**
 * Zoom for the camera check, as plain maths (no camera here).
 *
 * Two kinds of zoom. Where the phone's own camera can zoom (many Android phones in Chrome), the check asks the camera: the picture
 * is truly sharper. Where it cannot (iPad and iPhone browsers do not offer it), the check zooms digitally: the middle part of the
 * picture is cut out and given to the pose model, and the screen shows the same part larger. The cut-out keeps the picture's
 * proportions, so angles are not stretched. Zoom is locked once the set starts, because changing it mid-set would change the
 * measurements.
 */
import type { Frame } from './analyze';

export const ZOOM = { min: 1, max: 3, step: 0.1 } as const;
export interface Crop { x: number; y: number; w: number; h: number }

export const clampZoom = (z: number): number => (Number.isFinite(z) ? Math.min(ZOOM.max, Math.max(ZOOM.min, z)) : 1);
/** The middle part of the picture that is seen at this zoom, as shares of the whole picture (0 to 1). */
export const cropFor = (zoom: number): Crop => { const w = 1 / clampZoom(zoom); return { x: (1 - w) / 2, y: (1 - w) / 2, w, h: w }; };
/** Body points found in the cut-out, moved back to where they are in the whole picture (for drawing the skeleton). */
export const toFullFrame = (frame: Frame, c: Crop): Frame => frame.map((p) => ({ ...p, x: c.x + p.x * c.w, y: c.y + p.y * c.h }));
