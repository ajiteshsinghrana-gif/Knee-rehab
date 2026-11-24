import { useState } from 'react';
import { SCREENING_PACK as PACK } from '../marketplace/screening';
import { FEE_CONFIG } from '../marketplace/fees';
import { setBookingStatus, markEnrolled, takenSlots, type Booking, type MpState } from '../marketplace/ledger';
import { getMp, setMp } from '../marketplace/store';
import { getState, setState, clockMs } from '../store';
import { enrolInRehabPath } from '../marketplace/handoff';
import { slotsFor } from '../marketplace/physios';
import { setPlan } from '../marketplace/ledger';

const rupee = (n: number) => '₹' + n.toLocaleString('en-IN');
const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const areaName = (id: string) => PACK.areas.find((a) => a.id === id)?.label.en ?? id;
const durName = (id: string) => PACK.durations.find((a) => a.id === id)?.label.en ?? id;
const fnName = (id: string) => PACK.functions.find((a) => a.id === id)?.label.en ?? id;

/** What the physio sees before the visit: the screening summary that makes a mismatched consultation less likely. */
function Summary({ b }: { b: Booking }) {
  const s = b.screening;
  const why = PACK.rules.filter((r) => s.rules.includes(r.id));
  return (
    <details className="mp-sum"><summary>Screening summary</summary>
      <ul>
        <li>Area: <b>{areaName(s.area)}</b> · {durName(s.duration)} · pain <b>{s.severity}/10</b></li>
        <li>Daily activities: {fnName(s.function)}</li>
        <li>Surgery in last 12 weeks: {s.recentSurgery ? 'yes' : 'no'} · Came and went before: {s.priorEpisodes ? 'yes' : 'no'}</li>
        <li>No red-flag symptom reported at booking.</li>
        {why.map((r) => <li key={r.id}><code>{r.id}</code> {r.why.en}</li>)}
      </ul>
    </details>
  );
}

export function PhysioPortal({ mp, today }: { mp: MpState; today: string }) {
  const verified = mp.physios.filter((p) => p.status === 'verified');
  const [id, setId] = useState('');
  const [msg, setMsg] = useState('');
  const p = verified.find((x) => x.id === id) ?? verified[0];
  if (!p) return <section className="card"><h2>Physio portal</h2><p>No verified physiotherapists yet. Register one in the Admin view, then verify them.</p></section>;
  const mine = mp.bookings.filter((b) => b.physioId === p.id);
  const upcoming = mine.filter((b) => b.status === 'booked').sort((x, y) => (x.slot.date + x.slot.time).localeCompare(y.slot.date + y.slot.time));
  const finished = mine.filter((b) => b.status !== 'booked');
  const done = mine.filter((b) => b.split);
  const gross = done.reduce((n, b) => n + b.split!.fee, 0), comm = done.reduce((n, b) => n + b.split!.commission, 0), pay = done.reduce((n, b) => n + b.split!.payout, 0);
  const free = slotsFor(p, takenSlots(mp, p.id), today, 7).length;
  const cfg = FEE_CONFIG.commissionPct[p.plan];
  const act = (b: Booking, to: 'completed' | 'cancelled' | 'no-show') => { const r = setBookingStatus(getMp(), b.id, to); if (r.ok) { setMp(r.state); setMsg(''); } else setMsg(r.error); };
  const enrol = (b: Booking) => {
    const app = getState();
    const r = enrolInRehabPath(app, b, clockMs(app), app.today);
    if ('error' in r) { setMsg(r.error); return; }
    setState(r.state); setMp(markEnrolled(getMp(), b.id, r.patientId)); setMsg(`${b.patientName} is now on the Physio dashboard for follow-up.`);
  };
  return (
    <section className="mp-portal" data-testid="mp-portal">
      <div className="card">
        <label className="mp-field">Signed in as
          <select value={p.id} data-testid="mp-as" onChange={(e) => setId(e.target.value)}>{verified.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <div className="mp-stats">
          <div><b>{upcoming.length}</b><small>upcoming</small></div>
          <div><b>{free}</b><small>free slots this week</small></div>
          <div><b>{done.length}</b><small>completed</small></div>
          <div><b>{rupee(pay)}</b><small>your earnings</small></div>
        </div>
        <p><small>Plan: <b>{p.plan === 'pro' ? 'Pro' : 'Basic (free listing)'}</b>. Platform commission on completed visits: online {cfg.online}%, clinic {cfg.clinic}%, home {cfg.home}%.{' '}
          <button className="link" onClick={() => setMp(setPlan(getMp(), p.id, p.plan === 'pro' ? 'basic' : 'pro'))}>{p.plan === 'pro' ? 'Switch to Basic' : `Try Pro (${rupee(FEE_CONFIG.subscription.pro)}/month, lower commission, featured tag)`}</button></small></p>
        {msg && <p className="mp-note" role="status" data-testid="mp-msg">{msg}</p>}
      </div>
      <div className="card">
        <h3>Upcoming enquiries</h3>
        {!upcoming.length && <p className="sub">No upcoming bookings. Book one from the Find a physio view.</p>}
        <ul className="mp-bookings">{upcoming.map((b) => (
          <li key={b.id} data-testid={`bk-${b.id}`}>
            <div className="mp-bk"><b>{fmt(b.slot.date)}, {b.slot.time}</b> · {b.patientName} · {b.mode} · {rupee(b.fee)} <small>· {b.phone}</small></div>
            <Summary b={b} />
            <div className="btnrow"><button className="btn primary" data-testid={`done-${b.id}`} onClick={() => act(b, 'completed')}>Mark completed</button><button className="btn" onClick={() => act(b, 'no-show')}>No-show</button><button className="btn" onClick={() => act(b, 'cancelled')}>Cancel</button></div>
          </li>))}</ul>
      </div>
      <div className="card">
        <h3>Past visits</h3>
        {!finished.length && <p className="sub">Nothing yet.</p>}
        <ul className="mp-bookings">{finished.map((b) => (
          <li key={b.id}>
            <div className="mp-bk"><b>{fmt(b.slot.date)}, {b.slot.time}</b> · {b.patientName} · {b.status}
              {b.split && <> · fee {rupee(b.split.fee)}, platform {rupee(b.split.commission)} ({b.split.pct}%), you {rupee(b.split.payout)}</>}</div>
            {b.status === 'completed' && (b.enrolledPatientId ? <small>In RehabPath follow-up.</small> : <div className="btnrow"><button className="btn" data-testid={`enrol-${b.id}`} onClick={() => enrol(b)}>Move to RehabPath follow-up</button></div>)}
          </li>))}</ul>
        {done.length > 0 && <p><small>Totals: fees {rupee(gross)}, platform {rupee(comm)}, yours {rupee(pay)}.</small></p>}
      </div>
    </section>
  );
}
