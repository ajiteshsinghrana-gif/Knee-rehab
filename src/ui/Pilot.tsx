// Camera pilot (camera check safety round): a physio screen behind physio sign-in, for testing the camera check on participants.
// Never on a patient screen, and nothing here writes to a patient record. English only, like the other physio screens.
// Order per set: run the set (the phone shows nothing during it) -> the observer enters what they saw -> only then the phone's flags.
// What is kept, and where, is explained in src/formcheck/pilot.ts.
import { useState } from 'react';
import { KINDS, KIND_EXERCISES, VARIANTS, BORROWED, type FormKind } from '../formcheck/config';
import { FAULT_PHYSIO, UNIT_LABEL, fcs } from '../formcheck/strings';
import { exerciseName } from '../exercises/library';
import {
  GROUP_LABEL, PARTICIPANT_TYPE, countPct, faultsFor, judge, loadPilot, newPilotRecord, putParticipant, repAgreement, savePilot, summarise, toCsv, toJson, upsert,
  type ParticipantType, type PilotGroup, type PilotRecord, type PilotStore,
} from '../formcheck/pilot';
import { CameraSet, type SetOutcome } from './FormCheck';

const save = (name: string, type: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};
const stamp = () => new Date().toISOString().slice(0, 10);

/** Every movement the camera can check with rules of its own, with the exercise it belongs to. */
export const PILOT_KINDS: { kind: FormKind; exerciseId: string; label: string }[] = (Object.keys(KINDS) as FormKind[]).flatMap((kind) => {
  const own = KIND_EXERCISES[kind].filter((id) => !BORROWED.includes(id));
  if (own.length) return [{ kind, exerciseId: own[0], label: own.map((id) => (id === 'shoulder-abduction' ? 'Shoulder abduction' : exerciseName(id, 'en'))).join(', ') }];
  for (const [ex, vs] of Object.entries(VARIANTS)) {
    const v = vs.find((x) => x.kind === kind);
    if (v) return [{ kind, exerciseId: ex, label: `${exerciseName(ex, 'en')}: ${fcs('en', v.labelKey)}` }];
  }
  return [];
});

