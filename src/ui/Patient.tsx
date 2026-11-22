import { safetyLevel, hasEmergencySign } from '../safety';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGS, LANG_NAME } from '../types';
import type { Lang, Patient, ProtocolPack, Value } from '../types';
import { L, t } from '../i18n';
import { getPack } from '../engine/packs';
import { addDays, diffDays } from '../engine/dates';
import { careStart, triage } from '../engine/triage';
import { clockMs, getState, updatePatient } from '../store';
import {
  activePrecautions, applyVoice, draftFromEntry, dueState, isComplete, newDraft, saveCheckIn, saveQuestionnaire, saveWeekly, toDaily,
  unansweredSigns, weeklyComplete, weeklyMeasures, type Draft,
  allExercisesDone, canMarkNoWarnings, markAllExercisesDone, markNoWarnings, noWarningsAnswered,
} from '../checkin';
import { listen, parseVoice, voiceSupported } from '../voice/parser';
import { speak, speakSupported } from '../voice/speak';
import { currentExercises } from '../engine/plan';
import { exerciseName, getExercise } from '../exercises/library';
import { DemoButton } from './Demo';
import { AngleTool } from './AngleTool';
import { noticeText } from '../notices';
import { GuidedSession } from './GuidedSession';
import { FormRequestScreen } from './FormRequest';
import { fs } from '../forms/strings';
import { unreadReplies } from '../forms/model';
import { prefillFromSessions } from '../session/engine';
import { ss } from '../session/strings';

const FACES = ['😀', '🙂', '🙂', '😐', '😐', '😕', '😟', '😣', '😣', '😫', '😭'];
const SKIP_EMOJI: Record<string, string> = { pain: '😣', fear: '😨', time: '⏰', access: '🚫', understand: '❓' };
const EXS = [['all', '✅'], ['some', '🟡'], ['none', '❌']] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;

type Screen = 'home' | 'checkin' | 'weekly' | 'monthly' | 'done' | 'session' | 'forms';

export function PatientView({ patient }: { patient: Patient }) {
  const pack = getPack(patient.packId);
  const lang = patient.language;
  const T = (k: string, p?: Record<string, string | number>) => t(lang, k, p);
  const [screen, setScreen] = useState<Screen>('home');
  const [formEx, setFormEx] = useState<string | null>(null);
  const setLang = (l: Lang) => updatePatient(patient.id, (p) => ({ ...p, language: l }));
  return (
    <div className="app" lang={lang}>
      <header className="top">
        <h1>{T('appName')}</h1>
        <button className="lang" onClick={() => setLang(LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length])} aria-label="Language">{LANG_NAME[LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]]}</button>
      </header>
      {screen === 'home' && <Home patient={patient} pack={pack} lang={lang} go={(sc) => { if (sc === 'forms') setFormEx(null); setScreen(sc); }} />}
      {screen === 'session' && <GuidedSession key={patient.id} patient={patient} pack={pack} lang={lang} onExit={(toCheckIn) => setScreen(toCheckIn ? 'checkin' : 'home')} onNeedHelp={(id) => { setFormEx(id); setScreen('forms'); }} />}
      {screen === 'forms' && <FormRequestScreen key={patient.id + (formEx ?? '')} patient={patient} pack={pack} lang={lang} exerciseId={formEx} onBack={() => { setFormEx(null); setScreen('home'); }} />}
      {screen === 'checkin' && <CheckIn key={patient.id} patient={patient} pack={pack} lang={lang} onDone={() => setScreen('done')} onBack={() => setScreen('home')} />}
      {screen === 'weekly' && <Weekly patient={patient} pack={pack} lang={lang} onDone={() => setScreen('home')} onBack={() => setScreen('home')} />}
      {screen === 'monthly' && <Monthly patient={patient} pack={pack} lang={lang} onDone={() => setScreen('home')} onBack={() => setScreen('home')} />}
      {screen === 'done' && <Done patient={patient} pack={pack} lang={lang} onHome={() => setScreen('home')} />}
      <p className="notice">{T('notice')}</p>
    </div>
  );
}

function SafetyBanner({ lang, emergency }: { lang: Lang; emergency: boolean }) {
  const k = emergency ? 'safety' : 'safetyToday';
  return (
    <div className={`safetybanner${emergency ? '' : ' sameday'}`} role="alert" data-level={emergency ? 'emergency' : 'same-day'}>
      <strong>⚠️ {t(lang, `${k}Title`)}</strong>
      <p>{t(lang, `${k}Body`)}</p>
      <ReadAloud key={lang} text={`${t(lang, `${k}Title`)}. ${t(lang, `${k}Body`)}`} lang={lang} />
    </div>
  );
}

