/**
 * Loads a pose model that runs in the browser (MediaPipe Pose Landmarker, lite) and turns a video frame into body points.
 * The video never leaves the phone here. Only the model files are downloaded, once.
 *
 * Offline use: copy the files below into `public/mediapipe/` and rebuild, and the check works without internet:
 *   vision_bundle.mjs and the wasm/ folder from the npm package @mediapipe/tasks-vision, and pose_landmarker_lite.task (see README).
 * Without them the files come from the public CDN (jsDelivr) and Google's model storage, so the first use needs internet.
 */
import type { Frame } from './analyze';

export interface Pose { detect(video: HTMLVideoElement, tMs: number): Frame | null; close(): void }

const LOCAL = 'mediapipe';
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10';
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

interface RawLandmarker { detectForVideo(v: HTMLVideoElement, t: number): { landmarks?: { x: number; y: number; visibility?: number }[][] }; close(): void }
interface VisionModule {
  FilesetResolver: { forVisionTasks(wasmDir: string): Promise<unknown> };
  PoseLandmarker: { createFromOptions(fileset: unknown, opts: unknown): Promise<RawLandmarker> };
}

const abs = (u: string) => new URL(u, document.baseURI).href;
async function hasLocal(): Promise<boolean> {
  // A plain GET (not HEAD) so the app's service worker keeps the file and the check still works offline after the first use.
  try { return (await fetch(`${LOCAL}/vision_bundle.mjs`)).ok; } catch { return false; }
}

export async function loadPose(): Promise<Pose> {
  const local = await hasLocal();
  const bundle = abs(local ? `${LOCAL}/vision_bundle.mjs` : `${CDN}/vision_bundle.mjs`);
  const wasm = abs(local ? `${LOCAL}/wasm` : `${CDN}/wasm`);
  const model = abs(local ? `${LOCAL}/pose_landmarker_lite.task` : MODEL_CDN);
  // The address is built at run time on purpose: the app bundle must not contain the model library.
  const mod = (await import(/* @vite-ignore */ bundle)) as VisionModule;
  const fileset = await mod.FilesetResolver.forVisionTasks(wasm);
  const make = (delegate: 'GPU' | 'CPU') => mod.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', numPoses: 1 });
  let lm: RawLandmarker;
  try { lm = await make('GPU'); } catch { lm = await make('CPU'); }
  let last = -1;
  return {
    detect(video, tMs) {
      // The model needs strictly increasing timestamps.
      const t = tMs <= last ? last + 1 : tMs;
      last = t;
      const r = lm.detectForVideo(video, t);
      const pts = r.landmarks?.[0];
      return pts ? pts.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 0 })) : null;
    },
    close() { try { lm.close(); } catch { /* already closed */ } },
  };
}
