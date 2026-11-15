import { useEffect, useState, useSyncExternalStore } from 'react';
import { getState, resetState, setState, subscribe, updatePatient } from '../store';
import { DEMO_STEPS, demoStepPatient } from '../demo/seed';
import { addDays } from '../engine/dates';
import { getPack } from '../engine/packs';
import { decodeInvite } from '../onboarding';
import { PatientView } from './Patient';
import { Clinician } from './Clinician';
import { getSyncStatus, subscribeSync } from '../sync/engine';

const route = (): 'patient' | 'clinician' => (window.location.hash === '#clinician' ? 'clinician' : 'patient');

function SyncChip() {
  const s = useSyncExternalStore(subscribeSync, getSyncStatus);
  if (!s.enabled) return null;
  const t = s.lastOkAt ? new Date(s.lastOkAt).toLocaleTimeString() : '';
  if (s.state === 'error') return <span className="syncchip bad" role="status" data-testid="sync-chip">⚠ Sync problem. Your data is safe on this device and will send when it works. ({s.error})</span>;
  return <span className="syncchip" role="status" data-testid="sync-chip">● Live sync on{s.patients ? ` · ${s.patients} patient${s.patients === 1 ? '' : 's'}` : ''}{t ? ` · last ${t}` : ''}</span>;
}

export function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const [view, setView] = useState(route);
  useEffect(() => {
    // Invite link / QR code: #join=<code> adds the patient on this device and opens their phone view.
    const join = () => {
      const m = /^#join=(.+)$/.exec(window.location.hash);
      if (!m) return;
      const inv = decodeInvite(m[1]);
      const st = getState();
      if (inv) setState({ ...st, patients: st.patients.some((p) => p.id === inv.patient.id) ? st.patients : [...st.patients, inv.patient], customPacks: inv.pack && !(st.customPacks ?? []).some((c) => c.id === inv.pack!.id) ? [...(st.customPacks ?? []), inv.pack] : st.customPacks, activeId: inv.patient.id });
      window.location.hash = 'patient';
    };
    join();
    const f = () => { join(); setView(route()); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = (v: 'patient' | 'clinician') => { window.location.hash = v; setView(v); };
  const patient = state.patients.find((p) => p.id === state.activeId) ?? state.patients[0];
  const step = state.demoStep;
  const s = DEMO_STEPS[step];
  const isRavi = patient.id === 'ravi';

  const fastForward = () => {
    const ravi = state.patients.find((p) => p.id === 'ravi');
    if (!ravi || !s) return;
    const next = demoStepPatient(ravi, step);
    const date = next.daily[next.daily.length - 1].date;
    setState({ ...state, patients: state.patients.map((p) => (p.id === 'ravi' ? next : p)), today: addDays(date, 1), demoStep: step + 1 });
  };

  return (
    <>
      <div className="demobar">
        <span className="tag">DEMO</span>
        <span className="demotext">{s ? `${s.title}: ${s.narration}` : 'Demo complete: Ravi is now URGENT via R5. Open the physio view.'}</span>
        <span className="selectrow">
          <label htmlFor="demo-patient">Patient</label>
          <select id="demo-patient" value={patient.id} onChange={(e) => setState({ ...getState(), activeId: e.target.value })}>
            {state.patients.map((p) => <option key={p.id} value={p.id}>{p.name} · {getPack(p.packId).condition.en}</option>)}
          </select>
        </span>
        <span className="demobtns">
          <button className="btn primary" disabled={!s} onClick={fastForward}>⏩ Fast-forward ({Math.min(step + 1, DEMO_STEPS.length)}/{DEMO_STEPS.length})</button>
          <button className="btn" onClick={resetState}>↺ Reset</button>
        </span>
      </div>
      <SyncChip />
      <nav className="tabs">
        <button className={view === 'patient' ? 'on' : ''} onClick={() => go('patient')}>Patient phone</button>
        <button className={view === 'clinician' ? 'on' : ''} onClick={() => go('clinician')}>Physio dashboard</button>
      </nav>
      {view === 'patient' ? <PatientView key={patient.id} patient={patient} /> : <Clinician state={state} />}
      {!isRavi && view === 'patient' && null}
    </>
  );
}

// exposed for e2e smoke checks
export const _debug = { updatePatient };
