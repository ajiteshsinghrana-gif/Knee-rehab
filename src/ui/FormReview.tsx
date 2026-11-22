// Physio side: form-check videos waiting for review. Watch the clip, tick cues, write a reply, delete the clip.
// Review time comes from the protocol's REVIEW response time. Nothing here changes a tier or a plan.
import { useEffect, useState } from 'react';
import type { FormRequest, Patient, ProtocolPack } from '../types';
import { exerciseName } from '../exercises/library';
import { CUES, FORM_CONFIG, isOverdue, replyToForm, reviewHours } from '../forms/model';
import { clockMs, getState, updatePatient } from '../store';
import { physioClipUrl } from '../sync/engine';
import { deleteClipNow, purgeExpired } from '../forms/purge';
import { PHYSIO } from '../engine/plan';

export function FormReview({ patient: p, pack, now }: { patient: Patient; pack: ProtocolPack; now: number }) {
  const reqs = [...(p.formRequests ?? [])].reverse();
  useEffect(() => { void purgeExpired(p); }, [p.id]);
  if (!reqs.length) return null;
  return (
    <div className="card" data-testid="form-review">
      <h3>Form-check videos <small>(patient asked for help with an exercise; review within {reviewHours(pack)} h, the protocol's review time. Not for warning signs.)</small></h3>
      {reqs.map((r) => <One key={r.id} r={r} p={p} pack={pack} now={now} />)}
    </div>
  );
}

function One({ r, p, pack, now }: { r: FormRequest; p: Patient; pack: ProtocolPack; now: number }) {
  const [points, setPoints] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const overdue = isOverdue(r, pack, now);
  const watch = async () => {
    setErr('');
    try { if (r.clip?.where === 'cloud') setUrl(await physioClipUrl(p, r.clip.ref)); } catch (e) { setErr((e as Error).message); }
  };
  const send = () => {
    const at = new Date(clockMs(getState())).toISOString();
    updatePatient(p.id, (q) => replyToForm(q, r.id, { by: PHYSIO, text, points, at }, { nowMs: now, today: getState().today }));
  };
  return (
    <details open={!r.reply} data-testid="form-one">
      <summary><b>{exerciseName(r.exerciseId, 'en')}</b> · {r.at.slice(0, 10)} {r.reply ? '· replied' : <b className="err">· waiting</b>}{overdue && <span className="overdue">Overdue</span>}{r.via === 'whatsapp' ? ' (WhatsApp)' : ''}</summary>
      {r.note && <p>“{r.note}”</p>}
      <p className="tiny">Consent given by the {r.consent.by} on {r.consent.at.slice(0, 10)} (wording {r.consent.version}).</p>
      {r.clip ? (
        r.clip.where === 'cloud' ? (
          <>
            {url ? <video src={url} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 480, borderRadius: 12 }} /> : <button className="btn" onClick={watch}>Watch clip</button>}
            {err && <p className="err" role="alert">{err}</p>}
          </>
        ) : <p className="tiny">The clip is only on the patient's phone (video sending was not available). Ask to see it at the next visit.</p>
      ) : r.clipGone ? <p className="tiny">Clip deleted {r.clipGone.slice(0, 10)}.</p> : <p className="tiny">Sent without a video.</p>}
      {r.clip && <p className="tiny">Deleted automatically on {r.clip.deleteAfter}.</p>}
      {r.reply ? (
        <div className="reviewed"><b>Your reply</b> ({r.reply.at.slice(0, 10)}){r.reply.points.length > 0 && <ul>{r.reply.points.map((c) => <li key={c}>{CUES.find((x) => x.id === c)?.en}</li>)}</ul>}{r.reply.text && <p>{r.reply.text}</p>}</div>
      ) : (
        <div className="modify">
          <b>Cues to send (tick any)</b>
          {CUES.map((c) => (
            <label key={c.id}><input type="checkbox" checked={points.includes(c.id)} onChange={(e) => setPoints(e.target.checked ? [...points, c.id] : points.filter((x) => x !== c.id))} />{c.en}</label>
          ))}
          <textarea placeholder="Your own words (optional)" maxLength={FORM_CONFIG.maxReply} value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply text" />
          <div className="btnrow"><button className="btn primary" data-testid="send-reply" disabled={!text.trim() && points.length === 0} onClick={send}>Send reply</button></div>
        </div>
      )}
      {r.clip && <div className="btnrow"><button className="btn" onClick={() => void deleteClipNow(p, r.id)}>Delete clip now</button></div>}
    </details>
  );
}
