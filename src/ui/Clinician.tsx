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

  const decide = (action: string, status: 'approved' | 'modified') =>
    updatePatient(p.id, (q) => ({
      ...q,
      reviewed: r.flagKey ? { ...q.reviewed, [r.flagKey]: new Date(now).toISOString() } : q.reviewed,
      decisions: [...q.decisions, { at: new Date(now).toISOString(), flagKey: r.flagKey, action, status, ...(note[action] ? { note: note[action] } : {}) }],
    }));
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
                <div><b>{t.label.en}</b> <Tier tier={t.tier} /> <Src s={t.source} /><p>{t.evidence}</p>{t.combinedFrom && <small>Combined from: {t.combinedFrom.join(', ')}</small>}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>Suggested actions <small>(never applied automatically)</small></h3>
        {r.reviewedAt && <p className="reviewed">Reviewed {r.reviewedAt.slice(0, 16).replace('T', ' ')}</p>}
        {actions.length === 0 && <p className="tiny">No action suggested. Weekly summary only.</p>}
        {actions.map((a) => (
          <div className="actrow" key={a}>
            <span className="name">{ACTION_LABELS[a]?.en ?? a}</span>
            {modifying === a && <input aria-label="Note" placeholder="What did you change?" value={note[a] ?? ''} onChange={(e) => setNote({ ...note, [a]: e.target.value })} />}
            {modifying === a ? (
              <button className="btn primary" onClick={() => { decide(a, 'modified'); setModifying(null); }}>Save change</button>
            ) : (
              <>
                <button className="btn primary" onClick={() => decide(a, 'approved')}>Approve</button>
                <button className="btn" onClick={() => setModifying(a)}>Modify</button>
              </>
            )}
          </div>
        ))}
        {p.decisions.length > 0 && (
          <ul className="decisions">{p.decisions.slice(-4).map((d, i) => <li key={i}>{d.at.slice(0, 16).replace('T', ' ')}: {ACTION_LABELS[d.action]?.en ?? d.action} {d.status}{d.note ? ` (${d.note})` : ''}</li>)}</ul>
        )}
        <p className="tiny">Recording a decision marks the flag as reviewed. Automatic plan changes are not wired up yet; you edit the plan yourself.</p>
        {r.tier !== 'ON_PLAN' && !r.reviewedAt && <div className="btnrow"><button className="btn" onClick={markReviewed}>Mark as reviewed</button></div>}
      </div>

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
            <div className="card ready"><div><b>Ready for {pack.phases.find((x) => x.id === gate.toPhase)?.name.en}</b><p>All criteria met. For physio sign-off. The app never advances a patient by itself.</p></div></div>
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
