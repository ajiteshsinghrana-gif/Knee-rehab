import { useEffect, useMemo, useRef, useState } from 'react';
import { ExPicture } from './ExPicture';
import type { ExerciseDemo } from '../types';
import { getPack } from '../engine/packs';
import { exerciseName, LIBRARY } from '../exercises/library';
import { checkLink, checkVideoFile, patientExerciseIds } from '../exercises/demos';
import { deleteLocalVideo, newLocalId, saveLocalVideo } from '../exercises/deviceVideos';
import { physioCanUploadToCloud, physioDeleteDemo, physioUploadDemo } from '../sync/engine';
import { getState, setExerciseDemo } from '../store';
import { DemoPlayer } from './Demo';

/** What a demo is, in one short phrase for the physio. */
function describe(d: ExerciseDemo | undefined): string {
  if (!d) return 'No video yet';
  if (d.kind === 'link') return `Link: ${new URL(d.url).hostname}`;
  const size = d.size < 1048576 ? `${Math.max(1, Math.round(d.size / 1024))} KB` : `${(d.size / 1048576).toFixed(1)} MB`;
  return d.kind === 'video' ? `Uploaded video: ${d.name} (${size}), patients can watch it` : `Video on this device only: ${d.name} (${size}), patients cannot see it`;
}

/** Remove whatever stored bytes belong to a demo that is being replaced or removed. */
async function dispose(d: ExerciseDemo | undefined): Promise<void> {
  if (!d) return;
  if (d.kind === 'video') await physioDeleteDemo(d.url);
  else if (d.kind === 'local') await deleteLocalVideo(d.id);
}

