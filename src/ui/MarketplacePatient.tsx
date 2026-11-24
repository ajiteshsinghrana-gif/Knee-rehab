import { useMemo, useState } from 'react';
import { L } from '../i18n';
import type { Lang } from '../types';
import { SCREENING_PACK as PACK, flagsForArea, screen, type AreaId, type DurationId, type FunctionId, type ScreeningAnswers } from '../marketplace/screening';
import { matchPhysios, type Match, type Prefs } from '../marketplace/match';
import { LOCALITIES, slotsFor, type ConsultMode, type Slot } from '../marketplace/physios';
import { bookSlot, takenSlots, type Booking } from '../marketplace/ledger';
import { getMp, setMp } from '../marketplace/store';
import { tr } from '../marketplace/strings';

const STEPS = 4;
const modeLabel = (m: ConsultMode, lang: Lang) => tr(m, lang);
const fmtDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function PatientFlow({ lang, today, nowIso }: { lang: Lang; today: string; nowIso: string }) {
  const [step, setStep] = useState(0); // 0 intro, 1..4 questions, 5 result
  const [a, setA] = useState<ScreeningAnswers>({ area: 'back', duration: 'lt2w', severity: 0, function: 'none', recentSurgery: false, priorEpisodes: false, flags: [] });
  const [picked, setPicked] = useState({ area: false, duration: false, function: false });
  const [prefs, setPrefs] = useState<Prefs>({ mode: 'any', locality: '', maxFee: null, language: lang });
  const [override, setOverride] = useState(false);
  const [done, setDone] = useState<Booking | null>(null);
  const result = useMemo(() => (step === 5 ? screen(a) : null), [step, a]);
  const set = <K extends keyof ScreeningAnswers>(k: K, v: ScreeningAnswers[K]) => setA((x) => ({ ...x, [k]: v }));
  const reset = () => { setStep(0); setA({ area: 'back', duration: 'lt2w', severity: 0, function: 'none', recentSurgery: false, priorEpisodes: false, flags: [] }); setPicked({ area: false, duration: false, function: false }); setOverride(false); setDone(null); };
  const canNext = step === 1 ? picked.area : step === 2 ? picked.duration && picked.function : true;

  if (step === 0) return (
    <section className="card mp-flow" data-testid="mp-intro">
      <h2>{tr('freeCheck', lang)}</h2>
      <p>{tr('intro', lang)}</p>
      <p className="disclaimer">{L(PACK.disclaimer, lang)}</p>
      <div className="btnrow"><button className="btn primary" data-testid="mp-start" onClick={() => setStep(1)}>{tr('start', lang)}</button></div>
    </section>
  );

  if (result) return (
    <ResultView lang={lang} a={a} result={result} prefs={prefs} setPrefs={setPrefs} override={override} setOverride={setOverride} today={today} nowIso={nowIso} done={done} setDone={setDone} reset={reset} back={() => setStep(4)} />
  );

  return (
    <section className="card mp-flow" data-testid={`mp-step-${step}`}>
      <p className="mp-stepline"><span>{tr('stepOf', lang, { n: step, total: STEPS })}</span><span className="mp-bar" aria-hidden><i style={{ width: `${(step / STEPS) * 100}%` }} /></span></p>
      {step === 1 && (<>
        <h2>{tr('qArea', lang)}</h2>
        <div className="mp-choices">{PACK.areas.map((x) => (
          <button key={x.id} type="button" className={`mp-choice${picked.area && a.area === x.id ? ' on' : ''}`} aria-pressed={picked.area && a.area === x.id} data-testid={`area-${x.id}`} onClick={() => { set('area', x.id as AreaId); set('flags', []); setPicked((p) => ({ ...p, area: true })); }}><span aria-hidden>{x.icon}</span>{L(x.label, lang)}</button>
        ))}</div>
      </>)}
      {step === 2 && (<>
        <h2>{tr('qDuration', lang)}</h2>
        <div className="mp-choices">{PACK.durations.map((x) => (
          <button key={x.id} type="button" className={`mp-choice${picked.duration && a.duration === x.id ? ' on' : ''}`} aria-pressed={picked.duration && a.duration === x.id} data-testid={`dur-${x.id}`} onClick={() => { set('duration', x.id as DurationId); setPicked((p) => ({ ...p, duration: true })); }}>{L(x.label, lang)}</button>
        ))}</div>
        <h2>{tr('qFunction', lang)}</h2>
        <div className="mp-choices">{PACK.functions.map((x) => (
          <button key={x.id} type="button" className={`mp-choice${picked.function && a.function === x.id ? ' on' : ''}`} aria-pressed={picked.function && a.function === x.id} data-testid={`fn-${x.id}`} onClick={() => { set('function', x.id as FunctionId); setPicked((p) => ({ ...p, function: true })); }}>{L(x.label, lang)}</button>
        ))}</div>
      </>)}
      {step === 3 && (<>
        <h2>{tr('qSeverity', lang)}</h2>
        <div className="mp-scale" role="radiogroup" aria-label={tr('qSeverity', lang)}>{Array.from({ length: 11 }, (_, i) => (
          <button key={i} type="button" role="radio" aria-checked={a.severity === i} className={a.severity === i ? 'on' : ''} data-testid={`sev-${i}`} onClick={() => set('severity', i)}>{i}</button>
        ))}</div>
        <p className="mp-scalelabels"><small>{tr('sev0', lang)}</small><small>{tr('sev10', lang)}</small></p>
        <YesNo q={tr('qSurgery', lang)} lang={lang} v={a.recentSurgery} on={(v) => set('recentSurgery', v)} id="surgery" />
        <YesNo q={tr('qPrior', lang)} lang={lang} v={a.priorEpisodes} on={(v) => set('priorEpisodes', v)} id="prior" />
      </>)}
      {step === 4 && (<>
        <h2>{tr('qFlags', lang)}</h2>
        <p className="sub">{tr('flagsHint', lang)}</p>
        <ul className="mp-flags">{flagsForArea(a.area).map((f) => (
          <li key={f.id}><label><input type="checkbox" data-testid={`flag-${f.id}`} checked={a.flags.includes(f.id)} onChange={(e) => set('flags', e.target.checked ? [...a.flags, f.id] : a.flags.filter((x) => x !== f.id))} /> <span>{L(f.label, lang)}</span></label></li>
        ))}</ul>
      </>)}
      <div className="btnrow">
        <button className="btn" onClick={() => setStep(step - 1)}>{tr('back', lang)}</button>
        {step < STEPS ? <button className="btn primary" disabled={!canNext} data-testid="mp-next" onClick={() => setStep(step + 1)}>{tr('next', lang)}</button>
          : <button className="btn primary" data-testid="mp-result" onClick={() => setStep(5)}>{tr('seeResult', lang)}</button>}
      </div>
    </section>
  );
}

