// The camera check (camera check safety round).
//   CameraSet: setup check (live prompts), a 5 second get-ready, the set with rep count and cues, recording of at most 30 seconds.
//              Shared by the patient's screen and the physio's pilot screen (Pilot.tsx).
//   FormCheckScreen: the patient's side. Off until the physio switches it on. Per exercise it offers what the camera can honestly do:
//              check form (own rules, each tested), count reps (borrowed check, no flags) or record a video for the physio.
// The phone measures; it never says a movement is correct, good or safe, and it never changes a plan or a tier.
// Video stays on the phone unless the patient previews it and ticks consent for that clip. See src/formcheck/ and README.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExPicture } from './ExPicture';
import type { FormCheckLog, Lang, Patient, ProtocolPack } from '../types';
import { clockMs, getState, updatePatient } from '../store';
import { exerciseName, getExercise } from '../exercises/library';
import { currentExercises } from '../engine/plan';
import { t } from '../i18n';
import { speak, speakSupported } from '../voice/speak';
import { CONSENT_TEXT, FORM_CONFIG, consentText, reviewHours, validClip } from '../forms/model';
import { newLocalId, saveLocalVideo } from '../exercises/deviceVideos';
import { clipCloudReady, patientUploadClip } from '../sync/engine';
import { FormAnalyzer, type FormEvent, type FormSummary } from '../formcheck/analyze';
import { ANGLES, BONES, FORM_CHECK, HAND, HAND_BONES, HAND_KINDS, KINDS, SETUP, VARIANTS, checkMode, formKindFor, isFrontView, type FormKind } from '../formcheck/config';
import { assess, attachClip, cameraOn, carerOf, giveConsent, hasConsent, limitFor, newCheckLog, recordCheck, requestForClip, setAfterAnswers, withdrawConsent, type Assessment } from '../formcheck/model';
import { loadPose, type Pose } from '../formcheck/pose';
import { ZOOM, clampZoom, cropFor, toFullFrame } from '../formcheck/zoom';
import { lumaOf, setupHint, type SetupHint } from '../formcheck/setup';
import { COUNT_KEYS, VIEW_KEY, fcs } from '../formcheck/strings';
import { howTo } from '../formcheck/howto';
import { repInfo, repRule, stageStrip } from '../formcheck/repinfo';
import { hasPhone, telHref } from '../contact';

const pickMime = (): string => {
  const ok = (m: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m);
  return ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(ok) ?? '';
};

/** A small read-aloud button. Stops when the screen closes. */
export function Speak({ text, lang }: { text: string; lang: Lang }) {
  const [on, setOn] = useState(false);
  const stop = useRef<null | (() => void)>(null);
  useEffect(() => () => { stop.current?.(); }, []);
  if (!speakSupported(lang)) return null;
  return (
    <button type="button" className="readaloud icon" aria-pressed={on} aria-label={t(lang, on ? 'stopReading' : 'readAloud')}
      onClick={() => { if (on) { stop.current?.(); setOn(false); return; } setOn(true); stop.current = speak(text, lang, () => setOn(false)); }}>🔊</button>
  );
}

export interface SetOutcome {
  summary: FormSummary;
  clip: Blob | null;
  /** Length of the clip in seconds (at most FORM_CONFIG.maxClipSec). */
  clipSec: number;
  /** How the set ended: the patient tapped Finish (or time ran out), a stumble, or a limit the physio set. */
  stop: 'finish' | 'stumble' | 'limit';
}

/** Start, middle and end pictures with a caption each, and in plain words why that is a full rep. */
export function RepStages({ kind, lang }: { kind: FormKind; lang: Lang }) {
  const F = (k: string) => fcs(lang, k);
  const info = repInfo(lang, kind), strip = stageStrip(kind);
  const names = ['fcStageStart', 'fcStageMid', 'fcStageEnd'];
  return (
    <div className="fc-stages" data-testid="fc-stages">
      <h4>{F('fcWhyTitle')}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {info.stages.map((cap, i) => (
          <figure key={i} style={{ margin: 0, textAlign: 'center' }}>
            {strip && <div role="img" aria-label={`${F(names[i])}: ${cap}`} style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 10, backgroundColor: '#d7f0ee', backgroundImage: `url(${strip})`, backgroundSize: '300% 100%', backgroundPosition: `${i * 50}% 0` }} />}
            <figcaption className="tiny"><b>{i + 1}. {F(names[i])}</b><br />{cap}</figcaption>
          </figure>
        ))}
      </div>
      <p>{repRule(lang, kind)}</p>
    </div>
  );
}

/** What to do: the starting position, then the movement. `steps` adds the four numbered steps (camera, green frame, count-down, move slowly). */
export function HowTo({ kind, lang, steps, stages }: { kind: FormKind; lang: Lang; steps?: boolean; stages?: boolean }) {
  const F = (k: string) => fcs(lang, k);
  const h = howTo(lang, kind);
  return (
    <div className="card fc-howto" data-testid="fc-howto">
      {steps && <><h3>{F('fcHowTitle')}</h3><ol className="exlist" style={{ listStyle: 'none', paddingLeft: 0 }}>{['fcHow1', 'fcHow2', 'fcHow3', 'fcHow4'].map((k) => <li key={k}>{F(k)}</li>)}</ol></>}
      <p><b>{F('fcStartLbl')}:</b> {h.start}</p>
      <p><b>{F('fcMoveLbl')}:</b> {h.move}</p>
      {stages && <RepStages kind={kind} lang={lang} />}
    </div>
  );
}

/**
 * One set with the camera. `countOnly`: reps only, nothing judged. `blind` (pilot mode): the rep count and cues are hidden during
 * the set, so the observer's own verdict is not led by the phone.
 */
