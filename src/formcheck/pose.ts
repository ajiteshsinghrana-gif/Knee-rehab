/**
 * Loads a pose model that runs in the browser (MediaPipe Pose Landmarker, lite) and turns a video frame into body points.
 * The video never leaves the phone here. Only the model files are downloaded, once.
 *
 * Offline use: copy the files below into `public/mediapipe/` and rebuild, and the check works without internet:
 *   vision_bundle.mjs and the wasm/ folder from the npm package @mediapipe/tasks-vision, pose_landmarker_lite.task, and hand_landmarker.task for the hand, wrist and elbow check (see README).
 * Without them the files come from the public CDN (jsDelivr) and Google's model storage, so the first use needs internet.
 */
import type { Frame } from './analyze';

export interface Pose { /** true when the separate hand model is loaded too */ hand: boolean; detect(video: HTMLVideoElement | HTMLCanvasElement, tMs: number): Frame | null; close(): void }

const LOCAL = 'mediapipe';
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10';
const HAND_MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

interface RawLandmarker { detectForVideo(v: HTMLVideoElement | HTMLCanvasElement, t: number): { landmarks?: { x: number; y: number; visibility?: number }[][] }; close(): void }
interface VisionModule {
  FilesetResolver: { forVisionTasks(wasmDir: string): Promise<unknown> };
  PoseLandmarker: { createFromOptions(fileset: unknown, opts: unknown): Promise<RawLandmarker> };
  HandLandmarker: { createFromOptions(fileset: unknown, opts: unknown): Promise<RawLandmarker> };
}

const abs = (u: string) => new URL(u, document.baseURI).href;
async function hasLocal(): Promise<boolean> {
  // A plain GET (not HEAD) so the app's service worker keeps the file and the check still works offline after the first use.
  try { return (await fetch(`${LOCAL}/vision_bundle.mjs`)).ok; } catch { return false; }
}

/** `withHand`: also load Google's hand model (an extra download), used only by the hand, wrist and elbow check. The hand's 21 points follow the body's 33. */
export async function loadPose(withHand = false): Promise<Pose> {
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
  let hl: RawLandmarker | null = null;
  if (withHand) {
    const handModel = abs(local ? `${LOCAL}/hand_landmarker.task` : HAND_MODEL_CDN);
    const mk = (delegate: 'GPU' | 'CPU') => mod.HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: handModel, delegate }, runningMode: 'VIDEO', numHands: 1 });
    try { hl = await mk('GPU'); } catch { hl = await mk('CPU'); }
  }
  let last = -1;
  return {
    hand: withHand,
    detect(video, tMs) {
      // The model needs strictly increasing timestamps.
      const t = tMs <= last ? last + 1 : tMs;
      last = t;
      const r = lm.detectForVideo(video, t);
      const pts = r.landmarks?.[0];
      const hand = hl ? hl.detectForVideo(video, t).landmarks?.[0] : undefined;
      if (!pts && !hand) return null;
      // A close-up of a hand often has no body in it: the body points are then "not seen" and only the hand is used.
      const body: Frame = pts ? pts.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 0 })) : Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 0 }));
      return hand ? [...body, ...hand.map((p) => ({ x: p.x, y: p.y, v: 1 }))] : body;
    },
    close() { try { lm.close(); } catch { /* already closed */ } try { hl?.close(); } catch { /* already closed */ } },
  };
}
