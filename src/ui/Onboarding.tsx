import { useMemo, useState } from 'react';
import type { Lang } from '../types';
import { PACKS } from '../engine/packs';
import { LIBRARY, exerciseName } from '../exercises/library';
import { listOverridable } from '../engine/overrides';
import { getSyncStatus } from '../sync/engine';
import { newClaimPin, newSyncKey } from '../sync/client';
import { buildPatient, inviteUrl, validateOnboard, type OnboardDraft } from '../onboarding';
import { qrSvg } from '../qr';
import { clockMs, getState, setState } from '../store';

const today = () => getState().today;
const qrOrNull = (u: string): string | null => { try { return qrSvg(u, 5); } catch { return null; } };

/** Phase 3.1: new patient -> condition -> adjust plan -> approve -> link and QR code. */
export function Onboarding({ onClose, onNewCondition }: { onClose: () => void; onNewCondition?: () => void }) {
  const s = getState();
  const packs = Object.values(PACKS);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [d, setD] = useState<OnboardDraft>(() => {
    const pack = packs[0];
    return { name: '', age: 40, language: 'en' as Lang, packId: pack.id, anchorDate: s.today, phaseId: pack.phases[0].id, exercises: [...pack.phases[0].exercises], checkInEveryDays: 1, reviewEveryDays: pack.phases[0].followUpEveryDays, overrides: [] };
  });
  const [err, setErr] = useState('');
  const [made, setMade] = useState<{ id: string; url: string } | null>(null);
  const [tTarget, setTTarget] = useState('');
  const [tValue, setTValue] = useState('');
  const [tReason, setTReason] = useState('');
  const pack = PACKS[d.packId];
  const phase = pack.phases.find((x) => x.id === d.phaseId) ?? pack.phases[0];
  const ovList = useMemo(() => listOverridable(pack), [pack]);
  const set = (patch: Partial<OnboardDraft>) => setD((x) => ({ ...x, ...patch }));

  const choosePack = (id: string) => { const p = PACKS[id]; set({ packId: id, phaseId: p.phases[0].id, exercises: [...p.phases[0].exercises], reviewEveryDays: p.phases[0].followUpEveryDays, overrides: [] }); };
  const choosePhase = (id: string) => { const ph = pack.phases.find((x) => x.id === id)!; set({ phaseId: id, exercises: [...ph.exercises], reviewEveryDays: ph.followUpEveryDays }); };
  const toggleEx = (id: string) => set({ exercises: d.exercises.includes(id) ? d.exercises.filter((x) => x !== id) : [...d.exercises, id] });

  const next = () => {
    const errs = validateOnboard(d, today());
    if (step === 1 && errs.some((e) => /name|age|condition|surgery|phase/i.test(e))) { setErr(errs.find((e) => /name|age|condition|surgery|phase/i.test(e))!); return; }
    setErr('');
    setStep((step + 1) as 2 | 3 | 4);
  };
  const approve = () => {
    try {
      const st = getState();
      let p = buildPatient(d, { nowMs: clockMs(st), today: st.today });
      if (getSyncStatus().enabled) p = { ...p, syncKey: newSyncKey(), syncRole: 'physio' as const, ...(getSyncStatus().auth ? { claimPin: newClaimPin() } : {}), ...(st.clinicContact ? { clinicContact: st.clinicContact } : {}) }; // live sync: this computer is the physio's side
      setState({ ...st, patients: [...st.patients, p] });
      const base = window.location.href.split('#')[0];
      setMade({ id: p.id, url: inviteUrl(p, base) });
      setStep(4);
    } catch (e) { setErr((e as Error).message); }
  };
  const addThreshold = () => {
    const t = ovList.find((x) => x.target === tTarget);
    if (!t || tValue === '' || !Number.isFinite(Number(tValue))) { setErr('Choose a threshold and enter a number'); return; }
    set({ overrides: [...d.overrides.filter((o) => o.target !== tTarget), { target: tTarget, value: Number(tValue), reason: tReason.trim() || 'Set at onboarding' }] });
    setTTarget(''); setTValue(''); setTReason(''); setErr('');
  };
  const copy = () => { try { void navigator.clipboard.writeText(made!.url); } catch { /* the link is also shown in full */ } };

  return (
    <section className="card onboard" data-testid="onboarding">
      <div className="btnrow"><h2>Add a patient</h2><button className="btn" onClick={onClose}>Close</button></div>
      <p className="tiny">Step {Math.min(step, 3)} of 3. Nothing is created until you approve the plan.</p>
      {err && <p className="err" role="alert">{err}</p>}

      {step === 1 && (
        <div className="formgrid">
          <label>Name <input value={d.name} onChange={(e) => set({ name: e.target.value })} aria-label="Patient name" /></label>
          <label>Age <input type="number" min={1} max={110} value={d.age} onChange={(e) => set({ age: Number(e.target.value) })} aria-label="Age" /></label>
          <label>Language <select value={d.language} onChange={(e) => set({ language: e.target.value as Lang })} aria-label="Language"><option value="en">English</option><option value="hi">हिन्दी</option><option value="bn">বাংলা</option></select></label>
          <label className="check"><input type="checkbox" checked={!!d.caregiver} onChange={(e) => set({ caregiver: e.target.checked })} aria-label="A caregiver will answer" /> A family member or carer will usually answer for the patient</label>
          <label>Condition <select value={d.packId} onChange={(e) => choosePack(e.target.value)} aria-label="Condition">{packs.map((p) => <option key={p.id} value={p.id}>{p.condition.en}</option>)}</select></label>
          {onNewCondition && <p className="tiny" data-testid="new-condition-hint">Condition not listed? <button type="button" className="btn" onClick={onNewCondition}>+ Write a new condition</button> You write its phases, exercises and warning signs once, then pick it here.</p>}
          <label>{pack.anchorLabel.en} date <input type="date" max={s.today} value={d.anchorDate} onChange={(e) => set({ anchorDate: e.target.value })} aria-label="Surgery date" /></label>
          <label>Starting phase <select value={d.phaseId} onChange={(e) => choosePhase(e.target.value)} aria-label="Phase">{pack.phases.map((ph) => <option key={ph.id} value={ph.id}>{ph.name.en}</option>)}</select></label>
          <div className="btnrow"><button className="btn primary" onClick={next}>Next: adjust the plan</button></div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h3>Exercises <small>({phase.name.en}; the pack's list is ticked)</small></h3>
          <ul className="exchecks">{[...LIBRARY].sort((a, b) => Number(d.exercises.includes(b.id)) - Number(d.exercises.includes(a.id)) || a.name.en.localeCompare(b.name.en)).map((e) => (
            <li key={e.id}><label><input type="checkbox" checked={d.exercises.includes(e.id)} onChange={() => toggleEx(e.id)} /> {exerciseName(e.id, 'en')}{phase.exercises.includes(e.id) ? '' : <small> (not in the pack for this phase)</small>}</label></li>))}</ul>
          <h3>Follow-up</h3>
          <div className="fu">
            <label>Patient checks in every <input type="number" min={1} max={14} value={d.checkInEveryDays} onChange={(e) => set({ checkInEveryDays: Number(e.target.value) })} aria-label="Check-in every" /> day(s)</label>
            <label>You review every <input type="number" min={1} max={60} value={d.reviewEveryDays} onChange={(e) => set({ reviewEveryDays: Number(e.target.value) })} aria-label="Review every" /> day(s)</label>
          </div>
          <h3>Thresholds <small>(optional; the pack's values apply unless you change them)</small></h3>
          {d.overrides.length > 0 && <ul className="audit">{d.overrides.map((o) => <li key={o.target}>{ovList.find((x) => x.target === o.target)?.label}: <b>{o.value}</b> <small>({o.reason})</small> <button className="btn" onClick={() => set({ overrides: d.overrides.filter((x) => x.target !== o.target) })}>Remove</button></li>)}</ul>}
          <div className="fu">
            <select value={tTarget} onChange={(e) => setTTarget(e.target.value)} aria-label="Threshold"><option value="">Choose a threshold…</option>{ovList.map((x) => <option key={x.target} value={x.target}>{x.label} (now {x.base})</option>)}</select>
            <input type="number" placeholder="value" value={tValue} onChange={(e) => setTValue(e.target.value)} aria-label="Threshold value" />
            <input placeholder="Reason" value={tReason} onChange={(e) => setTReason(e.target.value)} aria-label="Threshold reason" />
            <button className="btn" onClick={addThreshold}>Add</button>
          </div>
          <div className="btnrow"><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn primary" onClick={next}>Next: review</button></div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h3>Review and approve</h3>
          <ul className="audit">
            <li><b>{d.name || '(no name)'}</b>, {d.age}, {({ en: 'English', hi: 'Hindi', bn: 'Bengali' } as Record<string, string>)[d.language]}{d.caregiver ? ', answered by a caregiver' : ''}</li>
            <li>{pack.condition.en}, {pack.anchorLabel.en} {d.anchorDate}, {phase.name.en}</li>
            <li>Exercises: {d.exercises.map((id) => exerciseName(id, 'en')).join(', ')}</li>
            <li>Check-ins every {d.checkInEveryDays} day(s); your reviews every {d.reviewEveryDays} day(s)</li>
            <li>Threshold changes: {d.overrides.length ? d.overrides.map((o) => `${ovList.find((x) => x.target === o.target)?.label} → ${o.value}`).join('; ') : 'none (pack defaults)'}</li>
          </ul>
          <div className="btnrow"><button className="btn" onClick={() => setStep(2)}>Back</button><button className="btn primary" onClick={approve}>Approve plan and create patient</button></div>
        </div>
      )}

      {step === 4 && made && (
        <div data-testid="invite">
          <h3>Patient created</h3>
          <p>Send this link, or let the patient scan the code. It opens {d.name}'s plan on their phone.</p>
          {qrOrNull(made.url) ? <div className="qr" dangerouslySetInnerHTML={{ __html: qrOrNull(made.url)! }} /> : <p className="tiny">This plan is too large for a QR code. Send the link instead.</p>}
          <p className="linkbox"><input readOnly value={made.url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} /> <button className="btn" onClick={copy}>Copy link</button></p>
          {getSyncStatus().auth && !getSyncStatus().user && <p className="tiny" role="alert"><b>You are not signed in.</b> Sign in on the Physio dashboard so this patient is registered to your account. Until then their answers will not reach you.</p>}
          <p className="tiny">{getSyncStatus().enabled ? "The link carries the patient's name, plan and a secret sync key, so share it privately and only with the patient. Live sync is on: their check-ins will appear here by themselves, and your plan changes will reach their phone." : "The link carries the patient's name and plan, so share it privately. Live sync is not set up, so the patient's answers stay on the phone that opens the link."}</p>
          <div className="btnrow"><button className="btn primary" onClick={() => { setState({ ...getState(), activeId: made.id }); onClose(); }}>Done</button></div>
        </div>
      )}
    </section>
  );
}
