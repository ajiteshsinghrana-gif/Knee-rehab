// Pilot mode screens for the camera form check: the switch (before a set) and the rating panel (after a set).
// For a physio running the check on volunteers. English only, like the other physio screens. Never shown on a patient's own phone.
// What is kept, and where, is explained in src/formcheck/pilot.ts.
import { useState } from 'react';
import { KINDS } from '../formcheck/config';
import { FAULT_PHYSIO, UNIT_LABEL } from '../formcheck/strings';
import { loadPilot, savePilot, summarise, toCsv, toJson, rate, upsert, type PilotRecord, type PilotStore } from '../formcheck/pilot';

const save = (name: string, type: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};
const stamp = () => new Date().toISOString().slice(0, 10);

/** The switch, the participant label, what the ratings say so far, and the export buttons. */
export function PilotSetup({ onChange }: { onChange?: (s: PilotStore) => void }) {
  const [s, setS] = useState<PilotStore>(() => loadPilot());
  const [sure, setSure] = useState(false);
  const put = (n: PilotStore) => { setS(n); savePilot(n); onChange?.(n); };
  const stats = summarise(s.records);
  const rated = s.records.filter((r) => r.rated).length;
  return (
    <details className="card" data-testid="pilot-setup" open={s.on}>
      <summary><b>Pilot mode</b> (for a physio testing the camera check on volunteers){s.on ? ' · ON' : ''}</summary>
      <p className="tiny">Use it only with volunteers who agreed to take part. It keeps the phone's measurements and your ratings, with no video and no names, in this browser only. Nothing is sent anywhere until you export it. It never changes a threshold, a plan or a tier by itself.</p>
      <label className="caregivertoggle"><input type="checkbox" checked={s.on} onChange={(e) => put({ ...s, on: e.target.checked })} data-testid="pilot-on" /><span><b>Record pilot data and ask me to rate each set</b></span></label>
      {s.on && (
        <label className="field"><b>Participant label</b> <small>(a code such as P07, not a name)</small>
          <input value={s.participant} maxLength={20} onChange={(e) => put({ ...s, participant: e.target.value })} data-testid="pilot-participant" placeholder="P01" />
        </label>
      )}
      <p className="tiny">{s.records.length} set{s.records.length === 1 ? '' : 's'} recorded, {rated} rated.</p>
      {stats.length > 0 && (
        <div data-testid="pilot-stats" style={{ overflowX: 'auto' }}>
          <table className="tiny">
            <thead><tr><th>Fault</th><th>Sets</th><th>Real</th><th>False alarm</th><th>Missed</th><th>Limit now</th><th>Suggested</th></tr></thead>
            <tbody>{stats.map((f) => (
              <tr key={`${f.kind}-${f.id}`}>
                <td>{FAULT_PHYSIO[f.id] ?? f.id}</td><td>{f.sets}</td><td>{f.real}</td><td>{f.falseAlarm}</td><td>{f.missed}</td>
                <td>{f.limit}{UNIT_LABEL[f.unit]}</td>
                <td>{f.suggestion?.enough
                  ? <>{f.suggestion.limit}{UNIT_LABEL[f.unit]} <small>(catches {Math.round((f.suggestion.recall ?? 0) * 100)}%, right {Math.round((f.suggestion.precision ?? 0) * 100)}% of the time; now {Math.round((f.suggestion.currentRecall ?? 0) * 100)}% and {Math.round((f.suggestion.currentPrecision ?? 0) * 100)}%)</small></>
                  : <small>needs more rated sets ({f.suggestion?.positives ?? 0} real, {f.suggestion?.negatives ?? 0} not)</small>}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="tiny">A suggested limit is only a suggestion. A physio signs off any change to <code>src/formcheck/config.ts</code>. A small pilot can mislead: more people and more sets make it safer.</p>
        </div>
      )}
      {s.records.length > 0 && (
        <div className="fu">
          <button className="btn" onClick={() => save(`form-check-pilot-${stamp()}.csv`, 'text/csv', toCsv(s.records))} data-testid="pilot-csv">Export spreadsheet (.csv)</button>
          <button className="btn" onClick={() => save(`form-check-pilot-${stamp()}.json`, 'application/json', toJson(s.records))}>Export everything (.json)</button>
          {!sure ? <button className="link" onClick={() => setSure(true)}>Clear pilot data</button>
            : <button className="btn danger" onClick={() => { put({ ...s, records: [] }); setSure(false); }} data-testid="pilot-clear">Really clear {s.records.length} sets</button>}
        </div>
      )}
    </details>
  );
}

/** After a set: was each flag real, which faults did the phone miss, and how many reps did you count. */
export function PilotRating({ record, onSaved }: { record: PilotRecord; onSaved: (r: PilotRecord) => void }) {
  const [marks, setMarks] = useState<Record<string, 'real' | 'false'>>(record.marks);
  const [missed, setMissed] = useState<string[]>(record.missed);
  const [reps, setReps] = useState(record.observerReps === null ? '' : String(record.observerReps));
  const [note, setNote] = useState(record.note);
  const [done, setDone] = useState(record.rated);
  const flagged = new Set(record.flagged.map((f) => f.id));
  const others = KINDS[record.kind].faults.filter((f) => !flagged.has(f.id));
  const ready = record.flagged.every((f) => marks[f.id]);
  const submit = () => {
    const r = rate(record, { marks, missed, observerReps: reps.trim() === '' || !Number.isFinite(Number(reps)) ? null : Math.max(0, Math.round(Number(reps))), note });
    savePilot(upsert(loadPilot(), r));
    setDone(true);
    onSaved(r);
  };
  return (
    <div className="card" data-testid="pilot-rating">
      <h3>Pilot rating <small>({record.participant})</small></h3>
      {!record.reliable && <p className="tiny">The camera did not see enough, so this set is kept but is not used for limits.</p>}
      {record.flagged.length === 0 ? <p className="tiny">The phone flagged nothing.</p> : record.flagged.map((f) => (
        <div key={f.id} data-testid="pilot-flag">
          <b>{FAULT_PHYSIO[f.id] ?? f.id}</b> <small>(peak {f.peak}{UNIT_LABEL[f.unit]}, reps {f.reps.join(', ')})</small>
          <div className="fu">
            <button className={marks[f.id] === 'real' ? 'btn primary' : 'btn'} onClick={() => { setDone(false); setMarks({ ...marks, [f.id]: 'real' }); }}>Real fault</button>
            <button className={marks[f.id] === 'false' ? 'btn primary' : 'btn'} onClick={() => { setDone(false); setMarks({ ...marks, [f.id]: 'false' }); }}>False alarm</button>
          </div>
        </div>
      ))}
      {others.length > 0 && (
        <fieldset>
          <legend><b>Faults you saw that the phone did not flag</b></legend>
          {others.map((f) => (
            <label key={f.id} className="caregivertoggle"><input type="checkbox" checked={missed.includes(f.id)} onChange={(e) => { setDone(false); setMissed(e.target.checked ? [...missed, f.id] : missed.filter((x) => x !== f.id)); }} /><span>{FAULT_PHYSIO[f.id] ?? f.id}</span></label>
          ))}
        </fieldset>
      )}
      <label className="field"><b>Reps you counted</b> <small>(the phone counted {record.reps})</small>
        <input inputMode="numeric" value={reps} onChange={(e) => { setDone(false); setReps(e.target.value); }} data-testid="pilot-reps" />
      </label>
      <label className="field"><b>Note</b> <small>(optional, no names)</small>
        <input value={note} maxLength={300} onChange={(e) => { setDone(false); setNote(e.target.value); }} />
      </label>
      <button className="big primary" disabled={!ready || done} onClick={submit} data-testid="pilot-save">{done ? 'Rating saved' : 'Save rating'}</button>
      {!ready && <p className="tiny">Mark each flag real or false alarm first.</p>}
    </div>
  );
}
