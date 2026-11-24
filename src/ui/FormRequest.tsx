// Patient side of a form-check request: consent, record or choose a short video, add a note, send. Then "My videos" with the physio's replies.
// The video is sent only after the patient ticks the consent. It never carries a warning sign and never changes the plan or tier.
import { useEffect, useState } from 'react';
import { ExPicture } from './ExPicture';
import type { Lang, Patient, ProtocolPack } from '../types';
import { t } from '../i18n';
import { clockMs, getState, updatePatient } from '../store';
import { exerciseName, getExercise } from '../exercises/library';
import { currentExercises } from '../engine/plan';
import { CONSENT_TEXT, addFormRequest, consentText, cueText, markReplySeen, newFormRequest, reviewHours, validClip } from '../forms/model';
import { fmtSize, fs } from '../forms/strings';
import { newLocalId, saveLocalVideo, loadLocalVideo } from '../exercises/deviceVideos';
import { clipCloudReady, patientUploadClip } from '../sync/engine';
import { deleteClipNow, purgeExpired } from '../forms/purge';
import { fcs } from '../formcheck/strings';

const newId = () => 'f' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, '0')).join('');

export function FormRequestScreen({ patient, pack, lang, exerciseId, onBack }: { patient: Patient; pack: ProtocolPack; lang: Lang; exerciseId: string | null; onBack: () => void }) {
  const F = (k: string, p?: Record<string, string | number>) => fs(lang, k, p);
  const [view, setView] = useState<'new' | 'list'>(exerciseId ? 'new' : 'list');
  const [ex, setEx] = useState<string>(exerciseId ?? currentExercises(patient, pack)[0] ?? '');
  const [agreed, setAgreed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<'cloud' | 'device' | 'note' | null>(null);
  const hours = reviewHours(pack);
  const consent = consentText(lang);

  useEffect(() => { void purgeExpired(patient); }, []);

  const pick = (f: File | null) => {
    setErr('');
    if (!f) { setFile(null); return; }
    const bad = validClip(f.type || 'video/mp4', f.size);
    if (bad === 'size') { setErr(F('fTooBig')); return; }
    if (bad) { setErr(F('fBadType')); return; }
    setFile(f);
  };
  const send = async (withClip = true) => {
    setBusy(true); setErr('');
    try {
      const id = newId();
      const nowIso = new Date(clockMs(getState())).toISOString();
      let clip = null as null | { where: 'device' | 'cloud'; ref: string; mime: string; size: number; durationSec: number | null };
      let how: 'cloud' | 'device' | 'note' = 'note';
      if (file && withClip) {
        const mime = (file.type || 'video/mp4').split(';')[0];
        const path = clipCloudReady(patient) ? await patientUploadClip(patient, id, file, mime) : null;
        if (path) { clip = { where: 'cloud', ref: path, mime, size: file.size, durationSec: null }; how = 'cloud'; }
        else { const lid = newLocalId(); await saveLocalVideo(lid, file); clip = { where: 'device', ref: lid, mime, size: file.size, durationSec: null }; how = 'device'; }
      }
      const req = newFormRequest({ id, exerciseId: ex, at: nowIso, note, by: patient.caregiverMode ? 'caregiver' : 'patient', clip, via: 'app' });
      updatePatient(patient.id, (p) => addFormRequest(p, req));
      setDone(how === 'note' ? 'note' : how); setFile(null); setNote(''); setAgreed(false);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const mine = [...(patient.formRequests ?? [])].reverse();
  const unseen = mine.filter((r) => r.reply && !r.replySeenAt);
  useEffect(() => {
    if (view !== 'list' || !unseen.length) return;
    const at = new Date(clockMs(getState())).toISOString();
    for (const r of unseen) updatePatient(patient.id, (p) => markReplySeen(p, r.id, at));
  }, [view]);

  if (view === 'list') {
    return (
      <main data-testid="my-videos">
        <button className="back" onClick={onBack}>← {F('fBack')}</button>
        <h2>{F('fMine')}</h2>
        <button className="big primary" data-testid="new-request" onClick={() => setView('new')}>{F('fTitle')}</button>
        {mine.length === 0 && <p>{F('fNone')}</p>}
        {mine.map((r) => (
          <div className="card" key={r.id} data-testid="form-item">
            <b>{exerciseName(r.exerciseId, lang)}</b> <small>{r.at.slice(0, 10)}</small>
            {r.note && <p>{r.note}</p>}
            {r.auto && <p className="tiny">{fcs(lang, 'fcAuto')}</p>}
            {r.reply ? (
              <div className="notice-card">
                <b>{F('fReply')}</b>
                {r.reply.points.length > 0 && <ul className="exlist">{r.reply.points.map((c) => <li key={c}>{cueText(c, lang)}</li>)}</ul>}
                {r.reply.text && <p>{r.reply.text}</p>}
              </div>
            ) : <p className="tiny">{F('fWaiting', { hours })}</p>}
            {r.clip ? (
              <>
                <ClipPlayer patient={patient} id={r.id} />
                {r.clip.where === 'device' && <p className="tiny">{F('fOnPhone')}</p>}
                <p className="tiny">{F('fKeeps', { date: r.clip.deleteAfter })}</p>
                <button className="btn" onClick={() => void deleteClipNow(patient, r.id)}>{F('fDelete')}</button>
              </>
            ) : r.clipGone ? <p className="tiny">{F('fGone')}</p> : null}
          </div>
        ))}
      </main>
    );
  }

  if (done) {
    return (
      <main data-testid="form-sent">
        <p className="okline">{done === 'device' ? F('fSentDevice') : F(done === 'cloud' ? 'fSentCloud' : 'fSentNote', { hours })}</p>
        <button className="big primary" onClick={() => { setDone(null); setView('list'); }}>{F('fMine')}</button>
        <button className="big secondary" onClick={onBack}>{F('fBack')}</button>
      </main>
    );
  }

  return (
    <main data-testid="form-new">
      <button className="back" onClick={onBack}>← {F('fBack')}</button>
      <h2>{F('fTitle')}</h2>
      <p className="hint">{F('fNoEmergency')}</p>
      {!exerciseId && (
        <label className="field"><b>{F('fPick')}</b>
          <select value={ex} onChange={(e) => setEx(e.target.value)}>{currentExercises(patient, pack).map((id) => <option key={id} value={id}>{exerciseName(id, lang)}</option>)}</select>
        </label>
      )}
      {exerciseId && <div className="card exhead"><ExPicture src={getExercise(ex)?.picture} size={56} /><b>{exerciseName(ex, lang)}</b></div>}
      <label className="field"><b>{F('fNoteLabel')}</b>
        <textarea className="vtext" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="card" data-testid="consent">
        <h3>{consent.title}</h3>
        <ul className="exlist">{consent.points.map((x) => <li key={x}>{x}</li>)}</ul>
        <small className="tiny">{CONSENT_TEXT[lang].draft}</small>
        <label className="caregivertoggle"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="consent-check" /><span><b>{CONSENT_TEXT[lang].agree}</b></span></label>
      </div>
      <label className="filebtn">🎥 {F('fRecord')}
        <input type="file" accept="video/*" capture="environment" data-testid="clip-input" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>
      <p className="tiny">{F('fRecordHint')}</p>
      {file && <p className="okline">{F('fReady', { size: fmtSize(file.size) })}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="big primary" data-testid="send-clip" disabled={busy || !file || !agreed} onClick={() => void send(true)}>{busy ? F('fSending') : F('fSend')}</button>
      <button className="link" disabled={busy || !note.trim()} onClick={() => void send(false)}>{F('fSendNote')}</button>
    </main>
  );
}

/** Plays a clip stored on this phone. */
function ClipPlayer({ patient, id }: { patient: Patient; id: string }) {
  const r = (patient.formRequests ?? []).find((x) => x.id === id);
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    if (r?.clip?.where === 'device') void loadLocalVideo(r.clip.ref).then((b) => { if (b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [r?.clip?.ref]);
  if (!url) return null;
  return <video src={url} controls playsInline preload="metadata" style={{ width: '100%', borderRadius: 12 }} aria-label={t('en', 'appName')} />;
}