function YesNo({ q, v, on, lang, id }: { q: string; v: boolean; on: (v: boolean) => void; lang: Lang; id: string }) {
  return (
    <div className="mp-yn"><span id={`yn-${id}`}>{q}</span>
      <span className="mp-ynbtns" role="group" aria-labelledby={`yn-${id}`}>
        <button type="button" className={!v ? 'on' : ''} aria-pressed={!v} onClick={() => on(false)}>{tr('no', lang)}</button>
        <button type="button" className={v ? 'on' : ''} aria-pressed={v} data-testid={`yes-${id}`} onClick={() => on(true)}>{tr('yes', lang)}</button>
      </span>
    </div>
  );
}

type Result = ReturnType<typeof screen>;
function ResultView({ lang, a, result, prefs, setPrefs, override, setOverride, today, nowIso, done, setDone, reset, back }: {
  lang: Lang; a: ScreeningAnswers; result: Result; prefs: Prefs; setPrefs: (p: Prefs) => void; override: boolean; setOverride: (b: boolean) => void;
  today: string; nowIso: string; done: Booking | null; setDone: (b: Booking | null) => void; reset: () => void; back: () => void;
}) {
  const red = result.tier === 'RED_FLAG';
  const showList = result.tier === 'PHYSIO' || (result.tier === 'LOW_RISK' && override);
  const cls = red ? (result.urgency === 'now' ? 'mp-res now' : 'mp-res soon') : result.tier === 'PHYSIO' ? 'mp-res physio' : 'mp-res low';
  return (
    <section className="mp-flow" data-testid={`mp-result-${result.tier}`}>
      <div className={`card ${cls}`} role={red ? 'alert' : 'status'}>
        <h2>{L(result.headline, lang)}</h2>
        <p>{L(result.body, lang)}</p>
        {result.urgency === 'now' && <a className="btn primary mp-call" href="tel:112">{tr('emergencyCall', lang)}</a>}
        {result.triggered.length > 0 && (
          <details open={red}><summary>{tr('whyThis', lang)}</summary>
            <ul className="mp-why">{result.triggered.map((t) => <li key={t.id}>{L(t.why, lang)}</li>)}</ul>
          </details>
        )}
        {red && <p className="mp-nobook" data-testid="mp-nobook"><b>{tr('noBooking', lang)}</b></p>}
        <p className="disclaimer">{L(PACK.disclaimer, lang)}</p>
        <div className="btnrow">
          <button className="btn" onClick={back}>{tr('back', lang)}</button>
          <button className="btn" onClick={reset}>{tr('startOver', lang)}</button>
          {result.tier === 'LOW_RISK' && !override && <button className="btn primary" data-testid="mp-anyway" onClick={() => setOverride(true)}>{tr('showAnyway', lang)}</button>}
        </div>
      </div>
      {showList && (done ? <Confirmation lang={lang} b={done} onAgain={() => setDone(null)} reset={reset} /> : <PhysioList lang={lang} a={a} result={result} prefs={prefs} setPrefs={setPrefs} today={today} nowIso={nowIso} onBooked={setDone} />)}
    </section>
  );
}

