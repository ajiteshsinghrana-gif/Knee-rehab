import { useEffect, useState } from 'react';
import { LANGS, LANG_NAME } from '../types';
import type { AnsweredBy, Lang, Patient } from '../types';
import { isActive } from '../lifecycle';
import { getPack } from '../engine/packs';
import { L } from '../i18n';
import { TEMPLATES, firstName, templateButtons } from '../whatsapp/templates';
import { CHECKLIST, isLikelyIndianMobile, loadWa, maskPhone, normalisePhone, saveWa, type WaSettings } from '../whatsapp/settings';
import { sendTemplate, whatsappStatus, type WaStatus } from '../whatsapp/client';
import { WhatsAppSim } from './WhatsAppSim';

/**
 * WhatsApp setup for the live clinic. Everything here can be prepared before a WhatsApp Business number exists:
 * the checklist, the templates to submit for approval, each patient's number and consent. Sending stays switched off until the backend reports
 * that WhatsApp is connected. Nothing here sends a message by itself, and the chat preview never saves anything to a patient.
 */
export function WhatsAppSetup({ patients }: { patients: Patient[] }) {
  const [s, setS] = useState<WaSettings>(() => loadWa());
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [lang, setLang] = useState<Lang>('en');
  const [preview, setPreview] = useState<Patient | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const people = patients.filter(isActive);

  const check = async () => { setChecking(true); setStatus(await whatsappStatus()); setChecking(false); };
  useEffect(() => { void check(); }, []);
  const update = (f: (x: WaSettings) => WaSettings) => setS((old) => { const n = f(old); saveWa(n); return n; });
  const setContact = (id: string, patch: Partial<WaSettings['contacts'][string]>) =>
    update((x) => ({ ...x, contacts: { ...x.contacts, [id]: { phone: '', consent: null, sendTime: '08:00', ...x.contacts[id], ...patch } } }));
  const say = (id: string, text: string) => setMsg((m) => ({ ...m, [id]: text }));

  const connected = !!status?.configured;
  const done = CHECKLIST.filter((c) => s.checklist[c.id]).length;

  const test = async (p: Patient) => {
    const c = s.contacts[p.id];
    if (!c?.phone || !c.consent) return;
    say(p.id, 'Sending…');
    const r = await sendTemplate({ to: c.phone, template: 'rp_checkin_prompt', lang: p.language, vars: [firstName(p.name)] });
    say(p.id, r.ok ? 'Sent. Ask the patient to confirm it arrived.' : `Not sent. ${r.error ?? ''}`);
  };

  return (
    <section className="wasetup" data-testid="wa-setup">
      <h2>WhatsApp channel</h2>
      <p className="dashnotice" style={{ margin: 0 }}>Patients can get their reminders and answer the daily check-in on WhatsApp. Triage still comes only from the protocol rules. You can prepare everything below now; nothing is sent until a WhatsApp Business number is connected.</p>

      <div className={`card wa-status${connected ? ' on' : ''}`} role="status" data-testid="wa-status">
        <h3>{connected ? 'Connected' : 'Not connected yet'}</h3>
        <p>{connected ? 'The clinic backend has a WhatsApp Business number and can send approved templates.' : (status?.note ?? (status?.missing.length ? `The backend is reachable but these settings are missing: ${status.missing.join(', ')}.` : 'Checking…'))}</p>
        <div className="btnrow"><button type="button" className="btn" onClick={() => void check()} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button></div>
      </div>

      <div className="card">
        <h3>Setup checklist <small>{done} of {CHECKLIST.length} ticked by you</small></h3>
        {CHECKLIST.map((c) => (
          <label key={c.id} className="wa-check">
            <input type="checkbox" checked={!!s.checklist[c.id]} onChange={(e) => update((x) => ({ ...x, checklist: { ...x.checklist, [c.id]: e.target.checked } }))} />
            <span>{c.label}<small>{c.help}</small></span>
          </label>
        ))}
        <p><small>Steps and the backend are in WHATSAPP.md in the repository. Ticking a box here only records your own progress.</small></p>
      </div>

      <div className="card">
        <h3>Messages to submit for approval</h3>
        <p><small>WhatsApp only lets a business start a conversation with an approved template. These are short, carry no clinical detail, and are ready to submit. Hindi and Bengali wording needs a native reader before submission.</small></p>
        <div className="wa-langs" role="group" aria-label="Template language">
          {LANGS.map((l) => <button key={l} type="button" className={`btn${l === lang ? ' primary' : ''}`} aria-pressed={l === lang} onClick={() => setLang(l)}>{LANG_NAME[l]}</button>)}
        </div>
        {TEMPLATES.map((t) => (
          <div key={t.name} className="wa-tpl">
            <strong>{t.purpose}</strong>
            <code>{t.name}</code>
            <div className="tplbody">{L(t.body, lang)}</div>
            {t.vars.length > 0 && <small>{t.vars.map((v, i) => `{{${i + 1}}} = ${v}`).join(' · ')}</small>}
            {t.buttons.length > 0 && <div className="tplbtns">{templateButtons(t, lang).map((b) => <span key={b}>{b}</span>)}</div>}
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Patients</h3>
        <p><small>A number is used only with the patient's (or their caregiver's) agreement. For now numbers are kept on this device only. Cloud storage comes with the backend step in WHATSAPP.md.</small></p>
        {people.length === 0 && <p>No active patients yet. Add one on the Physio dashboard.</p>}
        {people.map((p) => {
          const c = s.contacts[p.id];
          const ready = !!c?.phone && !!c?.consent;
          return (
            <div key={p.id} className="wa-prow" data-testid={`wa-row-${p.id}`}>
              <div><b>{p.name}</b><small>{L(getPack(p.packId).condition, 'en')} · {LANG_NAME[p.language]}</small></div>
              <div>
                <input type="tel" inputMode="tel" aria-label={`WhatsApp number for ${p.name}`} placeholder="+91 98765 43210" defaultValue={c?.phone ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (!v) { setContact(p.id, { phone: '', consent: null }); say(p.id, ''); return; }
                    const n = normalisePhone(v);
                    if (!n) { say(p.id, 'That does not look like a phone number.'); return; }
                    e.target.value = n;
                    setContact(p.id, { phone: n });
                    say(p.id, isLikelyIndianMobile(n) ? '' : 'Check the number: it does not look like an Indian mobile.');
                  }} />
                {c?.phone && <small>Saved on this device as {maskPhone(c.phone)}</small>}
                <label className="wa-check"><input type="checkbox" checked={!!c?.consent} disabled={!c?.phone}
                  onChange={(e) => setContact(p.id, { consent: e.target.checked ? { by: (p.caregiverMode ? 'caregiver' : 'patient') as AnsweredBy, at: new Date().toISOString(), lang: p.language } : null })} />
                  <span>{p.caregiverMode ? 'The family member agreed to WhatsApp messages' : 'The patient agreed to WhatsApp messages'}{c?.consent ? <small>Recorded {c.consent.at.slice(0, 10)}</small> : null}</span></label>
                {msg[p.id] && <small role="status">{msg[p.id]}</small>}
              </div>
              <div className="btnrow" style={{ margin: 0 }}>
                <button type="button" className="btn" onClick={() => setPreview(p)}>Preview chat</button>
                <button type="button" className="btn" disabled={!connected || !ready} title={connected ? 'Send the check-in message to this number' : 'Available once WhatsApp is connected'} onClick={() => void test(p)}>Send test</button>
              </div>
            </div>
          );
        })}
      </div>
      {preview && <WhatsAppSim patient={preview} canSave={false} onClose={() => setPreview(null)} />}
    </section>
  );
}