export function PilotScreen({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<PilotStore>(() => loadPilot());
  const put = (n: PilotStore) => { setS(n); savePilot(n); };
  const [who, setWho] = useState(s.participants[0]?.label ?? '');
  const [pick, setPick] = useState(0);
  const [stage, setStage] = useState<'home' | 'set' | 'verdict' | 'reveal'>('home');
  const [rec, setRec] = useState<PilotRecord | null>(null);
  const [label, setLabel] = useState('');
  const [ptype, setPtype] = useState<ParticipantType>('volunteer');
  const [group, setGroup] = useState<PilotGroup>('tune');
  const [sure, setSure] = useState(false);
  const part = s.participants.find((x) => x.label === who);
  const k = PILOT_KINDS[pick];

  const onDone = (o: SetOutcome) => {
    if (!part) return;
    const r = newPilotRecord({ id: `p${Date.now().toString(36)}`, at: new Date().toISOString(), participant: part, kind: k.kind, exerciseId: k.exerciseId, summary: o.summary });
    put(upsert(loadPilot(), r));
    setRec(r); setStage('verdict');
  };

  if (stage === 'set' && part) {
    return (
      <section data-testid="pilot-set">
        <p className="tiny">Pilot · {part.label} · {k.label}. The phone shows nothing during the set; enter your own verdict first.</p>
        <CameraSet key={k.kind} kind={k.kind} lang="en" countOnly={false} blind trace onDone={onDone} onCancel={() => setStage('home')} onTooSlow={() => setStage('home')} />
      </section>
    );
  }
  if (stage === 'verdict' && rec) return <Verdict record={rec} onSaved={(r) => { put(upsert(loadPilot(), r)); setRec(r); setStage('reveal'); }} />;
  if (stage === 'reveal' && rec) {
    return (
      <section className="card" data-testid="pilot-reveal">
        <h3>What the phone flagged <small>({rec.participant})</small></h3>
        {!rec.reliable && <p className="hint">The camera could not see enough, so it flagged nothing. This set is left out of every figure.</p>}
        <p>Reps: phone {rec.reps}, you {rec.observer?.reps ?? 'not counted'}.</p>
        <ul>{faultsFor(rec.kind).map((id) => {
          const flagged = rec.flagged.find((f) => f.id === id), saw = rec.observer?.faults.includes(id);
          if (!flagged && !saw) return null;
          return <li key={id}><b>{FAULT_PHYSIO[id] ?? id}</b>: {flagged && saw ? 'phone and you (agree)' : flagged ? 'phone only (false alarm by your verdict)' : 'you only (the phone missed it)'}{flagged ? ` · peak ${flagged.peak}${UNIT_LABEL[flagged.unit] ?? ''}, reps ${flagged.reps.join(', ')}` : ''}</li>;
        })}</ul>
        {rec.flagged.length === 0 && !rec.observer?.faults.length && <p>Neither the phone nor you saw a fault.</p>}
        <p className="tiny">Your verdict is locked: it was entered before these flags were shown.</p>
        <button className="big primary" onClick={() => setStage('set')}>Next set, same participant</button>
        <button className="big secondary" onClick={() => setStage('home')}>Back to the pilot</button>
      </section>
    );
  }

  const stats = summarise(s.records);
  const judged = s.records.filter((r) => r.rated);
  const reps = { test: repAgreement(s.records, 'test'), tune: repAgreement(s.records, 'tune') };
  const testSets = judged.filter((r) => r.group === 'test').length;
  return (
    <section data-testid="pilot">
      <div className="btnrow"><h2>Camera pilot</h2><button className="link" onClick={onClose}>Close</button></div>
      <p className="tiny">For testing the camera check on participants, not patients' own sets. Kept in this browser only, never synced, no video, no names. Limits are suggested from the tuning group only; accuracy is reported on the test group only. Every percentage shows its counts.</p>

      <div className="card">
        <h3>Participants</h3>
        {s.participants.length === 0 && <p className="tiny">Add a participant first.</p>}
        <ul>{s.participants.map((x) => <li key={x.label}><b>{x.label}</b> · {PARTICIPANT_TYPE[x.type]} · {x.group === 'tune' ? 'tuning group' : 'test group'}</li>)}</ul>
        <label className="field"><b>Label</b> <small>(a code such as P07, not a name)</small>
          <input value={label} maxLength={20} onChange={(e) => setLabel(e.target.value)} placeholder="P01" data-testid="pilot-label" />
        </label>
        <label className="field"><b>Who is this?</b>
          <select value={ptype} onChange={(e) => setPtype(e.target.value as ParticipantType)} data-testid="pilot-type">{(Object.keys(PARTICIPANT_TYPE) as ParticipantType[]).map((t) => <option key={t} value={t}>{PARTICIPANT_TYPE[t]}</option>)}</select>
        </label>
        <label className="field"><b>Group</b>
          <select value={group} onChange={(e) => setGroup(e.target.value as PilotGroup)} data-testid="pilot-group">{(Object.keys(GROUP_LABEL) as PilotGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select>
        </label>
        <button className="btn" data-testid="pilot-add" disabled={!label.trim()} onClick={() => { put(putParticipant(s, { label, type: ptype, group })); setWho(label.trim()); setLabel(''); }}>Add or update participant</button>
        <p className="tiny">Keep each participant in one group. Changing a participant's group later does not move sets already recorded.</p>
      </div>

      <div className="card">
        <h3>Run a set</h3>
        <label className="field"><b>Participant</b>
          <select value={who} onChange={(e) => setWho(e.target.value)} data-testid="pilot-who"><option value="">Choose…</option>{s.participants.map((x) => <option key={x.label} value={x.label}>{x.label}</option>)}</select>
        </label>
        <label className="field"><b>Exercise</b>
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))} data-testid="pilot-kind">{PILOT_KINDS.map((x, i) => <option key={x.kind} value={i}>{x.label}</option>)}</select>
        </label>
        <button className="big primary" data-testid="pilot-start" disabled={!part} onClick={() => setStage('set')}>Start the camera</button>
      </div>

      <div className="card" data-testid="pilot-stats">
        <h3>Results <small>({judged.length} judged set{judged.length === 1 ? '' : 's'}: {testSets} test, {judged.length - testSets} tuning)</small></h3>
        <p><b>Reps, test group:</b> exact match {countPct(reps.test.exact, reps.test.sets)}; within one {countPct(reps.test.within1, reps.test.sets)}.</p>
        <p className="tiny">Reps, tuning group (same data used to choose limits, so it will look better than real use): exact {countPct(reps.tune.exact, reps.tune.sets)}.</p>
        {stats.length === 0 ? <p className="tiny">No judged sets yet.</p> : (
          <ul>{stats.map((x) => (
            <li key={x.kind + x.id}>
              <b>{FAULT_PHYSIO[x.id] ?? x.id}</b> <small>({x.kind})</small>
              <br />Test group ({x.test.sets} set{x.test.sets === 1 ? '' : 's'}): real faults the phone found {countPct(x.test.tp, x.test.tp + x.test.fn)}; phone flags that were real {countPct(x.test.tp, x.test.tp + x.test.fp)}.
              <br /><small>Tuning group (same data used to choose limits, so it will look better than real use): real faults found {countPct(x.tune.tp, x.tune.tp + x.tune.fn)}; flags that were real {countPct(x.tune.tp, x.tune.tp + x.tune.fp)}.</small>
              {x.suggestion && (x.suggestion.enough
                ? <><br /><small>Suggested limit from the tuning group: {x.suggestion.limit}{UNIT_LABEL[x.unit ?? ''] ?? ''} (now {x.limit}{UNIT_LABEL[x.unit ?? ''] ?? ''}), from {x.suggestion.positives} sets with the fault and {x.suggestion.negatives} without. Same-data fit, not accuracy: check it on the test group. For you to sign off; nothing changes by itself.</small></>
                : <><br /><small>No limit suggested yet: needs at least 10 tuning sets with 3 that had the fault and 3 that did not (now {x.suggestion.positives} with, {x.suggestion.negatives} without).</small></>)}
            </li>))}</ul>
        )}
        <div className="btnrow">
          <button className="btn" onClick={() => save(`camera-pilot-${stamp()}.csv`, 'text/csv', toCsv(s.records))} data-testid="pilot-csv">Export spreadsheet (.csv)</button>
          <button className="btn" onClick={() => save(`camera-pilot-${stamp()}.json`, 'application/json', toJson(s.records))}>Export everything (.json)</button>
          {!sure ? <button className="link" onClick={() => setSure(true)}>Clear pilot sets</button>
            : <button className="btn danger" onClick={() => { put({ ...s, records: [] }); setSure(false); }} data-testid="pilot-clear">Really clear {s.records.length} sets</button>}
        </div>
      </div>
    </section>
  );
}

