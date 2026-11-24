// Physio view of the camera form checks: what the phone measured in each set, the review rule that fired, and the physio's own limits.
// Read-only apart from the limits, which are the physio's decision and are written to the audit log with a reason.
// Nothing here changes a tier or a plan. The phone measures, the rules flag, the physio decides.
import { useState } from 'react';
import type { FormCheckLog, FormFault, FormRequest, Patient, ProtocolPack } from '../types';
import { exerciseName } from '../exercises/library';
import { currentExercises } from '../engine/plan';
import { clockMs, getState, updatePatient } from '../store';
import { DEFAULT_TEMPO, FORM_CHECK, KINDS, PACE, checkMode, formKindFor, paceApplies, unitOf } from '../formcheck/config';
import { cameraOn, f1Faults, limitFor, setCameraCheck, setFormLimit } from '../formcheck/model';
import { COUNT_KEYS, FAULT_PHYSIO, KIND_LABEL, UNIT_LABEL } from '../formcheck/strings';

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
/** Pace, pain and the red-flag answer of one check, in one line for the physio. */
const extras = (c: FormCheckLog): string[] => [
  ...(c.mode === 'count' ? ['count only (no form rules for this exercise, nothing judged)'] : []),
  ...(c.repSecs?.length && c.tempo ? [`reps took ${Math.min(...c.repSecs)}–${Math.max(...c.repSecs)} s (median ${median(c.repSecs)} s; tempo ${c.tempo} s)`] : []),
  ...(c.after ? [`pain after the set ${c.after.pain ?? 'not given'}/10`, c.after.redFlag ? 'said YES to dizziness, chest pain or breathlessness (sent to the warning signs)' : 'no dizziness, chest pain or breathlessness'] : []),
];
const faultLine = (f: FormFault, reps: number) => `${FAULT_PHYSIO[f.id] ?? f.id} · ${KIND_LABEL[f.kind] ?? f.kind} · reps ${f.reps.join(', ')} of ${reps} · peak ${f.peak}${UNIT_LABEL[f.unit]}`;

/** The measured numbers behind a request the camera check raised. Shown inside the review item. */
export function AutoSummary({ patient, r }: { patient: Patient; r: FormRequest }) {
  if (!r.auto) return null;
  const c = (patient.formChecks ?? []).find((x) => x.id === r.auto!.checkId);
  return (
    <div className="reviewed" data-testid="auto-summary">
      <b>Raised by the camera check</b> ({r.auto.reason === 'PAUSE' ? 'a red flag during the set (a stumble or your limit); the set was not stopped' : `rule F1: the same fault in ${FORM_CHECK.f1.checks} of the last ${FORM_CHECK.f1.window} checks`}).
      {c ? (
        <ul>
          <li>{c.repsCounted} {c.holds?.length ? 'holds' : COUNT_KEYS[c.kind]?.word ?? 'reps'} counted · camera saw the body in {Math.round(c.usable * 100)}% of frames</li>
          {c.holds?.length ? <li>Hold times: {c.holds.join(', ')} s</li> : null}
          {c.cadence ? <li>About {c.cadence} {c.kind === 'cycle' ? 'pedal turns' : 'steps'} a minute</li> : null}
          {extras(c).map((x) => <li key={x}>{x}</li>)}
          {c.faults.map((f) => <li key={f.id}>{faultLine(f, c.repsCounted)}</li>)}
        </ul>
      ) : <p className="tiny">The measured numbers have not arrived yet.</p>}
      <p className="tiny">A single phone camera can be wrong by several degrees. Treat this as a prompt to look, not as a finding.</p>
    </div>
  );
}

/**
 * The per-patient camera switch, at the top of the Plan tab. On for every patient by default; the physio can turn it off.
 * Written to the audit log; travels to the patient's phone.
 */
export function CameraSwitch({ patient: p, pack, now }: { patient: Patient; pack: ProtocolPack; now: number }) {
  const on = cameraOn(p);
  const plan = currentExercises(p, pack);
  const form = plan.filter((id) => checkMode(id) === 'form').length, count = plan.filter((id) => checkMode(id) === 'count').length, video = plan.length - form - count;
  const toggle = () => updatePatient(p.id, (q) => setCameraCheck(q, !on, { nowMs: now || clockMs(getState()), today: getState().today }));
  return (
    <div className="card camswitch" data-testid="camera-switch">
      <div className="camswitch-row">
        <span><b>Camera form check</b> · {on ? 'On' : <b className="err">Off</b>} for this patient{!on && p.formCheckOff?.at ? <small> since {p.formCheckOff.at.slice(0, 10)}</small> : null}</span>
        <button className="btn" data-testid="fc-switch" onClick={toggle}>{on ? 'Turn off' : 'Turn on'}</button>
      </div>
      <p className="tiny">On by default. The patient sees “Check my form with the camera” on their home screen: in the current plan, form tips for {form} exercise{form === 1 ? '' : 's'}{count ? `, reps and pace only for ${count}` : ''}{video ? `, and ${video} the camera cannot count (the patient is offered a video instead)` : ''}. Turning it off or on is written to the audit log.</p>
    </div>
  );
}

