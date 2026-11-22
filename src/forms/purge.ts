// Deleting clips: on a schedule (retention), when the patient or physio asks, or when the other side already deleted one.
// A cloud clip is only marked gone once the server confirms it; if it cannot be reached the clip is kept and tried again next time.
import type { FormRequest, Patient } from '../types';
import { clockMs, getState, updatePatient } from '../store';
import { deleteLocalVideo } from '../exercises/deviceVideos';
import { removeCloudClip } from '../sync/engine';
import { deleteClip, expiredClips } from './model';

/** Delete one request's clip file. True when it is gone. */
export async function removeClipFile(p: Patient, r: FormRequest): Promise<boolean> {
  if (!r.clip) return true;
  if (r.clip.where === 'device') { await deleteLocalVideo(r.clip.ref); return true; }
  return removeCloudClip(p, r.clip.ref);
}
/** Delete the clip now (button on either side). */
export async function deleteClipNow(p: Patient, id: string): Promise<boolean> {
  const r = (p.formRequests ?? []).find((x) => x.id === id);
  if (!r) return false;
  if (!(await removeClipFile(p, r))) return false;
  const at = new Date(clockMs(getState())).toISOString();
  updatePatient(p.id, (q) => deleteClip(q, id, at));
  return true;
}
/** Remove every clip whose delete-by date has come. Safe to call often. */
export async function purgeExpired(p: Patient): Promise<number> {
  let n = 0;
  for (const r of expiredClips(p, getState().today)) { if (await deleteClipNow(p, r.id)) n++; }
  return n;
}