/** Shown on every answering screen while a carer is answering (Phase 5.3). */
function CaregiverBanner({ patient, lang }: { patient: Patient; lang: Lang }) {
  if (!patient.caregiverMode) return null;
  return <p className="caregiver" role="note" data-testid="caregiver-banner">🤝 {t(lang, 'caregiverBanner', { name: patient.name })}</p>;
}
const answerer = (p: Patient) => (p.caregiverMode ? ('caregiver' as const) : ('patient' as const));

// ------------------------------------------------------------------ home
function Home({ patient, pack, lang, go }: { patient: Patient; pack: ProtocolPack; lang: Lang; go: (s: Screen) => void }) {
  const T = (k: string, p?: Record<string, string | number>) => t(lang, k, p);
  const s = getState();
  const today = s.today;
  const doneToday = patient.daily.some((d) => d.date === today);
  const day = diffDays(today, patient.anchorDate);
  const phase = pack.phases.find((x) => x.id === patient.currentPhase)!;
  const tri = useMemo(() => triage(patient, pack), [patient, pack]);
  const exs = currentExercises(patient, pack);
  const due = dueState(pack, patient, today, diffDays);
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const sym = { all: ['ok', '✓'], some: ['part', '½'], none: ['miss', '✕'] } as const;
  return (
    <main>
      {tri.tier === 'SAFETY' && <SafetyBanner lang={lang} emergency={safetyLevel(patient) === 'emergency'} />}
      <div>
        <div className="hello">{T('hello')}, {patient.name}</div>
        <p className="sub">{T('dayAfter', { n: day })} · {L(phase.name, lang)}</p>
      </div>
      <Notices patient={patient} pack={pack} lang={lang} />
      <label className="caregivertoggle">
        <input type="checkbox" checked={!!patient.caregiverMode} aria-label={T('caregiverToggle', { name: patient.name })} onChange={(e) => updatePatient(patient.id, (x) => ({ ...x, caregiverMode: e.target.checked }))} />
        <span><b>{T('caregiverToggle', { name: patient.name })}</b><small>{T('caregiverHint')}</small></span>
      </label>
      {doneToday && <p className="okline">{T('doneToday')}</p>}
      {exs.length > 0 && <button className="big secondary" data-testid="start-session" onClick={() => go('session')}>🏃 {ss(lang, 'sStart')}</button>}
      {exs.length > 0 && <button className="big secondary" data-testid="open-forms" onClick={() => go('forms')}>📹 {(patient.formRequests ?? []).length ? fs(lang, 'fMine') : fs(lang, 'fHomeBtn')}{unreadReplies(patient).length > 0 && <span className="newtag">{fs(lang, 'fNew')}</span>}</button>}
      <button className="big primary" onClick={() => go('checkin')}>{doneToday ? T('editToday') : T('startCheckIn')}</button>
      <div>
        <h3>{T('last7')}</h3>
        <div className="dots">
          {last7.map((d) => {
            const e = patient.daily.find((x) => x.date === d);
            const before = !e && d < careStart(patient); // before the patient joined: not a missed day
            const [cls, ch] = e ? sym[e.exercises] : d === today || before ? ['', '·'] : ['miss', '✕'];
            return <span key={d} className={`dot ${cls}`} role="img" aria-label={e ? T(e.exercises === 'all' ? 'dayOk' : e.exercises === 'some' ? 'dayPart' : 'dayMiss') : d === today ? T('dayToday') : before ? T('dayBefore') : T('dayMiss')}>{ch}</span>;
          })}
        </div>
      </div>
      {(patient.plan.instructions ?? []).length > 0 && (
        <div className="physioins" data-testid="instructions">
          <h3>{T('yourPhysioSays')}</h3>
          <ul className="exlist">{(patient.plan.instructions ?? []).map((x) => <li key={x.id}>{x.text}</li>)}</ul>
        </div>
      )}
      {exs.length > 0 && (
        <div>
          <h3>{T('yourExercises')}</h3>
          <ul className="exlist">{exs.map((id) => <li key={id} className="exitem"><span>{exerciseName(id, lang)}</span><DemoButton patient={patient} exerciseId={id} lang={lang} compact /></li>)}</ul>
        </div>
      )}
      <div className="homecards">
        {due.weeklyDue || due.weeklyNextIn >= 0 ? (
          <button className={`homecard ${due.weeklyDue ? 'due' : ''}`} onClick={() => go('weekly')} disabled={weeklyMeasures(pack, patient).length === 0}>
            <span className="emoji">📏</span><b>{T('weeklyTitle')}</b>
            <small>{weeklyMeasures(pack, patient).length === 0 ? T('weeklyNone') : due.weeklyDue ? T('dueNow') : T('nextIn', { n: due.weeklyNextIn })}</small>
          </button>
        ) : null}
        <button className={`homecard ${due.questionnaireDue ? 'due' : ''}`} onClick={() => go('monthly')} disabled={pack.questionnaires.length === 0}>
          <span className="emoji">📝</span><b>{T('monthlyTitle')}</b>
          <small>{pack.questionnaires.length === 0 ? T('noQuestionnaire') : due.questionnaireDue ? T('dueNow') : T('nextIn', { n: due.questionnaireNextIn })}</small>
        </button>
      </div>
      <p className="disclaimer">{T('noticeLong')}</p>
    </main>
  );
}