export function FormCheckCard({ patient: p, pack, now }: { patient: Patient; pack: ProtocolPack; now: number }) {
  const checks = [...(p.formChecks ?? [])].reverse();
  const plan = currentExercises(p, pack);
  // Limits and tempo only for exercises with form rules of their own (count-only exercises flag nothing).
  const measurable = [...new Set([...plan, ...(p.formChecks ?? []).map((c) => c.exerciseId)])].filter((id) => { const k = formKindFor(id); return !!k && checkMode(id) === 'form' && (!KINDS[k].noLimit || paceApplies(k)); });
  if (!checks.length && !plan.length) return null;
  return (
    <div className="card" data-testid="formcheck-card">
      <h3>Camera check <small>(measured on the patient's phone. Not a diagnosis, and it never changes a tier or a plan. {FORM_CHECK.minUsable * 100}% of frames must be clear or nothing is flagged. {cameraOn(p) ? 'On' : 'Off'} for this patient: the switch is at the top of the Plan tab.)</small></h3>
      {checks.length === 0 && <p className="tiny">No camera checks yet.</p>}
      {checks.slice(0, 8).map((c) => <One key={c.id} c={c} p={p} />)}
      {measurable.length > 0 && (
        <details>
          <summary>Limits and pace for this patient ({measurable.length} measurable exercise{measurable.length === 1 ? '' : 's'})</summary>
          {measurable.map((id) => <Limit key={id} p={p} id={id} now={now} />)}
          <p className="tiny">Without a limit the camera only checks the default form faults. A maximum you set stops the set when it is crossed. Pace: a rep quicker than {PACE.fast * 100}% of the tempo or slower than {PACE.slow} times it is flagged. Every setting and reason is in the audit log. Default thresholds and tempos are placeholders (NEEDS_PHYSIO_SIGNOFF).</p>
        </details>
      )}
    </div>
  );
}

function One({ c, p }: { c: FormCheckLog; p: Patient }) {
  const f1 = f1Faults((p.formChecks ?? []).filter((x) => x.id !== c.id && x.startedAt < c.startedAt), c);
  return (
    <details open={c === (p.formChecks ?? [])[(p.formChecks ?? []).length - 1]} data-testid="formcheck-one">
      <summary>
        {c.date} · <b>{exerciseName(c.exerciseId, 'en')}</b> · {c.repsCounted} {c.holds?.length ? 'holds' : COUNT_KEYS[c.kind]?.word ?? 'reps'}{c.holds?.length ? ` (${c.holds.join(', ')} s)` : ''}
        {!c.reliable && ' · could not see enough (nothing flagged)'}
        {c.reliable && c.faults.length === 0 && ' · nothing measured above the limits'}
        {c.reliable && c.faults.length > 0 && ` · ${c.faults.length} fault${c.faults.length === 1 ? '' : 's'} measured`}
        {c.paused && <b className="err"> · red flag during the set (stumble or your limit)</b>}
        {c.after?.redFlag && <b className="err"> · red-flag yes after the set</b>}
        {f1.length > 0 && <b> · F1</b>}
      </summary>
      {(c.faults.length > 0 || extras(c).length > 0) && <ul>{c.faults.map((f) => <li key={f.id}>{faultLine(f, c.repsCounted)}</li>)}{extras(c).map((x) => <li key={x}>{x}</li>)}</ul>}
      <p className="tiny">Camera saw the body in {Math.round(c.usable * 100)}% of frames{c.limit ? ` · your limit then: ${c.limit.min !== undefined ? `min ${c.limit.min}` : ''}${c.limit.min !== undefined && c.limit.max !== undefined ? ', ' : ''}${c.limit.max !== undefined ? `max ${c.limit.max}` : ''}` : ''}{c.answeredBy === 'caregiver' ? ' · answered by a carer' : ''}.</p>
    </details>
  );
}

function Limit({ p, id, now }: { p: Patient; id: string; now: number }) {
  const kind = formKindFor(id)!;
  const unit = UNIT_LABEL[unitOf(kind)];
  const cur = limitFor(p, id);
  const [max, setMax] = useState(cur?.max?.toString() ?? '');
  const [min, setMin] = useState(cur?.min?.toString() ?? '');
  const [tempo, setTempo] = useState(cur?.tempo?.toString() ?? '');
  const hasRange = !KINDS[kind].noLimit, hasPace = paceApplies(kind);
  const [why, setWhy] = useState('');
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const hint = KINDS[kind].hint;
  const save = () => updatePatient(p.id, (q) => setFormLimit(q, id, { max: hasRange ? num(max) : undefined, min: hasRange ? num(min) : undefined, tempo: hasPace ? num(tempo) : undefined }, why, { nowMs: now || clockMs(getState()), today: getState().today }));
  const bad = (s: string) => s.trim() !== '' && !Number.isFinite(Number(s));
  const badTempo = tempo.trim() !== '' && (!Number.isFinite(Number(tempo)) || Number(tempo) < PACE.minSec || Number(tempo) > PACE.maxSec);
  return (
    <div className="modify" data-testid="fc-limit">
      <b>{exerciseName(id, 'en')}</b> <small>({hint})</small>
      {hasRange && <label>Do not go past (max) <input type="number" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} aria-label={`Maximum for ${id}`} /> {unit}</label>}
      {hasRange && <label>At least reach (min) <input type="number" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} aria-label={`Minimum for ${id}`} /> {unit}</label>}
      {hasPace && <label>Tempo <input type="number" inputMode="decimal" min={PACE.minSec} max={PACE.maxSec} step="0.5" value={tempo} placeholder={String(DEFAULT_TEMPO[kind])} onChange={(e) => setTempo(e.target.value)} aria-label={`Tempo for ${id}`} data-testid="fc-tempo" /> seconds a rep <small>(default {DEFAULT_TEMPO[kind]} s)</small></label>}
      <textarea placeholder="Reason (required, goes in the audit log)" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Reason" />
      <div className="btnrow"><button className="btn primary" data-testid="fc-limit-save" disabled={!why.trim() || bad(max) || bad(min) || badTempo} onClick={save}>{max === '' && min === '' && tempo === '' ? 'Remove settings' : 'Save'}</button></div>
    </div>
  );
}
