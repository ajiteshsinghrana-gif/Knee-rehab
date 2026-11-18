import { useState, type FormEvent } from 'react';
import { getState } from '../store';
import { t } from '../i18n';
import { finishPasswordReset } from '../sync/engine';

/** Opened from the link in a password-reset email. Works for physio and patient accounts. The one-time token never leaves this page. */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const lang = getState().patients[0]?.language ?? 'en';
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (pw.length < 8) { setErr(t(lang, 'acctShortPw')); return; }
    setBusy(true);
    try { await finishPasswordReset(token, pw); setDone(true); setPw(''); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="patientshell" data-testid="reset-password">
      <h2>{t(lang, 'resetTitle')}</h2>
      {done ? (
        <>
          <p role="status">{t(lang, 'resetDone')}</p>
          <button className="btn primary" onClick={onDone}>{t(lang, 'resetBack')}</button>
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="formgrid">
          <label>{t(lang, 'acctPassword')} <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label={t(lang, 'acctPassword')} /></label>
          <div className="btnrow"><button className="btn primary" type="submit" disabled={busy}>{busy ? t(lang, 'acctBusy') : t(lang, 'resetSave')}</button></div>
          {err && <p className="err" role="alert">{err}</p>}
        </form>
      )}
    </main>
  );
}
