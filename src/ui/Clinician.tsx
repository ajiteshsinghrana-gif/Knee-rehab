import { useMemo, useState } from 'react';
import type { Patient, ProtocolPack, Tier, TriageResult } from '../types';
import { L } from '../i18n';
import { getPack } from '../engine/packs';
import { addDays, diffDays } from '../engine/dates';
import { compareWorklist, stageFor, triage, weeksInPhase, weeksSince } from '../engine/triage';
import { evaluateGate } from '../engine/gates';
import { ACTION_LABELS, suggestedActions } from '../engine/actions';
import { collectSignoffs } from '../engine/signoff';
import { clockMs, getState, updatePatient, type AppState } from '../store';
import { LineChart } from './Charts';
import { applyAction, currentExercises, currentFollowUp, pendingProposal, type PlanAction } from '../engine/plan';
import { listOverridable } from '../engine/overrides';
import { exerciseName, getExercise } from '../exercises/library';

const TIER_LABEL: Record<Tier, string> = { SAFETY: 'SAFETY', URGENT: 'URGENT', REVIEW: 'REVIEW', ON_PLAN: 'ON PLAN' };
const srcClass = (s: string) => s.split(/[;( ]/)[0].replace(/[^A-Z_]/g, '');
const Src = ({ s }: { s: string }) => <span className={`src ${srcClass(s)}`} title={s}>{s.length > 34 ? s.slice(0, 32) + '…' : s}</span>;
const hrs = (ms: number) => `${Math.round(Math.abs(ms) / 3_600_000)} h`;

export function Tier({ tier, xl }: { tier: Tier; xl?: boolean }) {
  return <span className={`pill ${tier} ${xl ? 'xl' : ''}`}>{TIER_LABEL[tier]}</span>;
}

function dueText(r: TriageResult, now: number): string {
  if (r.tier === 'ON_PLAN' || r.dueByMs === null) return 'weekly summary only';
  if (r.reviewedAt) return 'reviewed';
  return r.dueByMs >= now ? `respond within ${hrs(r.dueByMs - now)}` : `${hrs(now - r.dueByMs)} past deadline`;
}

export function Clinician({ state }: { state: AppState }) {
  const now = clockMs(state);
  const rows = useMemo(
    () => state.patients.map((p) => ({ p, pack: getPack(p.packId), r: triage(p, getPack(p.packId), { nowMs: now }) })).sort((a, b) => compareWorklist(a.r, b.r)),
    [state.patients, now],
  );
  const [sel, setSel] = useState(state.activeId);
  const cur = rows.find((x) => x.p.id === sel) ?? rows[0];
  const counts = (['SAFETY', 'URGENT', 'REVIEW', 'ON_PLAN'] as Tier[]).map((t) => [t, rows.filter((x) => x.r.tier === t).length] as const);
  return (
    <>
      <p className="dashnotice">Supports clinical judgement; not a diagnosis. Tiers come only from deterministic rules in each patient's protocol pack. Nothing changes a plan until you approve it.</p>
      <div className="dash">
        <aside className="worklist">
          <h2>Worklist</h2>
          <p className="counts">{counts.map(([t, n]) => <span key={t}><Tier tier={t} /> {n}</span>)}</p>
          <ul>
            {rows.map(({ p, pack, r }) => (
              <li key={p.id}>
                <button className={`prow ${p.id === cur.p.id ? 'active' : ''}`} onClick={() => setSel(p.id)}>
                  <span className={`dot ${r.tier}`} />
                  <span className="pmain">
                    <b>{p.name}, {p.age}{r.overdue && <span className="overdue">Overdue</span>}</b>
                    <small>{pack.condition.en}</small>
                    <span className="chips">{r.triggers.slice(0, 5).map((t) => <i key={t.ruleId}>{t.ruleId}</i>)}</span>
                  </span>
                  <span className="pdl"><strong className={r.tier}>{TIER_LABEL[r.tier]}</strong><small className={r.reviewedAt ? 'rev' : ''}>{dueText(r, now)}</small></span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <Detail key={cur.p.id + cur.r.asOf} patient={cur.p} pack={cur.pack} r={cur.r} now={now} />
      </div>
    </>
  );
}

function Detail({ patient: p, pack, r, now }: { patient: Patient; pack: ProtocolPack; r: TriageResult; now: number }) {
  const phase = pack.phases.find((x) => x.id === p.currentPhase)!;
  const wk = weeksSince(p, r.asOf);
  const actions = suggestedActions(r.triggers, pack, p, r.asOf);
  const gate = evaluateGate(p, pack, r.asOf);
  const signoffs = useMemo(() => collectSignoffs(pack).filter((x) => x.needsSignoff), [pack]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [modifying, setModifying] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const st = getState();
  const exs = currentExercises(p, pack);
  const [pick, setPick] = useState('');
  const [fuDate, setFuDate] = useState(addDays(st.today, 2));
  const [fuEvery, setFuEvery] = useState(1);
  const PLAN_ACTIONS = ['regress-exercise', 'hold-progression', 'reassess-bring-visit-forward'];

  /** Apply a plan action (physio only). Errors are shown, never swallowed. */
  const apply = (a: PlanAction, label?: { action: string; status: 'approved' | 'modified' }): boolean => {
    try {
      const iso = new Date(now).toISOString();
      updatePatient(p.id, (q) => {
        let out = applyAction(q, pack, a, { nowMs: now, today: st.today });
        if (r.flagKey && label) out = { ...out, reviewed: { ...out.reviewed, [r.flagKey]: iso } };
        if (label) out = { ...out, decisions: [...out.decisions, { at: iso, flagKey: r.flagKey, action: label.action, status: label.status, ...(note[label.action] ? { note: note[label.action] } : {}) }] };
        return out;
      });
      setErr('');
      return true;
    } catch (e) { setErr((e as Error).message); return false; }
  };
  const start = (a: string) => {
    if (!PLAN_ACTIONS.includes(a)) { apply({ type: 'record', action: ACTION_LABELS[a]?.en ?? a, status: 'approved', ...(note[a] ? { note: note[a] } : {}) }, { action: a, status: 'approved' }); return; }
    setErr(''); setModifying(a);
  };
  const confirm = (a: string) => {
    const n = note[a];
    let act: PlanAction | null = null;
    if (a === 'regress-exercise') { if (!pick) { setErr('Choose which exercise to make easier'); return; } act = { type: 'regress-exercise', exerciseId: pick, note: n }; }
    if (a === 'hold-progression') act = { type: 'hold-progression', note: n };
    if (a === 'reassess-bring-visit-forward') act = { type: 'change-follow-up', checkInEveryDays: fuEvery, nextReviewDate: fuDate, note: n };
    if (act && apply(act, { action: a, status: 'approved' })) setModifying(null);
  };
  const markReviewed = () => r.flagKey && updatePatient(p.id, (q) => ({ ...q, reviewed: { ...q.reviewed, [r.flagKey!]: new Date(now).toISOString() } }));

  // charts
  const first = addDays(r.asOf, -41);
  const pain = p.daily.filter((d) => d.date >= first && d.values.pain !== undefined).map((d) => ({ x: Math.round((diffDays(d.date, p.anchorDate) / 7) * 10) / 10, y: Number(d.values.pain) }));
  const r3 = pack.rules.find((x) => x.type === 'threshold' && x.measure === 'pain');
  const painRef = r3 && r3.type === 'threshold' ? stageFor(r3.stages, wk) : undefined;
  const lastWeek = Array.from({ length: 7 }, (_, i) => addDays(r.asOf, i - 6));
  const curves = pack.expectedCurves;

  return (
    <section className="detail">
      <div className={`card head ${r.tier}`}>
        <div>
          <h2>{p.name}, {p.age} <small>{pack.condition.en}</small></h2>
          <p className="sub">Week {wk.toFixed(1)} {pack.anchorLabel.en} · {phase.name.en} ({weeksInPhase(p, r.asOf).toFixed(1)} wk in phase) · as of {r.asOf}</p>
        </div>
        <div className="tierbox">
          <span><Tier tier={r.tier} xl />{r.overdue && <span className="overdue">Overdue</span>}</span>
          <small>{dueText(r, now)}{r.responseHours ? ` (${r.responseHours} h target)` : ''}</small>
        </div>
      </div>

      {signoffs.length > 0 && (
        <details className="placeholders">
          <summary>{signoffs.length} values in this protocol pack are placeholders awaiting physio sign-off (NEEDS_PHYSIO_SIGNOFF)</summary>
          <ul>{signoffs.map((s, i) => <li key={i}>{s.where.replace(pack.id + ': ', '')}: <b>{s.value}</b></li>)}</ul>
        </details>
      )}

      {r.triggers.length > 0 && (
        <div className="card">
          <h3>Why this tier</h3>
          <ul className="evidence">
            {r.triggers.map((t) => (
              <li key={t.ruleId}>
                <span className={`rid ${t.tier}`}>{t.ruleId}</span>
                <div><b>{t.label.en}</b> <Tier tier={t.tier} /> <Src s={t.source} />{t.source.includes('PHYSIO_OVERRIDE') && <span className="src" data-testid="override-tag">PHYSIO_OVERRIDE: {t.source.split('PHYSIO_OVERRIDE:')[1]?.trim()}</span>}<p>{t.evidence}</p>{t.combinedFrom && <small>Combined from: {t.combinedFrom.join(', ')}</small>}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ProposalCard patient={p} pack={pack} r={r} now={now} />

      <div className="card">
        <h3>Suggested actions <small>(never applied until you approve)</small></h3>
        {r.reviewedAt && <p className="reviewed">Reviewed {r.reviewedAt.slice(0, 16).replace('T', ' ')}</p>}
        {actions.length === 0 && <p className="tiny">No action suggested. Weekly summary only.</p>}
        {err && <p className="err" role="alert">{err}</p>}
        {actions.map((a) => (
          <div className="actrow" key={a} data-action={a}>
            <span className="name">{ACTION_LABELS[a]?.en ?? a}</span>
            {modifying === a && a === 'regress-exercise' && (
              <select aria-label="Exercise to make easier" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose exercise…</option>
                {exs.map((id) => <option key={id} value={id} disabled={!getExercise(id)?.regressionId}>{exerciseName(id, 'en')}{getExercise(id)?.regressionId ? ` → ${exerciseName(getExercise(id)!.regressionId!, 'en')}` : ' (no easier version defined)'}</option>)}
              </select>
            )}
            {modifying === a && a === 'reassess-bring-visit-forward' && (
              <span className="fu">
                <label>Next review <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} /></label>
                <label>Check in every <input type="number" min={1} max={14} value={fuEvery} onChange={(e) => setFuEvery(Number(e.target.value))} /> day(s)</label>
              </span>
            )}
            {modifying === a && <input aria-label="Note" placeholder="Note (optional)" value={note[a] ?? ''} onChange={(e) => setNote({ ...note, [a]: e.target.value })} />}
            {modifying === a ? (
              <>
                <button className="btn primary" onClick={() => confirm(a)}>Confirm and apply</button>
                <button className="btn" onClick={() => setModifying(null)}>Cancel</button>
              </>
            ) : (
              <button className="btn primary" onClick={() => start(a)}>{PLAN_ACTIONS.includes(a) ? 'Approve…' : 'Approve'}</button>
            )}
          </div>
        ))}
        <p className="tiny">Approving a plan action changes the patient's plan and is written to the audit log. The patient is told in their own language.</p>
        {r.tier !== 'ON_PLAN' && !r.reviewedAt && <div className="btnrow"><button className="btn" onClick={markReviewed}>Mark as reviewed</button></div>}
      </div>

      <PlanCard patient={p} pack={pack} now={now} onApply={apply} err={err} />
      <OverridesCard patient={p} pack={pack} onApply={apply} err={err} />

      <div className="charts">
        <div className="card">
          <LineChart title="Pain (last 6 weeks)" xLabel={`weeks ${pack.anchorLabel.en}`} yLabel="0-10" yMin={0} yMax={10}
            series={[{ name: 'Pain', color: '#0a6b6b', points: pain, dots: true }]}
            refs={painRef ? [{ y: painRef.value, label: `urgent at ${painRef.value}`, color: '#b3261e' }] : []} />
        </div>
        {curves.map((c) => {
          const m = pack.measures.find((x) => x.id === c.measure)!;
          const pts = p.periodic.filter((e) => e.values[c.measure] !== undefined).map((e) => ({ x: weeksSince(p, e.date), y: Number(e.values[c.measure]) }));
          return (
            <div className="card" key={c.measure}>
              <LineChart title={`${L(m.short ?? m.label, 'en')} vs expected`} xLabel={`weeks ${pack.anchorLabel.en}`} yLabel={m.unit ?? ''}
                series={[{ name: 'Measured', color: '#0a6b6b', points: pts, dots: true }, { name: 'Expected', color: '#6b7a80', dashed: true, points: c.points.map(([x, y]) => ({ x, y })) }]}
                band={c.points.map(([x, y]) => ({ x, lo: y - c.tolerance, hi: y + c.tolerance }))} />
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Last 7 days</h3>
        <table className="gate"><tbody>
          {lastWeek.map((d) => {
            const e = p.daily.find((x) => x.date === d);
            const signs = e ? pack.warningSigns.filter((s) => e.warnings[s.id]).map((s) => s.label.en) : [];
            return (
              <tr key={d}>
                <td>{d}{e?.answeredBy === 'caregiver' ? ' (caregiver)' : ''}</td>
                <td>{e ? `pain ${e.values.pain ?? '—'}, ${e.exercises === 'all' ? 'all exercises' : e.exercises === 'some' ? 'some exercises' : 'no exercises'}${e.skipReason ? ` (${e.skipReason})` : ''}` : <i>no check-in</i>}</td>
                <td>{e && e.hardMovement !== 'none' ? `hard: ${e.hardMovement}` : ''}</td>
                <td>{signs.length ? <b>{signs.join(', ')}</b> : ''}</td>
              </tr>
            );
          })}
        </tbody></table>
      </div>

      {gate && (
        <>
          {gate.allMet && (
            <div className="card ready" data-testid="gate-ready"><div><b>Ready for {pack.phases.find((x) => x.id === gate.toPhase)?.name.en}</b>
              {gate.held
                ? <p className="err">All criteria met, but progression is on hold. Sign-off is blocked until the hold is removed.</p>
                : <p>All criteria met. For physio sign-off. The app never advances a patient by itself.</p>}
              <button className="btn primary" disabled={!gate.canSignOff} onClick={() => apply({ type: 'sign-off-phase' })}>Sign off phase change</button></div></div>
          )}
          <details className="card">
            <summary><b>{pack.phases.find((x) => x.id === gate.fromPhase)?.name.en} to {pack.phases.find((x) => x.id === gate.toPhase)?.name.en}: gate criteria</b> ({gate.criteria.filter((c) => c.met).length}/{gate.criteria.length} met)</summary>
            <table className="gate"><tbody>{gate.criteria.map((c) => (
              <tr key={c.id}><td>{c.met ? '✅' : '⬜'}</td><td>{c.label.en}<br /><small>needs {c.required}</small></td><td>{c.actual}</td><td><Src s={c.source} /></td></tr>))}</tbody></table>
          </details>
        </>
      )}
    </section>
  );
}

// ---------------- Phase 2 panels ----------------
type ApplyFn = (a: PlanAction, label?: { action: string; status: 'approved' | 'modified' }) => boolean;

function ProposalCard({ patient: p, pack, r, now }: { patient: Patient; pack: ProtocolPack; r: TriageResult; now: number }) {
  const st = getState();
  const prop = pendingProposal(p, pack, r, st.today, now);
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState(pack.followUpProposal.checkInEveryDays);
  const [review, setReview] = useState('');
  const [note, setNote] = useState('');
  if (!prop) return null;
  const run = (a: PlanAction, status: 'approved' | 'modified') => updatePatient(p.id, (q) => {
    const out = applyAction(q, pack, a, { nowMs: now, today: st.today });
    return { ...out, reviewed: { ...out.reviewed, [prop.flagKey]: new Date(now).toISOString() }, decisions: [...out.decisions, { at: new Date(now).toISOString(), flagKey: prop.flagKey, action: 'reassess-bring-visit-forward', status, ...(note ? { note } : {}) }] };
  });
  const b = prop.before, a = prop.after;
  const reviewDate = review || a.teleReviewBy;
  return (
    <div className="card proposal" data-testid="proposal">
      <h3>Proposed follow-up <small>(flag raised by a combination of rules; nothing changes until you approve)</small></h3>
      <table className="gate beforeafter"><thead><tr><th></th><th>Now</th><th>Proposed</th></tr></thead><tbody>
        <tr><td>Tele-review</td><td>{b.nextReviewDate ?? `every ${b.reviewEveryDays} days`}</td><td><b>by {a.teleReviewBy}</b> (within {a.teleReviewWithinHours} h)</td></tr>
        <tr><td>Check-ins</td><td>every {b.checkInEveryDays} day(s)</td><td><b>every {a.checkInEveryDays} day(s) for {a.forDays} days</b> (until {a.until})</td></tr>
      </tbody></table>
      <p className="tiny">Source: {pack.followUpProposal.source}</p>
      {editing && (
        <p className="fu">
          <label>Tele-review by <input type="date" value={reviewDate} onChange={(e) => setReview(e.target.value)} /></label>
          <label>Check in every <input type="number" min={1} max={14} value={days} onChange={(e) => setDays(Number(e.target.value))} /> day(s)</label>
        </p>
      )}
      <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="btnrow">
        {!editing ? (
          <>
            <button className="btn primary" onClick={() => run({ type: 'change-follow-up', checkInEveryDays: a.checkInEveryDays, nextReviewDate: a.teleReviewBy, until: a.until, flagKey: prop.flagKey, proposalStatus: 'approved', note }, 'approved')}>Approve</button>
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn" onClick={() => updatePatient(p.id, (q) => ({ ...applyAction(q, pack, { type: 'reject-proposal', flagKey: prop.flagKey, note }, { nowMs: now, today: st.today }), reviewed: { ...q.reviewed, [prop.flagKey]: new Date(now).toISOString() } }))}>Reject</button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => run({ type: 'change-follow-up', checkInEveryDays: days, nextReviewDate: reviewDate, until: a.until, flagKey: prop.flagKey, proposalStatus: 'modified', note }, 'modified')}>Save edited plan</button>
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function PlanCard({ patient: p, pack, now, onApply, err }: { patient: Patient; pack: ProtocolPack; now: number; onApply: ApplyFn; err: string }) {
  const st = getState();
  const exs = currentExercises(p, pack);
  const fu = currentFollowUp(p, pack, st.today);
  const swapped = Object.entries(p.plan.swaps);
  return (
    <div className="card plan" data-testid="plan">
      <h3>Current plan</h3>
      <ul className="planlist">
        {exs.map((id) => {
          const orig = swapped.find(([, v]) => v === id)?.[0];
          return <li key={id}>{exerciseName(id, 'en')}{orig && <> <small>(easier version of {exerciseName(orig, 'en')})</small> <button className="btn" onClick={() => onApply({ type: 'restore-exercise', exerciseId: id })}>Restore</button></>}</li>;
        })}
      </ul>
      <p>Check-ins: every <b>{fu.checkInEveryDays}</b> day(s) · Next review: <b>{fu.nextReviewDate ?? 'not set'}</b>{p.plan.followUp?.until && <> <small>(until {p.plan.followUp.until})</small></>}</p>
      <p>Progression: {p.plan.hold ? <b className="holdtag">On hold since {p.plan.hold.at.slice(0, 10)}</b> : 'not on hold'} {p.plan.hold && <button className="btn" onClick={() => onApply({ type: 'release-hold' })}>Remove hold</button>}</p>
      {err && <p className="err" role="alert">{err}</p>}
      <details>
        <summary>Audit log ({p.audit.length})</summary>
        {p.audit.length === 0 ? <p className="tiny">No plan changes yet.</p> : (
          <ul className="audit">{[...p.audit].reverse().map((a) => (
            <li key={a.id}><b>{a.at.slice(0, 16).replace('T', ' ')}</b> · {a.who}: {a.summary}{a.note ? <> <i>“{a.note}”</i></> : null}</li>))}</ul>
        )}
      </details>
    </div>
  );
}

function OverridesCard({ patient: p, pack, onApply, err }: { patient: Patient; pack: ProtocolPack; onApply: ApplyFn; err: string }) {
  const list = listOverridable(pack, p);
  const [target, setTarget] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const cur = list.find((x) => x.target === target);
  return (
    <details className="card overrides" data-testid="overrides">
      <summary><b>Thresholds for this patient</b> ({p.plan.overrides.length} overridden)</summary>
      {p.plan.overrides.length > 0 && (
        <ul className="audit">{p.plan.overrides.map((o) => (
          <li key={o.id}>{o.label}: <s>{o.original}</s> <b>{o.value}</b> <span className="src">PHYSIO_OVERRIDE</span> · {o.by}, {o.at.slice(0, 10)} · “{o.reason}” <button className="btn" onClick={() => onApply({ type: 'remove-override', id: o.id })}>Remove</button></li>))}</ul>
      )}
      <div className="fu">
        <select aria-label="Threshold" value={target} onChange={(e) => { setTarget(e.target.value); setValue(''); }}>
          <option value="">Choose a threshold…</option>
          {list.map((x) => <option key={x.target} value={x.target}>{x.label} (now {x.current})</option>)}
        </select>
        <input aria-label="New value" type="number" placeholder={cur ? String(cur.current) : 'value'} value={value} onChange={(e) => setValue(e.target.value)} />
        <input aria-label="Reason (required)" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn primary" disabled={!target || value === '' || !reason.trim()} onClick={() => { if (onApply({ type: 'set-override', target, value: Number(value), reason })) { setTarget(''); setValue(''); setReason(''); } }}>Override for this patient</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <p className="tiny">Applies to this patient only. The pack is unchanged. The reason is logged and shown on the evidence line whenever the rule fires.</p>
    </details>
  );
}
