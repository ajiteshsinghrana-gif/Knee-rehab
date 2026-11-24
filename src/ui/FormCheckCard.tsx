// Physio view of the camera form checks: what the phone measured in each set, the review rule that fired, and the physio's own limits.
// Read-only apart from the limits, which are the physio's decision and are written to the audit log with a reason.
// Nothing here changes a tier or a plan. The phone measures, the rules flag, the physio decides.
import { useState } from 'react';
import type { FormCheckLog, FormFault, FormRequest, Patient, ProtocolPack } from '../types';
import { exerciseName } from '../exercises/library';
import { currentExercises } from '../engine/plan';
import { clockMs, getState, updatePatient } from '../store';
import { FORM_CHECK, KINDS, formKindFor, unitOf } from '../formcheck/config';
import { f1Faults, limitFor, setFormLimit } from '../formcheck/model';
import { FAULT_PHYSIO, KIND_LABEL, UNIT_LABEL } from '../formcheck/strings';

const faultLine = (f: FormFault, reps: number) => `${FAULT_PHYSIO[f.id] ?? f.id} · ${KIND_LABEL[f.kind] ?? f.kind} · reps ${f.reps.join(', ')} of ${reps} · peak ${f.peak}${UNIT_LABEL[f.unit]}`;

/** The measured numbers behind a request the camera check raised. Shown inside the review item. */
export function AutoSummary({ patient, r }: { patient: Patient; r: FormRequest }) {
  if (!r.auto) return null;
  const c = (patient.formChecks ?? []).find((x) => x.id === r.auto!.checkId);
  return (
    <div className="reviewed" data-testid="auto-summary">
      <b>Raised by the camera form check</b> ({r.auto.reason === 'PAUSE' ? 'the phone asked the patient to pause' : `rule F1: the same fault in ${FORM_CHECK.f1.checks} of the last ${FORM_CHECK.f1.window} checks`}).
      {c ? (
        <ul>
          <li>{c.repsCounted} {c.holds?.length ? 'holds' : 'reps'} counted · camera saw the body in {Math.round(c.usable * 100)}% of frames</li>
          {c.holds?.length ? <li>Hold times: {c.holds.join(', ')} s</li> : null}
          {c.faults.map((f) => <li key={f.id}>{faultLine(f, c.repsCounted)}</li>)}
        </ul>
      ) : <p className="tiny">The measured numbers have not arrived yet.</p>}
      <p className="tiny">A single phone camera can be wrong by several degrees. Treat this as a prompt to look, not as a finding.</p>
    </div>
  );
}

export function FormCheckCard({ patient: p, pack, now }: { patient: Patient; pack: ProtocolPack; now: number }) {
  const checks = [...(p.formChecks ?? [])].reverse();
  const measurable = [...new Set([...currentExercises(p, pack), ...(p.formChecks ?? []).map((c) => c.exerciseId)])].filter((id) => formKindFor(id));
  if (!checks.length && !measurable.length) return null;
  return (
    <div className="card" data-testid="formcheck-card">
      <h3>Camera form checks <small>(measured on the patient's phone. Not a diagnosis, and it never changes a tier or a plan. {FORM_CHECK.minUsable * 100}% of frames must be clear or nothing is flagged.)</small></h3>
      {checks.length === 0 && <p className="tiny">No camera checks yet.</p>}
      {checks.slice(0, 8).map((c) => <One key={c.id} c={c} p={p} />)}
      {measurable.length > 0 && (
        <details>
          <summary>Limits for this patient ({measurable.length} measurable exercise{measurable.length === 1 ? '' : 's'})</summary>
          {measurable.map((id) => <Limit key={id} p={p} id={id} now={now} />)}
          <p className="tiny">Without a limit the camera only checks the default form faults. A limit you set makes the phone ask the patient to pause when it is crossed. Every limit and reason is in the audit log. Default thresholds are placeholders (NEEDS_PHYSIO_SIGNOFF).</p>
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
        {c.date} · <b>{exerciseName(c.exerciseId, 'en')}</b> · {c.repsCounted} {c.holds?.length ? 'holds' : 'reps'}{c.holds?.length ? ` (${c.holds.join(', ')} s)` : ''}
        {!c.reliable && ' · could not see enough (nothing flagged)'}
        {c.reliable && c.faults.length === 0 && ' · nothing measured above the limits'}
        {c.reliable && c.faults.length > 0 && ` · ${c.faults.length} fault${c.faults.length === 1 ? '' : 's'} measured`}
        {c.paused && <b className="err"> · patient asked to pause</b>}
        {f1.length > 0 && <b> · F1</b>}
      </summary>
      {c.faults.length > 0 && <ul>{c.faults.map((f) => <li key={f.id}>{faultLine(f, c.repsCounted)}</li>)}</ul>}
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
  const [why, setWhy] = useState('');
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const hint = KINDS[kind].hint;
  const save = () => updatePatient(p.id, (q) => setFormLimit(q, id, { max: num(max), min: num(min) }, why, { nowMs: now || clockMs(getState()), today: getState().today }));
  const bad = (s: string) => s.trim() !== '' && !Number.isFinite(Number(s));
  return (
    <div className="modify" data-testid="fc-limit">
      <b>{exerciseName(id, 'en')}</b> <small>({hint})</small>
      <label>Do not go past (max) <input type="number" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} aria-label={`Maximum for ${id}`} /> {unit}</label>
      <label>At least reach (min) <input type="number" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} aria-label={`Minimum for ${id}`} /> {unit}</label>
      <textarea placeholder="Reason (required, goes in the audit log)" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Reason" />
      <div className="btnrow"><button className="btn primary" data-testid="fc-limit-save" disabled={!why.trim() || bad(max) || bad(min)} onClick={save}>{max === '' && min === '' ? 'Remove limit' : 'Save limit'}</button></div>
    </div>
  );
}