function ReadAloud({ text, lang }: { text: string; lang: Lang }) {
  const [on, setOn] = useState(false);
  const stopRef = useRef<null | (() => void)>(null);
  useEffect(() => () => { stopRef.current?.(); }, []); // leaving the question stops the voice
  if (!speakSupported(lang)) return null;
  return (
    <button className="readaloud" aria-pressed={on} onClick={() => {
      if (on) { stopRef.current?.(); setOn(false); return; }
      setOn(true);
      stopRef.current = speak(text, lang, () => setOn(false));
    }}>🔊 {t(lang, on ? 'stopReading' : 'readAloud')}</button>
  );
}

/** What the physio changed, in the patient's language, with a read-aloud button (Phase 2.6). */
function Notices({ patient, pack, lang }: { patient: Patient; pack: ProtocolPack; lang: Lang }) {
  const unseen = patient.notices.filter((n) => !n.seen);
  if (!unseen.length) return null;
  const mark = () => updatePatient(patient.id, (p) => ({ ...p, notices: p.notices.map((n) => ({ ...n, seen: true })) }));
  return (
    <div className="notice-card" role="status" data-testid="physio-notice">
      <strong>🩺 {t(lang, 'noticeTitle')}</strong>
      {unseen.map((n) => { const text = noticeText(n, lang, pack); return <p key={n.id} className="noticeline">{text} <ReadAloud text={text} lang={lang} /></p>; })}
      <button className="btn" onClick={mark}>{t(lang, 'gotIt')}</button>
    </div>
  );
}

// ------------------------------------------------------------------ daily check-in
type Step = string; // "m:<measureId>" | exercises | why | hard | precautions | warnings | review

function Progress({ i, n }: { i: number; n: number }) {
  return <div className="progress" aria-hidden>{Array.from({ length: n }, (_, k) => <span key={k} className={k <= i ? 'on' : ''} />)}</div>;
}

