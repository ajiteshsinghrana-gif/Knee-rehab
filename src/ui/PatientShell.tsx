import { useState, useSyncExternalStore, type FormEvent } from 'react';
import type { Lang, Patient } from '../types';
import { getState, setState, subscribe } from '../store';
import { t } from '../i18n';
import { getSyncStatus, patientCreateAccount, patientDeleteAccount, patientSignIn, patientSignOut, sendPasswordReset, subscribeSync } from '../sync/engine';
import { CONSENT_VERSION, exportMyData } from '../lifecycle';
import { getPack } from '../engine/packs';
import { PatientView } from './Patient';

/** What a patient's phone shows (Phase 6.3): their own screens only. No demo bar, no physio dashboard. */
export function PatientShell() {
  const state = useSyncExternalStore(subscribe, getState);
  const sync = useSyncExternalStore(subscribeSync, getSyncStatus);
  const patient = state.patients.find((p) => p.id === state.activeId) ?? state.patients[0];
  const lang: Lang = patient?.language ?? 'en';
  if (!sync.ready) return <main className="patientshell"><p className="tiny">…</p></main>;
  // Accounts not switched on for this deployment: the plain link works as before.
  if (!sync.auth || !sync.enabled) return patient ? <PatientView key={patient.id} patient={patient} /> : <main className="patientshell"><p>{t(lang, 'acctNoLink')}</p></main>;
  if (!patient) return <AccountGate lang={lang} />;
  if (!patient.accountEmail) return <AccountGate lang={lang} patient={patient} />;
  if (sync.state === 'login' || !sync.user) return <AccountGate lang={lang} patient={patient} signInOnly />;
  return (
    <>
      <AccountBar lang={lang} email={sync.user} />
      {patient.status === 'completed' ? <TreatmentComplete patient={patient} lang={lang} /> : <PatientView key={patient.id} patient={patient} />}
      <MyData patient={patient} lang={lang} />
    </>
  );
}

function TreatmentComplete({ patient, lang }: { patient: Patient; lang: Lang }) {
  return (
    <main className="patientshell" data-testid="treatment-complete">
      <h2>{t(lang, 'doneTitle')}</h2>
      <p>{t(lang, 'doneBody')}</p>
      <p className="tiny">{patient.name}</p>
    </main>
  );
}

