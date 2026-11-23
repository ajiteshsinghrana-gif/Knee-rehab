import { auditCsv } from '../audit';
import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Menu } from './TopBar';
import { LoginCard } from './Login';
import { DEFAULT_RETENTION_YEARS, completeTreatment, eraseLocal, isActive, reopenTreatment, retentionDue, retentionEnd } from '../lifecycle';
import { physioErasePatient, physioNewClaimPin } from '../sync/engine';
import { getSyncStatus, physioResetPatientLink, subscribeSync } from '../sync/engine';
import { inviteUrl } from '../onboarding';
import { qrSvg } from '../qr';
import type { Patient, ProtocolPack, Tier, Trigger, TriageResult } from '../types';
import { L } from '../i18n';
import { getPack } from '../engine/packs';
import { addDays, diffDays } from '../engine/dates';
import { compareWorklist, stageFor, triage, usualValue, weeksInPhase, weeksSince } from '../engine/triage';
import { evaluateGate } from '../engine/gates';
import { ACTION_LABELS, suggestedActions } from '../engine/actions';
import { collectSignoffs } from '../engine/signoff';
import { clockMs, getState, realToday, removeClinicCurve, setClinicCurve, setState, updatePatient, type AppState } from '../store';
import { LineChart, Sparkline } from './Charts';
import { Onboarding } from './Onboarding';
import { ImportProtocol } from './Import';
import { NewCondition } from './Condition';
import { ExerciseVideos } from './Demos';
import { getDemo } from '../exercises/demos';
import type { ConditionDraft } from '../author/condition';
import { applyAction, applyManual, withAuditNote, currentExercises, currentFollowUp, pendingProposal, type PlanAction } from '../engine/plan';
import { effectivePack, listOverridable } from '../engine/overrides';
import { curveOrigin } from '../engine/curves';
import { exerciseName, getExercise, LIBRARY } from '../exercises/library';
import { SessionsCard } from './SessionsCard';
import { FormReview } from './FormReview';
import { pendingForms } from '../forms/model';
import { optInWeeklyMeasures } from '../checkin';
import { doseLine } from '../exercises/dose';
import { scheduleSuggestion } from '../engine/schedule';
import { missedCheckIns } from '../reminders';
import { validHours } from '../engine/hours';
import { ruleHitRates } from '../engine/feedback';

const TIER_LABEL: Record<Tier, string> = { SAFETY: 'SAFETY', URGENT: 'URGENT', REVIEW: 'REVIEW', ON_PLAN: 'ON PLAN' };
const srcClass = (s: string) => s.split(/[;( ]/)[0].replace(/[^A-Z_]/g, '');
/** Placeholder values are shown in plain words, never as the raw NEEDS_PHYSIO_SIGNOFF code. */
const DEFAULT_NOTE = 'Default value, not yet reviewed by your clinic';
const srcText = (s: string) => s.replace(/NEEDS_PHYSIO_SIGNOFF:?\s*/g, `${DEFAULT_NOTE}. `).replace(/\.\s*$/, '');
/** Readable names for the source tags in the protocol files, with the explanation shown on hover. */
const SOURCE_NAMES: Record<string, [string, string]> = {
  MELBOURNE: ['Melbourne ACL Guide', 'From the Melbourne ACL Rehabilitation Guide 2.0 (Cooper & Hughes), a published physiotherapy guide for rehabilitation after ACL reconstruction.'],
  DEFAULT: ['App default', "A starting value chosen by the app's developers, not taken from a published guide. Check it against your own protocol."],
  SAFETY: ['Safety rule', 'A safety rule built into the app: these warning signs always need prompt attention.'],
  NEEDS_PHYSIO_SIGNOFF: ['Not yet reviewed', `${DEFAULT_NOTE}.`],
  PLACEHOLDER: ['Placeholder', 'A placeholder value that holds the place until your clinic sets its own.'],
  TSK: ['TSK-11', 'Tampa Scale for Kinesiophobia, 11 items (Woby et al., 2005).'],
  PHYSIO_OVERRIDE: ['Your threshold', 'You changed this value for this patient.'],
  PHYSIO_CLINIC: ['Clinic default', 'Your clinic set this value for every patient with this condition.'],
  PHYSIO_AUTHORED: ['Written by you', 'You wrote this value in the condition you created.'],
  PHYSIO_IMPORTED: ['Imported by you', 'You imported and approved this value from a protocol document.'],
  PHYSIO_CONFIRMED: ['Confirmed by you', 'You confirmed this value.'],
};
const srcName = (s: string): { label: string; tip: string } => {
  const k = srcClass(s);
  const known = SOURCE_NAMES[k];
  const partly = k !== 'NEEDS_PHYSIO_SIGNOFF' && s.includes('NEEDS_PHYSIO_SIGNOFF');
  const label = known ? known[0] : (srcText(s).length > 34 ? srcText(s).slice(0, 32) + '…' : srcText(s));
  const tip = [known?.[1], partly ? `Part of this is a ${DEFAULT_NOTE.toLowerCase()}.` : '', `Tag: ${srcText(s)}`].filter(Boolean).join(' ');
  return { label: partly ? `${label}, partly not reviewed` : label, tip };
};
const Src = ({ s }: { s: string }) => {
  const n = srcName(s);
  return <span className={`src ${srcClass(s)}`} title={n.tip}>{n.label}</span>;
};

/** One plain phrase per signal, e.g. "pain rising (3 → 5)", "2 missed days", "squats hard 3 times". */
const NUM_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
function plainSignal(t: Trigger, pack: ProtocolPack): string {
  const rule = pack.rules.find((x) => x.id === t.ruleId);
  const label = t.label.en.charAt(0).toLowerCase() + t.label.en.slice(1);
  if (rule?.type === 'trend') { const m = /(\d+(?:\.\d+)?(?: -> \d+(?:\.\d+)?)+)/.exec(t.evidence); if (m) { const v = m[1].split(' -> '); return `${label} (${v[0]} → ${v[v.length - 1]})`; } }
  if (rule?.type === 'streak' && rule.metric === 'missedSessions') { const m = /(\d+) missed days? in a row/.exec(t.evidence); if (m) return `${m[1]} missed day${m[1] === '1' ? '' : 's'}`; }
  if (rule?.type === 'streak' && rule.metric === 'repeatedHardMovement') { const m = /'([^']+)' reported hard on (\d+) of last (\d+) days/.exec(t.evidence); if (m) return `${exerciseName(m[1], 'en').toLowerCase()} hard ${m[2]} time${m[2] === '1' ? '' : 's'}`; }
  return label;
}
/** A combination rule as one sentence: "Three warning signs in the last 3 days: pain rising (3 → 5), 2 missed days, squats hard 3 times." */
function combinedSentence(t: Trigger, all: Trigger[], pack: ProtocolPack): string {
  const rule = pack.rules.find((x) => x.id === t.ruleId);
  const ids = t.combinedFrom ?? [];
  const parts = ids.map((id) => { const c = all.find((x) => x.ruleId === id); const rr = pack.rules.find((x) => x.id === id); return c ? plainSignal(c, pack) : rr ? rr.label.en.toLowerCase() : id; });
  const days = rule && rule.type === 'combination' ? ` in the last ${rule.windowDays} days` : '';
  return `${NUM_WORDS[ids.length] ?? ids.length} warning signs${days}: ${parts.join(', ')}.`;
}
const prettyEvidence = (e: string) => e.replace(/ -> /g, ' → ');
const hrs = (ms: number) => `${Math.round(Math.abs(ms) / 3_600_000)} h`;

export function Tier({ tier, xl }: { tier: Tier; xl?: boolean }) {
  return <span className={`pill ${tier} ${xl ? 'xl' : ''}`}>{TIER_LABEL[tier]}</span>;
}

function dueText(r: TriageResult, now: number): string {
  if (r.tier === 'ON_PLAN' || r.dueByMs === null) return 'weekly summary only';
  if (r.reviewedAt) return 'reviewed';
  return r.dueByMs >= now ? `respond within ${hrs(r.dueByMs - now)}` : `${hrs(now - r.dueByMs)} past deadline`;
}

