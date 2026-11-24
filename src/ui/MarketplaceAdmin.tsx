import { useState } from 'react';
import { SCREENING_PACK as PACK } from '../marketplace/screening';
import { FEE_CONFIG } from '../marketplace/fees';
import { decideVerification, registerPhysio, revenue, setPlan, type MpState } from '../marketplace/ledger';
import { LOCALITIES, MODES, type ConsultMode } from '../marketplace/physios';
import { getMp, resetMp, setMp } from '../marketplace/store';

const rupee = (n: number) => '₹' + n.toLocaleString('en-IN');

export function Admin({ mp, live }: { mp: MpState; live: boolean }) {
  const r = revenue(mp);
  const pending = mp.physios.filter((p) => p.status === 'pending');
  const platform = r.commission + r.subscriptions;
  const [err, setErr] = useState('');
  const decide = (id: string, to: 'verified' | 'rejected') => { const x = decideVerification(getMp(), id, to); if (x.ok) setMp(x.state); else setErr(x.error); };
  return (
    <section className="mp-admin" data-testid="mp-admin">
      <div className="card">
        <h2>Marketplace revenue</h2>
        <div className="mp-stats">
          <div><b>{rupee(r.gmv)}</b><small>fees from completed visits</small></div>
          <div><b data-testid="rev-commission">{rupee(r.commission)}</b><small>commission earned</small></div>
          <div><b>{rupee(r.subscriptions)}</b><small>Pro subscriptions / month ({r.proCount})</small></div>
          <div><b data-testid="rev-platform">{rupee(platform)}</b><small>platform revenue</small></div>
        </div>
        <table className="gate"><thead><tr><th align="left">Visit type</th><th align="right">Completed</th><th align="right">Fees</th><th align="right">Commission</th></tr></thead>
          <tbody>{MODES.map((m) => <tr key={m}><td>{m}</td><td align="right">{r.byMode[m].count}</td><td align="right">{rupee(r.byMode[m].gmv)}</td><td align="right">{rupee(r.byMode[m].commission)}</td></tr>)}</tbody></table>
        <p><small>Upcoming {r.upcoming} · cancelled {r.cancelled} · no-show {r.noShow}. Commission is counted only when a visit is marked completed.</small></p>
        <p className="disclaimer">Commission rates ({JSON.stringify(FEE_CONFIG.commissionPct.basic)} basic) and the Pro price are placeholders ({FEE_CONFIG.review}), not agreed numbers.</p>
      </div>
      <div className="card" data-testid="mp-queue">
        <h3>Verification queue ({pending.length})</h3>
        {err && <p className="mp-err" role="alert">{err}</p>}
        {!pending.length && <p className="sub">No applications waiting.</p>}
        <ul className="mp-bookings">{pending.map((p) => (
          <li key={p.id} data-testid={`pending-${p.id}`}>
            <div className="mp-bk"><b>{p.name}</b> · {p.qualification} · {p.years} yrs · {p.locality}<br /><small>Registration: <code>{p.registration}</code> · fees {MODES.filter((m) => p.fees[m] !== undefined).map((m) => `${m} ${rupee(p.fees[m]!)}`).join(', ')}</small></div>
            <p className="notice left">Check the registration number with the state council before approving. Nothing is checked automatically.</p>
            <div className="btnrow"><button className="btn primary" data-testid={`verify-${p.id}`} onClick={() => decide(p.id, 'verified')}>Verify</button><button className="btn" onClick={() => decide(p.id, 'rejected')}>Reject</button></div>
          </li>))}</ul>
      </div>
      <Register />
      <div className="card">
        <h3>Roster</h3>
        <table className="gate"><thead><tr><th align="left">Name</th><th align="left">Status</th><th align="left">Plan</th><th align="left">Locality</th></tr></thead>
          <tbody>{mp.physios.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.status}</td><td>{p.status === 'verified' ? <button className="link" onClick={() => setMp(setPlan(getMp(), p.id, p.plan === 'pro' ? 'basic' : 'pro'))}>{p.plan}</button> : p.plan}</td><td>{p.locality}</td></tr>))}
          </tbody></table>
        {!mp.physios.length && <p className="sub">No physiotherapists yet.</p>}
        {!live && <div className="btnrow"><button className="btn" data-testid="mp-reset" onClick={resetMp}>Reset marketplace demo</button></div>}
      </div>
    </section>
  );
}

function Register() {
  const empty = { name: '', qualification: '', registration: '', years: 0, locality: LOCALITIES[0], bio: '' };
  const [f, setF] = useState(empty);
  const [specs, setSpecs] = useState<string[]>([]);
  const [modes, setModes] = useState<ConsultMode[]>(['clinic']);
  const [fees, setFees] = useState<Partial<Record<ConsultMode, number>>>({ clinic: 500 });
  const [msg, setMsg] = useState('');
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const submit = () => {
    const r = registerPhysio(getMp(), { ...f, specialties: specs, modes, fees });
    if (!r.ok) { setMsg(r.error); return; }
    setMp(r.state); setMsg('Application received. It is pending until it is verified.'); setF(empty); setSpecs([]);
  };
  return (
    <details className="card"><summary><h3 style={{ display: 'inline' }}>Register a physiotherapist</h3></summary>
      <div className="mp-form">
        <label className="mp-field">Name<input value={f.name} data-testid="r-name" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="mp-field">Qualification<input value={f.qualification} data-testid="r-qual" onChange={(e) => setF({ ...f, qualification: e.target.value })} placeholder="BPT, MPT (Sports)" /></label>
        <label className="mp-field">Registration number<input value={f.registration} data-testid="r-reg" onChange={(e) => setF({ ...f, registration: e.target.value })} /></label>
        <label className="mp-field">Years of experience<input type="number" min={0} max={60} value={f.years} onChange={(e) => setF({ ...f, years: Number(e.target.value) })} /></label>
        <label className="mp-field">Clinic locality<select value={f.locality} onChange={(e) => setF({ ...f, locality: e.target.value })}>{LOCALITIES.map((l) => <option key={l}>{l}</option>)}</select></label>
        <fieldset><legend>Specialisations</legend>{PACK.specialties.map((s) => <label key={s.id} className="mp-check"><input type="checkbox" data-testid={`r-spec-${s.id}`} checked={specs.includes(s.id)} onChange={() => setSpecs(toggle(specs, s.id))} /> {s.label.en}</label>)}</fieldset>
        <fieldset><legend>Visits offered and fee (₹)</legend>{MODES.map((m) => (
          <div key={m} className="mp-check"><label><input type="checkbox" checked={modes.includes(m)} onChange={() => setModes(toggle(modes, m))} /> {m}</label>
            {modes.includes(m) && <input type="number" aria-label={`${m} fee`} value={fees[m] ?? ''} data-testid={`r-fee-${m}`} onChange={(e) => setFees({ ...fees, [m]: Number(e.target.value) })} />}</div>))}</fieldset>
        <label className="mp-field">Short bio<textarea value={f.bio} maxLength={300} onChange={(e) => setF({ ...f, bio: e.target.value })} /></label>
        {msg && <p className="mp-note" role="status" data-testid="r-msg">{msg}</p>}
        <div className="btnrow"><button className="btn primary" data-testid="r-submit" onClick={submit}>Submit for verification</button></div>
      </div>
    </details>
  );
}
