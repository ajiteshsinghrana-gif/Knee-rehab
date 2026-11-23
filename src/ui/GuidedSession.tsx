// Guided exercise session: shows one exercise at a time, counts reps and sets, times rests and holds, and speaks if the patient wants.
// It only records what the patient taps. It never tells them a movement is correct and never changes the plan.
import { useEffect, useRef, useState } from 'react';
import { ExPicture } from './ExPicture';
import type { Lang, Patient, ProtocolPack } from '../types';
import { t } from '../i18n';
import { clockMs, getState, updatePatient } from '../store';
import { exerciseName, getExercise } from '../exercises/library';
import { speak, speakSupported } from '../voice/speak';
import { DemoButton } from './Demo';
import { ss } from '../session/strings';
import { SESSION_CONFIG } from '../session/config';
import {
  addSession, answerPain, begin, doRep, doseText, encouragement, endRest, exerciseFinished, markStruggling, planSteps,
  startSession, stopExercise, toSessionLog, undoRep, unitsPerSet, type SState,
} from '../session/engine';

const SKIP_EMOJI: Record<string, string> = { pain: '😣', fear: '😨', time: '⏰', access: '🚫', understand: '❓' };

export function GuidedSession({ patient, pack, lang, onExit, onNeedHelp }: {
  patient: Patient; pack: ProtocolPack; lang: Lang;
  onExit: (toCheckIn: boolean) => void;
  /** Opens the video request for this exercise. */
  onNeedHelp?: (exerciseId: string) => void;
}) {
  const S = (k: string, p?: Record<string, string | number>) => ss(lang, k, p);
  const T = (k: string, p?: Record<string, string | number>) => t(lang, k, p);
  const [s, setS] = useState<SState>(() => startSession(planSteps(patient, pack), clockMs(getState())));
  const [voice, setVoice] = useState(false);
  const [holding, setHolding] = useState<number | null>(null);
  const [restLeft, setRestLeft] = useState(SESSION_CONFIG.restSec);
  const [stopping, setStopping] = useState(false);
  const [saved, setSaved] = useState(false);
  const leaveDlg = useRef<HTMLDialogElement>(null);
  const sRef = useRef(s);
  sRef.current = s;
  const savedRef = useRef(false);

  const save = () => {
    if (savedRef.current) return;
    const cur = sRef.current;
    const log = toSessionLog(cur, getState().today, clockMs(getState()), patient.caregiverMode ? 'caregiver' : 'patient');
    if (!log.exercises.some((l) => l.repsDone > 0 || l.stopped)) return;
    savedRef.current = true;
    setSaved(true);
    updatePatient(patient.id, (p) => addSession(p, log));
  };
  // Keep what was done even if the patient closes the screen part-way.
  useEffect(() => () => { if (!savedRef.current && sRef.current.phase !== 'done') save(); }, []);
  useEffect(() => { if (s.phase === 'done') save(); }, [s.phase]);

  const say = (text: string) => { if (voice && text) speak(text, lang); };
  const step = s.steps[s.i];
  const log = s.logs[s.i];

  // Rest timer
  useEffect(() => {
    if (s.phase !== 'rest') return;
    setRestLeft(SESSION_CONFIG.restSec);
    const id = setInterval(() => setRestLeft((n) => n - 1), 1000);
    return () => clearInterval(id);
  }, [s.phase, s.set, s.i]);
  useEffect(() => { if (s.phase === 'rest' && restLeft <= 0) { setS((x) => endRest(x)); } }, [restLeft, s.phase]);

  // Hold timer
  useEffect(() => {
    if (holding === null) return;
    if (holding <= 0) { setHolding(null); setS((x) => doRep(x)); return; }
    const id = setTimeout(() => setHolding((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(id);
  }, [holding]);
  useEffect(() => { setHolding(null); setStopping(false); }, [s.i, s.phase, s.set]);

  // Speak the cue when the moment changes
  const spoke = useRef('');
  useEffect(() => {
    if (!voice) return;
    const key = `${s.i}|${s.set}|${s.rep}|${s.phase}`;
    if (key === spoke.current) return;
    spoke.current = key;
    if (s.phase === 'ready' && step) say(`${exerciseName(step.exerciseId, lang)}. ${doseText(step, lang)}`);
    else if (s.phase === 'work' && s.rep === 0 && step) say(S('sSetOf', { i: s.set, n: step.sets }));
    else say(encouragement(s, lang));
  }, [s, voice]);

  const act = (f: (x: SState) => SState) => setS((x) => f(x));
  const leave = () => { save(); onExit(false); };

  if (!step && s.phase !== 'done') {
    return (<main><p>{S('sNoExercises')}</p><button className="big secondary" onClick={() => onExit(false)}>{S('sHome')}</button></main>);
  }

  const header = (
    <div className="gs-top">
      <button type="button" className="back" onClick={() => { if (s.phase === 'done') leave(); else leaveDlg.current?.showModal(); }}>← {S('sClose')}</button>
      {/* In-app question instead of the browser's confirm pop-up: same wording, same result. */}
      <dialog ref={leaveDlg} className="dialog" aria-labelledby="gs-leave-q" onClick={(e) => { if (e.target === leaveDlg.current) leaveDlg.current.close(); }}>
        <p id="gs-leave-q" className="dialog-q">{S('sConfirmLeave')}</p>
        <div className="dialog-btns">
          <button type="button" className="btn" autoFocus onClick={() => leaveDlg.current?.close()}>{T('stay')}</button>
          <button type="button" className="btn primary" onClick={() => { leaveDlg.current?.close(); leave(); }}>{T('leave')}</button>
        </div>
      </dialog>
      {speakSupported(lang) && <button type="button" className="readaloud" aria-pressed={voice} onClick={() => setVoice(!voice)}>{voice ? S('sVoiceOn') : S('sVoiceOff')}</button>}
    </div>
  );

  if (s.phase === 'done') {
    return (
      <main data-testid="session-summary">
        {header}
        <h2>{S('sSummary')}</h2>
        <ul className="exlist">
          {s.logs.map((l) => (
            <li key={l.id} className="exitem">
              <span><b>{exerciseName(l.id, lang)}</b><br /><small>{S('sSets', { done: l.setsDone, n: l.setsPlanned })}{l.stopped ? ` · ${S('sStoppedLine', { why: T(`skip_${l.stopped}`) })}` : ''}{l.pain !== undefined ? ` · ${l.pain}/10` : ''}</small></span>
              <span aria-hidden="true">{exerciseFinished(l) ? '✅' : '🟡'}</span>
            </li>
          ))}
        </ul>
        <p className="okline">{encouragement(s, lang)}</p>
        <button className="big primary" onClick={() => onExit(true)}>{S('sThenCheckIn')}</button>
        <button className="big secondary" onClick={() => onExit(false)}>{S('sHome')}</button>
      </main>
    );
  }

  const ex = getExercise(step.exerciseId);
  const total = unitsPerSet(step);
  const msg = encouragement(s, lang);
  const painScale = Array.from({ length: 11 }, (_, k) => k);

  return (
    <main data-testid="session" data-phase={s.phase}>
      {header}
      <p className="sub">{S('sOf', { i: s.i + 1, n: s.steps.length })}</p>
      <div className="card gs-card">
        <div className="exhead">
          <ExPicture src={ex?.picture} size={64} />
          <div><h2>{exerciseName(step.exerciseId, lang)}</h2><small>{doseText(step, lang)}</small></div>
        </div>
        <DemoButton patient={patient} exerciseId={step.exerciseId} lang={lang} />
      </div>

      {s.phase === 'ready' && <button className="big primary" onClick={() => act(begin)}>{S('sBegin')}</button>}

      {s.phase === 'work' && !stopping && (
        <>
          <p className="gs-set">{S('sSetOf', { i: s.set, n: step.sets })}</p>
          <p className="gs-count" aria-live="polite">{step.reps !== null ? S('sRepCount', { done: s.rep, total }) : ''}</p>
          <div className="progress tight" aria-hidden="true">{Array.from({ length: total }, (_, k) => <span key={k} className={k < s.rep ? 'on' : ''} />)}</div>
          {step.holdSec !== null ? (
            holding === null
              ? <button className="big primary" onClick={() => setHolding(step.holdSec)}>{S('sHold')}</button>
              : <div className="gs-hold" role="timer" aria-live="polite">{S('sHolding', { sec: holding })}</div>
          ) : (
            <button className="big primary" onClick={() => act(doRep)}>{step.reps !== null ? S('sRep') : S('sSetDone')}</button>
          )}
          {msg && <p className="gs-msg">{msg}</p>}
          {s.rep > 0 && holding === null && <button type="button" className="link" onClick={() => act(undoRep)}>{S('sUndo')}</button>}
        </>
      )}

      {s.phase === 'rest' && (
        <div className="card" data-testid="rest">
          <h3>{S('sRest')}</h3>
          <p className="gs-count">{Math.max(0, restLeft)}</p>
          <p>{S('sRestLeft', { sec: Math.max(0, restLeft) })}</p>
          <p className="gs-msg">{msg}</p>
          <button className="big primary" onClick={() => act(endRest)}>{S('sSkipRest')}</button>
        </div>
      )}

      {s.phase === 'pain' && (
        <div className="card" data-testid="pain">
          {log.stopped ? <p><b>{S('sStoppedMsg')}</b></p> : <p className="gs-msg">{msg}</p>}
          <h3>{S('sPainAsk')}</h3>
          <div className="gs-pain">{painScale.map((k) => <button key={k} type="button" className="stepbtn" onClick={() => act((x) => answerPain(x, k))}>{k}</button>)}</div>
          <button type="button" className="link" onClick={() => act((x) => answerPain(x, null))}>{S('sPainSkip')}</button>
        </div>
      )}

      {(s.phase === 'work' || s.phase === 'ready' || s.phase === 'rest') && (
        <>
          {stopping ? (
            <div className="card" data-testid="stop-reasons">
              <h3>{S('sStopWhy')}</h3>
              <div className="grid2">
                {pack.checkIn.skipReasons.map((r) => (
                  <button key={r} type="button" className="tile" onClick={() => { setStopping(false); act((x) => stopExercise(x, r)); }}>
                    <span className="emoji" aria-hidden="true">{SKIP_EMOJI[r] ?? '•'}</span>{T(`skip_${r}`)}
                  </button>
                ))}
              </div>
              <button type="button" className="link" onClick={() => setStopping(false)}>←</button>
            </div>
          ) : (
            <div className="gs-actions">
              <button type="button" className="big secondary gs-stop" onClick={() => setStopping(true)}>{S('sStop')}</button>
              {onNeedHelp && (
                <button type="button" className="big secondary" onClick={() => { act(markStruggling); save(); onNeedHelp(step.exerciseId); }}>{S('sStruggle')}</button>
              )}
              {s.phase === 'ready' && <button type="button" className="link" onClick={() => act((x) => stopExercise(x, 'time'))}>{S('sSkipEx')}</button>}
            </div>
          )}
        </>
      )}
    </main>
  );
}