/** The observer's verdict, before the phone's flags are shown: which faults they saw, and how many reps they counted. */
function Verdict({ record, onSaved }: { record: PilotRecord; onSaved: (r: PilotRecord) => void }) {
  const [seen, setSeen] = useState<string[]>([]);
  const [reps, setReps] = useState('');
  const [note, setNote] = useState('');
  const ok = reps.trim() !== '' && Number.isFinite(Number(reps)) && Number(reps) >= 0;
  return (
    <section className="card" data-testid="pilot-verdict">
      <h3>Your verdict <small>({record.participant}, before you see the phone's flags)</small></h3>
      <fieldset>
        <legend><b>Faults you saw in this set</b> (tick none if you saw none)</legend>
        {faultsFor(record.kind).map((id) => (
          <label key={id} className="caregivertoggle"><input type="checkbox" checked={seen.includes(id)} onChange={(e) => setSeen(e.target.checked ? [...seen, id] : seen.filter((x) => x !== id))} /><span>{FAULT_PHYSIO[id] ?? id}</span></label>
        ))}
      </fieldset>
      <label className="field"><b>Reps you counted</b>
        <input type="number" inputMode="numeric" min={0} value={reps} onChange={(e) => setReps(e.target.value)} data-testid="pilot-reps" />
      </label>
      <label className="field"><b>Note</b> <small>(optional, no names)</small>
        <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button className="big primary" disabled={!ok} data-testid="pilot-save" onClick={() => onSaved(judge(record, { faults: seen, reps: Number(reps), note }))}>Save my verdict and show the phone's flags</button>
    </section>
  );
}
