import { useMemo, useState } from 'react';
import { PACKS } from '../engine/packs';
import { exerciseName } from '../exercises/library';
import { buildTemplate, catalogue, extract, type Ambiguous, type ExtractResult, type Proposal } from '../import/extract';
import { buildImportedPack } from '../import/apply';
import { readFileText } from '../import/pdf';
import { clockMs, getState, setState } from '../store';
import { PASTE_PROMPT, draftFrom, parseDraftJson, requestDraft, reviewOf, type AiDraft, type DraftReview } from '../import/draft';
import { blankDraft, newConditionId, type ConditionDraft } from '../author/condition';

const NEW = '__new__';
const show = (v: number | string[]) => (Array.isArray(v) ? (v.length ? v.map((id) => exerciseName(id, 'en')).join(', ') : 'none') : String(v));

/** Phase 3.2: physio uploads a file or pastes text; each imported value is reviewed next to the default and approved one by one. */
export function ImportProtocol({ onClose, onDraft }: { onClose: () => void; onDraft?: (d: ConditionDraft, notes: string[]) => void }) {
  const packs = Object.values(PACKS).filter((p) => !p.basedOn && !p.authored);
  const [baseId, setBaseId] = useState(NEW);
  const isNew = baseId === NEW;
  const base = PACKS[isNew ? packs[0].id : baseId]; // for a new condition the number-matching reader is not used
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [res, setRes] = useState<ExtractResult | null>(null);
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState('');
  const [ai, setAi] = useState<{ draft: AiDraft; review: DraftReview } | null>(null);
  const [aiOk, setAiOk] = useState<Record<string, boolean>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState('');
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);

  const proposals: Proposal[] = useMemo(() => {
    if (!res) return [];
    const resolved = res.ambiguous.flatMap((a, i): Proposal[] => {
      const t = picked[i];
      const c = a.candidates.find((x) => x.target === t);
      if (!c) return [];
      return [{ target: c.target, label: c.label, kind: a.kind, current: catalogue(base).find((f) => f.target === c.target)?.current ?? 0, proposed: a.value, line: a.line }];
    });
    return [...res.proposals, ...resolved.filter((r) => !res.proposals.some((p) => p.target === r.target))];
  }, [res, picked, base]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(''); setFileName(f.name);
    try {
      const t = await readFileText(f);
      if (!t.trim()) { setMsg('No text was found in this file. Scanned PDFs have no text layer: paste the text instead.'); return; }
      setText(t);
    } catch { setMsg('This file could not be read. Paste the text instead.'); }
  };
  const read = () => { setDone(''); setOk({}); setPicked({}); setRes(extract(base, text, fileName)); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([buildTemplate(base)], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = `${base.id}-template.txt`; a.click(); URL.revokeObjectURL(url);
  };
  const draftWithAi = async () => {
    setAiBusy(true); setAiErr(''); setAi(null);
    try {
      const draft = await requestDraft(text, fileName || 'pasted text');
      const review = reviewOf(draft, text);
      setAi({ draft, review });
      setAiOk(Object.fromEntries(review.items.map((i) => [i.id, i.quoteFound]))); // only items whose quote is really in the file start ticked
    } catch (e) { setAiErr((e as Error).message); }
    setAiBusy(false);
  };
  const reviewPasted = () => {
    setAiErr(''); setAi(null);
    try {
      const draft = parseDraftJson(pasted);
      const review = reviewOf(draft, text);
      setAi({ draft, review });
      setAiOk(Object.fromEntries(review.items.map((i) => [i.id, i.quoteFound])));
    } catch (e) { setAiErr((e as Error).message); }
  };
  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(PASTE_PROMPT + '\n' + text); setCopied(true); setTimeout(() => setCopied(false), 3000); }
    catch { setAiErr('Could not copy automatically. Select the text in the box and copy it yourself.'); }
  };
  const openDraft = () => {
    if (!ai || !onDraft) return;
    const kept = new Set(Object.keys(aiOk).filter((k) => aiOk[k]));
    const { draft, notes } = draftFrom(ai.draft, kept, newConditionId(clockMs(getState())), fileName || 'pasted text');
    onDraft(draft, notes);
  };
  const approvedList = proposals.filter((p) => ok[p.target]);
  const create = () => {
    try {
      const st = getState();
      const n = (st.customPacks ?? []).length + 1;
      let id = `${base.id}-custom-${n}`;
      while (PACKS[id]) id += 'x';
      const pack = buildImportedPack(base, approvedList, fileName, id);
      setState({ ...st, customPacks: [...(st.customPacks ?? []), pack] });
      setDone(`Saved "${pack.condition.en}". Choose it when you add a patient.`);
      setRes(null);
    } catch (e) { setMsg(`Not saved: ${(e as Error).message}`); }
  };

  return (
    <section className="card import" data-testid="import">
      <div className="btnrow"><h2>Import a protocol</h2><button className="btn" onClick={onClose}>Close</button></div>
      <p className="tiny">Upload a PDF, .txt, .md, .csv or .json file, or paste text. Nothing is applied until you approve each value. Imported values are tagged PHYSIO_IMPORTED with the file name. No AI is used.</p>
      {done && <p className="reviewed" role="status">{done}</p>}
      {msg && <p className="err" role="alert">{msg}</p>}
      <label>Start from <select value={baseId} onChange={(e) => { setBaseId(e.target.value); setRes(null); }} aria-label="Base protocol"><option value={NEW}>New condition (any illness)</option>{packs.map((p) => <option key={p.id} value={p.id}>Change numbers in: {p.condition.en}</option>)}</select></label>
      <div className="fu">
        <input type="file" accept=".pdf,.txt,.md,.csv,.json,text/plain,application/pdf,application/json" onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Protocol file" />
        {!isNew && <button className="btn" onClick={download}>Download template</button>}
      </div>
      <textarea className="vtext" rows={6} placeholder={'Paste protocol text, e.g.\nR3 high pain weeks 0-2 [rule:R3:stage:0]: 8\nPhase 1 exercises: quad sets, heel slides'} value={text} onChange={(e) => { setText(e.target.value); if (fileName && !e.target.value) setFileName(''); }} aria-label="Protocol text" />
      {!isNew && <div className="btnrow"><button className="btn primary" disabled={!text.trim()} onClick={read}>Read protocol</button></div>}
      {isNew && onDraft && <div className="btnrow"><button className="btn" data-testid="blank-condition" onClick={() => onDraft(blankDraft(newConditionId(clockMs(getState()))), [])}>Start a blank condition (no file)</button></div>}

      <h3>{isNew ? 'Draft the new condition from this file' : 'Or draft a new condition from this file'}</h3>
      <p className="tiny">For a condition the app does not ship. An AI reads the text and proposes phases, exercises, measures, criteria, alerts and warning signs, each with the exact words it found. It adds nothing from its own knowledge. You tick what to keep, then check and edit everything in the condition editor. The AI never makes a decision about a patient.</p>
      {aiErr && <p className="err" role="alert">{aiErr}</p>}
      <div className="btnrow"><button className="btn" data-testid="ai-draft" disabled={!text.trim() || aiBusy} onClick={() => void draftWithAi()}>{aiBusy ? 'Reading the document…' : 'Draft a new condition (AI)'}</button></div>
      <details className="subcard" data-testid="paste-json" open={isNew}>
        <summary><b>No server? Use any AI chat instead</b></summary>
        <ol className="tiny">
          <li>Tap <b>Copy prompt and document</b>.</li>
          <li>Paste it into Claude (or another AI chat) and send.</li>
          <li>Copy the JSON it replies with and paste it below, then tap <b>Review pasted JSON</b>.</li>
        </ol>
        <div className="btnrow"><button className="btn" disabled={!text.trim()} onClick={() => void copyPrompt()}>{copied ? 'Copied' : 'Copy prompt and document'}</button></div>
        <textarea className="vtext" rows={5} placeholder="Paste the AI's JSON reply here" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Pasted draft JSON" />
        <div className="btnrow"><button className="btn" disabled={!pasted.trim()} onClick={reviewPasted}>Review pasted JSON</button></div>
        <p className="tiny">Same checks as above: each quote is matched against your file, and you tick every item before anything is used.</p>
      </details>
      {ai && (
        <div data-testid="ai-review">
          <h3>Draft: {ai.review.headline} <small>({ai.review.items.length} item{ai.review.items.length === 1 ? '' : 's'} found)</small></h3>
          {ai.review.items.length === 0 && <p>The AI found nothing it could quote from this file.</p>}
          <ul className="audit">
            {ai.review.items.map((it) => (
              <li key={it.id}>
                <label><input type="checkbox" aria-label={`Keep: ${it.summary}`} checked={!!aiOk[it.id]} onChange={(e) => setAiOk({ ...aiOk, [it.id]: e.target.checked })} /> <b>{it.summary}</b></label>
                <blockquote className="tiny">“{it.quote}”{!it.quoteFound && <> <b className="err">Not found in your file. Check it before keeping.</b></>}</blockquote>
              </li>))}
          </ul>
          {ai.review.notStated.length > 0 && <div><h4>The document does not say</h4><ul className="audit">{ai.review.notStated.map((n, i) => <li key={i}><small>{n}</small></li>)}</ul></div>}
          <div className="btnrow">
            <button className="btn" onClick={() => setAiOk(Object.fromEntries(ai.review.items.map((i) => [i.id, true])))}>Keep all</button>
            <button className="btn" onClick={() => setAiOk({})}>Clear</button>
            <button className="btn primary" disabled={!onDraft || !Object.values(aiOk).some(Boolean)} onClick={openDraft}>Open {Object.values(aiOk).filter(Boolean).length} kept item(s) in the condition editor</button>
          </div>
        </div>
      )}

      {res && !isNew && (
        <div data-testid="import-review">
          <h3>Review <small>({proposals.length} change{proposals.length === 1 ? '' : 's'} found; untouched fields keep the default)</small></h3>
          {proposals.length > 0 && (
            <>
              <table className="gate importtable"><thead><tr><th>Approve</th><th>Field</th><th>Default</th><th>Imported</th><th>From the file</th></tr></thead><tbody>
                {proposals.map((p) => (
                  <tr key={p.target}>
                    <td><input type="checkbox" aria-label={`Approve ${p.label}`} checked={!!ok[p.target]} onChange={(e) => setOk({ ...ok, [p.target]: e.target.checked })} /></td>
                    <td>{p.label}</td><td>{show(p.current)}</td><td><b>{show(p.proposed)}</b></td><td><small>{p.line}</small></td>
                  </tr>))}
              </tbody></table>
              <div className="btnrow"><button className="btn" onClick={() => setOk(Object.fromEntries(proposals.map((p) => [p.target, true])))}>Approve all</button><button className="btn" onClick={() => setOk({})}>Clear</button></div>
            </>
          )}
          {res.ambiguous.length > 0 && (
            <div><h4>Which field is this?</h4>
              {res.ambiguous.map((a: Ambiguous, i) => (
                <p key={i} className="fu"><small>{a.line}</small>
                  <select aria-label={`Field for: ${a.line}`} value={picked[i] ?? ''} onChange={(e) => setPicked({ ...picked, [i]: e.target.value })}><option value="">Skip</option>{a.candidates.map((c) => <option key={c.target} value={c.target}>{c.label}</option>)}</select></p>))}
            </div>
          )}
          {res.rejected.length > 0 && <div><h4>Not used</h4><ul className="audit">{res.rejected.map((r, i) => <li key={i}><small>{r.line}</small>: {r.why}</li>)}</ul></div>}
          {res.unmatched.length > 0 && <div><h4>Not understood <small>(use the template to match these)</small></h4><ul className="audit">{res.unmatched.map((l, i) => <li key={i}><small>{l}</small></li>)}</ul></div>}
          {proposals.length === 0 && res.ambiguous.length === 0 && <p>No changes found. The default protocol would be unchanged.</p>}
          <div className="btnrow"><button className="btn primary" disabled={approvedList.length === 0} onClick={create}>Save protocol with {approvedList.length} approved change{approvedList.length === 1 ? '' : 's'}</button></div>
        </div>
      )}
    </section>
  );
}
