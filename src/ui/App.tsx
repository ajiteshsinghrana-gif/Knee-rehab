import { useEffect, useState, useSyncExternalStore } from 'react';
import { getState, resetState, setState, subscribe, updatePatient } from '../store';
import { DEMO_STEPS, demoStepPatient } from '../demo/seed';
import { addDays } from '../engine/dates';
import { getPack } from '../engine/packs';
import { decodeInvite } from '../onboarding';
import { PatientView } from './Patient';
import { Clinician } from './Clinician';
import { getSyncStatus, physioErasePatient, subscribeSync } from '../sync/engine';
import { isPatientDevice } from '../device';
import { getMode, setMode } from '../mode';
import { LoginCard } from './Login';
import { isActive } from '../lifecycle';
import { PatientShell } from './PatientShell';
import { ResetPassword } from './ResetPassword';
import { recoveryTokenFromHash } from '../sync/auth';
import { WhatsAppSim } from './WhatsAppSim';
import { WhatsAppSetup } from './WhatsAppSetup';

const route = (): 'patient' | 'clinician' => (window.location.hash === '#clinician' ? 'clinician' : 'patient');

function SyncChip() {
  const s = useSyncExternalStore(subscribeSync, getSyncStatus);
  if (!s.enabled) return null;
  const t = s.lastOkAt ? new Date(s.lastOkAt).toLocaleTimeString() : '';
  if (s.state === 'login') return <span className="syncchip bad" role="status" data-testid="sync-chip">● Sign in as a physio (Physio dashboard tab) to sync your patients. Their data stays on this device until then.</span>;
  if (s.state === 'error') return <span className="syncchip bad" role="status" data-testid="sync-chip">⚠ Sync problem. Your data is safe on this device and will send when it works. ({s.error})</span>;
  return <span className="syncchip" role="status" data-testid="sync-chip">● Live sync on{s.patients ? ` · ${s.patients} patient${s.patients === 1 ? '' : 's'}` : ''}{t ? ` · last ${t}` : ''}{getMode() === 'demo' ? ' · demo: only patients you add sync; the six built-in ones stay on this device' : ''}</span>;
}

export function App() {
  const [recovery, setRecovery] = useState<string | null>(() => recoveryTokenFromHash(window.location.hash));
  useEffect(() => { if (recovery) window.history.replaceState(null, '', window.location.pathname + window.location.search); }, [recovery]);
  if (recovery) return <ResetPassword token={recovery} onDone={() => setRecovery(null)} />;
  // The device kind is fixed when the page loads (main.tsx). A patient's phone never reaches the physio dashboard code path.
  return isPatientDevice() ? <PatientApp /> : getMode() === 'live' ? <LiveApp /> : <DemoApp />;
}

function PatientApp() {
  useEffect(() => {
    // Invite link / QR code: #join=<code> adds this patient to the phone. Nothing else is on a patient device.
    const join = () => {
      const m = /^#join=(.+)$/.exec(window.location.hash);
      if (!m) return;
      const inv = decodeInvite(m[1]);
      const st = getState();
      if (inv) setState({ ...st, patients: st.patients.some((p) => p.id === inv.patient.id) ? st.patients : [...st.patients, inv.patient], customPacks: inv.pack && !(st.customPacks ?? []).some((c) => c.id === inv.pack!.id) ? [...(st.customPacks ?? []), inv.pack] : st.customPacks, activeId: inv.patient.id });
      window.location.hash = 'patient';
    };
    join();
    window.addEventListener('hashchange', join);
    return () => window.removeEventListener('hashchange', join);
  }, []);
  return <PatientShell />;
}