function Row({ id, demo, cloud, onChanged }: { id: string; demo: ExerciseDemo | undefined; cloud: boolean | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [mode, setMode] = useState<'link' | 'upload'>('link');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const ex = LIBRARY.find((e) => e.id === id);
  const name = exerciseName(id, 'en');

  const close = () => { setOpen(false); setUrl(''); setFile(null); setErr(''); };
  const save = async () => {
    setErr(''); setOk('');
    setBusy(true);
    try {
      const prev = demo;
      const addedAt = new Date().toISOString();
      let next: ExerciseDemo;
      let note = '';
      if (mode === 'link') {
        const c = checkLink(url);
        if (!c.ok) { setErr(c.error); return; }
        next = { kind: 'link', url: c.url, addedAt };
      } else {
        if (!file) { setErr('Choose a video file first.'); return; }
        const v = checkVideoFile(file);
        if (!v.ok) { setErr(v.error); return; }
        const up = await physioUploadDemo(file, v.mime, v.ext); // null = no cloud right now; throws if the cloud refused
        if (up) next = { kind: 'video', url: up.url, name: file.name.slice(0, 200), mime: v.mime, size: file.size, addedAt };
        else {
          const lid = newLocalId();
          await saveLocalVideo(lid, file);
          next = { kind: 'local', id: lid, name: file.name.slice(0, 200), mime: v.mime, size: file.size, addedAt };
          note = ' It is saved on this device only, so patients cannot see it yet. Sign in to the cloud and upload it again to share it.';
        }
      }
      setExerciseDemo(id, next);
      await dispose(prev);
      setOk(`Saved for ${name}.${note}`);
      close();
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    setErr(''); setOk('');
    try { const prev = demo; setExerciseDemo(id, null); await dispose(prev); setPreview(false); setOk(`Removed the video for ${name}.`); onChanged(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <li className="demorow" data-ex={id}>
      <ExPicture src={ex?.picture} size={44} />
      <div>
        <b>{name}</b>
        <span className={`demostatus ${demo ? 'has' : ''}`}>{describe(demo)}</span>
        {err && !open && <span className="err" role="alert">{err}</span>}
        {ok && <span className="demostatus has" role="status">{ok}</span>}
      </div>
      <div className="btnrow" style={{ margin: 0 }}>
        {demo && <button type="button" className="btn" onClick={() => setPreview(!preview)} aria-expanded={preview}>{preview ? 'Hide' : 'Preview'}</button>}
        <button type="button" className="btn" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open}>{demo ? 'Replace' : 'Add video or link'}</button>
        {demo && <button type="button" className="btn" onClick={() => void remove()}>Remove</button>}
      </div>
      {preview && demo && <div className="demoedit demoprev"><DemoPlayer demo={demo} lang="en" onClose={() => setPreview(false)} /></div>}
      {open && (
        <div className="demoedit">
          <div className="demochoice" role="radiogroup" aria-label="Type of demonstration">
            <label><input type="radio" name={`m-${id}`} checked={mode === 'link'} onChange={() => setMode('link')} /> Paste a link</label>
            <label><input type="radio" name={`m-${id}`} checked={mode === 'upload'} onChange={() => setMode('upload')} /> Upload a video</label>
          </div>
          {mode === 'link' ? (
            <label>Link to the video (YouTube plays inside the app; other links open in the browser)
              <input type="url" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={`Link to the video for ${name}`} />
            </label>
          ) : (
            <>
              <label>Video file (MP4, WebM or MOV, up to 50 MB)
                <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label={`Video file for ${name}`} />
              </label>
              <p className="tiny" role="note">
                {cloud === null ? 'Checking where uploads go…' : cloud
                  ? 'This will be uploaded to your clinic’s cloud storage so patients can watch it on their phones. Anyone with its private address can play it.'
                  : 'You are not signed in to the cloud, so this video will be kept on this device only. Patients will not see it. To share it with patients, sign in first, or paste a link instead.'}
              </p>
            </>
          )}
          <p className="demowarn" role="note">Teaching videos only. Never upload a video that shows a patient.</p>
          {err && <p className="err" role="alert">{err}</p>}
          <div className="btnrow">
            <button type="button" className="btn primary" disabled={busy || (mode === 'link' ? !url.trim() : !file)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn" disabled={busy} onClick={close}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Physio dashboard: attach a link or a video of the ideal way to do each exercise (Phase 7.2). */
export function ExerciseVideos({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  const [cloud, setCloud] = useState<boolean | null>(null);
  useEffect(() => { let live = true; void physioCanUploadToCloud().then((c) => { if (live) setCloud(c); }).catch(() => { if (live) setCloud(false); }); return () => { live = false; }; }, []);
  const st = getState();
  const demos = st.exerciseDemos ?? {};
  const mine = useMemo(() => {
    const s = new Set<string>();
    for (const p of st.patients) { try { for (const id of patientExerciseIds(p, getPack(p.packId).phases.flatMap((x) => x.exercises))) s.add(id); } catch { /* unknown condition */ } }
    return s;
  }, [st.patients]);
  void tick;
  const match = (id: string) => exerciseName(id, 'en').toLowerCase().includes(q.trim().toLowerCase());
  const all = LIBRARY.map((e) => e.id).filter(match).sort((a, b) => exerciseName(a, 'en').localeCompare(exerciseName(b, 'en')));
  const used = all.filter((id) => mine.has(id));
  const others = all.filter((id) => !mine.has(id));
  const withVideo = Object.keys(demos).length;
  const list = (ids: string[]) => <ul className="planlist" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{ids.map((id) => <Row key={id} id={id} demo={demos[id]} cloud={cloud} onChanged={() => setTick((n) => n + 1)} />)}</ul>;
  return (
    <section className="card demos" data-testid="exercise-videos">
      <div className="btnrow" style={{ justifyContent: 'space-between', alignItems: 'center', margin: 0 }}>
        <h2 style={{ margin: 0 }}>Exercise videos</h2>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      <p className="tiny">Show patients the ideal way to do each exercise. Attach a link (YouTube plays inside the app) or upload a short video. Patients see a “Watch how to do it” button on that exercise, in the exercise list and in their daily check-in. This is teaching material: it never changes a plan or an alert. {withVideo} of {LIBRARY.length} exercises have one.</p>
      <input type="search" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search exercises" />
      {used.length > 0 && <><h3>Exercises your patients do ({used.length})</h3>{list(used)}</>}
      {others.length > 0 && <details open={used.length === 0 || q.trim() !== ''}><summary><b>Other exercises in the library ({others.length})</b></summary>{list(others)}</details>}
      {all.length === 0 && <p className="tiny">No exercise matches “{q}”.</p>}
    </section>
  );
}