function CheckIn({ patient, pack, lang, onDone, onBack }: { patient: Patient; pack: ProtocolPack; lang: Lang; onDone: () => void; onBack: () => void }) {
  const T = (k: string, p?: Record<string, string | number>) => t(lang, k, p);
  const s = getState();
  const existing = patient.daily.find((d) => d.date === s.today);
  const [draft, setDraft] = useState<Draft>(() => (existing ? draftFromEntry(pack, patient, existing) : prefillFromSessions(newDraft(pack, patient), patient, s.today)));
  const [step, setStep] = useState<Step>(existing ? 'review' : `m:${pack.checkIn.dailyMeasures[0]}`);
  const [fromReview, setFromReview] = useState(!!existing);
  const [listening, setListening] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState('');
  const [typed, setTyped] = useState('');
  const stop = useRef<null | (() => void)>(null);
  const R = (text: string) => <ReadAloud key={`${lang}|${text}`} text={text} lang={lang} />;
  const precs = activePrecautions(pack, patient);
  const exIds = Object.keys(draft.results);
  const hasList = exIds.length > 0;

  const order: Step[] = useMemo(() => [
    ...pack.checkIn.dailyMeasures.map((m) => `m:${m}`), 'exercises', ...(!hasList && draft.exercises && draft.exercises !== 'all' ? ['why'] : []), 'hard',
    ...(precs.length ? ['precautions'] : []), 'warnings', 'review',
  ], [pack, draft.exercises, precs.length]);
  const idx = Math.max(0, order.indexOf(step));
  const next = (cur: Step, d: Draft = draft) => {
    if (fromReview && cur !== 'warnings') { setStep('review'); return; }
    const o = [
      ...pack.checkIn.dailyMeasures.map((m) => `m:${m}`), 'exercises', ...(!hasList && d.exercises && d.exercises !== 'all' ? ['why'] : []), 'hard',
      ...(precs.length ? ['precautions'] : []), 'warnings', 'review',
    ];
    setStep(o[Math.min(o.indexOf(cur) + 1, o.length - 1)]);
  };
  const edit = (to: Step) => { setFromReview(true); setStep(to); };
  const set = (patch: Partial<Draft>, cur: Step, advance = true) => {
    const d = { ...draft, ...patch };
    setDraft(d);
    if (advance) next(cur, d);
  };

  const applyText = (text: string) => {
    const v = parseVoice(text, pack, currentExercises(patient, pack));
    setDraft((d) => applyVoice(d, v, pack, text));
    setVoiceMsg('');
    setFromReview(false);
    setStep('warnings'); // always: tap-only Yes/No for every sign before review
  };
  const startVoice = () => {
    setVoiceMsg('');
    setListening(true);
    let got = '';
    stop.current = listen(lang, (txt) => { got = txt; }, (err) => {
      setListening(false);
      if (got) applyText(got); else setVoiceMsg(err ? T('voiceError') : T('voiceError'));
    });
  };

  const save = () => {
    const entry = toDaily(draft, patient, s.today, { recordedAt: clockMs(s), answeredBy: answerer(patient) });
    updatePatient(patient.id, (p) => saveCheckIn(p, entry));
    onDone();
  };
  const sign = (id: string) => pack.warningSigns.find((x) => x.id === id)!;
  const unanswered = unansweredSigns(draft);
  const measure = (id: string) => pack.measures.find((m) => m.id === id)!;

  const reviewRows: { label: string; value: string; step: Step }[] = [
    ...pack.checkIn.dailyMeasures.map((id) => {
      const m = measure(id);
      const v = draft.values[id];
      const shown = v === null ? '—' : m.options ? L(m.options.find((o) => o.id === v)?.label, lang) : m.scale ? `${FACES[Number(v)] ?? ''} ${v}/10` : String(v);
      return { label: L(m.label, lang), value: shown, step: `m:${id}` };
    }),
    ...(hasList
      ? exIds.map((id) => { const r = draft.results[id]; return { label: exerciseName(id, lang), value: r.done === null ? '—' : r.done ? `✓ ${T('exDone')}` : `✕ ${r.reason ? T(`skip_${r.reason}`) : T('exCouldnt')}`, step: 'exercises' }; })
      : [
        { label: T('exercises'), value: draft.exercises ? T(`ex_${draft.exercises}`) : '—', step: 'exercises' },
        ...(draft.exercises && draft.exercises !== 'all' ? [{ label: T('reason'), value: draft.skipReason ? T(`skip_${draft.skipReason}`) : '—', step: 'why' }] : []),
      ]),
    { label: T('hardest'), value: draft.hardMovement === null ? '—' : draft.hardMovement === 'none' ? T('hm_none') : exerciseName(draft.hardMovement, lang), step: 'hard' },
    ...(precs.length ? [{ label: T('q_precautions'), value: Object.values(draft.precautionBreaches).some((v) => v === null) ? '—' : precs.filter((x) => draft.precautionBreaches[x.id]).map((x) => L(x.label, lang)).join(', ') || T('none'), step: 'precautions' }] : []),
    { label: T('warnings'), value: unanswered.length ? '—' : pack.warningSigns.filter((x) => draft.warnings[x.id]).map((x) => L(x.label, lang)).join(', ') || T('none'), step: 'warnings' },
  ];

  const yn = (val: boolean | null, sug: boolean | undefined, setVal: (v: boolean) => void, label: string) => (
    <div className="yn">
      <button className={`${val === false ? 'sel no' : ''} ${val === null && sug === false ? 'sug' : ''}`} aria-pressed={val === false} aria-label={`${label}: ${T('no')}`} onClick={() => setVal(false)}>{T('no')}</button>
      <button className={`${val === true ? 'sel yes' : ''} ${val === null && sug === true ? 'sug' : ''}`} aria-pressed={val === true} aria-label={`${label}: ${T('yes')}`} onClick={() => setVal(true)}>{T('yes')}</button>
    </div>
  );

  return (
    <>
      <Progress i={idx} n={order.length} />
      <CaregiverBanner patient={patient} lang={lang} />
      {listening && <div className="voice" role="status">🎙️ {T('listening')}<br /><small>{L(pack.checkIn.voiceExample, lang)}</small></div>}
      <main>
        <button className="back" onClick={() => { stop.current?.(); (fromReview && step !== 'review') ? setStep('review') : idx === 0 || step === 'review' ? onBack() : setStep(order[idx - 1]); }}>← {T('back')}</button>

        {step.startsWith('m:') && (() => {
          const m = measure(step.slice(2));
          const v = draft.values[m.id];
          return (
            <>
              <h2>{L(m.question, lang)}</h2>
              {R(m.scale ? `${L(m.question, lang)}. ${T('painNone')}: ${m.scale.min}. ${T('painWorst')}: ${m.scale.max}.` : `${L(m.question, lang)}. ${(m.options ?? []).map((o) => L(o.label, lang)).join('. ')}`)}
              {m.scale && (
                <>
                  <div className="faces">{Array.from({ length: m.scale.max - m.scale.min + 1 }, (_, k) => k + m.scale!.min).map((n) => (
                    <button key={n} className={`face ${v === n ? 'sel' : ''}`} aria-pressed={v === n} aria-label={T('faceLabel', { n })} onClick={() => set({ values: { ...draft.values, [m.id]: n } }, step)}>
                      <span className="emoji">{FACES[n]}</span><b>{n}</b>
                    </button>))}</div>
                  <p className="scale"><span>{T('painNone')}</span><span>{T('painWorst')}</span></p>
                </>
              )}
              {m.options && (
                <div className="stack">{m.options.map((o) => (
                  <button key={o.id} className={`choice ${v === o.id ? 'sel' : ''}`} aria-pressed={v === o.id} onClick={() => set({ values: { ...draft.values, [m.id]: o.id } }, step)}>{L(o.label, lang)}</button>))}</div>
              )}
              {idx === 0 && !fromReview && (
                voiceSupported() ? (
                  <button className="big secondary" onClick={startVoice}>🎙️ {T('speak')}</button>
                ) : (
                  <div className="card">
                    <p className="hint">{T('voiceUnsupported')}<br />{L(pack.checkIn.voiceExample, lang)}</p>
                    <textarea className="vtext" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={T('speak')} />
                    <button className="big secondary" disabled={!typed.trim()} onClick={() => applyText(typed)}>{T('speak')}</button>
                  </div>
                )
              )}
              {voiceMsg && <p className="hint">{voiceMsg}</p>}
            </>
          );
        })()}

        {step === 'exercises' && hasList && (
          <>
            <h2>{T('exTodayTitle')}</h2>
            {R(`${T('exTodayTitle')}. ${exIds.map((id) => exerciseName(id, lang)).join('. ')}`)}
            <p className="sub">{T('exTodaySub')}</p>
            <button type="button" className={`big secondary quickall ${allExercisesDone(draft) ? 'sel' : ''}`} data-testid="did-all" aria-pressed={allExercisesDone(draft)} onClick={() => setDraft(markAllExercisesDone(draft))}>✓ {T('exAllDone')}</button>
            <div className="excards">{exIds.map((id) => {
              const ex = getExercise(id);
              const r = draft.results[id];
              const setR = (v: { done: boolean | null; reason: string | null }) => setDraft({ ...draft, results: { ...draft.results, [id]: v } });
              return (
                <div className="excard" key={id} data-ex={id}>
                  <div className="exhead">
                    {ex && <img src={ex.picture} alt="" width={64} height={64} />}
                    <div><b>{exerciseName(id, lang)}</b>{ex && <small>{T('exDose')}: {L(ex.dose.text, lang)}</small>}</div>
                  </div>
                  <DemoButton patient={patient} exerciseId={id} lang={lang} />
                  <div className="yn">
                    <button className={r.done === true ? 'sel yes' : ''} aria-pressed={r.done === true} onClick={() => setR({ done: true, reason: null })}>✓ {T('exDone')}</button>
                    <button className={r.done === false ? 'sel no' : ''} aria-pressed={r.done === false} onClick={() => setR({ done: false, reason: r.reason })}>✕ {T('exCouldnt')}</button>
                  </div>
                  {r.done === false && (
                    <div className="why">
                      <p>{T('exWhy')}</p>
                      <div className="grid2">{pack.checkIn.skipReasons.map((k) => (
                        <button key={k} className={`tile ${r.reason === k ? 'sel' : ''}`} aria-pressed={r.reason === k} onClick={() => setR({ done: false, reason: k })}><span className="emoji">{SKIP_EMOJI[k]}</span><span>{T(`skip_${k}`)}</span></button>))}</div>
                    </div>
                  )}
                </div>
              );
            })}</div>
            <button className="big primary" disabled={exIds.some((id) => draft.results[id].done === null || (draft.results[id].done === false && draft.results[id].reason === null))} onClick={() => next('exercises')}>{T('next')}</button>
          </>
        )}

        {step === 'exercises' && !hasList && (
          <>
            <h2>{T('q_exercises')}</h2>
            {R(`${T('q_exercises')} ${EXS.map(([id]) => T(`ex_${id}`)).join('. ')}`)}
            <p className="sub">{T('sessionsToday', { n: patient.sessionsPrescribedPerDay })}</p>
            <div className="stack">{EXS.map(([id, e]) => (
              <button key={id} className={`choice ${draft.exercises === id ? 'sel' : ''}`} aria-pressed={draft.exercises === id} onClick={() => set({ exercises: id, ...(id === 'all' ? { skipReason: null } : {}) }, 'exercises')}><span className="emoji">{e}</span>{T(`ex_${id}`)}</button>))}</div>
          </>
        )}

        {step === 'why' && (
          <>
            <h2>{T('q_why')}</h2>
            {R(`${T('q_why')} ${pack.checkIn.skipReasons.map((r) => T(`skip_${r}`)).join('. ')}`)}
            <div className="grid2">{pack.checkIn.skipReasons.map((r) => (
              <button key={r} className={`tile ${draft.skipReason === r ? 'sel' : ''}`} aria-pressed={draft.skipReason === r} onClick={() => set({ skipReason: r }, 'why')}><span className="emoji">{SKIP_EMOJI[r]}</span><span>{T(`skip_${r}`)}</span></button>))}</div>
          </>
        )}

        {step === 'hard' && (
          <>
            <h2>{T('q_hard')}</h2>
            {R(`${T('q_hard')} ${[...exIds.map((id) => exerciseName(id, lang)), T('hm_none')].join('. ')}`)}
            <div className="grid2">
              {[...exIds.map((id) => ({ id, label: exerciseName(id, lang) })), { id: 'none', label: T('hm_none') }].map((h) => (
                <button key={h.id} className={`tile ${draft.hardMovement === h.id ? 'sel' : ''}`} aria-pressed={draft.hardMovement === h.id} onClick={() => set({ hardMovement: h.id }, 'hard')}><span>{h.label}</span></button>))}
            </div>
          </>
        )}

        {step === 'precautions' && (
          <>
            <h2>{T('q_precautions')}</h2>
            {R(`${T('q_precautions')} ${precs.map((x) => L(x.question, lang)).join(' ')}`)}
            <div className="safety">{precs.map((x) => (
              <div className="srow" key={x.id}><span>{L(x.question, lang)}</span>
                {yn(draft.precautionBreaches[x.id], undefined, (v) => setDraft({ ...draft, precautionBreaches: { ...draft.precautionBreaches, [x.id]: v } }), L(x.label, lang))}</div>))}</div>
            <button className="big primary" disabled={Object.values(draft.precautionBreaches).some((v) => v === null)} onClick={() => next('precautions')}>{T('next')}</button>
          </>
        )}

        {step === 'warnings' && (
          <>
            <h2>{T('q_safety')}</h2>
            {R(`${T('q_safety')} ${pack.warningSigns.map((w) => L(w.label, lang)).join('. ')}`)}
            <p className="hint">{T('warnStepIntro')}</p>
            {canMarkNoWarnings(draft) && <button type="button" className={`big secondary quickall ${noWarningsAnswered(draft) ? 'sel' : ''}`} data-testid="none-of-these" aria-pressed={noWarningsAnswered(draft)} onClick={() => setDraft(markNoWarnings(draft))}>{T('noneOfThese')}</button>}
            <div className="safety">{pack.warningSigns.map((w) => (
              <div className="srow" key={w.id}>
                <span>{L(w.label, lang)}{draft.warnings[w.id] === null && draft.suggested[w.id] !== undefined && <><br /><span className="sugnote">{T('suggestedByVoice')}</span></>}</span>
                {yn(draft.warnings[w.id], draft.suggested[w.id], (v) => setDraft({ ...draft, warnings: { ...draft.warnings, [w.id]: v } }), L(w.label, lang))}
              </div>))}</div>
            <button className="big primary" disabled={unanswered.length > 0} onClick={() => { setFromReview(false); setStep('review'); }}>{unanswered.length ? T('answerEverySign') : T('next')}</button>
          </>
        )}

        {step === 'review' && (
          <>
            <h2>{T('q_review')}</h2>
            {R(`${T('q_review')} ${reviewRows.map((r) => `${r.label}: ${r.value}`).join('. ')}`)}
            {draft.heard && <p className="hint">{T('voiceHeard')} “{draft.heard}”</p>}
            <ul className="review">{reviewRows.map((r) => (
              <li key={r.step}><div><small>{r.label}</small><strong>{r.value}</strong></div><button onClick={() => edit(r.step)}>{T('change')}</button></li>))}</ul>
            {draft.warnings && pack.warningSigns.some((w) => draft.warnings[w.id] && w.tier === 'SAFETY') && <SafetyBanner lang={lang} emergency={hasEmergencySign(draft.warnings)} />}
            <button className="big primary" disabled={!isComplete(draft)} onClick={save}>{isComplete(draft) ? T('save') : T('answerEverySign')}</button>
          </>
        )}
      </main>
    </>
  );
}

