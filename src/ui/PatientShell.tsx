import { useState, useSyncExternalStore, type FormEvent } from 'react';
import type { Lang, Patient } from '../types';
import { getState, setState, subscribe } from '../store';
import { t } from '../i18n';
import { getSyncStatus, patientCreateAccount, patientSignIn, patientSignOut, subscribeSync } from '../sync/engine';
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
      <PatientView key={patient.id} patient={patient} />
    </>
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
    setBusy(true);
    try {
      if (mode === 'up' && patient) {
        const r = await patientCreateAccount(patient, email, password);
        if (r === 'confirm-email') { setMsg({ bad: false, text: t(lang, 'acctConfirm') }); setMode('in'); }
        else { const st = getState(); setState({ ...st, patients: st.patients.map((p) => (p.id === patient.id ? { ...p, accountEmail: email.trim() } : p)) }); }
      } else {
        const r = await patientSignIn(email, password, patient && !patient.accountEmail ? patient : undefined);
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
      <form onSubmit={(e) => void submit(e)} className="formgrid">
        <label>{t(lang, 'acctEmail')} <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label={t(lang, 'acctEmail')} /></label>
        <label>{t(lang, 'acctPassword')} <input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} aria-label={t(lang, 'acctPassword')} /></label>
        <div className="btnrow">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? t(lang, 'acctBusy') : mode === 'up' ? t(lang, 'acctCreate') : t(lang, 'acctSignIn')}</button>
          {!signInOnly && patient && !patient.accountEmail && (mode === 'up'
            ? <button className="btn" type="button" onClick={() => { setMode('in'); setMsg(null); }}>{t(lang, 'acctHave')}</button>
            : <button className="btn" type="button" onClick={() => { setMode('up'); setMsg(null); }}>{t(lang, 'acctNew')}</button>)}
        </div>
      </form>
      {msg && <p className={msg.bad ? 'err' : 'okline'} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}
      {mode === 'up' && <p className="tiny">{t(lang, 'acctNextTime')}</p>}
    </main>
  );
}