function Confirmation({ lang, b, onAgain, reset }: { lang: Lang; b: Booking; onAgain: () => void; reset: () => void }) {
  return (
    <div className="card mp-done" data-testid="mp-confirmed" role="status">
      <h3>✓ {tr('booked', lang)}</h3>
      <p>{tr('bookedBody', lang, { name: b.physioName, date: fmtDate(b.slot.date), time: b.slot.time, mode: modeLabel(b.mode, lang), fee: b.fee })}</p>
      <div className="btnrow"><button className="btn" onClick={onAgain}>{tr('findPhysios', lang)}</button><button className="btn" onClick={reset}>{tr('startOver', lang)}</button></div>
    </div>
  );
}

function PhysioList({ lang, a, result, prefs, setPrefs, today, nowIso, onBooked }: { lang: Lang; a: ScreeningAnswers; result: Result; prefs: Prefs; setPrefs: (p: Prefs) => void; today: string; nowIso: string; onBooked: (b: Booking) => void }) {
  const mp = getMp();
  const p = { ...prefs, language: lang };
  const matches = matchPhysios(result, p, mp.physios, (id) => takenSlots(mp, id), today);
  const [open, setOpen] = useState<string | null>(null);
  const verified = mp.physios.some((x) => x.status === 'verified');
  return (
    <div className="mp-list">
      <h2>{tr('findPhysios', lang)}</h2>
      <div className="mp-filters card">
        <label>{tr('visitType', lang)}
          <select value={prefs.mode} data-testid="f-mode" onChange={(e) => setPrefs({ ...prefs, mode: e.target.value as Prefs['mode'] })}>
            <option value="any">{tr('anyType', lang)}</option><option value="online">{tr('online', lang)}</option><option value="clinic">{tr('clinic', lang)}</option><option value="home">{tr('home', lang)}</option>
          </select></label>
        <label>{tr('yourArea', lang)}
          <select value={prefs.locality} data-testid="f-locality" onChange={(e) => setPrefs({ ...prefs, locality: e.target.value })}>
            <option value="">—</option>{LOCALITIES.map((l) => <option key={l}>{l}</option>)}
          </select></label>
        <label>{tr('budget', lang)}
          <select value={prefs.maxFee ?? ''} data-testid="f-fee" onChange={(e) => setPrefs({ ...prefs, maxFee: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{tr('anyBudget', lang)}</option>{[500, 800, 1200].map((n) => <option key={n} value={n}>{tr('upTo', lang, { n })}</option>)}
          </select></label>
      </div>
      {!verified && <p className="card">{tr('noPhysiosLive', lang)}</p>}
      {verified && !matches.length && <p className="card">{tr('noMatch', lang)}</p>}
      {matches.map((m) => (
        <PhysioCard key={m.physio.id} lang={lang} m={m} open={open === m.physio.id} onOpen={() => setOpen(open === m.physio.id ? null : m.physio.id)}
          a={a} today={today} nowIso={nowIso} onBooked={onBooked} />
      ))}
    </div>
  );
}

function PhysioCard({ lang, m, open, onOpen, a, today, nowIso, onBooked }: { lang: Lang; m: Match; open: boolean; onOpen: () => void; a: ScreeningAnswers; today: string; nowIso: string; onBooked: (b: Booking) => void }) {
  const p = m.physio;
  const specs = p.specialties.map((s) => PACK.specialties.find((x) => x.id === s)?.label).filter(Boolean);
  return (
    <article className="card mp-physio" data-testid={`physio-${p.id}`}>
      <header>
        <div>
          <h3>{p.name} <span className="mp-badge ok" title={tr('verified', lang)}>✓ {tr('verified', lang)}</span>{m.featured && <span className="mp-badge">{tr('featured', lang)}</span>}</h3>
          <small>{p.qualification} · {tr('yearsExp', lang, { n: p.years })}{p.reviews ? ` · ★ ${p.rating.toFixed(1)} (${p.reviews})` : ''}</small>
        </div>
        <div className="mp-fee"><b>{tr('from', lang, { n: m.fromFee })}</b><small>{m.modes.map((x) => modeLabel(x, lang)).join(' · ')}</small></div>
      </header>
      <p className="chips">{specs.map((s, i) => <i key={i}>{L(s!, lang)}</i>)}<i>{p.locality}</i></p>
      <p className="mp-bio">{p.bio}</p>
      {m.reasons.length > 0 && <ul className="mp-reasons">{m.reasons.map((r, i) => <li key={i}>{L(r, lang)}</li>)}</ul>}
      <p className="mp-next"><small>{tr('nextFree', lang)}: {m.next ? <b>{fmtDate(m.next.date)}, {m.next.time}</b> : tr('noSlots', lang)}</small></p>
      <div className="btnrow"><button className="btn primary" data-testid={`book-${p.id}`} disabled={!m.next} onClick={onOpen}>{open ? tr('close', lang) : tr('book', lang)}</button></div>
      {open && <BookingForm lang={lang} m={m} a={a} today={today} nowIso={nowIso} onBooked={onBooked} />}
    </article>
  );
}

function BookingForm({ lang, m, a, today, nowIso, onBooked }: { lang: Lang; m: Match; a: ScreeningAnswers; today: string; nowIso: string; onBooked: (b: Booking) => void }) {
  const p = m.physio;
  const [mode, setMode] = useState<ConsultMode>(m.modes[0]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState('');
  const slots = slotsFor(p, takenSlots(getMp(), p.id), today, 7).slice(0, 12);
  const submit = () => {
    if (!slot) { setErr(tr('chooseTime', lang)); return; }
    const r = bookSlot(getMp(), { physioId: p.id, mode, slot, patientName: name, phone, answers: a, consent, nowIso, today });
    if (!r.ok) { setErr(r.error); return; }
    setMp(r.state); onBooked(r.booking!);
  };
  return (
    <div className="mp-book" data-testid="mp-bookform">
      {m.modes.length > 1 && <div className="mp-choices small" role="radiogroup" aria-label={tr('visitType', lang)}>{m.modes.map((x) => (
        <button key={x} type="button" role="radio" aria-checked={mode === x} className={`mp-choice${mode === x ? ' on' : ''}`} onClick={() => setMode(x)}>{modeLabel(x, lang)} · ₹{p.fees[x]}</button>
      ))}</div>}
      <h4>{tr('chooseTime', lang)}</h4>
      <div className="mp-slots">{slots.map((s) => (
        <button key={s.date + s.time} type="button" className={slot && slot.date === s.date && slot.time === s.time ? 'on' : ''} data-testid={`slot-${s.date}-${s.time}`} onClick={() => setSlot(s)}>{fmtDate(s.date)} · {s.time}</button>
      ))}</div>
      <label className="mp-field">{tr('yourName', lang)}<input value={name} data-testid="b-name" onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      <label className="mp-field">{tr('yourMobile', lang)}<input value={phone} data-testid="b-phone" inputMode="tel" onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></label>
      <label className="mp-check"><input type="checkbox" data-testid="b-consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>{tr('consent', lang)}</span></label>
      {err && <p className="mp-err" role="alert" data-testid="b-error">{err}</p>}
      <div className="btnrow"><button className="btn primary" data-testid="b-confirm" onClick={submit}>{tr('confirm', lang)}</button></div>
    </div>
  );
}