function Done({ patient, pack, lang, onHome }: { patient: Patient; pack: ProtocolPack; lang: Lang; onHome: () => void }) {
  const tri = triage(patient, pack);
  return (
    <main>
      {tri.tier === 'SAFETY' && <SafetyBanner lang={lang} emergency={safetyLevel(patient) === 'emergency'} />}
      <h2>{t(lang, 'thanks')}</h2>
      <p className="sub">{t(lang, 'thanksBody')}</p>
      <ReadAloud key={lang} text={`${t(lang, 'thanks')} ${t(lang, 'thanksBody')}`} lang={lang} />
      <button className="big primary" onClick={onHome}>{t(lang, 'backHome')}</button>
    </main>
  );
}

// ------------------------------------------------------------------ weekly self-test
function NumField(p: { label: string; hint?: string; value: Value | null; onChange: (v: number | null) => void; min: number; max: number; step: number; unit: string }) {
  const clamp = (n: number) => Math.min(p.max, Math.max(p.min, round1(n)));
  return (
    <div className="field">
      <label>{p.label}</label>
      {p.hint && <small>{p.hint}</small>}
      <div className="numrow">
        <button type="button" className="stepbtn" aria-label="minus" onClick={() => p.onChange(clamp((Number(p.value ?? p.min + p.step)) - p.step))}>−</button>
        <input type="number" inputMode="decimal" aria-label={p.label} value={p.value === null ? '' : String(p.value)} min={p.min} max={p.max} step={p.step} placeholder="—"
          onChange={(e) => p.onChange(e.target.value === '' ? null : clamp(Number(e.target.value)))} />
        <button type="button" className="stepbtn" aria-label="plus" onClick={() => p.onChange(clamp(Number(p.value ?? p.min - p.step) + p.step))}>+</button>
        <span className="unit">{p.unit}</span>
      </div>
    </div>
  );
}

