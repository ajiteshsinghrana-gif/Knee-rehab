import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { getSyncStatus, physioSignIn, physioSignOut, physioSignUp, subscribeSync } from '../sync/engine';

/** Physio sign-in (Phase 6.2). Shown on the physio dashboard only, and only when sync.json has auth: true. Patients never see it. */
export function LoginCard() {
  const s = useSyncExternalStore(subscribeSync, getSyncStatus);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  if (!s.enabled || !s.auth) return null;

  if (s.user) {
    return (
      <p className="logincard signedin" data-testid="login-card">
        Signed in as <b>{s.user}</b>. Your patients sync only while you are signed in.{' '}
        <button className="btn" onClick={() => void physioSignOut()}>Sign out</button>
      </p>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setMsg({ bad: true, text: 'Enter a valid email address.' }); return; }
    if (mode === 'up' && password.length < 8) { setMsg({ bad: true, text: 'Choose a password of at least 8 characters.' }); return; }
    setBusy(true);
    try {
      if (mode === 'in') await physioSignIn(email, password);
      else if ((await physioSignUp(email, password)) === 'confirm-email') { setMsg({ bad: false, text: 'Account created. Open the confirmation email, then sign in here.' }); setMode('in'); }
      setPassword('');
    } catch (err) { setMsg({ bad: true, text: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <form className="logincard" onSubmit={submit} data-testid="login-card" aria-label="Physio sign-in">
      <b>{mode === 'in' ? 'Physio sign-in' : 'Create a physio account'}</b>
      <span className="tiny"> Needed to sync your patients. Until you sign in, their data stays on this device. Patients never sign in.</span>
      <div className="loginrow">
        <label>Email <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password <input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
        <button className="btn" type="button" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>{mode === 'in' ? 'New physio? Create an account' : 'I already have an account'}</button>
      </div>
      {msg && <p role="status" className={msg.bad ? 'loginmsg bad' : 'loginmsg'}>{msg.text}</p>}
    </form>
  );
}