/** The running app (Phase 6.5): real patients only, physio sign-in required, and a read-only preview of any patient's phone. */
function LiveApp() {
  const state = useSyncExternalStore(subscribe, getState);
  const sync = useSyncExternalStore(subscribeSync, getSyncStatus);
  const [view, setView] = useState<'physio' | 'preview' | 'whatsapp'>('physio');
  const [previewId, setPreviewId] = useState('');
  const gated = sync.ready && sync.enabled && sync.auth && !sync.user; // nobody sees any patient until the physio signs in
  const people = state.patients.filter(isActive);
  const shown = people.find((p) => p.id === previewId) ?? people[0];
  return (
    <>
      <div className="livebar" data-testid="live-bar">
        <span className="tag live">LIVE CLINIC</span>
        <span className="demotext">Real patients, real dates, saved to your account. Patients open only their own link on their own phone.</span>
        <button className="btn" data-testid="to-demo" onClick={() => { setMode('demo'); window.location.reload(); }}>Switch to demo →</button>
      </div>
      {gated ? (
        <main className="patientshell" data-testid="physio-gate">
          <h2>Physio sign-in</h2>
          <p>Sign in to see your patients. If you are a patient, open the link your physio sent you, or <a href="#signin" onClick={() => window.location.reload()}>sign in here</a>.</p>
          <LoginCard />
        </main>
      ) : (
        <>
          <SyncChip />
          <nav className="tabs">
            <button className={view === 'physio' ? 'on' : ''} onClick={() => setView('physio')}>Physio dashboard</button>
            <button className={view === 'preview' ? 'on' : ''} data-testid="preview-tab" onClick={() => setView('preview')}>View as patient</button>
            <button className={view === 'whatsapp' ? 'on' : ''} data-testid="whatsapp-tab" onClick={() => setView('whatsapp')}>WhatsApp</button>
          </nav>
          {view === 'physio' ? <Clinician state={state} /> : view === 'whatsapp' ? <WhatsAppSetup patients={state.patients} /> : (
            <section data-testid="preview">
              {!shown ? <p className="card">No active patients yet. Add one on the Physio dashboard.</p> : (
                <>
                  <p className="previewbar" role="status">
                    <label htmlFor="preview-patient">Preview</label>{' '}
                    <select id="preview-patient" value={shown.id} onChange={(e) => setPreviewId(e.target.value)}>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {getPack(p.packId).condition.en}</option>)}
                    </select>{' '}
                    This is what {shown.name} sees on their phone. It is read-only: nothing you tap here changes their record.
                  </p>
                  <div className="previewwrap" ref={(el) => { if (el) el.setAttribute('inert', ''); }} aria-label={`Preview of ${shown.name}'s phone`}>
                    <PatientView key={shown.id} patient={shown} />
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

/** Reset restores the six demo patients. Demo patients that were synced lose their cloud copy too (best effort: needs the physio sign-in). */
function resetDemo() {
  for (const p of getState().patients) if (p.demoPatient && p.syncKey && p.syncRole === 'physio') void physioErasePatient(p.syncKey).catch(() => { /* signed out or offline: the cloud copy stays until erased from a patient's card */ });
  resetState();
}

function DemoApp() {
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
  const [wa, setWa] = useState(false);

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
          <button className="btn" data-testid="whatsapp-btn" onClick={() => setWa(true)}>💬 WhatsApp</button>
          <button className="btn" onClick={resetDemo}>↺ Reset</button>
          <button className="btn" data-testid="to-live" onClick={() => { setMode('live'); window.location.reload(); }}>Go to live clinic →</button>
        </span>
      </div>
      <SyncChip />
      <nav className="tabs">
        <button className={view === 'patient' ? 'on' : ''} onClick={() => go('patient')}>Patient phone</button>
        <button className={view === 'clinician' ? 'on' : ''} onClick={() => go('clinician')}>Physio dashboard</button>
      </nav>
      {view === 'patient' ? <PatientView key={patient.id} patient={patient} /> : <Clinician state={state} />}
      {!isRavi && view === 'patient' && null}
      {wa && <WhatsAppSim key={patient.id} patient={patient} canSave onClose={() => setWa(false)} />}
    </>
  );
}

// exposed for e2e smoke checks
export const _debug = { updatePatient };
