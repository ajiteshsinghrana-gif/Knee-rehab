import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Lang, Patient, ProtocolPack } from '../types';
import { L, t } from '../i18n';
import { speak, speakSupported } from '../voice/speak';
import { exerciseCard, goalCard, kneeCard, legLine, painCard, weeksSinceStart, type Pt } from '../progress';
import { waHref } from '../contact';

/** A small speaker button. Stops when the screen closes. */
function Speak({ text, lang }: { text: string; lang: Lang }) {
  const [on, setOn] = useState(false);
  const [stop, setStop] = useState<null | (() => void)>(null);
  useEffect(() => () => { stop?.(); }, [stop]);
  if (!speakSupported(lang)) return null;
  return (
    <button type="button" className="readaloud icon" aria-pressed={on} aria-label={t(lang, on ? 'stopReading' : 'readAloud')}
      onClick={() => { if (on) { stop?.(); setOn(false); return; } setOn(true); setStop(() => speak(text, lang, () => setOn(false))); }}>🔊</button>
  );
}

/**
 * The then-and-now sentence for each card, in the patient's language. Improvements are said plainly; anything worse gets the
 * same neutral line. Never a tier, flag, rule, expected band, or advice to change exercises.
 */
export function progressLines(p: Patient, pack: ProtocolPack, today: string, lang: Lang) {
  const T = (k: string, x?: Record<string, string | number>) => t(lang, k, x);
  const pain = painCard(p, today), ex = exerciseCard(p, today), knee = kneeCard(p), goal = goalCard(p), leg = legLine(p, pack);
  return {
    pain: pain && (pain.trend === 'worse' ? T('harder') : T(pain.trend === 'better' ? 'painBetter' : 'painSame', { a: pain.first, b: pain.now })),
    ex: ex && `${T('exLine', { a: ex.last7, b: ex.last28 })}${ex.trend === 'better' ? ` ${T('exBetter')}` : ex.trend === 'worse' ? ` ${T('harder')}` : ''}`,
    knee: knee && (knee.trend === 'worse' ? T('harder') : T(knee.trend === 'better' ? 'kneeBetter' : 'kneeSame', { a: knee.first, b: knee.now })),
    goal: goal && (goal.trend === 'worse' ? `${goal.goal}. ${T('harder')}` : T('goalLine', { goal: goal.goal, a: goal.first, b: goal.now })),
    leg: leg && `${T('legLine', { x: leg.now, what: L(leg.label, lang) })}${leg.earlier !== null ? ` ${T('legEarlier', { y: leg.earlier })}` : ''}`,
    data: { pain, ex, knee, goal },
  };
}

