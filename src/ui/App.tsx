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
import { Menu, StepLine, SyncDot, TopBar, ViewSwitch } from './TopBar';

const route = (): 'patient' | 'clinician' => (window.location.hash === '#clinician' ? 'clinician' : 'patient');

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
      <TopBar
        tag={<span className="tb-tag live">LIVE</span>}
        center={gated ? null : <ViewSwitch label="Choose a view" value={view} onChange={setView} options={[
          { id: 'physio', label: 'Physio dashboard', short: 'Physio' },
          { id: 'preview', label: 'View as patient', short: 'Patient', testid: 'preview-tab' },
          { id: 'whatsapp', label: 'WhatsApp', short: 'WhatsApp', testid: 'whatsapp-tab' },
        ]} />}
        right={<>
          {!gated && <SyncDot />}
          <Menu label="Live clinic options" buttonLabel="Clinic" testid="live-bar">
            {() => (<>
              <p className="menunote">Live clinic: real patients, real dates, saved to your account. Patients open only their own link on their own phone.</p>
              <button className="menuitem" data-testid="to-demo" onClick={() => { setMode('demo'); window.location.reload(); }}>Switch to demo →</button>
            </>)}
          </Menu>
        </>}
      />
      {gated ? (
        <main className="patientshell" data-testid="physio-gate">
          <h2>Physio sign-in</h2>
          <p>Sign in to see your patients. If you are a patient, open the link your physio sent you, or <a href="#signin" onClick={() => window.location.reload()}>sign in here</a>.</p>
          <LoginCard />
        </main>
      ) : (
        <>
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
      <TopBar
        center={<ViewSwitch label="Choose a view" value={view} onChange={go} options={[
          { id: 'patient', label: 'Patient phone', short: 'Patient' },
          { id: 'clinician', label: 'Physio dashboard', short: 'Physio' },
        ]} />}
        right={<>
          <SyncDot />
          <Menu label="Demo controls" testid="demo-menu" className="demomenu" buttonLabel={<>Demo<span className="tb-count">{Math.min(step, DEMO_STEPS.length)}/{DEMO_STEPS.length}</span></>}>
            {(close) => (<>
              <label className="menufield" htmlFor="demo-patient">Patient
                <select id="demo-patient" value={patient.id} onChange={(e) => setState({ ...getState(), activeId: e.target.value })}>
                  {state.patients.map((p) => <option key={p.id} value={p.id}>{p.name} · {getPack(p.packId).condition.en}</option>)}
                </select>
              </label>
              <button className="menuitem strong" disabled={!s} onClick={fastForward}>Fast-forward one day ({Math.min(step + 1, DEMO_STEPS.length)}/{DEMO_STEPS.length})</button>
              <button className="menuitem" data-testid="whatsapp-btn" onClick={() => { close(); setWa(true); }}>WhatsApp simulation</button>
              <button className="menuitem" onClick={resetDemo}>Reset demo</button>
              <hr />
              <button className="menuitem" data-testid="to-live" onClick={() => { setMode('live'); window.location.reload(); }}>Go to live clinic →</button>
            </>)}
          </Menu>
        </>}
      />
      <StepLine stepKey={String(step)} text={s ? `${s.title}: ${s.narration}` : 'Demo complete: Ravi is now URGENT via R5. Open the physio view.'} />
      {view === 'patient' ? <PatientView key={patient.id} patient={patient} /> : <Clinician state={state} />}
          {wa && <WhatsAppSim key={patient.id} patient={patient} canSave onClose={() => setWa(false)} />}
    </>
  );
}

// exposed for e2e smoke checks
export const _debug = { updatePatient };
