import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../types';
import { t } from '../i18n';
import { speak, speakSupported } from '../voice/speak';
import { combineReadings, meanVec, tiltBetween, type Vec } from '../goniometer';

/** Pictures of where the phone goes: lying face down on a bed, phone flat on the back of the lower leg; then the knee bent. */
function Pose({ bent }: { bent: boolean }) {
  const knee = { x: 176, y: 70 };
  const ankle = bent ? { x: 150, y: 22 } : { x: 236, y: 71 };
  const at = (f: number) => ({ x: knee.x + (ankle.x - knee.x) * f, y: knee.y + (ankle.y - knee.y) * f });
  const ph = at(0.38);
  const rot = (Math.atan2(ankle.y - knee.y, ankle.x - knee.x) * 180) / Math.PI;
  return (
    <svg viewBox="0 0 260 112" className="pose" role="img" aria-hidden="true">
      {/* bed */}
      <rect x="8" y="80" width="244" height="9" rx="3" fill="currentColor" opacity=".18" />
      <rect x="14" y="89" width="6" height="16" rx="2" fill="currentColor" opacity=".18" /><rect x="240" y="89" width="6" height="16" rx="2" fill="currentColor" opacity=".18" />
      {/* pillow, head, body lying face down */}
      <rect x="12" y="66" width="34" height="14" rx="6" fill="currentColor" opacity=".12" />
      <circle cx="30" cy="60" r="11" fill="var(--surface)" stroke="currentColor" strokeWidth="2.5" />
      <line x1="46" y1="66" x2="128" y2="68" stroke="currentColor" strokeWidth="18" strokeLinecap="round" />
      <line x1="56" y1="72" x2="84" y2="78" stroke="currentColor" strokeWidth="7" strokeLinecap="round" opacity=".7" />
      <line x1="128" y1="69" x2={knee.x} y2={knee.y} stroke="currentColor" strokeWidth="13" strokeLinecap="round" />
      <line x1={knee.x} y1={knee.y} x2={ankle.x} y2={ankle.y} stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
      {/* the phone, flat on the back of the lower leg */}
      <g transform={`translate(${ph.x},${ph.y}) rotate(${rot})`}>
        <rect x="-15" y="-13" width="30" height="10" rx="2" fill="var(--teal)" />
        <rect x="-12" y="-11.5" width="24" height="7" rx="1" fill="#fff" opacity=".35" />
      </g>
      {!bent && <path d={`M${ph.x} ${ph.y - 34} L${ph.x} ${ph.y - 20} M${ph.x - 5} ${ph.y - 25} L${ph.x} ${ph.y - 19} L${ph.x + 5} ${ph.y - 25}`} stroke="var(--teal)" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
      {bent && <path d="M222 66 A48 48 0 0 0 166 26" fill="none" stroke="var(--teal)" strokeWidth="2" strokeDasharray="4 4" markerEnd="url(#gn-arrow)" />}
      <defs><marker id="gn-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--teal)" /></marker></defs>
    </svg>
  );
}

function Speak({ text, lang }: { text: string; lang: Lang }) {
  if (!speakSupported(lang)) return null;
  return <button type="button" className="readaloud icon" aria-label={t(lang, 'readAloud')} onClick={() => speak(text, lang)}>🔊</button>;
}

type Phase = 'intro' | 'bend' | 'again' | 'bend2' | 'hold' | 'result' | 'nosensor' | 'denied';

/**
 * Knee bend measured with the phone's tilt sensor (physio feedback round): two readings, averaged.
 * Straight leg -> Start, bent knee -> Done. Asks for motion-sensor permission where the browser requires it.
 */
export function Goniometer({ lang, onUse, onClose }: { lang: Lang; onUse: (deg: number) => void; onClose: () => void }) {
  const T = (k: string, p?: Record<string, string | number>) => t(lang, k, p);
  const [phase, setPhase] = useState<Phase>('intro');
  const [reads, setReads] = useState<number[]>([]);
  const buf = useRef<Vec[]>([]);
  const base = useRef<Vec | null>(null);
  const got = useRef(false);
  const listening = useRef(false);

  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    got.current = true;
    buf.current = [...buf.current.slice(-30), { x: a.x, y: a.y, z: a.z }];
  };
  useEffect(() => () => { window.removeEventListener('devicemotion', onMotion); }, []);

  const listen = async (): Promise<boolean> => {
    if (listening.current) return true;
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (!DM) { setPhase('nosensor'); return false; }
    if (typeof DM.requestPermission === 'function') {
      try { if ((await DM.requestPermission()) !== 'granted') { setPhase('denied'); return false; } } catch { setPhase('denied'); return false; }
    }
    window.addEventListener('devicemotion', onMotion);
    listening.current = true;
    return true;
  };
  /** Wait, then average what the sensor reported while the leg was held still. */
  const sample = (ms = 700) => new Promise<Vec | null>((resolve) => {
    buf.current = [];
    setTimeout(() => resolve(got.current ? meanVec(buf.current) : null), ms);
  });

  const start = async (next: Phase) => {
    if (!(await listen())) return;
    setPhase('hold');
    const v = await sample();
    if (!v) { setPhase('nosensor'); return; }
    base.current = v;
    setPhase(next);
  };
  const done = async (n: number) => {
    setPhase('hold');
    const v = await sample();
    if (!v || !base.current) { setPhase('nosensor'); return; }
    const deg = tiltBetween(base.current, v);
    const r = [...reads.slice(0, n - 1), deg];
    setReads(r);
    setPhase(n === 1 ? 'again' : 'result');
  };
  const res = reads.length === 2 ? combineReadings(reads[0], reads[1]) : null;
  const say = phase === 'intro' ? `${T('gonioIntro')} ${T('gonioHelper')}` : phase === 'bend' || phase === 'bend2' ? T('gonioBend') : phase === 'again' ? T('gonioAgain') : '';

  return (
    <div className="gonio" data-testid="goniometer" role="group" aria-label={T('measureWithPhone')}>
      <div className="gonio-head"><b>{T('measureWithPhone')}</b>{(phase === 'bend' || phase === 'bend2' || phase === 'again') && <small>{T('gonioReading', { n: phase === 'bend' ? 1 : 2 })}</small>}</div>
      {(phase === 'intro' || phase === 'again') && <Pose bent={false} />}
      {(phase === 'bend' || phase === 'bend2') && <Pose bent />}
      {say && <p className="gonio-say">{say} <Speak key={lang + phase} text={say} lang={lang} /></p>}
      {phase === 'hold' && <p className="gonio-say" role="status">{T('gonioHold')}</p>}
      {phase === 'intro' && <button type="button" className="big primary" onClick={() => void start('bend')}>{T('gonioStart')}</button>}
      {phase === 'again' && <button type="button" className="big primary" onClick={() => void start('bend2')}>{T('gonioStart')}</button>}
      {phase === 'bend' && <button type="button" className="big primary" onClick={() => void done(1)}>{T('gonioDone')}</button>}
      {phase === 'bend2' && <button type="button" className="big primary" onClick={() => void done(2)}>{T('gonioDone')}</button>}
      {phase === 'result' && res && (res.ok ? (
        <>
          <p className="gonio-result" role="status">{T('gonioResult', { deg: res.deg, a: reads[0], b: reads[1] })} <Speak key={lang + 'r'} text={T('gonioResult', { deg: res.deg, a: reads[0], b: reads[1] })} lang={lang} /></p>
          <button type="button" className="big primary" onClick={() => onUse(res.deg)}>{T('gonioUse')}</button>
          <button type="button" className="btn" onClick={() => { setReads([]); setPhase('intro'); }}>{T('gonioRetry')}</button>
        </>
      ) : (
        <>
          <p className="gonio-result" role="alert">{T('gonioMismatch', { a: reads[0], b: reads[1] })}</p>
          <button type="button" className="big primary" onClick={() => { setReads([]); setPhase('intro'); }}>{T('gonioRetry')}</button>
        </>
      ))}
      {(phase === 'nosensor' || phase === 'denied') && <p className="gonio-result" role="alert">{T(phase === 'nosensor' ? 'gonioNoSensor' : 'gonioDenied')}</p>}
      <button type="button" className="linkbtn" onClick={onClose}>{T('gonioCancel')}</button>
    </div>
  );
}
