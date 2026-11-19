import { useMemo, useState } from 'react';
import type { Bi, Operator } from '../types';
import { LIBRARY } from '../exercises/library';
import { PACKS } from '../engine/packs';
import {
  PAIN_ID, draftAsNewVersion, ungatedChanges, fatDraft, questionnaireFromFile, blankBi, blankDraft, buildConditionPack, newConditionId, placeholderAlerts, validateDraft,
  type AlertGroup, type Alerts, type ConditionDraft,
} from '../author/condition';
import { clockMs, getState, setState } from '../store';

const OPS: Operator[] = ['>=', '>', '<=', '<', '==', '!='];
const ANCHORS: Bi[] = [{ en: 'after surgery', hi: 'सर्जरी के बाद' }, { en: 'after the injury', hi: 'चोट के बाद' }, { en: 'after diagnosis', hi: 'निदान के बाद' }];
const GROUPS: { key: AlertGroup; title: string; fields: { path: string; label: string }[] }[] = [
  { key: 'hours', title: 'Hours to respond', fields: [{ path: 'hours.SAFETY', label: 'SAFETY (h)' }, { path: 'hours.URGENT', label: 'URGENT (h)' }, { path: 'hours.REVIEW', label: 'REVIEW (h)' }] },
  { key: 'missed', title: 'Missed sessions', fields: [{ path: 'missed.count', label: 'Days in a row' }, { path: 'missed.adherencePct', label: 'Or adherence below (%)' }] },
  { key: 'combination', title: 'Several signals together', fields: [{ path: 'combination.minDistinct', label: 'At least this many REVIEW signals' }, { path: 'combination.windowDays', label: 'Within (days)' }] },
  { key: 'painRise', title: 'Pain rising', fields: [{ path: 'painRise.delta', label: 'Rise of (points)' }, { path: 'painRise.window', label: 'Over (check-ins)' }] },
  { key: 'silence', title: 'No check-in at all', fields: [{ path: 'silence.hours', label: 'Raise a REVIEW alert after (h)' }] },
  { key: 'followUp', title: 'Follow-up after an URGENT alert', fields: [{ path: 'followUp.teleHours', label: 'Tele-review within (h)' }, { path: 'followUp.checkInDays', label: 'Check in every (days)' }, { path: 'followUp.forDays', label: 'For (days)' }] },
];
const getAt = (a: Alerts, path: string): number => path.split('.').reduce((o: any, k) => o?.[k], a) as number;
const setAt = (a: Alerts, path: string, v: number): Alerts => { const c = JSON.parse(JSON.stringify(a)); const ks = path.split('.'); let o = c; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = v; return c; };
const numOrNull = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

function BiField({ label, value, onChange, hint }: { label: string; value: Bi; onChange: (b: Bi) => void; hint?: string }) {
  return (
    <fieldset className="bifield">
      <legend>{label}</legend>
      <input value={value.en} placeholder="English" aria-label={`${label} (English)`} onChange={(e) => onChange({ ...value, en: e.target.value })} />
      <input value={value.hi} placeholder="हिन्दी" lang="hi" aria-label={`${label} (Hindi)`} onChange={(e) => onChange({ ...value, hi: e.target.value })} />
      {hint && <small>{hint}</small>}
    </fieldset>
  );
}

