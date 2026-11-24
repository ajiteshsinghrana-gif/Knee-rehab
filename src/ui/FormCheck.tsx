// Patient side of the camera form check: consent, camera, a live set with rep count, and a plain result.
// The phone measures; it never says a movement is safe or correct and never changes the plan. Video stays on the phone unless the patient
// chooses to send the clip of a flagged set. See src/formcheck/ for the logic and README "Camera form check".
import { useEffect, useRef, useState } from 'react';
import { ExPicture } from './ExPicture';
import type { FormCheckLog, Lang, Patient, ProtocolPack } from '../types';
import { clockMs, getState, updatePatient } from '../store';
import { exerciseName, getExercise } from '../exercises/library';
import { currentExercises } from '../engine/plan';
import { speak, speakSupported } from '../voice/speak';
import { CONSENT_TEXT, consentText, reviewHours, validClip } from '../forms/model';
import { newLocalId, saveLocalVideo } from '../exercises/deviceVideos';
import { clipCloudReady, patientUploadClip } from '../sync/engine';
import { FormAnalyzer, type FormEvent } from '../formcheck/analyze';
import { BONES, FORM_CHECK, KINDS, formKindFor } from '../formcheck/config';
import { assess, attachClip, giveConsent, hasConsent, limitFor, newCheckLog, recordCheck, requestForClip, withdrawConsent, type Assessment } from '../formcheck/model';
import { loadPose, type Pose } from '../formcheck/pose';
import { VIEW_KEY, fcs } from '../formcheck/strings';

type Stage = 'intro' | 'camera' | 'live' | 'result';
interface Result { log: FormCheckLog; a: Assessment; requestId: string | null }

const pickMime = (): string => {
  const ok = (m: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m);
  return ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(ok) ?? '';
};