/** A simple line or dot chart, no axes or bands. */
function Mini({ series, yMin, yMax }: { series: { pts: Pt[]; kind: 'line' | 'hollow' | 'square' | 'dashed'; color: string }[]; yMin?: number; yMax?: number }) {
  const all = series.flatMap((s) => s.pts);
  if (!all.length) return null;
  const W = 300, H = 72;
  const xs = all.map((q) => q.x), ys = all.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = yMin ?? Math.min(...ys), y1 = yMax ?? Math.max(...ys);
  const X = (x: number) => 8 + ((x - x0) / (x1 - x0 || 1)) * (W - 16);
  const Y = (y: number) => H - 8 - ((y - y0) / (y1 - y0 || 1)) * (H - 16);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="minichart" role="presentation" aria-hidden="true">
      {series.map((s, i) => s.kind === 'line' || s.kind === 'dashed'
        ? <path key={i} d={s.pts.map((q, k) => `${k ? 'L' : 'M'}${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.kind === 'dashed' ? '5 4' : undefined} />
        : s.pts.map((q, k) => s.kind === 'square'
          ? <rect key={`${i}-${k}`} x={X(q.x) - 4.5} y={Y(q.y) - 4.5} width="9" height="9" fill={s.color} />
          : <circle key={`${i}-${k}`} cx={X(q.x)} cy={Y(q.y)} r="4.5" fill="#fff" stroke={s.color} strokeWidth="2" />))}
    </svg>
  );
}

function Card({ title, line, lang, children }: { title: string; line: string | null; lang: Lang; children?: React.ReactNode }) {
  return (
    <section className="progcard">
      <div className="progcard-head"><h3>{title}</h3>{line && <Speak key={line} text={`${title}. ${line}`} lang={lang} />}</div>
      {line ? <><p>{line}</p>{children}</> : <p className="tiny">{t(lang, 'notEnough')}</p>}
    </section>
  );
}

/** The patient's "My progress" screen. */
export function MyProgress({ patient, pack, lang, today, physioName, onBack }: { patient: Patient; pack: ProtocolPack; lang: Lang; today: string; physioName?: string; onBack: () => void }) {
  const T = (k: string, x?: Record<string, string | number>) => t(lang, k, x);
  const l = progressLines(patient, pack, today, lang);
  const [share, setShare] = useState(false);
  const { pain, ex, knee, goal } = l.data;
  return (
    <main className="myprogress" data-testid="my-progress">
      <button className="back" onClick={onBack}>← {T('backHome')}</button>
      <h2>{T('myProgress')}</h2>
      <Card title={T('progPain')} line={l.pain} lang={lang}>{pain && <Mini series={[{ pts: pain.pts, kind: 'line', color: '#0a6b6b' }]} yMin={0} yMax={10} />}</Card>
      <Card title={T('progExercises')} line={l.ex} lang={lang}>
        {ex && <div className="exbars" aria-hidden="true">{ex.days.map((d, i) => <i key={i} className={d === null ? 'na' : d ? 'on' : ''} />)}</div>}
      </Card>
      <Card title={T('progKnee')} line={l.knee} lang={lang}>
        {knee && <>
          <Mini series={[{ pts: [...knee.home, ...knee.clinic].sort((a, b) => a.x - b.x), kind: 'line', color: '#9cc4c4' }, { pts: knee.home, kind: 'hollow', color: '#0a6b6b' }, { pts: knee.clinic, kind: 'square', color: '#12355b' }, ...(knee.other.length > 1 ? [{ pts: knee.other, kind: 'dashed' as const, color: '#8a979c' }] : [])]} />
          <p className="proglegend">{knee.home.length > 0 && <span><i className="lg-hollow" /> {T('atHome')}</span>}{knee.clinic.length > 0 && <span><i className="lg-square" /> {T('inClinic')}</span>}{knee.other.length > 1 && <span><i className="lg-dash" /> {T('otherLegLine')}</span>}</p>
        </>}
      </Card>
      {l.leg && <p className="legline">{l.leg} <Speak key={l.leg} text={l.leg} lang={lang} /></p>}
      <Card title={T('progGoal')} line={l.goal} lang={lang}>{goal && <Mini series={[{ pts: goal.pts, kind: 'line', color: '#0a6b6b' }]} yMin={0} yMax={100} />}</Card>
      <button className="big secondary" onClick={() => setShare(true)} data-testid="share-progress">{T('shareProgress')}</button>
      {share && <ProgressSheet patient={patient} pack={pack} lang={lang} today={today} physioName={physioName} onClose={() => setShare(false)} />}
    </main>
  );
}

/**
 * One-page summary: name, weeks since start, the then-and-now lines and the physio's name. "Send on WhatsApp" opens
 * WhatsApp with the text; "Save as PDF" prints just this page (the browser's Save as PDF). The physio's report adds notes.
 */
export function ProgressSheet({ patient: p, pack, lang, today, physioName, notes, to, onClose, onSent }: {
  patient: Patient; pack: ProtocolPack; lang: Lang; today: string; physioName?: string; notes?: string;
  /** Phone number to send to (the physio's report); without it WhatsApp asks whom to send to. */
  to?: string; onClose: () => void; onSent?: (how: 'whatsapp' | 'pdf') => void;
}) {
  const T = (k: string, x?: Record<string, string | number>) => t(lang, k, x);
  const l = progressLines(p, pack, today, lang);
  const lines: [string, string | null][] = [[T('progPain'), l.pain], [T('progExercises'), l.ex], [T('progKnee'), l.knee], [T('progGoal'), l.goal]];
  const who = physioName?.trim(); // only a name the physio entered; never a made-up one
  const text = [`${T('summaryTitle')}: ${p.name}`, T('weekN', { n: weeksSinceStart(p, today) }),
    ...lines.map(([k, v]) => `${k}: ${v ?? T('notEnough')}`), ...(l.leg ? [l.leg] : []), ...(notes?.trim() ? [notes.trim()] : []), ...(who ? [T('physioIs', { name: who })] : []), T('notDiagnosis')].join('\n');
  useEffect(() => { document.body.classList.add('has-printsheet'); return () => document.body.classList.remove('has-printsheet'); }, []);
  const print = () => { onSent?.('pdf'); window.print(); };
  return createPortal(
    <div className="printsheet" role="dialog" aria-label={T('summaryTitle')} lang={lang}>
      <article className="printpage" data-testid="progress-sheet">
        <header><h1>{T('summaryTitle')}</h1><p className="sub">{p.name} · {T('weekN', { n: weeksSinceStart(p, today) })} · {today.split('-').reverse().join('/')}</p></header>
        <dl>{lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? T('notEnough')}</dd></div>)}</dl>
        {l.leg && <p>{l.leg}</p>}
        {notes?.trim() && <section className="printnotes"><p>{notes.trim()}</p></section>}
        <footer>{who && <p>{T('physioIs', { name: who })}</p>}<p className="tiny">{T('notDiagnosis')}</p></footer>
      </article>
      <div className="printbtns no-print">
        <a className="big primary" href={to ? `${waHref(to)}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" onClick={() => onSent?.('whatsapp')}>{T('sendWhatsApp')}</a>
        <button type="button" className="big secondary" onClick={print}>{T('savePdf')}</button>
        <button type="button" className="linkbtn" onClick={onClose}>{T('closeSheet')}</button>
      </div>
    </div>,
    document.body,
  );
}