export function CameraSet({ kind, lang, limit, tempo, countOnly, blind, trace, exerciseId, onDone, onCancel, onTooSlow }: {
  kind: FormKind; /** Shown as a small demo in the corner of the camera view. */ exerciseId?: string; lang: Lang; limit?: { max?: number; min?: number }; tempo?: number; countOnly: boolean; blind?: boolean; trace?: boolean;
  /** The phone is too slow to measure, or the camera or model could not start: offer a video for the physio instead. */
  onDone: (o: SetOutcome) => void; onCancel: () => void; onTooSlow?: () => void;
}) {
  const F = (k: string, p?: Record<string, string | number>) => fcs(lang, k, p);
  const [phase, setPhase] = useState<'setup' | 'countdown' | 'live'>('setup');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [hint, setHint] = useState<SetupHint>('fcSetStepBack');
  const [okRun, setOkRun] = useState(0);
  const [reps, setReps] = useState(0);
  const [unseen, setUnseen] = useState(false);
  const [getReady, setGetReady] = useState<number | null>(null);
  const [cue, setCue] = useState('');
  /** Red flags hit in the last few seconds, each named. The set and the camera keep running while they show. */
  const [flags, setFlags] = useState<{ id: string; text: string }[]>([]);
  /** Zoom: the camera's own where it has one (hardware), otherwise a digital crop. Locked once the set starts. */
  const [zoom, setZoom] = useState(1);
  const [hwZoom, setHwZoom] = useState<{ min: number; max: number; step: number } | null>(null);
  /** The ultra-wide lens of this camera (a separate camera on some phones and iPads), when the browser names one. It is the 0.5x. */
  const [wideId, setWideId] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [noWide, setNoWide] = useState(false);
  const digitalRef = useRef(1);
  const cropCanvas = useRef<HTMLCanvasElement | null>(null);
  const changeZoom = (raw: number) => {
    if (phaseRef.current === 'live') return;
    if (hwZoom) {
      const z = Math.min(hwZoom.max, Math.max(hwZoom.min, raw));
      setZoom(z);
      void stream.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ zoom: z } as unknown as MediaTrackConstraintSet] }).catch(() => { /* the camera refused */ });
    } else { const z = clampZoom(raw); setZoom(z); digitalRef.current = z; }
  };
  const flagTimers = useRef(new Map<string, number>());
  const showFlag = (id: string, text: string) => {
    setFlags((cur) => [...cur.filter((f) => f.id !== id), { id, text }]);
    window.clearTimeout(flagTimers.current.get(id));
    flagTimers.current.set(id, window.setTimeout(() => setFlags((cur) => cur.filter((f) => f.id !== id)), 7000));
  };
  const clearFlags = () => { flagTimers.current.forEach((t) => window.clearTimeout(t)); flagTimers.current.clear(); setFlags([]); };

  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const small = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pose = useRef<Pose | null>(null);
  const analyzer = useRef<FormAnalyzer | null>(null);
  const raf = useRef(0);
  const lastT = useRef(0);
  const live = useRef(false);
  const phaseRef = useRef<'setup' | 'countdown' | 'live'>('setup');
  const startedAt = useRef(0);
  const rec = useRef<MediaRecorder | null>(null);
  const recStop = useRef<Promise<void> | null>(null);
  const recTimer = useRef(0);
  const chunks = useRef<Blob[]>([]);
  const recMime = useRef('');
  const luma = useRef<number | null>(null);
  const fps = useRef({ t0: 0, n: 0, warned: false });
  const okRunRef = useRef(0);
  const lostRef = useRef(0);
  /** Nothing counted after a while: why (a body point not seen, or the movement was small) and how close it got. */
  const [help, setHelp] = useState<{ h: string; pct: number } | null>(null);
  const helpRef = useRef<{ h: string; pct: number } | null>(null);
  /** Set when the patient cancels a count-down, so it does not restart by itself until they leave and re-enter the position. */
  const autoOff = useRef(false);
  const cueTimer = useRef(0);
  /** Cues waiting to be shown and spoken, one at a time. */
  const cueQueue = useRef<string[]>([]);
  const cueBusy = useRef(false);
  const cueStop = useRef<null | (() => void)>(null);
  /** Show and speak the next cue; each stays at least 3 seconds and until it has been spoken. */
  const nextCue = () => {
    const text = cueQueue.current.shift();
    if (!text) { cueBusy.current = false; setCue(''); return; }
    cueBusy.current = true;
    setCue(text);
    let spoken = !speakSupported(lang), shown = false, moved = false;
    const done = () => { if (spoken && shown && !moved) { moved = true; nextCue(); } };
    if (!spoken) cueStop.current = speak(text, lang, () => { spoken = true; done(); });
    cueTimer.current = window.setTimeout(() => { shown = true; if (!spoken) window.setTimeout(() => { spoken = true; done(); }, 4000); done(); }, 3000);
  };
  const pushCue = (text: string) => {
    // One at a time: the same cue is not queued twice, and at most two wait (the newest ones).
    if (cueQueue.current.includes(text)) return;
    cueQueue.current = [...cueQueue.current, text].slice(-2);
    if (!cueBusy.current) nextCue();
  };
  const clearCues = () => { clearTimeout(cueTimer.current); cueQueue.current = []; cueBusy.current = false; try { cueStop.current?.(); } catch { /* not speaking */ } setCue(''); };

  const stopCamera = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((x) => x.stop());
    stream.current = null;
  };
  useEffect(() => () => {
    stopCamera(); pose.current?.close(); pose.current = null; clearTimeout(recTimer.current); clearTimeout(cueTimer.current); try { cueStop.current?.(); } catch { /* not speaking */ }
    try { rec.current?.stop(); } catch { /* not recording */ }
  }, []);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { void openCamera(facing); }, []);

  const draw = (frame: ReturnType<Pose['detect']>) => {
    const c = canvas.current, v = video.current;
    if (!c || !v) return;
    if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (!frame) return;
    g.lineWidth = 4; g.strokeStyle = '#2ec4b6';
    for (const [a, b] of BONES) {
      const p = frame[a], q = frame[b];
      if (!p || !q || (p.v ?? 0) < FORM_CHECK.minVisibility || (q.v ?? 0) < FORM_CHECK.minVisibility) continue;
      g.beginPath(); g.moveTo(p.x * c.width, p.y * c.height); g.lineTo(q.x * c.width, q.y * c.height); g.stroke();
    }
    if (frame.length > HAND) {
      for (const [a, b] of HAND_BONES) {
        const p = frame[HAND + a], q = frame[HAND + b];
        if (!p || !q) continue;
        g.beginPath(); g.moveTo(p.x * c.width, p.y * c.height); g.lineTo(q.x * c.width, q.y * c.height); g.stroke();
      }
    }
  };
  /** Brightness from a tiny copy of the picture, every few frames. */
  const readLuma = (v: HTMLVideoElement) => {
    try {
      const c = small.current ?? (small.current = document.createElement('canvas'));
      c.width = 32; c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
      if (!g) return;
      g.drawImage(v, 0, 0, 32, 24);
      luma.current = lumaOf(g.getImageData(0, 0, 32, 24).data);
    } catch { luma.current = null; }
  };

  const onEvents = (evs: FormEvent[]) => {
    for (const e of evs) {
      if (e.type === 'rep') setReps(e.n);
      else if (e.type === 'unseen') setUnseen(true);
      else if (e.type === 'seen') setUnseen(false);
      else if (e.type === 'fault' && !blind) {
        pushCue(F(`fault-${e.id}`));
      } else if (e.type === 'pause') {
        // A red flag: say exactly what was hit, and keep the set and the camera check running. The physio is still told when the set ends.
        const text = `${F('fcRedFlag')} ${F(`fault-${e.id}`)}`;
        showFlag(e.id, text);
        try { navigator.vibrate?.(300); } catch { /* not supported */ }
        if (speakSupported(lang)) speak(text, lang);
      }
    }
  };

  const loop = () => {
    const v = video.current, p = pose.current;
    if (v && p && v.readyState >= 2 && v.videoWidth) {
      const now = performance.now();
      if (now - lastT.current >= 66) { // about 15 frames a second
        lastT.current = now;
        // Digital zoom: the model is given only the middle part of the picture, and the skeleton is drawn back in the whole picture.
        let src: HTMLVideoElement | HTMLCanvasElement = v;
        let crop: ReturnType<typeof cropFor> | null = null;
        if (digitalRef.current > 1.01) {
          crop = cropFor(digitalRef.current);
          const cc = cropCanvas.current ?? (cropCanvas.current = document.createElement('canvas'));
          const sw = Math.round(v.videoWidth * crop.w), sh = Math.round(v.videoHeight * crop.h);
          if (cc.width !== sw || cc.height !== sh) { cc.width = sw; cc.height = sh; }
          cc.getContext('2d')?.drawImage(v, v.videoWidth * crop.x, v.videoHeight * crop.y, sw, sh, 0, 0, sw, sh);
          src = cc;
        }
        const frame = p.detect(src, now);
        draw(frame && crop ? toFullFrame(frame, crop) : frame);
        if (phaseRef.current === 'countdown') {
          // Stepped out of position during the count-down: go back and ask again.
          if (setupHint(kind, frame, luma.current) === 'fcSetOk') lostRef.current = 0;
          else if (++lostRef.current >= SETUP.lostFrames) { lostRef.current = 0; okRunRef.current = 0; setOkRun(0); autoOff.current = false; setGetReady(null); setPhase('setup'); }
        }
        if (phaseRef.current === 'setup') {
          const f = fps.current;
          if (!f.t0 || document.hidden) { f.t0 = now; f.n = 0; }
          f.n++;
          if (f.n % 5 === 1) readLuma(v);
          const h = setupHint(kind, frame, luma.current);
          setHint(h);
          okRunRef.current = h === 'fcSetOk' ? okRunRef.current + 1 : 0;
          setOkRun(okRunRef.current);
          // Too slow to measure: offer a video for the physio instead.
          const el = now - f.t0;
          if (!f.warned && el > SETUP.slowAfterMs && (f.n * 1000) / el < SETUP.slowFps) { f.warned = true; stopCamera(); onTooSlow?.(); return; }
        }
        if (live.current && analyzer.current) {
          const evs = frame ? analyzer.current.push(frame, now, v.videoWidth / v.videoHeight) : analyzer.current.push([], now);
          onEvents(evs);
          if (!live.current) return;
          const an = analyzer.current;
          if (an.repCount === 0 && now - startedAt.current > SETUP.helpAfterSec * 1000) {
            const h = setupHint(kind, frame, luma.current), pct = Math.round(an.progress * 20) * 5, cur = helpRef.current;
            if (!cur || cur.h !== h || cur.pct !== pct) { helpRef.current = { h, pct }; setHelp({ h, pct }); }
          } else if (helpRef.current) { helpRef.current = null; setHelp(null); }
          if (now - startedAt.current > FORM_CHECK.maxSeconds * 1000) { void end('finish'); return; }
        }
      }
    }
    raf.current = requestAnimationFrame(loop);
  };

  async function openCamera(face: 'user' | 'environment', deviceId?: string) {
    setErr(''); setReady(false); okRunRef.current = 0; setOkRun(0); fps.current = { t0: 0, n: 0, warned: false };
    stopCamera();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: face }), width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s;
      let hw: { min: number; max: number; step: number } | null = null;
      try {
        const z = (s.getVideoTracks()[0]?.getCapabilities?.() as { zoom?: { min: number; max: number; step?: number } } | undefined)?.zoom;
        if (z && z.max > z.min) hw = { min: z.min, max: z.max, step: z.step && z.step > 0 ? z.step : 0.1 };
      } catch { /* this browser cannot say */ }
      // Start at 1x even where the camera can go lower (the 0.5x is a choice, not the default).
      setHwZoom(hw); setZoom(hw ? Math.min(hw.max, Math.max(1, hw.min)) : 1); digitalRef.current = 1; setNoWide(false);
      if (!deviceId) {
        // Camera names are only given once the camera is allowed, which is now.
        try {
          const want = face === 'user' ? /front/i : /back|rear/i;
          const w = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'videoinput' && /ultra.?wide/i.test(d.label) && (want.test(d.label) || !/front|back|rear/i.test(d.label)));
          setWideId(w?.deviceId ?? null);
        } catch { setWideId(null); }
      }
      if (video.current) { video.current.srcObject = s; await video.current.play(); }
    } catch { setErr(F('fcNoCamera')); return; }
    try {
      const needHand = HAND_KINDS.includes(kind);
      if (pose.current && needHand && !pose.current.hand) { pose.current.close(); pose.current = null; }
      if (!pose.current) pose.current = await loadPose(needHand);
    } catch { stopCamera(); setErr(F('fcNoModel')); return; }
    setReady(true);
    raf.current = requestAnimationFrame(loop);
  }
  const swap = async () => { const f = facing === 'user' ? 'environment' : 'user'; setFacing(f); setWide(false); await openCamera(f); };
  /** 0.5x: the camera's own zoom if it goes that low, else the ultra-wide lens if the browser names one. A crop can never show more than the camera sees, so there is no digital 0.5x. */
  const goWide = async (on: boolean) => {
    if (phaseRef.current === 'live') return;
    if (hwZoom && hwZoom.min <= 0.5 + 1e-6) { setWide(on); changeZoom(on ? 0.5 : 1); return; }
    if (on && wideId) { setWide(true); await openCamera(facing, wideId); setZoom(0.5); return; }
    if (!on && wide) { setWide(false); await openCamera(facing); return; }
    if (on) setNoWide(true);
  };

  // Count down so the patient can get into position before anything is measured.
  useEffect(() => {
    if (getReady === null) return;
    if (getReady <= 0) { setGetReady(null); startSet(); return; }
    const id = setTimeout(() => setGetReady((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(id);
  }, [getReady]);

  const startSet = () => {
    analyzer.current = new FormAnalyzer(kind, countOnly ? undefined : limit, { countOnly, tempoSec: tempo });
    analyzer.current.recordTrace = !!trace;
    setReps(0); setUnseen(false); clearCues(); clearFlags();
    chunks.current = []; recMime.current = ''; recStop.current = null;
    if (stream.current && typeof MediaRecorder !== 'undefined') {
      try {
        const mime = pickMime();
        const r = new MediaRecorder(stream.current, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 800_000 });
        r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
        recStop.current = new Promise<void>((res) => { r.onstop = () => res(); });
        r.start(1000);
        rec.current = r; recMime.current = r.mimeType || mime;
        // The clip is capped: recording stops after 30 seconds while the set carries on being measured.
        recTimer.current = window.setTimeout(() => { try { if (r.state !== 'inactive') r.stop(); } catch { /* already stopped */ } }, FORM_CONFIG.maxClipSec * 1000);
      } catch { rec.current = null; }
    }
    startedAt.current = performance.now(); helpRef.current = null; setHelp(null);
    live.current = true;
    setPhase('live');
  };

  const stopRecording = async (): Promise<Blob | null> => {
    clearTimeout(recTimer.current);
    const r = rec.current;
    rec.current = null;
    if (r && r.state !== 'inactive') { try { r.stop(); } catch { /* already stopped */ } }
    if (recStop.current) await recStop.current;
    return chunks.current.length ? new Blob(chunks.current, { type: recMime.current || 'video/webm' }) : null;
  };

  async function end(stop: SetOutcome['stop']) {
    if (!live.current || !analyzer.current) return;
    live.current = false;
    clearCues(); clearFlags();
    const summary = analyzer.current.finish();
    if (stop === 'stumble') {
      try { navigator.vibrate?.(300); } catch { /* not supported */ }
      if (speakSupported(lang)) speak(F('fcStumble'), lang);
    }
    const clip = await stopRecording();
    stopCamera();
    onDone({ summary, clip, clipSec: Math.min(summary.seconds, FORM_CONFIG.maxClipSec), stop });
  }

  const mirror = facing === 'user' ? 'scaleX(-1)' : undefined;
  const okToStart = ready && okRun >= SETUP.okFrames;
  const inPosition = ready && hint === 'fcSetOk' && phase !== 'live';
  const beginCount = () => { lostRef.current = 0; setPhase('countdown'); setGetReady(FORM_CHECK.getReadySec); };
  // In position and still for a moment: start the count-down by itself. Cancelling it stops this until the patient moves out and back in.
  useEffect(() => {
    if (okRun === 0) autoOff.current = false;
    if (phase === 'setup' && ready && okRun >= SETUP.autoFrames && !autoOff.current) beginCount();
  }, [okRun, phase, ready]);
  return (
    <main data-testid="formcheck-live" data-stage={phase === 'setup' ? 'camera' : 'live'}>
      <div className="fc-stage" style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', background: '#000', borderRadius: 12, overflow: 'hidden', outline: phase === 'live' || !ready ? undefined : `6px solid ${inPosition ? '#1fa34a' : '#e0a100'}`, outlineOffset: -6, boxShadow: inPosition && phase !== 'live' ? '0 0 24px 4px rgba(31,163,74,.7)' : undefined }} data-position={phase === 'live' ? 'live' : inPosition ? 'ok' : 'adjust'}>
        {phase !== 'live' && ready && <div className="fc-pos" data-testid="fc-pos" role="status" style={{ position: 'absolute', left: 8, top: 8, zIndex: 2, padding: '4px 12px', borderRadius: 999, fontWeight: 700, color: '#fff', background: inPosition ? '#1fa34a' : '#b57f00' }}>{inPosition ? '✓ ' : ''}{F(inPosition ? 'fcPosOk' : 'fcPosGo')}</div>}
        <div style={{ position: 'absolute', inset: 0, transform: !hwZoom && zoom > 1 ? `scale(${zoom})` : undefined, transformOrigin: 'center' }}>
          <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: mirror }} aria-label={F('fcTitle')} />
          <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: mirror }} aria-hidden="true" />
        </div>
        {exerciseId && getExercise(exerciseId)?.picture && <div className="fc-demo" aria-hidden="true" style={{ position: 'absolute', right: 8, bottom: 8, borderRadius: 10, overflow: 'hidden', border: '2px solid #fff', background: '#fff', opacity: .92 }}><ExPicture src={getExercise(exerciseId)?.picture} size={84} animated /></div>}
      </div>
      {phase !== 'live' && ready && (
        <div className="field" data-testid="fc-zoom-box">
          <label><b>{F('fcZoom')} {zoom.toFixed(1)}×</b>
            <input type="range" data-testid="fc-zoom" disabled={wide && !hwZoom} min={hwZoom ? hwZoom.min : ZOOM.min} max={hwZoom ? hwZoom.max : ZOOM.max} step={hwZoom ? hwZoom.step : ZOOM.step} value={zoom} onChange={(e) => { setWide(false); changeZoom(Number(e.target.value)); }} />
          </label>
          <div className="yn">
            <button type="button" className={wide ? 'sel' : ''} aria-pressed={wide} data-testid="fc-zoom-wide" onClick={() => void goWide(true)}>0.5×</button>
            <button type="button" className={!wide && zoom === 1 ? 'sel' : ''} aria-pressed={!wide && zoom === 1} data-testid="fc-zoom-one" onClick={() => { void goWide(false); if (!wide) changeZoom(1); }}>1×</button>
          </div>
          {noWide && <p className="hint" role="status" data-testid="fc-zoom-nowide">{F('fcZoomWide')}</p>}
          {!hwZoom && zoom > 1 && <p className="tiny">{F('fcZoomDigital')}</p>}
        </div>
      )}
      {err && <p className="err" role="alert">{err}</p>}
      {err && onTooSlow && <button className="big primary" data-testid="fc-video-instead" onClick={onTooSlow}>{F('fcModeVideo')}</button>}
      {!err && !ready && <p>{F('fcLoading')}</p>}
      {phase === 'setup' && ready && (
        <p className={hint === 'fcSetOk' ? 'okline' : 'hint'} role="status" aria-live="polite" data-testid="fc-setup">{F(hint)} {hint !== 'fcSetOk' && <Speak key={hint} text={F(hint)} lang={lang} />}</p>
      )}
      {phase === 'countdown' && getReady !== null && <p className="gs-count" role="timer" aria-live="polite">{F('fcGetReady', { n: getReady })}</p>}
      {phase === 'countdown' && <><p className="hint" role="status">{F('fcWaitZero')}</p><HowTo kind={kind} lang={lang} /></>}
      {phase === 'live' && (blind
        ? <p className="gs-count" aria-live="polite">Recording. The phone's results are shown after you enter yours.</p>
        : <p className="gs-count" aria-live="polite">{F(COUNT_KEYS[kind]?.live || 'fcReps', { n: reps })}</p>)}
      {phase === 'live' && unseen && <p className="hint" role="status">{F('fcUnseen')}</p>}
      {phase === 'live' && help && (
        <div className="card fc-help" role="status" aria-live="polite" data-testid="fc-help">
          <b>{F('fcHelpTitle')}</b>
          <p>{help.h !== 'fcSetOk' ? `${F('fcHelpCantSee')} ${F(help.h)}` : help.pct > 0 ? F('fcHelpClose', { pct: help.pct }) : F('fcHelpNone')}</p>
          <p className="tiny"><b>{F('fcSeeLbl')}:</b> {repInfo(lang, kind).see}</p>
          <p className="tiny"><b>{F('fcHelpPlace')}:</b> {F(VIEW_KEY[KINDS[kind].view])}</p>
          <p className="tiny"><b>{F('fcHelpRule')}:</b> {repRule(lang, kind)}</p>
          <RepStages kind={kind} lang={lang} />
          <p className="tiny">{F('fcHelpIfNot')}</p>
        </div>
      )}
      {phase === 'live' && flags.length > 0 && (
        <div className="red" role="alert" data-testid="fc-redflag">
          {flags.map((f) => <p key={f.id}><strong style={{ fontSize: '1.15em' }}>{f.text}</strong></p>)}
          <small>{F('fcRedFlagKeep')}</small>
        </div>
      )}
      {phase === 'live' && cue && <p className="fc-cue" role="status" aria-live="assertive" data-testid="fc-cue">{cue}</p>}
      {phase === 'setup' && (
        <>
          <HowTo kind={kind} lang={lang} stages />
          <p className="tiny">{F('fcHow3')}</p>
          <p className="tiny">{F(VIEW_KEY[KINDS[kind].view])}</p>
          <p className="tiny">{F('fcRecWarn')}</p>
          <button className="big primary" data-testid="fc-begin" disabled={!okToStart} onClick={beginCount}>{F('fcBegin')}</button>
          <button className="link" onClick={() => void swap()}>{F('fcSwap')}</button>
          <button className="link" onClick={() => { stopCamera(); onCancel(); }}>← {F('fcCancel')}</button>
        </>
      )}
      {phase === 'countdown' && <button className="big secondary" onClick={() => { autoOff.current = true; setGetReady(null); setPhase('setup'); }}>{F('fcCancel')}</button>}
      {phase === 'live' && <button className="big primary" data-testid="fc-finish" onClick={() => void end('finish')}>{F('fcFinish')}</button>}
    </main>
  );
}