export function FormCheckScreen({ patient, pack, lang, exerciseId, onBack }: { patient: Patient; pack: ProtocolPack; lang: Lang; exerciseId: string | null; onBack: () => void }) {
  const F = (k: string, p?: Record<string, string | number>) => fcs(lang, k, p);
  const options = currentExercises(patient, pack).filter((id) => formKindFor(id));
  const [ex, setEx] = useState<string>(exerciseId && formKindFor(exerciseId) ? exerciseId : options[0] ?? '');
  const kind = formKindFor(ex);
  const [stage, setStage] = useState<Stage>('intro');
  const [agreed, setAgreed] = useState(hasConsent(patient));
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [reps, setReps] = useState(0);
  const [unseen, setUnseen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [getReady, setGetReady] = useState<number | null>(null);
  const [noticed, setNoticed] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [clip, setClip] = useState<Blob | null>(null);
  const [clipAgree, setClipAgree] = useState(false);
  const [clipState, setClipState] = useState<'idle' | 'sending' | 'cloud' | 'device' | 'deleted'>('idle');

  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const pose = useRef<Pose | null>(null);
  const analyzer = useRef<FormAnalyzer | null>(null);
  const raf = useRef(0);
  const lastT = useRef(0);
  const live = useRef(false);
  const startedAt = useRef(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recMime = useRef('');

  const stopCamera = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => () => { stopCamera(); pose.current?.close(); pose.current = null; try { rec.current?.stop(); } catch { /* not recording */ } }, []);

  const draw = (frame: ReturnType<Pose['detect']>) => {
    const c = canvas.current, v = video.current;
    if (!c || !v) return;
    if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (!frame) return;
    g.lineWidth = 4; g.strokeStyle = '#2ec4b6'; g.fillStyle = '#ffb703';
    for (const [a, b] of BONES) {
      const p = frame[a], q = frame[b];
      if (!p || !q || (p.v ?? 0) < FORM_CHECK.minVisibility || (q.v ?? 0) < FORM_CHECK.minVisibility) continue;
      g.beginPath(); g.moveTo(p.x * c.width, p.y * c.height); g.lineTo(q.x * c.width, q.y * c.height); g.stroke();
    }
  };

  const onEvents = (evs: FormEvent[]) => {
    for (const e of evs) {
      if (e.type === 'rep') setReps(e.n);
      else if (e.type === 'unseen') setUnseen(true);
      else if (e.type === 'seen') setUnseen(false);
      else if (e.type === 'fault') { setNoticed(`${F('fcNoticed')} ${F(`fault-${e.id}`)}`); setTimeout(() => setNoticed(''), 4000); }
      else if (e.type === 'pause') {
        setPaused(true);
        try { navigator.vibrate?.(300); } catch { /* not supported */ }
        if (speakSupported(lang)) speak(F('fcPause'), lang);
      }
    }
  };

  const loop = () => {
    const v = video.current, p = pose.current;
    if (v && p && v.readyState >= 2 && v.videoWidth) {
      const now = performance.now();
      if (now - lastT.current >= 66) { // about 15 frames a second
        lastT.current = now;
        const frame = p.detect(v, now);
        draw(frame);
        if (live.current && analyzer.current) {
          const evs = frame ? analyzer.current.push(frame, now, v.videoWidth / v.videoHeight) : analyzer.current.push([], now);
          onEvents(evs);
          if (now - startedAt.current > FORM_CHECK.maxSeconds * 1000) { void finish(); return; }
        }
      }
    }
    raf.current = requestAnimationFrame(loop);
  };

  const openCamera = async (face: 'user' | 'environment') => {
    setErr(''); setReady(false);
    stopCamera();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: face, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play(); }
    } catch { setErr(F('fcNoCamera')); return; }
    try {
      if (!pose.current) pose.current = await loadPose();
    } catch { stopCamera(); setErr(F('fcNoModel')); return; }
    setReady(true);
    raf.current = requestAnimationFrame(loop);
  };

  const start = async () => {
    if (!kind) return;
    if (!hasConsent(patient)) {
      const at = new Date(clockMs(getState())).toISOString();
      updatePatient(patient.id, (p) => giveConsent(p, patient.caregiverMode ? 'caregiver' : 'patient', at));
    }
    setStage('camera');
    await openCamera(facing);
  };
  const swap = async () => { const f = facing === 'user' ? 'environment' : 'user'; setFacing(f); await openCamera(f); };

  const beginSet = () => {
    if (!kind || !ready) return;
    setStage('live');
    setGetReady(FORM_CHECK.getReadySec);
  };
  // Count down so the patient can step back and get into position before anything is measured.
  useEffect(() => {
    if (getReady === null) return;
    if (getReady <= 0) { setGetReady(null); startSet(); return; }
    const id = setTimeout(() => setGetReady((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(id);
  }, [getReady]);

  const startSet = () => {
    if (!kind) return;
    const lim = limitFor(patient, ex);
    analyzer.current = new FormAnalyzer(kind, lim ? { max: lim.max, min: lim.min } : undefined);
    setReps(0); setUnseen(false); setPaused(false); setNoticed('');
    chunks.current = []; recMime.current = '';
    if (stream.current && typeof MediaRecorder !== 'undefined') {
      try {
        const mime = pickMime();
        const r = new MediaRecorder(stream.current, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 800_000 });
        r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
        r.start(1000);
        rec.current = r; recMime.current = r.mimeType || mime;
      } catch { rec.current = null; }
    }
    startedAt.current = performance.now();
    live.current = true;
  };

  const stopRecording = (): Promise<Blob | null> => new Promise((resolve) => {
    const r = rec.current;
    rec.current = null;
    if (!r || r.state === 'inactive') { resolve(null); return; }
    r.onstop = () => resolve(chunks.current.length ? new Blob(chunks.current, { type: recMime.current || 'video/webm' }) : null);
    try { r.stop(); } catch { resolve(null); }
  });

  const finish = async () => {
    if (!live.current || !analyzer.current || !kind) return;
    live.current = false;
    const summary = analyzer.current.finish();
    const blob = await stopRecording();
    stopCamera();
    const now = clockMs(getState());
    const iso = new Date(now).toISOString();
    const lim = limitFor(patient, ex);
    const log = newCheckLog({ id: `c${Date.now().toString(36)}`, date: getState().today, startedAt: now - Math.round(summary.seconds * 1000), endedAt: now, exerciseId: ex, summary, by: patient.caregiverMode ? 'caregiver' : 'patient', limit: lim });
    const cur = getState().patients.find((x) => x.id === patient.id) ?? patient;
    const out = recordCheck(cur, log, iso);
    updatePatient(patient.id, (q) => recordCheck(q, log, iso).patient);
    setResult({ log: out.patient.formChecks?.find((x) => x.id === log.id) ?? log, a: assess(cur, log), requestId: out.requestId });
    // The video stays in memory only so the patient can choose to send it. Nothing is uploaded unless they tick the consent box.
    setClip(blob ?? null);
    setStage('result');
  };

  const sendClip = async () => {
    if (!clip || !result) return;
    setClipState('sending'); setErr('');
    try {
      const mime = (clip.type || 'video/webm').split(';')[0];
      const bad = validClip(mime, clip.size);
      if (bad) { setErr(bad === 'size' ? fcs(lang, 'fcClipSize') : fcs(lang, 'fcClipType')); setClipState('idle'); return; }
      const iso = new Date(clockMs(getState())).toISOString();
      // No new item was raised for this set (the physio has one open): the video gets its own item.
      let id = result.requestId ?? '';
      if (!id) {
        const cur = getState().patients.find((x) => x.id === patient.id) ?? patient;
        const made = requestForClip(cur, result.log, result.a, iso);
        id = made.requestId;
        if (!id) { setClipState('idle'); return; }
        updatePatient(patient.id, (q) => requestForClip(q, result.log, result.a, iso).patient);
      }
      const path = clipCloudReady(patient) ? await patientUploadClip(patient, id, clip, mime) : null;
      if (path) { updatePatient(patient.id, (p) => attachClip(p, id, { where: 'cloud', ref: path, mime, size: clip.size, durationSec: null }, iso)); setClipState('cloud'); }
      else { const lid = newLocalId(); await saveLocalVideo(lid, clip); updatePatient(patient.id, (p) => attachClip(p, id, { where: 'device', ref: lid, mime, size: clip.size, durationSec: null }, iso)); setClipState('device'); }
      setClip(null);
    } catch (e) { setErr((e as Error).message); setClipState('idle'); }
  };

  const reset = () => { setStage('intro'); setResult(null); setClip(null); setClipAgree(false); setClipState('idle'); setReps(0); setReady(false); setErr(''); };
  const hours = reviewHours(pack);
  const consent = consentText(lang);

  if (!options.length && !kind) {
    return <main data-testid="formcheck"><button className="back" onClick={onBack}>← {F('fcHome')}</button><h2>{F('fcTitle')}</h2><p>{F('fcNoEx')}</p></main>;
  }

  if (stage === 'result' && result) {
    const { log, a } = result;
    return (
      <main data-testid="formcheck-result">
        <h2>{F('fcResult')}</h2>
        <div className="card exhead"><ExPicture src={getExercise(ex)?.picture} size={56} /><b>{exerciseName(ex, lang)}</b></div>
        <p>{log.repsCounted > 0 ? F('fcRepsDone', { n: log.repsCounted }) : F('fcNoReps')}</p>
        {a.unreliable ? <p className="hint">{F('fcUnreliable')}</p> : log.faults.length ? (
          <div className="card">
            <b>{F('fcHead')}</b>
            <ul className="exlist">{log.faults.map((f) => <li key={f.id}>{F('fcLine', { what: F(`fault-${f.id}`), n: f.reps.length, total: Math.max(log.repsCounted, f.reps.length) })}</li>)}</ul>
          </div>
        ) : <p>{F('fcNone')}</p>}
        {(a.raise || log.paused) && <p className="okline" data-testid="fc-told">{F('fcTold', { hours })}</p>}
        {a.raise && !clip && clipState === 'idle' && <p className="tiny">{F('fcToldNoClip')}</p>}
        {clip && clipState !== 'deleted' && (
          <div className="card" data-testid="fc-clip">
            <ul className="exlist">{consent.points.map((x) => <li key={x}>{x}</li>)}</ul>
            <small className="tiny">{CONSENT_TEXT[lang].draft}</small>
            <label className="caregivertoggle"><input type="checkbox" checked={clipAgree} onChange={(e) => setClipAgree(e.target.checked)} data-testid="fc-clip-consent" /><span><b>{CONSENT_TEXT[lang].agree}</b></span></label>
            <p className="tiny">{F('fcClipHint')}</p>
            <button className="big primary" disabled={!clipAgree || clipState === 'sending'} onClick={() => void sendClip()}>{clipState === 'sending' ? F('fcSending') : F('fcSendClip')}</button>
            <button className="link" onClick={() => { setClip(null); setClipState('deleted'); }}>{F('fcDiscard')}</button>
          </div>
        )}
        {clipState === 'cloud' && <p className="okline">{F('fcClipSent')}</p>}
        {clipState === 'device' && <p className="okline">{F('fcClipLocal')}</p>}
        {clipState === 'deleted' && <p className="tiny">{F('fcDiscarded')}</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <button className="big primary" onClick={reset}>{F('fcAgain')}</button>
        <button className="big secondary" onClick={onBack}>{F('fcHome')}</button>
      </main>
    );
  }

  if (stage === 'camera' || stage === 'live') {
    return (
      <main data-testid="formcheck-live" data-stage={stage}>
        <div className="fc-stage" style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', background: '#000', borderRadius: 12, overflow: 'hidden' }}>
          <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: facing === 'user' ? 'scaleX(-1)' : undefined }} aria-label={F('fcTitle')} />
          <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: facing === 'user' ? 'scaleX(-1)' : undefined }} aria-hidden="true" />
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        {!err && !ready && <p>{F('fcLoading')}</p>}
        {stage === 'live' && getReady !== null && <p className="gs-count" role="timer" aria-live="polite">{F('fcGetReady', { n: getReady })}</p>}
        {stage === 'live' && getReady === null && <p className="gs-count" aria-live="polite">{F('fcReps', { n: reps })}</p>}
        {stage === 'live' && unseen && <p className="hint" role="status">{F('fcUnseen')}</p>}
        {stage === 'live' && noticed && <p className="gs-msg" role="status">{noticed}</p>}
        {paused && <div className="red" role="alert" data-testid="fc-pause"><strong>{F('fcPause')}</strong></div>}
        {stage === 'camera' && (
          <>
            <p className="hint">{F(kind ? VIEW_KEY[KINDS[kind].view] : 'fcViewFront')}</p>
            <button className="big primary" disabled={!ready} onClick={beginSet}>{F('fcBegin')}</button>
            <button className="link" onClick={() => void swap()}>{F('fcSwap')}</button>
            <button className="link" onClick={() => { stopCamera(); setStage('intro'); }}>← {F('fcTitle')}</button>
          </>
        )}
        {stage === 'live' && <button className="big primary" onClick={() => (getReady !== null ? (setGetReady(null), setStage('camera')) : void finish())}>{getReady !== null ? F('fcCancel') : F('fcFinish')}</button>}
      </main>
    );
  }

  return (
    <main data-testid="formcheck">
      <button className="back" onClick={onBack}>← {F('fcHome')}</button>
      <h2>{F('fcTitle')}</h2>
      <p className="hint">{F('fcNot')}</p>
      <p className="tiny">{F('fcNoEmergency')}</p>
      {options.length > 1 && !exerciseId ? (
        <label className="field"><b>{F('fcPickEx')}</b>
          <select value={ex} onChange={(e) => setEx(e.target.value)}>{options.map((id) => <option key={id} value={id}>{exerciseName(id, lang)}</option>)}</select>
        </label>
      ) : <div className="card exhead"><ExPicture src={getExercise(ex)?.picture} size={56} /><b>{exerciseName(ex, lang)}</b></div>}
      {kind && <p>{F(VIEW_KEY[KINDS[kind].view])}</p>}
      {!hasConsent(patient) ? (
        <div className="card" data-testid="fc-consent">
          <h3>{F('fcConsentTitle')}</h3>
          <ul className="exlist">{['fcConsent1', 'fcConsent2', 'fcConsent3', 'fcConsent4'].map((k) => <li key={k}>{F(k)}</li>)}</ul>
          <small className="tiny">{F('fcConsentDraft')}</small>
          <label className="caregivertoggle"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="fc-consent-check" /><span><b>{F('fcConsentAgree')}</b></span></label>
        </div>
      ) : <button className="link" onClick={() => { setAgreed(false); updatePatient(patient.id, withdrawConsent); }}>{F('fcWithdraw')}</button>}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="big primary" data-testid="fc-start" disabled={!kind || (!hasConsent(patient) && !agreed)} onClick={() => void start()}>{F('fcStart')}</button>
    </main>
  );
}