/** Phase 3.3: the physio writes a protocol for any condition. Every clinical choice is typed by the physio. */
export function NewCondition({ onClose, onAddPatient, initial, initialNotes }: { onClose: () => void; onAddPatient: () => void; initial?: ConditionDraft; initialNotes?: string[] }) {
  const [d, setD] = useState<ConditionDraft>(() => initial ?? blankDraft(newConditionId(clockMs(getState()))));
  const [saved, setSaved] = useState('');
  const [msg, setMsg] = useState(() => (initial ? 'Loaded the AI draft. Nothing is saved yet. Check every item against its quote, fix the Hindi, and fill the gaps below.' : ''));
  const up = (fn: (c: ConditionDraft) => void) => setD((x) => { const c: ConditionDraft = JSON.parse(JSON.stringify(x)); fn(c); return c; });
  const saved_q = getState().questionnaires ?? [];
  const loadQuestionnaire = async (f?: File) => {
    if (!f) return;
    try { const q = questionnaireFromFile(await f.text()); up((c) => { c.questionnaire = q; }); setMsg(`Loaded ${f.name}. Tick the permission box yourself once you have confirmed you may use it.`); }
    catch (e) { setMsg(`Could not use that file: ${(e as Error).message}`); }
  };
  const saveQuestionnaire = () => {
    const q = d.questionnaire; if (!q) return;
    if (!q.title.en.trim()) { setMsg('Give the questionnaire an English title before saving it for reuse'); return; }
    const st = getState();
    const others = (st.questionnaires ?? []).filter((x) => x.name !== q.title.en.trim());
    setState({ ...st, questionnaires: [...others, { id: `sq-${Date.now().toString(36)}`, name: q.title.en.trim(), q: JSON.parse(JSON.stringify(q)) }] });
    setMsg(`Saved "${q.title.en.trim()}" for reuse in other conditions.`);
  };
  const downloadQuestionnaire = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(d.questionnaire, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${(d.questionnaire?.title.en || 'questionnaire').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const written = Object.values(PACKS).filter((p) => p.authored);
  const problems = useMemo(() => validateDraft(d), [d]);
  const measureOptions = [{ id: PAIN_ID, label: 'Pain (daily, 0-10)' }, ...d.measures.map((m) => ({ id: m.id, label: m.label.en || m.id }))];
  const exOptions = [...d.exercises.map((x) => ({ id: x.id, name: x.name.en || '(new exercise)', isNew: true })), ...LIBRARY.filter((e) => !e.id.startsWith('custom-')).map((e) => ({ id: e.id, name: e.name.en, isNew: false })).sort((a, b) => a.name.localeCompare(b.name))];

  const addExercise = () => up((c) => { const n = c.exercises.reduce((m, x) => Math.max(m, Number(x.id.split('-e')[1]) || 0), 0) + 1; c.exercises.push({ id: `${c.id}-e${n}`, name: blankBi(), doseText: blankBi() }); });
  const removeExercise = (id: string) => up((c) => { c.exercises = c.exercises.filter((x) => x.id !== id); c.phases.forEach((p) => { p.exercises = p.exercises.filter((e) => e !== id); }); });
  const addPhase = () => up((c) => { c.phases.push({ name: blankBi(), exercises: [], sessionsPerDay: 2, followUpEveryDays: 7, weeksMin: 0, weeksMax: null }); });
  const removePhase = (i: number) => up((c) => {
    c.phases.splice(i, 1);
    c.gates = c.gates.filter((g) => g.from !== i && g.from !== i - 1).map((g) => ({ ...g, from: g.from > i ? g.from - 1 : g.from }));
    c.precautions.forEach((p) => { p.phases = p.phases.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)); });
  });
  const addMeasure = () => up((c) => { const n = c.measures.reduce((m, x) => Math.max(m, Number(x.id.slice(1)) || 0), 0) + 1; c.measures.push({ id: `m${n}`, label: blankBi(), unit: '', min: 0, max: 100, step: 1 }); });
  const removeMeasure = (id: string) => up((c) => { c.measures = c.measures.filter((m) => m.id !== id); c.gates.forEach((g) => { g.criteria = g.criteria.filter((k) => k.measure !== id); }); c.rules = c.rules.filter((r) => r.measure !== id); c.curves = c.curves.filter((k) => k.measure !== id); });
  const gateOf = (c: ConditionDraft, from: number) => { let g = c.gates.find((x) => x.from === from); if (!g) { g = { from, criteria: [] }; c.gates.push(g); } return g; };

  const save = () => {
    try {
      const pack = buildConditionPack(d);
      const st = getState();
      setState({ ...st, customPacks: [...(st.customPacks ?? []), pack] });
      setSaved(pack.id); setMsg('');
    } catch (e) { setMsg(`Not saved: ${(e as Error).message}`); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${(d.condition.en || 'new-condition').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-draft.json`; a.click(); URL.revokeObjectURL(url);
  };
  const load = async (f?: File) => {
    if (!f) return;
    try {
      const x = JSON.parse(await f.text());
      const base = blankDraft(d.id);
      const arrays = ['phases', 'exercises', 'measures', 'gates', 'rules', 'precautions', 'signs', 'curves'] as const;
      for (const k of arrays) if (x[k] !== undefined && !Array.isArray(x[k])) throw new Error(`"${k}" must be a list`);
      const next: ConditionDraft = fatDraft({ ...base, ...x, id: d.id });
      // exercise ids are tied to the draft id, so a loaded draft is renamed to this one
      const old = typeof x.id === 'string' ? x.id : '';
      if (old && old !== d.id) {
        const swap = (s: string) => (s.startsWith(`${old}-e`) ? `${d.id}${s.slice(old.length)}` : s);
        next.exercises = (next.exercises ?? []).map((e) => ({ ...e, id: swap(e.id) }));
        next.phases = (next.phases ?? []).map((p) => ({ ...p, exercises: (p.exercises ?? []).map(swap) }));
      }
      setD(next); setMsg(`Loaded ${f.name}. Check everything below before saving.`);
    } catch (e) { setMsg(`Could not read that file: ${(e as Error).message}`); }
  };

  const a = d.alerts;
  const setAlert = (group: AlertGroup, path: string, v: number | null) => setD((x) => x.alerts ? { ...x, alerts: { ...setAt(x.alerts, path, v ?? 0), source: { ...x.alerts.source, [group]: 'physio' } } } : x);

  if (saved) {
    return (
      <section className="card condition" data-testid="condition-saved">
        <h2>{d.condition.en} saved</h2>
        <p>This condition is now in your list. Add a patient to start using it. The patient sees all text in English and Hindi as you wrote it.</p>
        {a && Object.values(a.source).some((s) => s === 'placeholder') && <p className="tiny">Some alert timings are placeholders. They are listed under "values awaiting physio sign-off" on every patient of this condition.</p>}
        <div className="btnrow"><button className="btn primary" onClick={onAddPatient}>+ Add a patient</button><button className="btn" onClick={onClose}>Close</button></div>
      </section>
    );
  }

  return (
    <section className="card condition" data-testid="condition">
      <div className="btnrow"><h2>Add a condition</h2><button className="btn" onClick={onClose}>Close</button></div>
      <p className="tiny">Write the protocol yourself. Every clinical value is typed or approved by you. The app only runs it and flags drift. Patient-facing text must be written in English and Hindi. A saved condition cannot be edited; save a new version instead.</p>
      {msg && <p className={/^(Loaded|Saved|Added)/.test(msg) ? 'reviewed' : 'err'} role="alert">{msg}</p>}
      <div className="fu"><button className="btn" onClick={download}>Download draft</button><label className="filebtn">Load a draft file<input type="file" accept=".json,application/json" aria-label="Draft file" onChange={(e) => void load(e.target.files?.[0])} /></label></div>

      {written.length > 0 && (
        <label>Start from one of your written conditions (saved as a new version; the old one and its patients stay as they are)
          <select aria-label="Copy a written condition" value="" onChange={(e) => { const pk = PACKS[e.target.value]; if (pk?.authored) { setD(draftAsNewVersion(pk.authored as ConditionDraft, d.id)); setMsg(`Copied ${pk.condition.en}. Change what you need, then save it as version ${((pk.authored as ConditionDraft).version ?? 1) + 1}.`); } }}>
            <option value="">Choose a condition to copy</option>{written.map((w) => <option key={w.id} value={w.id}>{w.condition.en}</option>)}
          </select></label>)}
      {d.version > 1 && <p className="tiny">This is version {d.version}. Patients already on the earlier version stay on it. New patients can use this one.</p>}

      {d.aiDraft && (
        <details open className="subcard" data-testid="ai-sources">
          <summary><b>Drafted by AI from {d.aiDraft.file}</b>: every item below came from this quote. You decide what stays.</summary>
          {initialNotes && initialNotes.length > 0 && <ul className="audit">{initialNotes.map((n, i) => <li key={i}><small>{n}</small></li>)}</ul>}
          <ul className="audit">{d.aiDraft.sources.map((x, i) => <li key={i}><small><b>{x.what}</b>: “{x.quote}”</small></li>)}</ul>
        </details>)}

      <h3>1. Condition</h3>
      <BiField label="Condition name" value={d.condition} onChange={(b) => up((c) => { c.condition = b; })} />
      <BiField label="Day zero is" value={d.anchorLabel} onChange={(b) => up((c) => { c.anchorLabel = b; })} hint="Shown as, for example, “Week 3 after surgery”." />
      <div className="btnrow">{ANCHORS.map((x) => <button key={x.en} className="btn" onClick={() => up((c) => { c.anchorLabel = x; })}>{x.en}</button>)}</div>
      <label>Who it is for (optional, for your notes)<input value={d.population} onChange={(e) => up((c) => { c.population = e.target.value; })} /></label>

      <h3>2. New exercises <small>(everything else comes from the shared library)</small></h3>
      {d.exercises.map((x, i) => (
        <div className="subcard" key={x.id}>
          <BiField label={`Exercise ${i + 1} name`} value={x.name} onChange={(b) => up((c) => { c.exercises[i].name = b; })} />
          <BiField label="Dose (optional, both languages)" value={x.doseText ?? blankBi()} onChange={(b) => up((c) => { c.exercises[i].doseText = b; })} hint="Left empty, the patient sees “as shown by your physio” and it is listed for sign-off." />
          <button className="btn" onClick={() => removeExercise(x.id)}>Remove exercise</button>
        </div>))}
      <button className="btn" onClick={addExercise}>+ Write a new exercise</button>

      <h3>3. Phases</h3>
      {d.phases.map((p, i) => (
        <div className="subcard" key={i}>
          <BiField label={`Phase ${i + 1} name`} value={p.name} onChange={(b) => up((c) => { c.phases[i].name = b; })} />
          <div className="formgrid">
            <label>Sessions per day<input type="number" min={1} max={6} value={p.sessionsPerDay} onChange={(e) => up((c) => { c.phases[i].sessionsPerDay = Number(e.target.value); })} /></label>
            <label>Review every (days)<input type="number" min={1} max={60} value={p.followUpEveryDays} onChange={(e) => up((c) => { c.phases[i].followUpEveryDays = Number(e.target.value); })} /></label>
            <label>Expected weeks in phase: from<input type="number" min={0} value={p.weeksMin} onChange={(e) => up((c) => { c.phases[i].weeksMin = Number(e.target.value); })} /></label>
            <label>to (empty = open ended)<input type="number" min={0} value={p.weeksMax ?? ''} onChange={(e) => up((c) => { c.phases[i].weeksMax = numOrNull(e.target.value); })} /></label>
          </div>
          <details><summary>{p.exercises.length} exercise{p.exercises.length === 1 ? '' : 's'} chosen</summary>
            <ul className="exchecks">{exOptions.map((e) => (
              <li key={e.id}><label><input type="checkbox" checked={p.exercises.includes(e.id)} onChange={(ev) => up((c) => { const l = c.phases[i].exercises; c.phases[i].exercises = ev.target.checked ? [...l, e.id] : l.filter((x) => x !== e.id); })} /> {e.name}{e.isNew ? ' (new)' : ''}</label></li>))}</ul>
          </details>
          {d.phases.length > 1 && <button className="btn" onClick={() => removePhase(i)}>Remove phase</button>}
        </div>))}
      <button className="btn" onClick={addPhase}>+ Add a phase</button>

      <h3>4. Things the patient measures each week <small>(optional)</small></h3>
      <p className="tiny">Pain (0 to 10) is always asked daily. Add numbers such as an angle, a distance, a weight or a score.</p>
      {d.measures.map((m, i) => (
        <div className="subcard" key={m.id}>
          <BiField label={`Measure ${i + 1}: what the patient is asked`} value={m.label} onChange={(b) => up((c) => { c.measures[i].label = b; })} />
          <div className="formgrid">
            <label>Unit<input value={m.unit} placeholder="deg, cm, kg, m ..." onChange={(e) => up((c) => { c.measures[i].unit = e.target.value; })} /></label>
            <label>Smallest<input type="number" value={m.min} onChange={(e) => up((c) => { c.measures[i].min = Number(e.target.value); })} /></label>
            <label>Largest<input type="number" value={m.max} onChange={(e) => up((c) => { c.measures[i].max = Number(e.target.value); })} /></label>
            <label>Step<input type="number" min={0} step="any" value={m.step} onChange={(e) => up((c) => { c.measures[i].step = Number(e.target.value); })} /></label>
          </div>
          <label className="check"><input type="checkbox" aria-label={`Measure ${i + 1} can be measured on a photo`} checked={!!m.photo} onChange={(e) => up((c) => { c.measures[i].photo = e.target.checked ? { reading: 'between', points: [blankBi(), blankBi(), blankBi()] } : undefined; })} /> The patient can measure this angle on a photo</label>
          {m.photo && <>
            <label>How the angle is read<select aria-label={`Measure ${i + 1} photo reading`} value={m.photo.reading} onChange={(e) => up((c) => { c.measures[i].photo!.reading = e.target.value as 'between' | 'deviation'; })}><option value="between">The angle at the middle point (for example arm raise)</option><option value="deviation">How far a straight line is bent at the middle point (for example knee bend)</option></select></label>
            {[0, 1, 2].map((k) => <BiField key={k} label={`Tap ${k === 1 ? 'the joint' : k === 0 ? 'the first point' : 'the last point'}: what is it called?`} value={m.photo!.points[k]} onChange={(b) => up((c) => { c.measures[i].photo!.points[k] = b; })} hint={k === 1 ? 'Middle point: the angle is measured here.' : undefined} />)}
          </>}
          <button className="btn" onClick={() => removeMeasure(m.id)}>Remove measure</button>
        </div>))}
      <button className="btn" onClick={addMeasure}>+ Add a weekly measure</button>

      <h3>4b. Expected recovery <small>(optional)</small></h3>
      <p className="tiny">For a weekly measure, say where it should be by each week since day zero. If a patient falls outside the allowed gap, the physio gets a REVIEW alert.</p>
      {d.curves.map((k, i) => (
        <div className="subcard" key={i}>
          <div className="fu">
            <select aria-label="Curve measure" value={k.measure} onChange={(e) => up((c) => { c.curves[i].measure = e.target.value; })}><option value="">Choose a weekly measure</option>{d.measures.map((m) => <option key={m.id} value={m.id}>{m.label.en || m.id}</option>)}</select>
            <select aria-label="Better is" value={k.better} onChange={(e) => up((c) => { c.curves[i].better = e.target.value as 'higher' | 'lower'; })}><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select>
            <label>Allowed gap<input type="number" min={0} step="any" aria-label="Allowed gap" value={k.tolerance || ''} onChange={(e) => up((c) => { c.curves[i].tolerance = Number(e.target.value); })} /></label>
          </div>
          {k.points.map((pt, j) => (
            <div className="fu" key={j}>
              <label>Week<input type="number" min={0} aria-label="Week" value={pt.week} onChange={(e) => up((c) => { c.curves[i].points[j].week = Number(e.target.value); })} /></label>
              <label>Value<input type="number" step="any" aria-label="Expected value" value={pt.value} onChange={(e) => up((c) => { c.curves[i].points[j].value = Number(e.target.value); })} /></label>
              <button className="btn" onClick={() => up((c) => { c.curves[i].points.splice(j, 1); })}>Remove point</button>
            </div>))}
          <div className="btnrow"><button className="btn" onClick={() => up((c) => { const l = c.curves[i].points; c.curves[i].points.push({ week: l.length ? l[l.length - 1].week + 1 : 0, value: 0 }); })}>+ Add a point</button><button className="btn" onClick={() => up((c) => { c.curves.splice(i, 1); })}>Remove expected recovery</button></div>
        </div>))}
      <button className="btn" disabled={d.measures.length === 0} onClick={() => up((c) => { c.curves.push({ measure: '', better: 'higher', tolerance: 0, points: [{ week: 0, value: 0 }, { week: 1, value: 0 }] }); })}>+ Add an expected recovery</button>

      <h3>4c. Monthly questionnaire <small>(optional)</small></h3>
      <p className="tiny">Enter a questionnaire you are allowed to use. The app does not include licensed questionnaires such as the Oxford Knee Score or Oxford Shoulder Score; get a licence from the publisher and type the questions here. The patient answers monthly and the total is the sum of the option scores.</p>
      <div className="fu">
        <label className="filebtn">Load a questionnaire file<input type="file" accept=".json,application/json" aria-label="Questionnaire file" onChange={(e) => void loadQuestionnaire(e.target.files?.[0])} /></label>
        {saved_q.length > 0 && <select aria-label="Use a saved questionnaire" value="" onChange={(e) => { const sq = saved_q.find((x) => x.id === e.target.value); if (sq) { up((c) => { c.questionnaire = JSON.parse(JSON.stringify(sq.q)); }); setMsg(`Added "${sq.name}". Check the permission box and the credit line.`); } }}><option value="">Use a saved questionnaire</option>{saved_q.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
      </div>
      {d.questionnaire ? (
        <div className="subcard" data-testid="questionnaire-form">
          <BiField label="Title" value={d.questionnaire.title} onChange={(b) => up((c) => { c.questionnaire!.title = b; })} />
          <BiField label="Introduction" value={d.questionnaire.intro} onChange={(b) => up((c) => { c.questionnaire!.intro = b; })} />
          {d.questionnaire.items.map((it, i) => (
            <div key={i} className="fu"><BiField label={`Question ${i + 1}`} value={it} onChange={(b) => up((c) => { c.questionnaire!.items[i] = b; })} /><button className="btn" onClick={() => up((c) => { c.questionnaire!.items.splice(i, 1); })}>Remove</button></div>))}
          <button className="btn" onClick={() => up((c) => { c.questionnaire!.items.push(blankBi()); })}>+ Add a question</button>
          {d.questionnaire.options.map((o, i) => (
            <div key={i} className="fu">
              <label>Score<input type="number" aria-label={`Option ${i + 1} score`} value={o.value} onChange={(e) => up((c) => { c.questionnaire!.options[i].value = Number(e.target.value); })} /></label>
              <BiField label={`Answer option ${i + 1}`} value={o.label} onChange={(b) => up((c) => { c.questionnaire!.options[i].label = b; })} />
              <button className="btn" onClick={() => up((c) => { c.questionnaire!.options.splice(i, 1); })}>Remove</button>
            </div>))}
          <button className="btn" onClick={() => up((c) => { const l = c.questionnaire!.options; l.push({ value: l.length, label: blankBi() }); })}>+ Add an answer option</button>
          <label>Credit and terms of use (shown to the patient)<textarea rows={2} aria-label="Questionnaire credit" value={d.questionnaire.credit} onChange={(e) => up((c) => { c.questionnaire!.credit = e.target.value; })} /></label>
          <label className="check"><input type="checkbox" aria-label="Permission to use" checked={d.questionnaire.permission} onChange={(e) => up((c) => { c.questionnaire!.permission = e.target.checked; })} /> I have permission to use this questionnaire</label>
          <div className="fu">
            <label className="check"><input type="checkbox" aria-label="Questionnaire alert" checked={!!d.questionnaire.alert} onChange={(e) => up((c) => { c.questionnaire!.alert = e.target.checked ? { operator: '<=', value: 0 } : undefined; })} /> Alert me (REVIEW) when the total score is</label>
            {d.questionnaire.alert && <>
              <select aria-label="Questionnaire alert comparison" value={d.questionnaire.alert.operator} onChange={(e) => up((c) => { c.questionnaire!.alert!.operator = e.target.value as Operator; })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
              <input type="number" aria-label="Questionnaire alert value" value={d.questionnaire.alert.value} onChange={(e) => up((c) => { c.questionnaire!.alert!.value = Number(e.target.value); })} /></>}
          </div>
          <div className="btnrow">
            <button className="btn" onClick={saveQuestionnaire}>Save for reuse</button>
            <button className="btn" onClick={downloadQuestionnaire}>Download as a file</button>
            <button className="btn" onClick={() => up((c) => { delete c.questionnaire; })}>Remove questionnaire</button>
          </div>
        </div>
      ) : <button className="btn" onClick={() => up((c) => { c.questionnaire = { title: blankBi(), intro: blankBi(), items: [blankBi()], options: [{ value: 0, label: blankBi() }, { value: 1, label: blankBi() }], credit: '', permission: false }; })}>+ Add a questionnaire</button>}

      <h3>5. When can a patient move to the next phase?</h3>
      {d.phases.length < 2 && <p className="tiny">One phase only: no criteria needed.</p>}
      {d.phases.slice(0, -1).map((_, i) => {
        const g = d.gates.find((x) => x.from === i);
        return (
          <div className="subcard" key={i}>
            <b>Phase {i + 1} to phase {i + 2}</b> <small>(you still sign off every move; the app never advances a patient)</small>
            {(g?.criteria ?? []).map((k, j) => (
              <div className="fu" key={j}>
                <select aria-label="Measure" value={k.measure} onChange={(e) => up((c) => { gateOf(c, i).criteria[j].measure = e.target.value; })}><option value="">Choose</option>{measureOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                <select aria-label="Comparison" value={k.operator} onChange={(e) => up((c) => { gateOf(c, i).criteria[j].operator = e.target.value as Operator; })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
                <input type="number" aria-label="Value" value={Number.isFinite(k.value) ? k.value : ''} onChange={(e) => up((c) => { gateOf(c, i).criteria[j].value = Number(e.target.value); })} />
                <button className="btn" onClick={() => up((c) => { gateOf(c, i).criteria.splice(j, 1); })}>Remove</button>
              </div>))}
            <button className="btn" onClick={() => up((c) => { gateOf(c, i).criteria.push({ measure: '', operator: '>=', value: 0 }); })}>+ Add a criterion</button>
          </div>);
      })}

      <h3>6. Alerts</h3>
      <p className="tiny">Always on: fever, calf pain or redness, wound fluid, spreading redness, chest pain or breathlessness (SAFETY), new numbness or tingling, several signals together, pain rising, missed sessions. You add the rest.</p>
      <b>Threshold alerts</b>
      {d.rules.map((r, i) => (
        <div className="fu" key={i}>
          <select aria-label="Measure" value={r.measure} onChange={(e) => up((c) => { c.rules[i].measure = e.target.value; })}><option value="">Choose</option>{measureOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          <select aria-label="Comparison" value={r.operator} onChange={(e) => up((c) => { c.rules[i].operator = e.target.value as Operator; })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
          <input type="number" aria-label="Value" value={Number.isFinite(r.value) ? r.value : ''} onChange={(e) => up((c) => { c.rules[i].value = Number(e.target.value); })} />
          <select aria-label="Tier" value={r.tier} onChange={(e) => up((c) => { c.rules[i].tier = e.target.value as 'REVIEW' | 'URGENT'; })}><option>REVIEW</option><option>URGENT</option></select>
          <button className="btn" onClick={() => up((c) => { c.rules.splice(i, 1); })}>Remove</button>
        </div>))}
      <button className="btn" onClick={() => up((c) => { c.rules.push({ measure: PAIN_ID, operator: '>=', value: 0, tier: 'REVIEW' }); })}>+ Add a threshold alert</button>
      <b>Extra warning signs the patient is asked about</b>
      {d.signs.map((s, i) => (
        <div className="subcard" key={i}>
          <BiField label={`Warning sign ${i + 1}`} value={s.label} onChange={(b) => up((c) => { c.signs[i].label = b; })} />
          <label>Tier<select value={s.tier} onChange={(e) => up((c) => { c.signs[i].tier = e.target.value as 'REVIEW' | 'URGENT'; })}><option>REVIEW</option><option>URGENT</option></select></label>
          <button className="btn" onClick={() => up((c) => { c.signs.splice(i, 1); })}>Remove</button>
        </div>))}
      <button className="btn" onClick={() => up((c) => { c.signs.push({ label: blankBi(), tier: 'REVIEW' }); })}>+ Add a warning sign</button>
      <b>Restricted movements</b>
      {d.precautions.map((p, i) => (
        <div className="subcard" key={i}>
          <BiField label={`Movement ${i + 1}`} value={p.label} onChange={(b) => up((c) => { c.precautions[i].label = b; })} />
          <BiField label="Question asked daily (yes = breach)" value={p.question} onChange={(b) => up((c) => { c.precautions[i].question = b; })} />
          <div className="btnrow">{d.phases.map((_, k) => <label key={k}><input type="checkbox" checked={p.phases.includes(k)} onChange={(e) => up((c) => { const l = c.precautions[i].phases; c.precautions[i].phases = e.target.checked ? [...l, k] : l.filter((x) => x !== k); })} /> Phase {k + 1}</label>)}</div>
          <button className="btn" onClick={() => up((c) => { c.precautions.splice(i, 1); })}>Remove</button>
        </div>))}
      <button className="btn" onClick={() => up((c) => { c.precautions.push({ label: blankBi(), question: blankBi(), phases: [] }); })}>+ Add a restricted movement</button>

      <h3>7. Alert timings</h3>
      {!a ? (
        <div className="btnrow">
          <button className="btn" onClick={() => up((c) => { c.alerts = { ...placeholderAlerts(), hours: { SAFETY: 0, URGENT: 0, REVIEW: 0 }, missed: { count: 0, adherencePct: 0 }, combination: { minDistinct: 0, windowDays: 0 }, painRise: { delta: 0, window: 0 }, followUp: { teleHours: 0, checkInDays: 0, forDays: 0 }, silence: { hours: 0 }, source: { hours: 'physio', missed: 'physio', combination: 'physio', painRise: 'physio', followUp: 'physio', silence: 'physio' } }; })}>Enter my own values</button>
          <button className="btn" onClick={() => up((c) => { c.alerts = placeholderAlerts(); })}>Use placeholder values (needs sign-off)</button>
        </div>
      ) : GROUPS.map((g) => (
        <div className="subcard" key={g.key}>
          <b>{g.title}</b> <small>{a.source[g.key] === 'placeholder' ? '· placeholder, needs sign-off' : '· set by you'}</small>
          <div className="formgrid">{g.fields.map((f) => (
            <label key={f.path}>{f.label}<input type="number" min={0} step="any" value={getAt(a, f.path) || ''} onChange={(e) => setAlert(g.key, f.path, numOrNull(e.target.value))} /></label>))}</div>
        </div>))}

      <h3>8. Check and save</h3>
      {ungatedChanges(d).length > 0 && <p className="tiny" data-testid="ungated-note">No criteria set for: {ungatedChanges(d).map((i) => `phase ${i + 1} to ${i + 2}`).join(', ')}. That is allowed. You will move patients on yourself with “Move to a phase”, and the app will not show “ready for the next phase” there.</p>}
      {problems.length ? <><p>To fix before saving:</p><ul className="audit" data-testid="condition-problems">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></> : <p className="reviewed">Everything needed is filled in. The protocol is checked again by the same safety validator as the built-in conditions when you save.</p>}
      <div className="btnrow"><button className="btn primary" disabled={problems.length > 0 || !!PACKS[d.id]} onClick={save}>Save condition</button></div>
    </section>
  );
}