type Stage = 'intro' | 'set' | 'stumble' | 'after' | 'result';
interface Result { log: FormCheckLog; a: Assessment; requestId: string | null; stop: SetOutcome['stop'] }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function FormCheckScreen({ patient, pack, lang, exerciseId, onBack, onVideo, onRedFlag }: {
  patient: Patient; pack: ProtocolPack; lang: Lang; exerciseId: string | null; onBack: () => void;
  /** Opens the video request for an exercise (the camera cannot measure it, or the phone is too slow). */
  onVideo: (exerciseId: string) => void;
  /** A yes to dizziness, chest pain or breathlessness after a set: opens the warning signs (the existing red-flag pathway). */
  onRedFlag: () => void;
}) {
  const F = (k: string, p?: Record<string, string | number>) => fcs(lang, k, p);
  const T = (k: string, p?: Record<string, string | number>) => t(lang, k, p);
  const options = currentExercises(patient, pack);
  const [ex, setEx] = useState<string>(exerciseId && options.includes(exerciseId) ? exerciseId : options.find((id) => checkMode(id) === 'form') ?? options[0] ?? '');
  const mode = checkMode(ex);
  const variants = mode === 'form' ? VARIANTS[ex] : undefined;
  const [variant, setVariant] = useState(0);
  const baseKind = variants ? variants[Math.min(variant, variants.length - 1)].kind : formKindFor(ex);
  /** Some exercises can be checked from more than one angle (the squat and the lunge: front and side). Every extra angle is optional. */
  const angles: FormKind[] = mode === 'form' && baseKind ? ANGLES[baseKind] ?? [baseKind] : baseKind ? [baseKind] : [];
  const [pick, setPick] = useState(0);
  /** An angle chosen after a set (the other one), and the sets already done for this exercise this time. */
  const [extra, setExtra] = useState<FormKind | null>(null);
  const [earlier, setEarlier] = useState<{ kind: FormKind; log: FormCheckLog }[]>([]);
  const kind = extra ?? angles[Math.min(pick, angles.length - 1)] ?? baseKind;
  const angleName = (k: FormKind) => F(isFrontView(k) ? 'fcAngleFront' : 'fcAngleSide');
  const [stage, setStage] = useState<Stage>('intro');
  const [agreed, setAgreed] = useState(hasConsent(patient));
  const [err, setErr] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [clip, setClip] = useState<{ blob: Blob; sec: number; setSec: number } | null>(null);
  const [clipAgree, setClipAgree] = useState(false);
  const [clipState, setClipState] = useState<'idle' | 'sending' | 'cloud' | 'device' | 'deleted'>('idle');
  const [pain, setPain] = useState<number | null>(null);
  const [flag, setFlag] = useState<boolean | null>(null);
  const clipUrl = useMemo(() => (clip ? URL.createObjectURL(clip.blob) : ''), [clip]);
  useEffect(() => () => { if (clipUrl) URL.revokeObjectURL(clipUrl); }, [clipUrl]);
  const carer = carerOf(patient);

  if (!cameraOn(patient)) {
    return <main data-testid="formcheck"><button className="back" onClick={onBack}>← {F('fcHome')}</button><h2>{F('fcTitle')}</h2><p>{F('fcOff')}</p></main>;
  }

  const begin = () => {
    if (!kind) return;
    if (!hasConsent(patient)) {
      const at = new Date(clockMs(getState())).toISOString();
      updatePatient(patient.id, (p) => giveConsent(p, patient.caregiverMode ? 'caregiver' : 'patient', at));
    }
    setErr(''); setStage('set');
  };

  const onDone = (o: SetOutcome) => {
    if (!kind) return;
    const now = clockMs(getState());
    const iso = new Date(now).toISOString();
    const lim = mode === 'form' ? limitFor(patient, ex) : undefined;
    const log = newCheckLog({ id: `c${Date.now().toString(36)}`, date: getState().today, startedAt: now - Math.round(o.summary.seconds * 1000), endedAt: now, exerciseId: ex, kind, summary: o.summary, by: patient.caregiverMode ? 'caregiver' : 'patient', limit: lim });
    const cur = getState().patients.find((x) => x.id === patient.id) ?? patient;
    const out = recordCheck(cur, log, iso);
    updatePatient(patient.id, (q) => recordCheck(q, log, iso).patient);
    setResult({ log: out.patient.formChecks?.find((x) => x.id === log.id) ?? log, a: assess(cur, log), requestId: out.requestId, stop: o.stop });
    // The video stays in memory only so the patient can choose to send it. Nothing is uploaded unless they watch it and tick consent.
    setClip(o.clip ? { blob: o.clip, sec: o.clipSec, setSec: o.summary.seconds } : null);
    setClipAgree(false); setClipState('idle'); setPain(null); setFlag(null);
    // The second angle follows straight on from the first: the after-set questions were already asked.
    setStage(o.stop === 'stumble' ? 'stumble' : earlier.length > 0 ? 'result' : 'after');
  };

  const saveAfter = () => {
    if (!result || flag === null) return;
    updatePatient(patient.id, (q) => setAfterAnswers(q, result.log.id, { pain, redFlag: flag }));
    if (flag) { onRedFlag(); return; }
    setStage('result');
  };

  const sendClip = async () => {
    if (!clip || !result || !clipAgree) return;
    setClipState('sending'); setErr('');
    try {
      const mime = (clip.blob.type || 'video/webm').split(';')[0];
      const bad = validClip(mime, clip.blob.size);
      if (bad) { setErr(bad === 'size' ? F('fcClipSize') : F('fcClipType')); setClipState('idle'); return; }
      const iso = new Date(clockMs(getState())).toISOString();
      // No new item was raised for this set (nothing flagged, or the physio has one open): the video gets its own item.
      let id = result.requestId ?? '';
      if (!id) {
        const cur = getState().patients.find((x) => x.id === patient.id) ?? patient;
        id = requestForClip(cur, result.log, result.a, iso).requestId;
        if (!id) { setClipState('idle'); return; }
        updatePatient(patient.id, (q) => requestForClip(q, result.log, result.a, iso).patient);
      }
      const durationSec = Math.round(clip.sec);
      const path = clipCloudReady(patient) ? await patientUploadClip(patient, id, clip.blob, mime) : null;
      if (path) { updatePatient(patient.id, (p) => attachClip(p, id, { where: 'cloud', ref: path, mime, size: clip.blob.size, durationSec }, iso)); setClipState('cloud'); }
      else { const lid = newLocalId(); await saveLocalVideo(lid, clip.blob); updatePatient(patient.id, (p) => attachClip(p, id, { where: 'device', ref: lid, mime, size: clip.blob.size, durationSec }, iso)); setClipState('device'); }
      setClip(null);
    } catch (e) { setErr((e as Error).message); setClipState('idle'); }
  };

  const reset = () => { setExtra(null); setEarlier([]); setStage('intro'); setResult(null); setClip(null); setClipAgree(false); setClipState('idle'); setErr(''); };
  const hours = reviewHours(pack);
  const consent = consentText(lang);

  if (stage === 'set' && kind) {
    return <CameraSet key={kind} kind={kind} exerciseId={ex} lang={lang} countOnly={mode === 'count'} limit={mode === 'form' && kind === baseKind && kind !== 'balance-line' && !KINDS[kind].noLimit ? limitFor(patient, ex) : undefined}
      tempo={mode === 'form' ? limitFor(patient, ex)?.tempo : undefined} onDone={onDone} onCancel={() => setStage('intro')} onTooSlow={() => onVideo(ex)} />;
  }

  if (stage === 'stumble') {
    const say = `${F('fcStumble')} ${F('fcStumbleMore')}`;
    return (
      <main data-testid="fc-stumble">
        <div className="red" role="alert"><strong style={{ fontSize: '1.3em' }}>{F('fcStumble')}</strong></div>
        <p>{F('fcStumbleMore')} <Speak text={say} lang={lang} /></p>
        {carer && hasPhone(carer.phone) && <a className="big primary" href={telHref(carer.phone)} data-testid="fc-call-carer">{carer.name ? F('fcCallCarer', { name: carer.name }) : F('fcCallCarerAny')}</a>}
        <a className="big secondary" href="tel:112">{F('fcCall112')}</a>
        <button className="big secondary" data-testid="fc-sat-down" onClick={() => setStage('after')}>{F('fcSatDown')}</button>
      </main>
    );
  }

  if (stage === 'after') {
    return (
      <main data-testid="fc-after">
        <h3>{F('fcAfterPain')} <Speak text={F('fcAfterPain')} lang={lang} /></h3>
        <div className="gs-pain" role="group" aria-label={F('fcAfterPain')}>{Array.from({ length: 11 }, (_, n) => (
          <button key={n} type="button" className={`stepbtn${pain === n ? ' sel' : ''}`} aria-pressed={pain === n} data-testid={`fc-pain-${n}`} onClick={() => setPain(n)}>{n}</button>))}</div>
        <h3>{F('fcAfterFlags')} <Speak text={F('fcAfterFlags')} lang={lang} /></h3>
        <div className="yn">
          <button className={flag === false ? 'sel no' : ''} aria-pressed={flag === false} data-testid="fc-flag-no" onClick={() => setFlag(false)}>{T('no')}</button>
          <button className={flag === true ? 'sel yes' : ''} aria-pressed={flag === true} data-testid="fc-flag-yes" onClick={() => setFlag(true)}>{T('yes')}</button>
        </div>
        <button className="big primary" data-testid="fc-after-next" disabled={pain === null || flag === null} onClick={saveAfter}>{F('fcAfterNext')}</button>
      </main>
    );
  }

  if (stage === 'result' && result) {
    const { log, a } = result;
    const lines: string[] = [];
    lines.push(log.repsCounted > 0 ? F(COUNT_KEYS[log.kind]?.done ?? 'fcRepsDone', { n: log.repsCounted }) : F('fcNoReps'));
    if (log.peaks?.length) lines.push(F('fcDepth', { n: Math.round(Math.max(...log.peaks)) }));
    if (log.cadence) lines.push(F(COUNT_KEYS[log.kind]?.rate ?? 'fcCadence', { n: log.cadence }));
    if (log.holds?.length) lines.push(F('fcHolds', { list: log.holds.join(', ') }));
    if (log.repSecs?.length && log.tempo) lines.push(F('fcPaceLine', { sec: median(log.repSecs), tempo: log.tempo }));
    // "Things to work on": each cue once, with how many times it came up (the reps it was seen in; two faults with the same cue add up).
    const tally = new Map<string, number>();
    for (const f of log.faults) { const c = F(`fault-${f.id}`); tally.set(c, (tally.get(c) ?? 0) + f.reps.length); }
    const cues = [...tally.entries()].sort((x, y) => y[1] - x[1]).map(([what, n]) => (n === 1 ? F('fcLineOnce', { what }) : F('fcLine', { what, n })));
    const count = log.mode === 'count';
    const verdict = a.unreliable ? F('fcUnreliable') : [count ? F('fcNoTips') : '', cues.length ? `${F('fcHead')} ${cues.join(' ')}` : count ? '' : F('fcNone')].filter(Boolean).join(' ');
    return (
      <main data-testid="formcheck-result">
        <h2>{F('fcResult')} <Speak text={[...lines, verdict].join(' ')} lang={lang} /></h2>
        <div className="card exhead"><ExPicture src={getExercise(ex)?.picture} size={96} animated /><b>{exerciseName(ex, lang)}</b></div>
        {earlier.map((e) => {
          const tally = new Map<string, number>();
          for (const f of e.log.faults) { const c = F(`fault-${f.id}`); tally.set(c, (tally.get(c) ?? 0) + f.reps.length); }
          return (
            <div className="card" key={e.log.id} data-testid="fc-earlier">
              <b>{angleName(e.kind)}</b>
              <p>{e.log.repsCounted > 0 ? F('fcRepsDone', { n: e.log.repsCounted }) : F('fcNoReps')}</p>
              {e.log.reliable ? (tally.size ? <ul className="exlist">{[...tally.keys()].map((c) => <li key={c}>{c}</li>)}</ul> : <p>{F('fcNone')}</p>) : <p className="hint">{F('fcUnreliable')}</p>}
            </div>
          );
        })}
        {earlier.length > 0 && <h3>{angleName(kind!)}</h3>}
        {result.stop === 'limit' && <p className="red" role="alert"><strong>{F('fcPause')}</strong></p>}
        {lines.map((x) => <p key={x}>{x}</p>)}
        {log.repsCounted === 0 && <div className="card" data-testid="fc-norep"><b>{F('fcHelpTitle')}</b><p className="tiny"><b>{F('fcSeeLbl')}:</b> {repInfo(lang, log.kind).see}</p><p className="tiny"><b>{F('fcHelpPlace')}:</b> {F(VIEW_KEY[KINDS[log.kind].view])}</p><RepStages kind={log.kind} lang={lang} /></div>}
        {count && <p className="hint" data-testid="fc-no-tips">{F('fcNoTips')}</p>}
        {a.unreliable ? <p className="hint">{F('fcUnreliable')}</p> : cues.length ? (
          <div className="card">
            {log.repsCounted > 0 && <p data-testid="fc-allcounted">{F('fcAllCounted')}</p>}
            <b>{F('fcHead')}</b>
            <ul className="exlist">{cues.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        ) : count ? null : <p data-testid="fc-none">{F('fcNone')}</p>}
        {(a.raise || log.paused) && <p className="okline" data-testid="fc-told">{F('fcTold', { hours })}</p>}
        {a.raise && !clip && clipState === 'idle' && <p className="tiny">{F('fcToldNoClip')}</p>}
        {clip && clipState !== 'deleted' && (
          <div className="card" data-testid="fc-clip">
            <b>{F('fcSendClip')}</b>
            <p className="tiny">{F('fcClipPreview')}{clip.setSec > FORM_CONFIG.maxClipSec ? ` ${F('fcClipFirst', { n: FORM_CONFIG.maxClipSec })}` : ''}</p>
            {clipUrl && <video src={clipUrl} controls playsInline preload="metadata" data-testid="fc-clip-preview" style={{ width: '100%', maxWidth: 480, borderRadius: 12 }} />}
            <ul className="exlist">{consent.points.map((x) => <li key={x}>{x}</li>)}</ul>
            <small className="tiny">{CONSENT_TEXT[lang].draft}</small>
            <label className="caregivertoggle"><input type="checkbox" checked={clipAgree} onChange={(e) => setClipAgree(e.target.checked)} data-testid="fc-clip-consent" /><span><b>{CONSENT_TEXT[lang].agree}</b></span></label>
            <p className="tiny">{F('fcClipHint')}</p>
            <button className="big primary" data-testid="fc-send-clip" disabled={!clipAgree || clipState === 'sending'} onClick={() => void sendClip()}>{clipState === 'sending' ? F('fcSending') : F('fcSendClip')}</button>
            <button className="link" onClick={() => { setClip(null); setClipState('deleted'); }}>{F('fcDiscard')}</button>
          </div>
        )}
        {clipState === 'cloud' && <p className="okline">{F('fcClipSent')}</p>}
        {clipState === 'device' && <p className="okline">{F('fcClipLocal')}</p>}
        {clipState === 'deleted' && <p className="tiny">{F('fcDiscarded')}</p>}
        {err && <p className="err" role="alert">{err}</p>}
        {(() => {
          const done = [...earlier.map((e) => e.kind), kind];
          const rest = angles.filter((k) => !done.includes(k));
          return rest.length > 0 ? (
            <div className="card" data-testid="fc-second-angle-box">
              <p className="tiny">{F('fcSecondAngleWhy')}</p>
              {rest.map((k) => (
                <button key={k} className="big secondary" data-testid="fc-second-angle" onClick={() => { setEarlier([...earlier, { kind: kind!, log }]); setExtra(k); setResult(null); setClip(null); setClipState('idle'); setStage('set'); }}>{F('fcAlsoCheck', { angle: angleName(k) })}</button>
              ))}
            </div>
          ) : null;
        })()}
        <button className="big primary" onClick={reset}>{F('fcAgain')}</button>
        <button className="big secondary" onClick={onBack}>{F('fcHome')}</button>
      </main>
    );
  }

  return (
    <main data-testid="formcheck">
      <button className="back" onClick={onBack}>← {F('fcHome')}</button>
      <h2>{F('fcTitle')}</h2>
      <p className="hint">{F('fcNot')} <Speak text={`${F('fcNot')} ${F('fcNoEmergency')}`} lang={lang} /></p>
      <p className="tiny">{F('fcNoEmergency')}</p>
      {options.length > 1 ? (
        <label className="field"><b>{F('fcPickEx')}</b>
          <select value={ex} data-testid="fc-exercise" onChange={(e) => { setEx(e.target.value); setVariant(0); setPick(0); }}>{options.map((id) => <option key={id} value={id}>{exerciseName(id, lang)}</option>)}</select>
        </label>
      ) : null}
      <div className="card exhead"><ExPicture src={getExercise(ex)?.picture} size={96} animated /><b>{exerciseName(ex, lang)}</b></div>
      {variants && (
        <label className="field"><b>{F('fcPickVar')}</b>
          <select value={variant} onChange={(e) => setVariant(Number(e.target.value))} data-testid="fc-variant">{variants.map((v, i) => <option key={v.kind} value={i}>{F(v.labelKey)}</option>)}</select>
        </label>
      )}
      {mode === 'form' && angles.length > 1 && (
        <label className="field"><b>{F('fcPickAngle')}</b>
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))} data-testid="fc-angle">{angles.map((k, i) => <option key={k} value={i}>{angleName(k)}</option>)}</select>
        </label>
      )}
      {mode !== 'form' && <p className="hint" data-testid="fc-no-tips">{F('fcNoTips')}{mode === 'video' ? ` ${F('fcCantCount')}` : ''}</p>}
      {mode !== 'video' && kind && <p className="tiny">{F(VIEW_KEY[KINDS[kind].view])}</p>}
      {mode !== 'video' && kind && <HowTo kind={kind} lang={lang} steps stages />}
      {mode !== 'video' && (!hasConsent(patient) ? (
        <div className="card" data-testid="fc-consent">
          <h3>{F('fcConsentTitle')}</h3>
          <ul className="exlist">{['fcConsent1', 'fcConsent2', 'fcConsent3', 'fcConsent4'].map((k) => <li key={k}>{F(k)}</li>)}</ul>
          <small className="tiny">{F('fcConsentDraft')}</small>
          <label className="caregivertoggle"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="fc-consent-check" /><span><b>{F('fcConsentAgree')}</b></span></label>
        </div>
      ) : <button className="link" onClick={() => { setAgreed(false); updatePatient(patient.id, withdrawConsent); }}>{F('fcWithdraw')}</button>)}
      {err && <p className="err" role="alert">{err}</p>}
      {mode === 'form' && <button className="big primary" data-testid="fc-start" disabled={!kind || (!hasConsent(patient) && !agreed)} onClick={begin}>{F('fcModeForm')}</button>}
      {mode === 'count' && <button className="big primary" data-testid="fc-start" disabled={!kind || (!hasConsent(patient) && !agreed)} onClick={begin}>{F('fcModeCount')}</button>}
      {mode !== 'form' && <button className={`big ${mode === 'video' ? 'primary' : 'secondary'}`} data-testid="fc-video" onClick={() => onVideo(ex)}>{F('fcModeVideo')}</button>}
    </main>
  );
}