function Weekly({ patient, pack, lang, onDone, onBack }: { patient: Patient; pack: ProtocolPack; lang: Lang; onDone: () => void; onBack: () => void }) {
  const T = (k: string, p?: Record<string, string | number>) => t(lang, k, p);
  const ms = weeklyMeasures(pack, patient);
  const [vals, setVals] = useState<Record<string, Value | null>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [methods, setMethods] = useState<Record<string, 'photo'>>({});
  const ok = weeklyComplete(pack, patient, vals);
  const unit = (m: { unit: string | null }) => (m.unit === 'cm' ? T('units_cm') : m.unit === 'deg' ? T('units_deg') : m.unit === 'reps' ? T('units_reps') : m.unit === 'sec' ? T('units_sec') : m.unit ?? '');
  return (
    <main>
      <button className="back" onClick={onBack}>← {T('backHome')}</button>
      <h2>{T('weeklyTitle')}</h2>
      <CaregiverBanner patient={patient} lang={lang} />
      {ms.map((m) => {
        const partner = pack.measures.find((x) => x.pairOf === m.id);
        return (
          <div className="card" key={m.id}>
            <ReadAloud key={`${lang}|${m.id}`} text={`${L(m.label, lang)}. ${m.hint ? L(m.hint, lang) : ''}`} lang={lang} />
            {m.valueType === 'boolean' ? (
              <div className="field"><label>{L(m.label, lang)}</label>
                <div className="yn">
                  <button className={vals[m.id] === false ? 'sel no' : ''} aria-pressed={vals[m.id] === false} onClick={() => setVals({ ...vals, [m.id]: false })}>{T('no')}</button>
                  <button className={vals[m.id] === true ? 'sel yes' : ''} aria-pressed={vals[m.id] === true} onClick={() => setVals({ ...vals, [m.id]: true })}>{T('yes')}</button>
                </div></div>
            ) : (
              <>
                <NumField label={partner ? `${L(m.label, lang)}: ${T('opLeg')}` : L(m.label, lang)} hint={m.hint ? L(m.hint, lang) : undefined} value={vals[m.id] ?? null} onChange={(v) => { setVals({ ...vals, [m.id]: v }); setMethods(({ [m.id]: _gone, ...rest }) => rest); }}
                  min={m.input?.min ?? 0} max={m.input?.max ?? 100} step={m.input?.step ?? 1} unit={unit(m)} />
                {partner && <NumField label={T('otherLeg')} value={vals[partner.id] ?? null} onChange={(v) => setVals({ ...vals, [partner.id]: v })} min={partner.input?.min ?? 1} max={partner.input?.max ?? 100} step={partner.input?.step ?? 1} unit={unit(partner)} />}
              </>
            )}
            {m.capture === 'photo' && (
              <>
                <label className="filebtn">📷 {T('photoOptional')}<input type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; setPhotos({ ...photos, [m.id]: String(f?.name ?? '') }); if (f) setFiles({ ...files, [m.id]: f }); }} /></label>
                {photos[m.id] && <small>📎 {photos[m.id]} · {T('photoSoon')}</small>}
                {m.photoAngle && files[m.id] && <AngleTool file={files[m.id]} measure={m} lang={lang} onUse={(deg) => { setVals({ ...vals, [m.id]: deg }); setMethods({ ...methods, [m.id]: 'photo' }); }} />}
                {methods[m.id] && <small>✔ {T('angleFromPhoto')}</small>}
              </>
            )}
          </div>
        );
      })}
      <button className="big primary" disabled={!ok} onClick={() => { updatePatient(patient.id, (p) => saveWeekly(pack, p, getState().today, vals, Object.fromEntries(Object.entries(photos).filter(([, v]) => v)), methods, answerer(patient))); onDone(); }}>{ok ? T('saveWeekly') : T('fillAll')}</button>
    </main>
  );
}