/** The patient's data rights in one place: a copy of their data, a request to erase it, and deleting their own login. */
function MyData({ patient, lang }: { patient: Patient; lang: Lang }) {
  const [ask, setAsk] = useState<'erase' | 'login' | null>(null);
  const [err, setErr] = useState('');
  const download = () => {
    const data = exportMyData(patient, getPack(patient.packId).condition.en, Date.now());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `my-rehab-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const requestErase = () => {
    const st = getState();
    setState({ ...st, patients: st.patients.map((p) => (p.id === patient.id ? { ...p, erasureRequestedAt: new Date().toISOString() } : p)) });
    setAsk(null);
  };
  const deleteLogin = async () => {
    try { await patientDeleteAccount(); const st = getState(); setState({ ...st, patients: [], activeId: '' }); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <details className="mydata card" data-testid="my-data">
      <summary><b>{t(lang, 'myDataTitle')}</b></summary>
      <p className="tiny">{t(lang, 'privRights', { contact: patient.clinicContact || t(lang, 'privNoContact') })}</p>
      <div className="btnrow"><button className="btn" onClick={download}>{t(lang, 'myDataDownload')}</button></div>
      {patient.erasureRequestedAt ? <p role="status">{t(lang, 'myDataEraseAsked', { date: patient.erasureRequestedAt.slice(0, 10) })}</p>
        : ask === 'erase' ? <p role="alert">{t(lang, 'myDataEraseConfirm')} <button className="btn primary" onClick={requestErase}>{t(lang, 'myDataYes')}</button> <button className="btn" onClick={() => setAsk(null)}>{t(lang, 'acctCancel')}</button></p>
        : <div className="btnrow"><button className="btn" onClick={() => setAsk('erase')}>{t(lang, 'myDataErase')}</button></div>}
      {patient.erasureNote && <p role="status">{t(lang, 'myDataEraseNote', { note: patient.erasureNote })}</p>}
      {ask === 'login' ? <p role="alert">{t(lang, 'myDataDelWarn')} <button className="btn primary" onClick={() => void deleteLogin()}>{t(lang, 'myDataDelYes')}</button> <button className="btn" onClick={() => setAsk(null)}>{t(lang, 'acctCancel')}</button></p>
        : <div className="btnrow"><button className="btn" onClick={() => setAsk('login')}>{t(lang, 'myDataDelAcct')}</button></div>}
      {err && <p className="err" role="alert">{err}</p>}
    </details>
  );
}

function AccountBar({ lang, email }: { lang: Lang; email: string }) {
  const [ask, setAsk] = useState(false);
  const out = async () => {
    await patientSignOut();
    const st = getState();
    setState({ ...st, patients: [], activeId: '' }); // this phone no longer holds the plan; the account does
    setAsk(false);
  };
  return (
    <div className="acctbar" data-testid="account-bar">
      <small>{t(lang, 'acctSignedAs', { email })}</small>
      {!ask ? <button className="btn" onClick={() => setAsk(true)}>{t(lang, 'acctSignOut')}</button> : (
        <span role="alert"><small>{t(lang, 'acctSignOutWarn')}</small> <button className="btn primary" onClick={() => void out()}>{t(lang, 'acctSignOutYes')}</button> <button className="btn" onClick={() => setAsk(false)}>{t(lang, 'acctCancel')}</button></span>
      )}
    </div>
  );
}

/** Create an account for the link just opened, or sign in to an existing one. `patient` is the link just opened (absent on a fresh phone). */
function AccountGate({ lang, patient, signInOnly }: { lang: Lang; patient?: Patient; signInOnly?: boolean }) {
  const [mode, setMode] = useState<'up' | 'in'>(patient && !patient.accountEmail && !signInOnly ? 'up' : 'in');
  const [email, setEmail] = useState(patient?.accountEmail ?? '');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);

  const adopt = (patients: Patient[], packs: Parameters<typeof setState>[0]['customPacks'], em: string) => {
    const st = getState();
    const local = new Map(st.patients.map((p) => [p.id, p]));
    const merged = patients.map((p) => (local.has(p.id) ? { ...local.get(p.id)!, accountEmail: em } : p));
    const have = new Set((st.customPacks ?? []).map((c) => c.id));
    setState({ ...st, patients: merged, activeId: merged.some((p) => p.id === st.activeId) ? st.activeId : merged[0]?.id ?? '', customPacks: [...(st.customPacks ?? []), ...(packs ?? []).filter((c) => !have.has(c.id))] });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setMsg({ bad: true, text: t(lang, 'acctBadEmail') }); return; }
    if (mode === 'up' && password.length < 8) { setMsg({ bad: true, text: t(lang, 'acctShortPw') }); return; }
    if (mode === 'up' && !agree) { setMsg({ bad: true, text: t(lang, 'privNeedAgree') }); return; }
    setBusy(true);
    try {
      if (mode === 'up' && patient) {
        const r = await patientCreateAccount(patient, email, password, pin.replace(/\s+/g, '') || undefined);
        if (r === 'confirm-email') { setMsg({ bad: false, text: t(lang, 'acctConfirm') }); setMode('in'); }
        else { const st = getState(); setState({ ...st, patients: st.patients.map((p) => (p.id === patient.id ? { ...p, accountEmail: email.trim(), consent: { version: CONSENT_VERSION, at: new Date().toISOString() } } : p)) }); }
      } else {
        const r = await patientSignIn(email, password, patient && !patient.accountEmail ? patient : undefined, pin.replace(/\s+/g, '') || undefined);
        if (!r.patients.length) { setMsg({ bad: true, text: t(lang, 'acctNoPlan') }); }
        else adopt(r.patients, r.packs, email.trim());
      }
      setPassword('');
    } catch (err) { setMsg({ bad: true, text: (err as Error).message }); } finally { setBusy(false); }
  };

  return (
    <main className="patientshell" data-testid="account-gate">
      {patient && <p className="hello">{t(lang, 'hello')}, {patient.name}</p>}
      {!patient && <p>{t(lang, 'acctNoLink')}</p>}
      {signInOnly && <p role="alert">{t(lang, 'acctNeedLogin')}</p>}
      <h2>{mode === 'up' ? t(lang, 'acctCreateTitle') : t(lang, 'acctSignInTitle')}</h2>
      {mode === 'up' && <p>{t(lang, 'acctIntro')}</p>}
      {mode === 'up' && (
        <section className="privnotice" data-testid="privacy-notice">
          <h3>{t(lang, 'privTitle')}</h3>
          <p>{t(lang, 'privBody1')}</p><p>{t(lang, 'privBody2')}</p><p>{t(lang, 'privBody3')}</p>
          <p>{t(lang, 'privRights', { contact: patient?.clinicContact || t(lang, 'privNoContact') })}</p>
        </section>
      )}
      <form onSubmit={(e) => void submit(e)} className="formgrid">
        <label>{t(lang, 'acctEmail')} <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label={t(lang, 'acctEmail')} /></label>
        <label>{t(lang, 'acctPassword')} <input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} aria-label={t(lang, 'acctPassword')} /></label>
        {patient && !patient.accountEmail && <label>{t(lang, 'acctPin')} <input inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} aria-label={t(lang, 'acctPin')} /></label>}
        {mode === 'up' && <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-label={t(lang, 'privAgree')} /> {t(lang, 'privAgree')}</label>}
        <div className="btnrow">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? t(lang, 'acctBusy') : mode === 'up' ? t(lang, 'acctCreate') : t(lang, 'acctSignIn')}</button>
          {!signInOnly && patient && !patient.accountEmail && (mode === 'up'
            ? <button className="btn" type="button" onClick={() => { setMode('in'); setMsg(null); }}>{t(lang, 'acctHave')}</button>
            : <button className="btn" type="button" onClick={() => { setMode('up'); setMsg(null); }}>{t(lang, 'acctNew')}</button>)}
        </div>
      </form>
      {mode === 'in' && <p><button type="button" className="linkbtn" onClick={async () => { if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setMsg({ bad: true, text: t(lang, 'acctBadEmail') }); return; } try { await sendPasswordReset(email); setMsg({ bad: false, text: t(lang, 'acctResetSent') }); } catch (e) { setMsg({ bad: true, text: (e as Error).message }); } }}>{t(lang, 'acctForgot')}</button></p>}
      {msg && <p className={msg.bad ? 'err' : 'okline'} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}
      {mode === 'up' && <p className="tiny">{t(lang, 'acctNextTime')}</p>}
    </main>
  );
}