/** One short plain-language reason for the worklist row. Rule codes stay in the detail view. */
function plainReason(r: TriageResult): string {
  if (!r.triggers.length) return '';
  // a "several signals together" rule is explained by the signals themselves, so list those instead
  const own = r.triggers.filter((t) => !t.combinedFrom?.some((id) => r.triggers.some((x) => x.ruleId === id)));
  const labels = (own.length ? own : r.triggers).map((t, i) => (i === 0 ? t.label.en : t.label.en.charAt(0).toLowerCase() + t.label.en.slice(1)));
  return labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more` : labels.join(', ');
}

/** Compact time-left text for the worklist row; the detail header keeps the full sentence. */
function dueShort(r: TriageResult, now: number): string {
  if (r.tier === 'ON_PLAN' || r.dueByMs === null) return 'Weekly summary';
  if (r.reviewedAt) return 'Reviewed';
  return r.dueByMs >= now ? `${hrs(r.dueByMs - now)} left` : `${hrs(now - r.dueByMs)} late`;
}

type DashMode = 'dash' | 'add' | 'import' | 'condition' | 'past' | 'videos' | 'summary';

export function Clinician({ state }: { state: AppState }) {
  const now = clockMs(state);
  const rows = useMemo(
    () => state.patients.map((p) => ({ p, pack: getPack(p.packId), r: triage(p, getPack(p.packId), { nowMs: now, workingHours: validHours(state.clinic?.hours) ? state.clinic!.hours : undefined }) })).sort((a, b) => compareWorklist(a.r, b.r)),
    [state.patients, now, state.clinic?.hours],
  );
  const [sel, setSel] = useState(state.activeId);
  const [mode, setModeRaw] = useState<DashMode>('dash');
  const [filter, setFilter] = useState<Tier | null>(null);
  // Narrow screens show one pane at a time: the worklist, or what was opened from it.
  const [opened, setOpened] = useState(false);
  const setMode = (m: DashMode) => { setModeRaw(m); setOpened(m !== 'dash' || opened); };
  const [aiDraft, setAiDraft] = useState<{ d: ConditionDraft; notes: string[] } | null>(null);
  const activeRows = rows.filter((x) => isActive(x.p));
  const pastRows = rows.filter((x) => !isActive(x.p));
  const cur = rows.find((x) => x.p.id === sel) ?? activeRows[0] ?? rows[0];
  const counts = (['SAFETY', 'URGENT', 'REVIEW', 'ON_PLAN'] as Tier[]).map((t) => [t, activeRows.filter((x) => x.r.tier === t).length] as const);
  const shown = filter ? activeRows.filter((x) => x.r.tier === filter) : activeRows;
  const asks = state.patients.filter((p) => p.erasureRequestedAt).length;
  const open = (id: string) => { setSel(id); setModeRaw('dash'); setOpened(true); };
  return (
    <>
      <div className={`dash ${opened ? 'show-detail' : 'show-list'}`}>
        <aside className="worklist" aria-label="Worklist">
          <div className="wl-head">
            <h2>Patients</h2>
            <button className="btn" onClick={() => setMode('add')}>+ Add patient</button>
            <Menu label="More patient and protocol tools" buttonLabel="More" className="wl-more" testid="more-menu">
              {(close) => (<>
                <button className="menuitem" onClick={() => { close(); setMode('import'); }}>Import protocol</button>
                <button className="menuitem" onClick={() => { close(); setMode('condition'); }}>Add a condition</button>
                <button className="menuitem" data-testid="videos-btn" onClick={() => { close(); setMode('videos'); }}>Exercise videos</button>
                <hr />
                <button className="menuitem" data-testid="summary-btn" onClick={() => { close(); setMode('summary'); }}>Clinic summary</button>
                <button className="menuitem" data-testid="past-btn" onClick={() => { close(); setMode('past'); }}>Past patients ({pastRows.length}){asks ? <span className="overdue">{asks} erasure request{asks === 1 ? '' : 's'}</span> : null}</button>
              </>)}
            </Menu>
          </div>
          <div className="tierfilter" role="group" aria-label="Show only one tier">
            {counts.map(([t, n]) => (
              <button key={t} type="button" className={`tchip ${t} ${filter === t ? 'on' : ''}`} aria-pressed={filter === t} onClick={() => setFilter(filter === t ? null : t)}>
                {TIER_LABEL[t]}<b>{n}</b>
              </button>
            ))}
          </div>
          <ul>
            {activeRows.length === 0 && <li className="tiny wl-empty">No active patients. Add one, or open Past patients from More.</li>}
            {activeRows.length > 0 && shown.length === 0 && <li className="tiny wl-empty">No patients in this tier. <button className="linkbtn" onClick={() => setFilter(null)}>Show all</button></li>}
            {shown.map(({ p, pack, r }) => (
              <li key={p.id}>
                <button className={`prow ${p.id === cur?.p.id && mode === 'dash' ? 'active' : ''}`} aria-current={p.id === cur?.p.id && mode === 'dash' ? 'true' : undefined} onClick={() => open(p.id)}>
                  <span className={`dot ${r.tier}`} aria-hidden />
                  <span className="pmain">
                    <span className="pname"><b>{p.name}</b>, {p.age}</span>
                    <small>{pack.condition.en}</small>
                    {r.triggers.length > 0 && <span className="preason" title={plainReason(r)}>{plainReason(r)}</span>}
                    {pendingForms(p).length > 0 && <span className="chips"><i data-testid="form-chip">{pendingForms(p).length} video{pendingForms(p).length === 1 ? '' : 's'} to review</i></span>}
                  </span>
                  <span className="pdl">
                    <strong className={r.tier}>{TIER_LABEL[r.tier]}</strong>
                    <small className={r.reviewedAt ? 'rev' : ''}>{dueShort(r, now)}</small>
                    {r.overdue && <span className="overdue">Overdue</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="dashmain">
          <button type="button" className="backtolist linkbtn" onClick={() => { setOpened(false); setModeRaw('dash'); }}>← All patients</button>
          {mode === 'add' && <Onboarding onClose={() => { setMode('dash'); setSel(getState().activeId); }} onNewCondition={() => setMode('condition')} />}
          {mode === 'import' && <ImportProtocol onClose={() => setMode('dash')} onDraft={(d, notes) => { setAiDraft({ d, notes }); setMode('condition'); }} />}
          {mode === 'condition' && <NewCondition key={aiDraft?.d.id ?? 'blank'} initial={aiDraft?.d} initialNotes={aiDraft?.notes} onClose={() => { setAiDraft(null); setMode('dash'); }} onAddPatient={() => { setAiDraft(null); setMode('add'); }} />}
          {mode === 'videos' && <ExerciseVideos onClose={() => setMode('dash')} />}
          {mode === 'summary' && <ClinicSummary state={state} rows={rows} now={now} onClose={() => setMode('dash')} />}
          {mode === 'past' && <PastPatients rows={pastRows.map((x) => x.p)} years={state.retentionYears ?? DEFAULT_RETENTION_YEARS} today={state.today} onOpen={(id) => open(id)} />}
          {mode === 'dash' && !cur && <section className="card"><p>No patients yet. Use + Add patient.</p></section>}
          {mode === 'dash' && cur && <Detail key={cur.p.id + cur.r.asOf} patient={cur.p} pack={cur.pack} r={cur.r} now={now} />}
        </div>
      </div>
      <footer className="dashfoot">Supports clinical judgement; not a diagnosis. Tiers come only from deterministic rules in each patient's protocol pack. Nothing changes a plan until you approve it.</footer>
    </>
  );
}

/** Header controls on the physio dashboard: sign-in (a small dialog) and clinic settings (gear). */
export function PhysioHeaderControls({ state }: { state: AppState }) {
  const s = useSyncExternalStore(subscribeSync, getSyncStatus);
  const dlg = useRef<HTMLDialogElement>(null);
  const showAuth = s.enabled && s.auth;
  return (
    <>
      {showAuth && (
        <>
          <button type="button" className="menubtn" data-testid="signin-btn" onClick={() => dlg.current?.showModal()}>
            {s.user ? <><span className="avatar" aria-hidden>{s.user.charAt(0).toUpperCase()}</span><span className="tb-hide-narrow">Account</span></> : 'Sign in'}
          </button>
          <dialog ref={dlg} className="dialog" aria-label="Physio account" onClick={(e) => { if (e.target === dlg.current) dlg.current.close(); }}>
            <div className="dialog-head"><h2>{s.user ? 'Physio account' : 'Physio sign-in'}</h2><button type="button" className="iconbtn" aria-label="Close" onClick={() => dlg.current?.close()}>✕</button></div>
            <LoginCard />
          </dialog>
        </>
      )}
      <Menu label="Clinic settings" testid="clinic-settings" className="settingsmenu" buttonLabel={<span aria-hidden className="gear">⚙</span>}>
        {() => <ClinicSettings state={state} />}
      </Menu>
    </>
  );
}

type TabId = 'overview' | 'plan' | 'progress' | 'history' | 'settings';
const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'plan', label: 'Plan' }, { id: 'progress', label: 'Progress' }, { id: 'history', label: 'History' }, { id: 'settings', label: 'Settings' },
];

/** Accessible tab list: arrow keys move between tabs, only the selected tab is in the Tab order. */
function TabList({ tab, setTab, idBase }: { tab: TabId; setTab: (t: TabId) => void; idBase: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: ReactKeyboardEvent, i: number) => {
    const n = TABS.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault(); setTab(TABS[to].id); refs.current[to]?.focus();
  };
  return (
    <div className="dtabs" role="tablist" aria-label="Patient record">
      {TABS.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`${idBase}-tab-${t.id}`} aria-controls={`${idBase}-panel-${t.id}`}
          aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} onKeyDown={(e) => onKey(e, i)}>{t.label}</button>
      ))}
    </div>
  );
}

const everyDays = (n: number) => (n === 1 ? 'every day' : `every ${n} days`);

function Detail({ patient: p, pack, r, now }: { patient: Patient; pack: ProtocolPack; r: TriageResult; now: number }) {
  const phase = pack.phases.find((x) => x.id === p.currentPhase)!;
  const wk = weeksSince(p, r.asOf);
  const actions = suggestedActions(r.triggers, pack, p, r.asOf);
  const gate = evaluateGate(p, pack, r.asOf);
  const signoffs = useMemo(() => collectSignoffs(pack).filter((x) => x.needsSignoff), [pack]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [modifying, setModifying] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<TabId>('overview');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const idBase = `pt-${p.id}`;
  const st = getState();
  const exs = currentExercises(p, pack);
  const [pick, setPick] = useState('');
  const [fuDate, setFuDate] = useState(addDays(st.today, 2));
  const [fuEvery, setFuEvery] = useState(1);
  const [forPatient, setForPatient] = useState('');
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
    if (a === 'regress-exercise') { if (!pick) { setErr('Choose which exercise to make easier'); return; } act = { type: 'regress-exercise', exerciseId: pick, note: n, patientNote: forPatient }; }
    if (a === 'hold-progression') act = { type: 'hold-progression', note: n };
    if (a === 'reassess-bring-visit-forward') act = { type: 'change-follow-up', checkInEveryDays: fuEvery, nextReviewDate: fuDate, note: n };
    if (act && apply(act, { action: a, status: 'approved' })) setModifying(null);
  };
  const markReviewed = () => r.flagKey && updatePatient(p.id, (q) => ({ ...q, reviewed: { ...q.reviewed, [r.flagKey!]: new Date(now).toISOString() } }));
  const openAdjust = () => { setTab('plan'); setAdjustOpen(true); };

  // charts and evidence
  const first = addDays(r.asOf, -41);
  const pain = p.daily.filter((d) => d.date >= first && d.values.pain !== undefined).map((d) => ({ x: Math.round((diffDays(d.date, p.anchorDate) / 7) * 10) / 10, y: Number(d.values.pain) }));
  const r3 = pack.rules.find((x) => x.type === 'threshold' && x.measure === 'pain');
  const painRef = r3 && r3.type === 'threshold' ? stageFor(r3.stages, wk) : undefined;
  const lastWeek = Array.from({ length: 7 }, (_, i) => addDays(r.asOf, i - 6));
  const curves = effectivePack(p, pack).expectedCurves; // protocol curve, clinic default or this patient's own
  const caregiverN = lastWeek.filter((d) => p.daily.find((x) => x.date === d)?.answeredBy === 'caregiver').length;
  const pendingVideos = pendingForms(p).length > 0;
  const flagged = r.tier !== 'ON_PLAN' && !r.reviewedAt;

  return (
    <section className="detail" aria-label={`${p.name}'s record`}>
      <div className={`card head ${r.tier}`}>
        <div className="dh-main">
          <h2>{p.name}, {p.age}</h2>
          <p className="sub">{pack.condition.en} · Week {wk.toFixed(1)} {pack.anchorLabel.en} · {phase.name.en} <small>({weeksInPhase(p, r.asOf).toFixed(1)} wk in phase, as of {r.asOf})</small></p>
        </div>
        <div className="dh-side">
          <div className="tierbox">
            <span className="tierline"><Tier tier={r.tier} xl />{r.overdue && <span className="overdue">Overdue</span>}</span>
            <small>{dueText(r, now)}{r.responseHours ? ` (${r.responseHours} h target)` : ''}</small>
          </div>
          {flagged
            ? <button className="btn" onClick={markReviewed}>Mark as reviewed</button>
            : <button className="btn primary" onClick={openAdjust}>Adjust treatment</button>}
        </div>
      </div>

      <EscalationCard patient={p} r={r} now={now} />
      {p.erasureRequestedAt && (
        <p className="warnline" role="alert">The patient asked for their data to be erased on {p.erasureRequestedAt.slice(0, 10)}. <button className="linkbtn" onClick={() => setTab('settings')}>Answer in Settings</button></p>
      )}

      <TabList tab={tab} setTab={setTab} idBase={idBase} />

      {tab === 'overview' && (
        <div className="tabpanel" role="tabpanel" id={`${idBase}-panel-overview`} aria-labelledby={`${idBase}-tab-overview`}>
          <div className="ovgrid">
          <div className="ov-col">
          <div className="card">
            <h3>{r.triggers.length ? 'Why this patient is flagged' : 'Status'}</h3>
            {r.triggers.length === 0 ? <p className="tiny">Nothing is flagged. The patient is on plan; weekly summary only.</p> : (() => {
              // A signal that is part of a combination is told inside that combination's sentence, not again on its own line.
              const inCombo = new Set(r.triggers.filter((t) => t.combinedFrom).flatMap((t) => t.combinedFrom ?? []));
              const lines = r.triggers.filter((t) => t.combinedFrom || !inCombo.has(t.ruleId));
              return (
                <ul className="reasons">
                  {lines.map((t) => (
                    <li key={t.ruleId}>
                      <span className={`dot ${t.tier}`} aria-hidden />
                      <span className="r-text" title={`${t.label.en}: ${prettyEvidence(t.evidence)}`}>
                        {t.combinedFrom
                          ? <span className="r-label">{combinedSentence(t, r.triggers, pack)}</span>
                          : <><span className="r-label">{t.label.en}</span> <span className="r-ev">{prettyEvidence(t.evidence)}</span></>}
                        {t.source.includes('PHYSIO_OVERRIDE') && <span className="src" data-testid="override-tag">Your threshold: {t.source.split('PHYSIO_OVERRIDE:')[1]?.trim()}</span>}
                      </span>
                      <span className="r-meta">
                        <Tier tier={t.tier} />
                        {[t.ruleId, ...(t.combinedFrom ?? [])].map((id) => {
                          const tr = r.triggers.find((x) => x.ruleId === id);
                          const n = srcName(tr?.source ?? t.source);
                          return <span key={id} className="r-code" title={`Rule ${id}${tr ? `: ${tr.label.en}` : ''}. Source: ${n.label}. ${n.tip}`}>{id}</span>;
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>

          <div className="card evstrip" aria-label="Evidence">
            <div className="ev">
              <span className="ev-k">Pain, last 14 days</span>
              {(() => {
                const pts = p.daily.filter((d) => d.date > addDays(r.asOf, -14) && d.date <= r.asOf && d.values.pain !== undefined).map((d) => ({ x: diffDays(d.date, r.asOf), y: Number(d.values.pain) }));
                const vals = pts.map((q) => q.y);
                const u = usualValue(p, 'pain', r.asOf);
                const ys = vals.concat(painRef && vals.length && painRef.value <= Math.max(...vals) + 1 ? [painRef.value] : []).concat(u ? [u.usual] : []); // the urgent line joins the scale only when it is close
                // Scale to the data (and the urgent line) so a 3-point rise is clearly visible, not squashed into 0 to 10.
                const lo = ys.length ? Math.max(0, Math.min(...ys) - 1) : 0;
                const hi = ys.length ? Math.min(10, Math.max(Math.max(...ys) + 1, lo + 5)) : 10;
                return (
                  <>
                    <Sparkline points={pts} xMin={-13} xMax={0} yMin={lo} yMax={hi} threshold={painRef?.value} usual={u?.usual} label="Pain, 0 to 10, over the last 14 days" change={painChange(pts)} />
                    <span className="ev-v" data-testid="usual-pain">{u ? <>Usual pain: <b>{u.usual}</b> · Today: <b>{u.latest}</b></> : 'Usual pain: needs 5 more check-ins'}</span>
                  </>
                );
              })()}
            </div>
            <div className="ev">
              <span className="ev-k">Exercises, last 7 days</span>
              <span className="adh" role="img" aria-label={lastWeek.map((d) => { const e = p.daily.find((x) => x.date === d); return `${d}: ${e ? (e.exercises === 'all' ? 'all done' : e.exercises === 'some' ? 'some done' : 'none done') : 'no check-in'}`; }).join('; ')}>
                {lastWeek.map((d) => { const e = p.daily.find((x) => x.date === d); return <i key={d} className={e ? e.exercises : 'nodata'} />; })}
              </span>
              <span className="ev-v">{lastWeek.filter((d) => p.daily.find((x) => x.date === d)?.exercises === 'all').length} of 7 days complete</span>
            </div>
            <div className="ev">
              <span className="ev-k">Hardest movement</span>
              {(() => { const h = hardest(p, r.asOf); return h ? <><span className="ev-big">{exerciseName(h.id, 'en')}</span><span className="ev-v">reported on {h.n} of the last 14 days</span></> : <span className="ev-v">None reported</span>; })()}
            </div>
          </div>
          {(() => {
            const m = missedCheckIns(p, pack, st.today);
            if (!m.missed) return null;
            const s1 = r.triggers.some((t) => t.ruleId === 'S1');
            return (
              <p className="missednote" data-testid="missed-note">
                <b>Missed check-ins: {m.missed}</b> (last check-in {m.lastDate}{m.every > 1 ? `, due every ${m.every} days` : ''}).{' '}
                {m.steps.map((x) => `WhatsApp reminder to the ${x.kind} on ${x.date}`).join('; ')} (simulated, nothing was sent).{' '}
                {s1 ? 'The physio is now flagged (S1).' : 'If the silence continues, rule S1 flags it for you.'}
              </p>
            );
          })()}
          {(caregiverN > 0 || p.caregiverMode) && <p className="tiny" data-testid="caregiver-note">{caregiverN} of the last 7 check-ins were answered by a caregiver, not the patient. Answers a carer gives for the patient are a second-hand report.</p>}
          </div>
          <div className="ov-col">
          <ScheduleCard patient={p} pack={pack} r={r} now={now} onApply={apply} />
          <ProposalCard patient={p} pack={pack} r={r} now={now} />

          <div className="card">
            <h3>Suggested actions <small>Nothing changes until you approve</small></h3>
            {actions.length > 0 && <p className="tiny">Approved changes go in the audit log, and the patient is told in their own language.</p>}
            {r.reviewedAt && <p className="reviewed">Reviewed {r.reviewedAt.slice(0, 16).replace('T', ' ')}</p>}
            {r.reviewedAt && r.flagKey && <FlagFeedback patient={p} r={r} now={now} />}
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
                    <label>Check in every <input type="number" min={1} max={14} value={fuEvery} onChange={(e) => setFuEvery(Number(e.target.value))} /> {fuEvery === 1 ? 'day' : 'days'}</label>
                  </span>
                )}
                {modifying === a && <input aria-label="Note" placeholder="Note (optional)" value={note[a] ?? ''} onChange={(e) => setNote({ ...note, [a]: e.target.value })} />}
                {modifying === a && a === 'regress-exercise' && <input aria-label="Note for the patient (optional, they will see it)" placeholder="Note for the patient (optional, they see it)" maxLength={300} value={forPatient} onChange={(e) => setForPatient(e.target.value)} />}
                {modifying === a ? (
                  <>
                    <button className="btn primary" onClick={() => confirm(a)}>Confirm and apply</button>
                    <button className="btn" onClick={() => setModifying(null)}>Cancel</button>
                  </>
                ) : (
                  <button className="btn" onClick={() => start(a)}>{PLAN_ACTIONS.includes(a) ? 'Approve…' : 'Approve'}</button>
                )}
              </div>
            ))}
          </div>

          </div>
          </div>
          {gate?.allMet && <GateReady gate={gate} pack={pack} onApply={apply} />}
          {pendingVideos && <FormReview patient={p} pack={pack} now={now} />}
        </div>
      )}

      {tab === 'plan' && (
        <div className="tabpanel" role="tabpanel" id={`${idBase}-panel-plan`} aria-labelledby={`${idBase}-tab-plan`}>
          <PlanCard patient={p} pack={pack} now={now} onApply={apply} err={err} onAdjust={p.status !== 'completed' && !adjustOpen ? () => setAdjustOpen(true) : undefined} />
          {p.status !== 'completed' && adjustOpen && <AdjustCard patient={p} pack={pack} now={now} onClose={() => setAdjustOpen(false)} />}
        </div>
      )}

      {tab === 'progress' && (
        <div className="tabpanel" role="tabpanel" id={`${idBase}-panel-progress`} aria-labelledby={`${idBase}-tab-progress`}>
          <div className="charts">
            <div className="card">
              <LineChart title="Pain, last 6 weeks" xLabel={`weeks ${pack.anchorLabel.en}`} yLabel="0-10" yMin={0} yMax={10}
                series={[{ name: 'Pain', color: '#0a6b6b', points: pain, dots: true }]}
                refs={[
                  ...(painRef ? [{ y: painRef.value, label: `urgent at ${painRef.value}`, color: '#c62828' }] : []),
                  ...(() => { const u = usualValue(p, 'pain', r.asOf); return u ? [{ y: u.usual, label: `usual ${u.usual}`, color: '#6b7a80' }] : []; })(),
                ]} />
            </div>
            {curves.map((c) => {
              const m = pack.measures.find((x) => x.id === c.measure)!;
              const pts = p.periodic.filter((e) => e.values[c.measure] !== undefined).map((e) => ({ x: weeksSince(p, e.date), y: Number(e.values[c.measure]) }));
              const placeholder = curveOrigin(c) === 'placeholder';
              return (
                <div className="card" key={c.measure}>
                  <LineChart title={`${L(m.short ?? m.label, 'en')} vs expected`} note={placeholder ? DEFAULT_NOTE : undefined} xLabel={`weeks ${pack.anchorLabel.en}`} yLabel={m.unit ?? ''}
                    series={[{ name: 'Measured', color: '#0a6b6b', points: pts, dots: true }, { name: 'Expected', color: '#8a979c', dashed: true, points: c.points.map(([x, y]) => ({ x, y })) }]}
                    band={c.points.map(([x, y]) => ({ x, lo: y - c.tolerance, hi: y + c.tolerance }))} />
                  {!placeholder && <CurveNote c={c} />}
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

          {pack.questionnaires.map((q) => {
            const rows = p.periodic.filter((e) => e.values[q.measure] !== undefined);
            const last = rows[rows.length - 1];
            return (
              <div className="card" key={q.id} data-testid="questionnaire-card">
                <h3>{q.title.en} <small>{q.items.length} question{q.items.length === 1 ? '' : 's'}, scored by adding the answers</small></h3>
                {last ? <p>Latest score <b>{String(last.values[q.measure])}</b> on {last.date}{last.answeredBy === 'caregiver' ? ' (answered by a caregiver)' : ''}{rows.length > 1 ? `; before that ${rows.slice(0, -1).map((e) => `${String(e.values[q.measure])} (${e.date})`).join(', ')}` : ''}.</p> : <p className="tiny">Not answered yet.</p>}
                <p className="tiny">{q.credit}{q.licenceConfirmed ? '' : ' (permission to use: default, not yet reviewed by your clinic)'}</p>
              </div>);
          })}

          {gate && (
            <details className="card" open>
              <summary><b>{pack.phases.find((x) => x.id === gate.fromPhase)?.name.en} to {pack.phases.find((x) => x.id === gate.toPhase)?.name.en}: gate criteria</b>&nbsp;<small>({gate.criteria.filter((c) => c.met).length}/{gate.criteria.length} met)</small></summary>
              <table className="gate"><tbody>{gate.criteria.map((c) => (
                <tr key={c.id}><td><span className={`gcheck ${c.met ? 'met' : ''}`} role="img" aria-label={c.met ? 'met' : 'not met'}>{c.met ? '✓' : ''}</span></td><td>{c.label.en}<br /><small>needs {c.required}</small></td><td>{c.actual}</td><td><Src s={c.source} /></td></tr>))}</tbody></table>
            </details>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="tabpanel" role="tabpanel" id={`${idBase}-panel-history`} aria-labelledby={`${idBase}-tab-history`}>
          <div className="card">
            <h3>Treatment status</h3>
            <p>{p.status === 'completed' ? <>Treatment complete since <b>{p.completedAt?.slice(0, 10)}</b>.</> : 'Active.'} <span className="tiny">Mark complete or erase in Settings.</span></p>
          </div>
          <AuditCard patient={p} />
          {!pendingVideos && <FormReview patient={p} pack={pack} now={now} />}
          <SessionsCard patient={p} pack={pack} />
        </div>
      )}

      {tab === 'settings' && (
        <div className="tabpanel" role="tabpanel" id={`${idBase}-panel-settings`} aria-labelledby={`${idBase}-tab-settings`}>
          <AccessCard patient={p} />
          {signoffs.length > 0 && (
            <details className="card placeholders">
              <summary><span>ⓘ {signoffs.length} values in this protocol are a default value, not yet reviewed by your clinic</span></summary>
              <ul>{signoffs.map((s, i) => <li key={i}>{s.where.replace(pack.id + ': ', '')}: <b>{s.value}</b></li>)}</ul>
            </details>
          )}
          <WeeklyItemsCard patient={p} pack={pack} onApply={apply} />
          <OverridesCard patient={p} pack={pack} onApply={apply} err={err} />
          <CurvesCard patient={p} pack={pack} now={now} />
          <ProtocolSignoff pack={pack} now={now} />
          <div className="dangerzone">
            <h3>Treatment and data</h3>
            <LifecycleCard patient={p} now={now} />
          </div>
        </div>
      )}
    </section>
  );
}

/** Pain change in words over about the last 3 days, e.g. "2 → 5 in 3 days". */
function painChange(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  const last = pts[pts.length - 1];
  const recent = pts.filter((q) => q.x >= last.x - 3);
  const first = recent.length > 1 ? recent[0] : pts[pts.length - 2];
  const days = last.x - first.x;
  if (first.y === last.y) return `Steady at ${last.y} for ${days} day${days === 1 ? '' : 's'}`;
  return `${first.y} → ${last.y} in ${days} day${days === 1 ? '' : 's'}`;
}

/** Overdue SAFETY or URGENT flag: hand it to the clinic's named backup contact. Simulated: nothing is sent; the hand-over is logged. */
function EscalationCard({ patient: p, r, now }: { patient: Patient; r: TriageResult; now: number }) {
  const st = getState();
  if (!r.overdue || !r.flagKey || (r.tier !== 'SAFETY' && r.tier !== 'URGENT')) return null;
  const done = p.escalated?.[r.flagKey];
  const name = st.clinic?.backupName?.trim();
  const phone = st.clinic?.backupPhone?.trim();
  const late = Math.round((now - (r.dueByMs ?? now)) / 3_600_000);
  const escalate = () => {
    const to = `${name}${phone ? ` (${phone})` : ''}`;
    const at = new Date(now).toISOString();
    updatePatient(p.id, (q) => withAuditNote({ ...q, escalated: { ...(q.escalated ?? {}), [r.flagKey!]: { at, to } } }, 'escalate', `Overdue ${r.tier} flag handed to backup contact ${to} (simulated: no message was sent)`, null, { to }, `${late} h past the response deadline`, { nowMs: now, today: st.today }));
  };
  return (
    <div className="escalation" role="alert" data-testid="escalation">
      <b>Response deadline passed {late} h ago.</b>
      {done ? <span> Backup contact {done.to} notified on {done.at.slice(0, 16).replace('T', ' ')} (simulated: nothing was sent).</span>
        : name ? <><span> Escalate: hand this {r.tier} flag to your backup contact.</span> <button className="btn" onClick={escalate}>Notify {name}{phone ? ` (${phone})` : ''}</button></>
        : <span> Escalate it: add a backup contact under ⚙ Clinic settings, then notify them from here.</span>}
    </div>
  );
}

/** "Was this flag useful?" after a review. Used only for the per-rule hit rate in the clinic summary; it never changes a tier. */
function FlagFeedback({ patient: p, r, now }: { patient: Patient; r: TriageResult; now: number }) {
  const f = p.flagFeedback?.[r.flagKey!];
  const set = (useful: boolean) => updatePatient(p.id, (q) => ({ ...q, flagFeedback: { ...(q.flagFeedback ?? {}), [r.flagKey!]: { useful, at: new Date(now).toISOString(), rules: r.triggers.map((t) => t.ruleId) } } }));
  return (
    <div className="feedback" data-testid="flag-feedback">
      <span>{f ? `You said this flag was ${f.useful ? 'useful' : 'not useful'}.` : 'Was this flag useful?'}</span>
      <button className={`btn ${f?.useful === true ? 'on' : ''}`} aria-pressed={f?.useful === true} onClick={() => set(true)}>Yes</button>
      <button className={`btn ${f?.useful === false ? 'on' : ''}`} aria-pressed={f?.useful === false} onClick={() => set(false)}>No</button>
    </div>
  );
}

/** A signed-in physio reviews this protocol for their clinic and records their own name and the date. Nothing is pre-filled. */
function ProtocolSignoff({ pack, now }: { pack: ProtocolPack; now: number }) {
  const sync = useSyncExternalStore(subscribeSync, getSyncStatus);
  const st = getState();
  const so = st.packSignoffs?.[pack.id];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [ok, setOk] = useState(false);
  const sign = () => {
    const s2 = getState();
    setState({ ...s2, packSignoffs: { ...(s2.packSignoffs ?? {}), [pack.id]: { name: name.trim(), email: sync.user ?? '', at: new Date(now).toISOString() } } });
    setOpen(false); setName(''); setOk(false);
  };
  const withdraw = () => { const s2 = getState(); const { [pack.id]: _gone, ...rest } = s2.packSignoffs ?? {}; setState({ ...s2, packSignoffs: rest }); };
  return (
    <div className="card" data-testid="protocol-signoff">
      <div className="cardhead"><h3>Protocol: {pack.condition.en}</h3>
        {so ? <button className="linkbtn" onClick={withdraw}>Withdraw sign-off</button>
          : sync.user ? !open && <button className="btn" onClick={() => setOpen(true)}>Sign off this protocol…</button> : null}
      </div>
      {so ? <p className="reviewed" data-testid="signoff-line">Reviewed by {so.name} on {so.at.slice(0, 10)}{so.email ? ` (${so.email})` : ''}</p>
        : <p className="tiny">Not yet reviewed by your clinic.{sync.user ? '' : ' Sign in as a physio to sign it off.'}</p>}
      {open && (
        <div className="doseeditor">
          <label className="menufield" style={{ padding: 0 }}>Your full name (recorded with the date and your account {sync.user})
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> <span>I have reviewed this protocol's rules, thresholds and exercises for use in my clinic.</span></label>
          <div className="btnrow"><button className="btn primary" disabled={!name.trim() || !ok} onClick={sign}>Sign off</button><button className="btn" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

/** Clinic summary: adherence, time from flag to review, patients per physio, and each rule's hit rate. */
function ClinicSummary({ state, rows, now, onClose }: { state: AppState; rows: { p: Patient; pack: ProtocolPack; r: TriageResult }[]; now: number; onClose: () => void }) {
  const active = rows.filter((x) => isActive(x.p));
  const from = addDays(state.today, -7);
  const entries = active.flatMap((x) => x.p.daily.filter((e) => e.date >= from && e.date < state.today));
  const pres = entries.reduce((n, e) => n + e.sessionsPrescribed, 0);
  const done = entries.reduce((n, e) => n + e.sessionsDone, 0);
  const waits: number[] = [];
  for (const x of state.patients) for (const [key, at] of Object.entries(x.reviewed ?? {})) {
    const day = key.split('@')[1];
    if (!day) continue;
    const raised = x.daily.find((e) => e.date === day)?.recordedAt ?? Date.parse(`${day}T12:00:00Z`);
    const h = (Date.parse(at) - raised) / 3_600_000;
    if (h >= 0) waits.push(h);
  }
  const physios = new Set<string>([...state.patients.flatMap((x) => x.audit.map((a) => a.who)), getSyncStatus().user ?? ''].filter(Boolean));
  const nPhysios = Math.max(1, physios.size);
  const hits = ruleHitRates(state.patients);
  const flagged = active.filter((x) => x.r.tier !== 'ON_PLAN').length;
  return (
    <section className="card summary" data-testid="clinic-summary">
      <div className="cardhead"><h2>Clinic summary</h2><button className="btn" onClick={onClose}>Close</button></div>
      <div className="kpis">
        <div><span className="ev-k">Patients monitored</span><b>{active.length}</b><small>{flagged} flagged now</small></div>
        <div><span className="ev-k">Patients per physio</span><b>{(active.length / nPhysios).toFixed(1)}</b><small>{nPhysios} physio{nPhysios === 1 ? '' : 's'}</small></div>
        <div><span className="ev-k">Exercise adherence, last 7 days</span><b>{pres ? `${Math.round((done / pres) * 100)}%` : '—'}</b><small>{done} of {pres} sessions</small></div>
        <div><span className="ev-k">Average time from flag to review</span><b>{waits.length ? `${(waits.reduce((a, b) => a + b, 0) / waits.length).toFixed(1)} h` : '—'}</b><small>{waits.length ? `${waits.length} reviewed flag${waits.length === 1 ? '' : 's'}` : 'No flags reviewed yet'}</small></div>
      </div>
      <h3>Rule hit rate <small>From your "Was this flag useful?" answers. It never changes a tier.</small></h3>
      {hits.length === 0 ? <p className="tiny">No flags rated yet. After you review a flag, answer "Was this flag useful?" in the patient's Overview.</p> : (
        <table className="extable"><thead><tr><th>Rule</th><th>Flags rated</th><th>Useful</th><th>Hit rate</th></tr></thead><tbody>
          {hits.map((h) => {
            const label = rows.map((x) => x.pack.rules.find((rr) => rr.id === h.ruleId)?.label.en ?? x.pack.warningSigns.find((w) => w.ruleId === h.ruleId)?.label.en).find(Boolean);
            return <tr key={h.ruleId}><td><b>{h.ruleId}</b> {label ?? ''}</td><td>{h.rated}</td><td>{h.useful}</td><td>{Math.round((h.useful / h.rated) * 100)}%</td></tr>;
          })}
        </tbody></table>
      )}
      <p className="tiny">Counts come from this device's records. Time from flag to review is measured from when the flag was raised to when you marked it reviewed or approved an action. Escalations to the backup contact: {state.patients.reduce((n, x) => n + Object.keys(x.escalated ?? {}).length, 0)}.</p>
    </section>
  );
}

/** An app suggestion to change how often the patient checks in. Nothing changes until the physio approves; both answers are logged. */
function ScheduleCard({ patient: p, pack, r, now, onApply }: { patient: Patient; pack: ProtocolPack; r: TriageResult; now: number; onApply: ApplyFn }) {
  const st = getState();
  const sug = scheduleSuggestion(p, pack, r, st.today, now);
  const [note, setNote] = useState('');
  if (!sug) return null;
  const fu = currentFollowUp(p, pack, st.today);
  const title = sug.kind === 'reduce' ? `Reduce check-ins to every ${sug.to} days` : 'Return to daily check-ins';
  const why = `${sug.why}.${note.trim() ? ` ${note.trim()}` : ''}`;
  return (
    <div className="card proposal schedule" data-testid="schedule-suggestion">
      <h3>Suggestion: {title} <small>Nothing changes until you approve</small></h3>
      <p className="tiny">{sug.why}. Now: {everyDays(sug.from)}. Proposed: {everyDays(sug.to)}. The patient is told if you approve.</p>
      <div className="btnrow proprow">
        <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" onClick={() => onApply({ type: 'change-follow-up', checkInEveryDays: sug.to, nextReviewDate: fu.nextReviewDate, until: null, flagKey: sug.key, proposalStatus: 'approved', note: `App suggestion approved: ${why}` })}>Approve</button>
        <button className="btn" onClick={() => onApply({ type: 'reject-proposal', flagKey: sug.key, note: `App suggestion declined: ${why}` })}>Decline</button>
      </div>
    </div>
  );
}

/** Optional weekly self-test items (off by default) the physio can switch on for this patient. Each switch is logged. */
function WeeklyItemsCard({ patient: p, pack, onApply }: { patient: Patient; pack: ProtocolPack; onApply: ApplyFn }) {
  const items = optInWeeklyMeasures(pack, p);
  if (!items.length) return null;
  return (
    <div className="card" data-testid="weekly-items">
      <h3>Weekly self-test <small>Optional items, off unless you switch them on for this patient</small></h3>
      {items.map((m) => {
        const on = (p.weeklyOptIn ?? []).includes(m.id);
        return (
          <label key={m.id} className="check">
            <input type="checkbox" checked={on} onChange={(e) => onApply({ type: 'set-weekly-item', measure: m.id, on: e.target.checked })} />
            <span>{m.label.en} <small>({on ? 'on: the patient is asked this every week' : 'off: not asked'})</small></span>
          </label>
        );
      })}
    </div>
  );
}

/** The exercise the patient most often reported as hard in the last 14 days. */
function hardest(p: Patient, asOf: string): { id: string; n: number } | null {
  const from = addDays(asOf, -13);
  const n = new Map<string, number>();
  for (const d of p.daily) if (d.date >= from && d.date <= asOf && d.hardMovement && d.hardMovement !== 'none') n.set(d.hardMovement, (n.get(d.hardMovement) ?? 0) + 1);
  const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? { id: top[0], n: top[1] } : null;
}

function GateReady({ gate, pack, onApply }: { gate: NonNullable<ReturnType<typeof evaluateGate>>; pack: ProtocolPack; onApply: ApplyFn }) {
  return (
    <div className="card ready" data-testid="gate-ready"><div><b>Ready for {pack.phases.find((x) => x.id === gate.toPhase)?.name.en}</b>
      {gate.held
        ? <p className="err">All criteria met, but progression is on hold. Sign-off is blocked until the hold is removed.</p>
        : <p className="tiny">All criteria met. For physio sign-off. The app never advances a patient by itself.</p>}
      <button className="btn" disabled={!gate.canSignOff} onClick={() => onApply({ type: 'sign-off-phase' })}>Sign off phase change</button></div></div>
  );
}

function AuditCard({ patient: p }: { patient: Patient }) {
  return (
    <div className="card" data-testid="audit">
      <div className="cardhead"><h3>Audit log <small>({p.audit.length})</small></h3><button className="btn" disabled={p.audit.length === 0} onClick={() => downloadAudit(p)}>Download as CSV</button></div>
      <p className="tiny">Every change to this patient's plan: who made it, when, what changed, and your written reason. It is saved on this device and cannot be edited.</p>
      {p.audit.length === 0 ? <p className="tiny">No plan changes yet.</p> : (
        <ul className="audit">{[...p.audit].reverse().map((a) => (
          <li key={a.id}><b>{a.at.slice(0, 16).replace('T', ' ')}</b> · {a.who}: {a.manual && <span className="src PHYSIO_OVERRIDE">physio-initiated</span>} {a.summary}{a.note ? <> <i>“{a.note}”</i></> : null}</li>))}</ul>
      )}
    </div>
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
      <h3 title={`Source: ${srcText(pack.followUpProposal.source)}`}>Proposed follow-up <small>Raised by several rules together</small></h3>
      <table className="gate beforeafter"><thead><tr><th></th><th>Now</th><th>Proposed</th></tr></thead><tbody>
        <tr><td>Tele-review</td><td>{b.nextReviewDate ?? `every ${b.reviewEveryDays} days`}</td><td><b>by {a.teleReviewBy}</b> (within {a.teleReviewWithinHours} h)</td></tr>
        <tr><td>Check-ins</td><td>{everyDays(b.checkInEveryDays)}</td><td><b>{everyDays(a.checkInEveryDays)} for {a.forDays} days</b> (until {a.until})</td></tr>
      </tbody></table>
      {editing && (
        <p className="fu">
          <label>Tele-review by <input type="date" value={reviewDate} onChange={(e) => setReview(e.target.value)} /></label>
          <label>Check in every <input type="number" min={1} max={14} value={days} onChange={(e) => setDays(Number(e.target.value))} /> {days === 1 ? 'day' : 'days'}</label>
        </p>
      )}
      <div className="btnrow proprow">
        <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
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

/** How this patient gets back into the app (Phase 6.3): who holds the account, resend the link, reset a wrong claim. */
function AccessCard({ patient: p }: { patient: Patient }) {
  const sync = useSyncExternalStore(subscribeSync, getSyncStatus);
  const [show, setShow] = useState(false);
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState('');
  const email = p.syncKey ? sync.links[p.syncKey] : undefined;
  const url = inviteUrl(p, window.location.href.split('#')[0]);
  const qr = (() => { try { return qrSvg(url, 5); } catch { return null; } })();
  return (
    <details className="card access" data-testid="access" open={false}>
      <summary><b>Patient link and QR code</b>&nbsp;<small>Send it again, or let a new phone join</small></summary>
      {!p.syncKey && <p className="tiny">Live sync is off for this patient, so the link opens their plan on one phone and their answers stay on that phone.</p>}
      {p.syncKey && sync.auth ? (
        <p>{email ? <>Patient account: <b>{email}</b>. They can sign in on any phone.</> : <>No patient account yet. The first person to open the link makes the account, so send it privately.</>}</p>
      ) : p.syncKey ? <p className="tiny">Patient accounts are not switched on. The link alone opens the plan.</p> : null}
      <div className="btnrow">
        <button className="btn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'} invite link and QR code</button>
        {p.syncKey && p.syncRole === 'physio' && sync.auth && !p.claimPin && !email && <button className="btn" onClick={async () => { try { const pin = await physioNewClaimPin(p.syncKey!); updatePatient(p.id, (q) => ({ ...q, claimPin: pin })); setErr(''); } catch (e) { setErr((e as Error).message); } }}>Create a claim PIN</button>}
        {sync.auth && email && !ask && <button className="btn" onClick={() => setAsk(true)}>Reset this patient's account link</button>}
      </div>
      {ask && <p role="alert" className="warnline">The patient is signed out of this link and the next person to open it can make a new account. Their answers stay with you. <button className="btn primary" onClick={async () => { try { await physioResetPatientLink(p.syncKey!); setAsk(false); setErr(''); } catch (e) { setErr((e as Error).message); } }}>Yes, reset</button> <button className="btn" onClick={() => setAsk(false)}>Cancel</button></p>}
      {sync.auth && !email && p.claimPin && <p data-testid="claim-pin">Claim PIN to tell the patient (by voice or message, not in the link): <b className="pin">{p.claimPin.replace(/(\d{4})(\d{4})/, '$1 $2')}</b></p>}
      {err && <p className="err" role="alert">{err}</p>}
      {show && (
        <div data-testid="access-invite">
          {qr ? <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} /> : <p className="tiny">This plan is too large for a QR code. Send the link instead.</p>}
          <p className="linkbox"><input readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} /></p>
          <p className="tiny">The link carries the patient's name, plan and a secret key. Share it privately, only with the patient.</p>
        </div>
      )}
    </details>
  );
}

/** Clinic-wide choices about patient data (Phase 6.4): how long records are kept, who patients contact, and the switch to real dates. */
function ClinicSettings({ state }: { state: AppState }) {
  const years = state.retentionYears ?? DEFAULT_RETENTION_YEARS;
  const setYears = (n: number) => { if (n >= 0 && n <= 30) setState({ ...getState(), retentionYears: n }); };
  const setClinic = (patch: Partial<NonNullable<AppState['clinic']>>) => { const st = getState(); setState({ ...st, clinic: { ...(st.clinic ?? {}), ...patch } }); };
  const setContact = (v: string) => { const st = getState(); const c = v.slice(0, 120); setState({ ...st, clinicContact: c, patients: st.patients.map((p) => ({ ...p, clinicContact: c || undefined })) }); };
  return (
    <div className="clinicsettings">
      <h3>Clinic settings</h3>
      <p className="tiny">Patient data and dates</p>
      <label className="menufield">Keep a finished patient's record for (years)
        <input type="number" min={0} max={30} value={years} onChange={(e) => setYears(Number(e.target.value))} aria-label="Retention years" />
      </label>
      <label className="menufield">Contact shown to patients (phone or email)
        <input maxLength={120} value={state.clinicContact ?? ''} onChange={(e) => setContact(e.target.value)} aria-label="Clinic contact" />
      </label>
      <h3 className="cs-sub">Overdue urgent flags</h3>
      <label className="menufield">Backup contact name (who covers an overdue SAFETY or URGENT flag)
        <input maxLength={80} value={state.clinic?.backupName ?? ''} onChange={(e) => setClinic({ backupName: e.target.value })} aria-label="Backup contact name" />
      </label>
      <label className="menufield">Backup contact phone
        <input maxLength={40} inputMode="tel" value={state.clinic?.backupPhone ?? ''} onChange={(e) => setClinic({ backupPhone: e.target.value })} aria-label="Backup contact phone" />
      </label>
      <h3 className="cs-sub">Working hours</h3>
      <label className="check"><input type="checkbox" checked={!!state.clinic?.hours} onChange={(e) => setClinic({ hours: e.target.checked ? { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5, 6] } : undefined })} /> <span>Count REVIEW and URGENT deadlines only in working hours <small>(SAFETY deadlines always run on the clock)</small></span></label>
      {state.clinic?.hours && (
        <div className="hoursrow">
          <label>From<input type="time" value={state.clinic.hours.start} onChange={(e) => setClinic({ hours: { ...state.clinic!.hours!, start: e.target.value } })} /></label>
          <label>To<input type="time" value={state.clinic.hours.end} onChange={(e) => setClinic({ hours: { ...state.clinic!.hours!, end: e.target.value } })} /></label>
          <div className="days" role="group" aria-label="Open days">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => {
            const on = state.clinic!.hours!.days.includes(i);
            return <button key={i} type="button" className={`daybtn ${on ? 'on' : ''}`} aria-pressed={on} aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]} onClick={() => setClinic({ hours: { ...state.clinic!.hours!, days: on ? state.clinic!.hours!.days.filter((x) => x !== i) : [...state.clinic!.hours!.days, i].sort() } })}>{d}</button>;
          })}</div>
          {!validHours(state.clinic.hours) && <p className="err">Closing time must be after opening time, and at least one day must be open. Until then deadlines run on the clock.</p>}
        </div>
      )}
      <p className="tiny">After this period a finished patient is flagged "review for erasure" under Past patients. Nothing is deleted by itself. Ask your lawyer what period applies to you: medical-record rules often say about 3 years, and some guidance says longer.</p>
      <p className="tiny">This is the live clinic. The demo has its own data and the six made-up patients; use Switch to demo at the top.</p>
    </div>
  );
}

/** Past patients: everyone whose treatment is complete. Records are kept for the retention period, then flagged for erasure. */
function PastPatients({ rows, years, today, onOpen }: { rows: Patient[]; years: number; today: string; onOpen: (id: string) => void }) {
  return (
    <section className="card past" data-testid="past-patients">
      <h2>Past patients</h2>
      <p className="tiny">Treatment complete. These records stay readable for {years} year(s) after completion, then are flagged for you to review and erase.</p>
      {rows.length === 0 ? <p>No past patients yet.</p> : (
        <ul className="audit">{rows.map((p) => {
          const end = retentionEnd(p, years);
          const due = retentionDue(p, years, today);
          return (
            <li key={p.id}>
              <b>{p.name}</b>, {p.age} · {getPack(p.packId).condition.en} · completed {p.completedAt?.slice(0, 10)}
              {end && <> · keep until {end}</>}
              {due && <span className="overdue"> Review for erasure</span>}
              {p.erasureRequestedAt && <span className="overdue"> Patient asked for erasure on {p.erasureRequestedAt.slice(0, 10)}</span>}
              {' '}<button className="btn" onClick={() => onOpen(p.id)}>Open</button>
            </li>
          );
        })}</ul>
      )}
    </section>
  );
}

/** Finish or reopen treatment, answer an erasure request, erase a patient (Phase 6.4). */
function LifecycleCard({ patient: p, now }: { patient: Patient; now: number }) {
  const st = getState();
  const years = st.retentionYears ?? DEFAULT_RETENTION_YEARS;
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [sure, setSure] = useState<'erase' | null>(null);
  const [typed, setTyped] = useState('');
  const [keepNote, setKeepNote] = useState('');
  const done = p.status === 'completed';
  const end = retentionEnd(p, years);
  const ctx = { nowMs: now, today: st.today };
  const change = (f: () => Patient) => { try { const next = f(); updatePatient(p.id, () => next); setNote(''); setErr(''); } catch (e) { setErr((e as Error).message); } };
  const erase = async (cloud: boolean, reason: string) => {
    try {
      if (cloud && p.syncKey && p.syncRole === 'physio' && getSyncStatus().enabled) await physioErasePatient(p.syncKey);
      setState(eraseLocal(getState(), p.id, reason, Date.now()));
    } catch (e) { setErr((e as Error).message); }
  };
  const keep = () => updatePatient(p.id, (q) => ({ ...q, erasureNote: (keepNote || `We must keep your record until ${end ?? 'the end of the required period'}, then we will erase it.`).slice(0, 300) }));
  return (
    <section className={`card lifecycle ${p.erasureRequestedAt ? 'asked' : ''}`} data-testid="lifecycle">
      <h3>Treatment status</h3>
      {done
        ? <p>Treatment complete since <b>{p.completedAt?.slice(0, 10)}</b>. {end && <>Keep the record until <b>{end}</b>{retentionDue(p, years, st.today) && <span className="overdue"> Review for erasure</span>}.</>}</p>
        : <p>Active.</p>}
      {p.erasureRequestedAt && (
        <div className="warnline" role="alert" data-testid="erasure-request">
          <b>The patient asked for their data to be erased on {p.erasureRequestedAt.slice(0, 10)}.</b>
          <p className="tiny">Under India's DPDP Act the patient may ask for erasure, but you may keep records you are required to keep (medical-record rules{end ? `; your retention date for this patient is ${end}` : ''}). Erase now, or tell the patient why you are keeping it.</p>
          <input aria-label="Message to the patient" placeholder="Message to the patient (optional)" value={keepNote} maxLength={300} onChange={(e) => setKeepNote(e.target.value)} />
          <button className="btn" onClick={keep}>Keep for now and tell the patient</button>
        </div>
      )}
      {p.erasureNote && <p className="tiny">Message shown to the patient: {p.erasureNote}</p>}
      <div className="fu">
        <input aria-label="Note for the audit log" placeholder={done ? 'Why is treatment starting again? (required)' : 'Why is treatment complete? (required)'} value={note} onChange={(e) => setNote(e.target.value)} />
        {done
          ? <button className="btn" onClick={() => change(() => reopenTreatment(p, note, ctx))}>Reopen treatment</button>
          : <button className="btn" onClick={() => change(() => completeTreatment(p, note, ctx))}>Mark treatment complete</button>}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="okline" role="status">{msg}</p>}
      {sure !== 'erase'
        ? <div className="btnrow"><button className="btn" data-testid="erase-start" onClick={() => setSure('erase')}>Erase this patient's data…</button></div>
        : (
          <div className="warnline" role="alert" data-testid="erase-confirm">
            <p>This permanently erases <b>{p.name}</b>: the plan, every check-in and the audit log, on this computer and in the cloud. It cannot be undone. A line with no personal data is kept in the erasure log. Type the patient's name to confirm.</p>
            <input aria-label="Type the patient's name" value={typed} onChange={(e) => setTyped(e.target.value)} />
            <div className="btnrow">
              <button className="btn primary" disabled={typed.trim().toLowerCase() !== p.name.trim().toLowerCase()} onClick={() => void erase(true, p.erasureRequestedAt ? 'patient request' : done ? 'retention period over' : 'physio decision')}>Erase now</button>
              <button className="btn" disabled={typed.trim().toLowerCase() !== p.name.trim().toLowerCase()} onClick={() => void erase(false, 'this device only')}>Erase on this computer only</button>
              <button className="btn" onClick={() => { setSure(null); setTyped(''); }}>Cancel</button>
            </div>
          </div>
        )}
    </section>
  );
}

function downloadAudit(p: Patient) {
  const blob = new Blob([auditCsv(p)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `audit-${p.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function PlanCard({ patient: p, pack, now, onApply, err, onAdjust }: { patient: Patient; pack: ProtocolPack; now: number; onApply: ApplyFn; err: string; onAdjust?: () => void }) {
  const st = getState();
  const exs = currentExercises(p, pack);
  const fu = currentFollowUp(p, pack, st.today);
  const swapped = Object.entries(p.plan.swaps);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="card plan" data-testid="plan">
      <div className="cardhead"><h3>Current plan</h3>{onAdjust && <button className="btn" onClick={onAdjust}>Adjust the treatment</button>}</div>
      <dl className="facts">
        <div><dt>Check-ins</dt><dd>{everyDays(fu.checkInEveryDays)}{p.plan.followUp?.until && <small> until {p.plan.followUp.until}</small>}</dd></div>
        <div><dt>Next review</dt><dd>{fu.nextReviewDate ?? 'Not set'}</dd></div>
        <div><dt>Progression</dt><dd>{p.plan.hold ? <><b className="holdtag">On hold since {p.plan.hold.at.slice(0, 10)}</b> <button className="linkbtn" onClick={() => onApply({ type: 'release-hold' })}>Remove hold</button></> : 'Not on hold'}</dd></div>
      </dl>
      <table className="extable"><thead><tr><th>Exercise</th><th>Dose</th><th>Video</th></tr></thead><tbody>
        {exs.map((id) => {
          const orig = swapped.find(([, v]) => v === id)?.[0];
          const ex = getExercise(id);
          return (
            <tr key={id}>
              <td>{exerciseName(id, 'en')}{orig && <><br /><small>Easier version of {exerciseName(orig, 'en')}</small> <button className="linkbtn" onClick={() => onApply({ type: 'restore-exercise', exerciseId: id })}>Restore</button></>}</td>
              <td>
                {(() => {
                  const d = p.plan.doses?.[id];
                  const n = p.plan.exerciseNotes?.[id];
                  return (
                    <>
                      <span className={d ? 'dose own' : 'dose'}>{d ? doseLine(p, id, 'en') : <small>{ex ? L(ex.dose.text, 'en') : '—'}</small>}</span>
                      {n && <small className="dosenote">Note for the patient: “{n.text}”</small>}
                      {(d || n) && <small className="doseby">Set by {(d ?? n)!.by} on {(d ?? n)!.at.slice(0, 10)}</small>}
                      {p.status !== 'completed' && editing !== id && <button className="linkbtn" onClick={() => setEditing(id)}>{d ? 'Edit dose' : 'Set dose'}</button>}
                    </>
                  );
                })()}
              </td>
              <td>{getDemo(id) ? <span className="demobadge" title="Patients can watch a demonstration of this exercise">Video</span> : <span className="demobadge none" title="No demonstration attached yet. Add one under More, Exercise videos.">No video</span>}</td>
            </tr>
          );
        })}
      </tbody></table>
      {editing && <DoseEditor key={editing} patient={p} pack={pack} now={now} exerciseId={editing} onClose={() => setEditing(null)} />}
      {err && <p className="err" role="alert">{err}</p>}
      {(p.plan.instructions ?? []).length > 0 && (
        <>
          <h4>Your own instructions</h4>
          <ul className="planlist">{(p.plan.instructions ?? []).map((x) => <li key={x.id}>{x.text}</li>)}</ul>
        </>
      )}
    </div>
  );
}

/** The physio's own dose and note for one exercise, for this patient. A reason is required and goes in the audit log. */
function DoseEditor({ patient: p, pack, now, exerciseId, onClose }: { patient: Patient; pack: ProtocolPack; now: number; exerciseId: string; onClose: () => void }) {
  const d = p.plan.doses?.[exerciseId];
  const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const [sets, setSets] = useState(num(d?.sets ?? getExercise(exerciseId)?.dose.sets));
  const [reps, setReps] = useState(num(d?.reps ?? getExercise(exerciseId)?.dose.reps));
  const [hold, setHold] = useState(num(d?.holdSec ?? getExercise(exerciseId)?.dose.holdSec));
  const [perDay, setPerDay] = useState(num(d?.perDay));
  const [forPatient, setForPatient] = useState(p.plan.exerciseNotes?.[exerciseId]?.text ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  const save = () => {
    try {
      updatePatient(p.id, (q) => applyManual(q, pack, { type: 'set-dose', exerciseId, sets: n(sets), reps: n(reps), holdSec: n(hold), perDay: n(perDay), patientNote: forPatient }, reason, { nowMs: now, today: getState().today }));
      onClose();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="doseeditor" data-testid="dose-editor">
      <h4>Dose for {exerciseName(exerciseId, 'en')}</h4>
      <div className="dosegrid">
        <label>Sets<input type="number" min={1} max={20} value={sets} onChange={(e) => setSets(e.target.value)} /></label>
        <label>Reps<input type="number" min={1} max={200} value={reps} onChange={(e) => setReps(e.target.value)} /></label>
        <label>Hold (s)<input type="number" min={1} max={600} value={hold} onChange={(e) => setHold(e.target.value)} /></label>
        <label>Times a day<input type="number" min={1} max={12} value={perDay} onChange={(e) => setPerDay(e.target.value)} /></label>
      </div>
      <label className="menufield" style={{ padding: 0 }}>Note for the patient (optional; they see it with this exercise)
        <input maxLength={300} value={forPatient} onChange={(e) => setForPatient(e.target.value)} placeholder="e.g. Keep your knee over your toes." />
      </label>
      <label className="menufield" style={{ padding: 0 }}>Reason for this change (required; saved in the audit log, not shown to the patient)
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="btnrow">
        <button className="btn primary" disabled={!reason.trim()} onClick={save}>Save and tell the patient</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
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
      <summary><b>Thresholds for this patient</b>&nbsp;<small>({p.plan.overrides.length} overridden)</small></summary>
      {p.plan.overrides.length > 0 && (
        <ul className="audit">{p.plan.overrides.map((o) => (
          <li key={o.id}>{o.label}: <s>{o.original}</s> <b>{o.value}</b> <Src s="PHYSIO_OVERRIDE" /> · {o.by}, {o.at.slice(0, 10)} · “{o.reason}” <button className="btn" onClick={() => onApply({ type: 'remove-override', id: o.id })}>Remove</button></li>))}</ul>
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

// ------------------------------------------------------------------ physio-initiated changes (Phase 5.4)
type AdjustKind = 'add' | 'remove' | 'easier' | 'hold' | 'phase' | 'custom' | 'uncustom';
function AdjustCard({ patient: p, pack, now, onClose }: { patient: Patient; pack: ProtocolPack; now: number; onClose: () => void }) {
  const st = getState();
  const [kind, setKind] = useState<AdjustKind>('add');
  const [ex, setEx] = useState('');
  const [text, setText] = useState('');
  const [toPhase, setToPhase] = useState('');
  const [forPatient, setForPatient] = useState('');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const cur = currentExercises(p, pack);
  const order = (id: string) => pack.phases.find((x) => x.id === id)?.order ?? 0;
  const gate = evaluateGate(p, pack, st.today);

  /** What the protocol would say about this move. Any warning needs a tick before the change can be made. */
  const warning = (): string | null => {
    if (kind !== 'phase' || !toPhase) return null;
    if (order(toPhase) < order(p.currentPhase)) return 'This moves the patient back to an earlier phase.';
    if (gate && gate.toPhase === toPhase) {
      const unmet = gate.criteria.filter((c) => !c.met);
      if (unmet.length) return `${unmet.length} gate criteri${unmet.length === 1 ? 'on is' : 'a are'} not met: ${unmet.map((c) => c.label.en).join('; ')}.`;
      if (p.plan.hold) return 'Progression is on hold.';
      return null;
    }
    return 'This skips a phase, so the protocol gate does not apply.';
  };
  const warn = warning();
  const ready = !!reason.trim() && (!warn || ack) && (kind === 'hold' || (kind === 'phase' ? !!toPhase : kind === 'custom' ? !!text.trim() : !!ex));

  const action = (): PlanAction => {
    if (kind === 'add') return { type: 'set-exercises', add: [ex] };
    if (kind === 'remove') return { type: 'set-exercises', remove: [ex] };
    if (kind === 'easier') return { type: 'regress-exercise', exerciseId: ex, patientNote: forPatient };
    if (kind === 'custom') return { type: 'add-instruction', text };
    if (kind === 'uncustom') return { type: 'remove-instruction', id: ex };
    if (kind === 'hold') return p.plan.hold ? { type: 'release-hold' } : { type: 'hold-progression' };
    return { type: 'move-phase', toPhase, note: reason };
  };
  const run = () => {
    try {
      updatePatient(p.id, (q) => applyManual(q, pack, action(), reason, { nowMs: now, today: st.today }));
      setErr(''); setDone('Done. The patient will see what changed on their screen. Your reason is saved in the audit log.');
      setEx(''); setText(''); setToPhase(''); setReason(''); setAck(false);
    } catch (e) { setErr((e as Error).message); setDone(''); }
  };
  return (
    <section className="card adjust" data-testid="adjust" aria-label="Adjust the treatment">
      <div className="cardhead"><h3>Adjust the treatment</h3><button type="button" className="iconbtn" aria-label="Close the form" onClick={onClose}>✕</button></div>
      <p className="tiny">Use this when you want to change the plan without waiting for a suggestion. You can go beyond the protocol. A reason is required for every change; it is saved in the audit log and the patient is told what changed.</p>
      <div className="fu">
        <select aria-label="What do you want to change" value={kind} onChange={(e) => { setKind(e.target.value as AdjustKind); setEx(''); setToPhase(''); setAck(false); setDone(''); setErr(''); }}>
          <option value="add">Add an exercise</option>
          <option value="remove">Remove an exercise</option>
          <option value="easier">Make an exercise easier</option>
          <option value="hold">{p.plan.hold ? 'Remove the hold on progression' : 'Put progression on hold'}</option>
          <option value="phase">Move to a phase</option>
          <option value="custom">Other: write your own instruction</option>
          {(p.plan.instructions ?? []).length > 0 && <option value="uncustom">Remove one of my own instructions</option>}
        </select>
        {kind === 'add' && (
          <select aria-label="Exercise to add" value={ex} onChange={(e) => setEx(e.target.value)}>
            <option value="">Choose an exercise…</option>
            {LIBRARY.filter((e) => !cur.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{e.name.en}</option>)}
          </select>
        )}
        {kind === 'remove' && (
          <select aria-label="Exercise to remove" value={ex} onChange={(e) => setEx(e.target.value)}>
            <option value="">Choose an exercise…</option>
            {cur.map((id) => <option key={id} value={id}>{exerciseName(id, 'en')}</option>)}
          </select>
        )}
        {kind === 'easier' && (
          <select aria-label="Exercise to make easier" value={ex} onChange={(e) => setEx(e.target.value)}>
            <option value="">Choose an exercise…</option>
            {cur.map((id) => { const to = getExercise(id)?.regressionId; return <option key={id} value={id} disabled={!to}>{exerciseName(id, 'en')}{to ? ` → ${exerciseName(to, 'en')}` : ' (no easier version yet: remove it and add another instead)'}</option>; })}
          </select>
        )}
        {kind === 'custom' && (
          <textarea aria-label="Your instruction for the patient" placeholder="e.g. Use a knee brace when walking outdoors. Avoid stairs until Friday." maxLength={400} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        )}
        {kind === 'uncustom' && (
          <select aria-label="Instruction to remove" value={ex} onChange={(e) => setEx(e.target.value)}>
            <option value="">Choose an instruction…</option>
            {(p.plan.instructions ?? []).map((x) => <option key={x.id} value={x.id}>{x.text.slice(0, 80)}</option>)}
          </select>
        )}
        {kind === 'phase' && (
          <select aria-label="Phase to move to" value={toPhase} onChange={(e) => { setToPhase(e.target.value); setAck(false); }}>
            <option value="">Choose a phase…</option>
            {pack.phases.filter((x) => x.id !== p.currentPhase).map((x) => <option key={x.id} value={x.id}>{x.name.en}</option>)}
          </select>
        )}
      </div>
      {kind === 'easier' && (
        <label className="menufield" style={{ padding: 0 }}>Note for the patient (optional; they see it with the easier exercise, your reason stays private)
          <input aria-label="Note for the patient" maxLength={300} placeholder="e.g. Only bend as far as is comfortable." value={forPatient} onChange={(e) => setForPatient(e.target.value)} />
        </label>
      )}
      {kind === 'custom' && <p className="tiny">The patient sees this text on their home screen and as a "what changed" notice. Your reason is not shown to them. It goes in the audit log.</p>}
      {kind === 'phase' && <p className="tiny">Moving phase resets this patient's exercise swaps and additions to the new phase's list.</p>}
      {warn && (
        <label className="check warnline" data-testid="adjust-warning"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} aria-label="I understand this overrides the protocol" /> {warn} I understand this overrides the protocol.</label>
      )}
      <div className="fu">
        <input aria-label="Reason for this change" placeholder="Reason for this change (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn primary" disabled={!ready} onClick={run}>Apply and tell the patient</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {done && <p className="okline" role="status" data-testid="adjust-done">{done}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ expected-recovery curves (Phase 7.1)
function CurveNote({ c }: { c: ProtocolPack['expectedCurves'][number] }) {
  const o = curveOrigin(c);
  const why = c.source.replace(/^PHYSIO_(CLINIC|OVERRIDE): /, '');
  if (o === 'placeholder') return <p className="tiny curvenote" data-testid="curve-note" data-origin="placeholder">{DEFAULT_NOTE}.</p>;
  if (o === 'clinic') return <p className="tiny curvenote" data-testid="curve-note" data-origin="clinic">Clinic default for every patient with this condition. Reason: {why}</p>;
  if (o === 'patient') return <p className="tiny curvenote" data-testid="curve-note" data-origin="patient">Set for this patient. Reason: {why}</p>;
  return <p className="tiny curvenote" data-testid="curve-note" data-origin="protocol">Source: {srcText(c.source)}</p>;
}

function CurvesCard({ patient: p, pack, now }: { patient: Patient; pack: ProtocolPack; now: number }) {
  const st = getState();
  const eff = effectivePack(p, pack);
  const [editing, setEditing] = useState<string | null>(null);
  const [rows, setRows] = useState<[string, string][]>([]);
  const [tol, setTol] = useState('');
  const [scope, setScope] = useState<'patient' | 'clinic'>('patient');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const same = st.patients.filter((x) => x.packId === pack.id).length;
  const mine = (m: string) => (p.plan.curveOverrides ?? []).some((x) => x.measure === m);
  const clinic = (m: string) => (st.clinicCurves?.[pack.id] ?? []).some((x) => x.measure === m);
  if (eff.expectedCurves.length === 0) return null;
  const edit = (m: string) => {
    const c = eff.expectedCurves.find((x) => x.measure === m)!;
    setEditing(m); setRows(c.points.map(([w, v]) => [String(w), String(v)])); setTol(String(c.tolerance)); setScope('patient'); setReason(''); setErr(''); setDone('');
  };
  const parsed = (): [number, number][] => rows.map(([w, v]) => [Number(w), Number(v)]);
  const fail = (e: unknown) => { setErr((e as Error).message); setDone(''); };
  const ok = (msg: string) => { setErr(''); setDone(msg); setEditing(null); setReason(''); };
  const save = () => {
    try {
      const measure = editing!;
      if (scope === 'clinic') setClinicCurve(pack.id, measure, parsed(), Number(tol), reason);
      else updatePatient(p.id, (q) => applyAction(q, pack, { type: 'set-curve', measure, points: parsed(), tolerance: Number(tol), reason }, { nowMs: now, today: st.today }));
      ok(scope === 'clinic' ? `Saved for all ${same} patient${same === 1 ? '' : 's'} with this condition. It is in each patient's audit log.` : 'Saved for this patient. It is in the audit log.');
    } catch (e) { fail(e); }
  };
  const revert = (m: string, which: 'patient' | 'clinic') => {
    try {
      if (which === 'clinic') removeClinicCurve(pack.id, m, reason);
      else updatePatient(p.id, (q) => applyAction(q, pack, { type: 'remove-curve', measure: m, reason }, { nowMs: now, today: st.today }));
      ok(which === 'clinic' ? 'Clinic default removed.' : "This patient's own curve removed.");
    } catch (e) { fail(e); }
  };
  return (
    <details className="card curves" data-testid="curves">
      <summary><b>Expected recovery curves</b></summary>
      <p className="tiny">The shaded band on the charts is built from these. Replace a placeholder with your own protocol's numbers. A reason is required and is saved in the audit log.</p>
      {eff.expectedCurves.map((c) => {
        const m = pack.measures.find((x) => x.id === c.measure);
        return (
          <div key={c.measure} className="curverow" data-measure={c.measure}>
            <b>{m ? L(m.short ?? m.label, 'en') : c.measure}</b> <small>({c.better} is better, allowed difference {c.tolerance})</small>
            <CurveNote c={c} />
            <div className="btnrow">
              <button className="btn" onClick={() => edit(c.measure)}>Edit</button>
              {mine(c.measure) && editing !== c.measure && <button className="btn" onClick={() => revert(c.measure, 'patient')} disabled={!reason.trim()} title="Write a reason first">Remove this patient's own curve</button>}
              {clinic(c.measure) && editing !== c.measure && <button className="btn" onClick={() => revert(c.measure, 'clinic')} disabled={!reason.trim()} title="Write a reason first">Remove the clinic default</button>}
            </div>
            {editing === c.measure && (
              <div className="curveedit" data-testid="curve-editor">
                <table className="gate"><thead><tr><th>Week since {pack.anchorLabel.en}</th><th>Expected value</th><th /></tr></thead><tbody>
                  {rows.map(([w, v], i) => (
                    <tr key={i}>
                      <td><input type="number" aria-label={`Week ${i + 1}`} value={w} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} /></td>
                      <td><input type="number" aria-label={`Value ${i + 1}`} value={v} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} /></td>
                      <td><button className="btn" aria-label={`Remove point ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
                    </tr>))}
                </tbody></table>
                <div className="btnrow"><button className="btn" onClick={() => setRows([...rows, ['', '']])}>+ Add a point</button></div>
                <label>Allowed difference either side <input type="number" aria-label="Allowed difference" value={tol} onChange={(e) => setTol(e.target.value)} /></label>
                <fieldset className="scope"><legend>Use this curve for</legend>
                  <label><input type="radio" name="scope" checked={scope === 'patient'} onChange={() => setScope('patient')} aria-label="This patient only" /> This patient only</label>
                  <label><input type="radio" name="scope" checked={scope === 'clinic'} onChange={() => setScope('clinic')} aria-label="All patients with this condition" /> All {same} patient{same === 1 ? '' : 's'} with {pack.condition.en} (a patient's own curve still wins)</label>
                </fieldset>
              </div>
            )}
          </div>
        );
      })}
      <div className="fu">
        <input aria-label="Reason for the curve change" placeholder="Reason (required): where these numbers come from" value={reason} onChange={(e) => setReason(e.target.value)} />
        {editing && <><button className="btn primary" onClick={save} disabled={!reason.trim()}>Save curve</button><button className="btn" onClick={() => { setEditing(null); setErr(''); }}>Cancel</button></>}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {done && <p className="okline" role="status" data-testid="curves-done">{done}</p>}
    </details>
  );
}