// ------------------------------------------------------------------ questionnaire (from the pack)
function Monthly({ patient, pack, lang, onDone, onBack }: { patient: Patient; pack: ProtocolPack; lang: Lang; onDone: () => void; onBack: () => void }) {
  const T = (k: string, p?: Record<string, string | number>) => t(lang, k, p);
  const q = pack.questionnaires[0];
  const [ans, setAns] = useState<(number | null)[]>(() => (q ? q.items.map(() => null) : []));
  const [i, setI] = useState(0);
  if (!q) return <main><button className="back" onClick={onBack}>← {T('backHome')}</button><p className="hint">{T('noQuestionnaire')}</p></main>;
  const finished = ans.every((a) => a !== null);
  return (
    <main>
      <button className="back" onClick={i === 0 ? onBack : () => setI(i - 1)}>← {T('back')}</button>
      <h2>{L(q.title, lang)}</h2>
      <CaregiverBanner patient={patient} lang={lang} />
      <p className="sub">{L(q.intro, lang)}</p>
      <p className="tiny">{q.credit}</p>
      <div className="progress tight">{q.items.map((_, k) => <span key={k} className={ans[k] !== null ? 'on' : ''} />)}</div>
      <p className="sub">{T('tskQ', { n: i + 1 })}</p>
      <div className="statement">{L(q.items[i], lang)}</div>
      <ReadAloud key={`${lang}|${i}`} text={`${L(q.items[i], lang)}. ${q.options.map((o) => L(o.label, lang)).join('. ')}`} lang={lang} />
      <div className="stack">{q.options.map((o) => (
        <button key={o.value} className={`choice ${ans[i] === o.value ? 'sel' : ''}`} aria-pressed={ans[i] === o.value}
          onClick={() => { const a = [...ans]; a[i] = o.value; setAns(a); if (i < q.items.length - 1) setI(i + 1); }}>{L(o.label, lang)}</button>))}</div>
      {finished && <button className="big primary" onClick={() => { updatePatient(patient.id, (p) => saveQuestionnaire(pack, p, q.id, getState().today, ans, answerer(patient))); onDone(); }}>{T('save')}</button>}
    </main>
  );
}
