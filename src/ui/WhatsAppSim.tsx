import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGS, LANG_NAME } from '../types';
import type { Lang, Patient } from '../types';
import { getPack } from '../engine/packs';
import { triage } from '../engine/triage';
import { clockMs, getState, updatePatient } from '../store';
import { saveCheckIn } from '../checkin';
import { answer, closingReply, isDone, nextQuestion, startSession, toCheckIn, unsupportedMeasures, type Question, type Session } from '../whatsapp/flow';
import { TEMPLATES, firstName, renderTemplate, templateButtons } from '../whatsapp/templates';

interface Msg { from: 'bot' | 'me'; text: string; tone?: 'ok' | 'warn' | 'alert' | 'tpl' }

const OPENING = TEMPLATES.find((t) => t.name === 'rp_checkin_prompt')!;

/**
 * A simulated WhatsApp chat: how a patient answers the daily check-in on WhatsApp.
 * Nothing is sent anywhere. The questions, the saved check-in and the closing message come from the same code and the same protocol pack as the app
 * (src/whatsapp/flow.ts), so what the patient taps here is judged by the same triage rules.
 * `canSave` is true only in the demo: it lets the physio dashboard react. In the live clinic this is a preview and never touches a record.
 */
export function WhatsAppSim({ patient, canSave, onClose }: { patient: Patient; canSave: boolean; onClose: () => void }) {
  const pack = getPack(patient.packId);
  const [lang, setLang] = useState<Lang>(patient.language);
  const [save, setSave] = useState(false);
  const [run, setRun] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const unsupported = useMemo(() => unsupportedMeasures(pack), [pack]);

  const opening = (l: Lang): Msg => ({ from: 'bot', tone: 'tpl', text: renderTemplate(OPENING, l, [firstName(patient.name)]) });

  // (Re)start whenever the patient, language or restart counter changes.
  useEffect(() => {
    setMsgs([opening(lang)]);
    setSession(startSession(patient, pack, lang));
    setQuestion(null);
    setStarted(false);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, lang, run]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [msgs, question]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);

  const push = (m: Msg[]) => setMsgs((old) => [...old, ...m]);
  const ask = (s: Session) => {
    const q = nextQuestion(s);
    setQuestion(q);
    if (q) push([{ from: 'bot', text: q.prompt }]);
    return q;
  };

  const start = () => {
    if (!session) return;
    setStarted(true);
    push([{ from: 'me', text: templateButtons(OPENING, lang)[0] }]);
    ask(session);
  };

  const pick = (choiceId: string, label: string) => {
    if (!session || !question) return;
    push([{ from: 'me', text: label }]);
    const next = answer(session, question, choiceId);
    setSession(next);
    if (!isDone(next)) { ask(next); return; }
    setQuestion(null);
    const st = getState();
    const nowMs = clockMs(st);
    const date = st.today;
    const entry = toCheckIn(next, date, nowMs);
    const saved = saveCheckIn(patient, entry);
    if (canSave && save) updatePatient(patient.id, (p) => saveCheckIn(p, entry));
    const replies = closingReply(saved, pack, lang, nowMs);
    push(replies.map((r) => ({ from: 'bot' as const, text: r.text, tone: r.tone })));
    const tri = triage(saved, pack, { nowMs });
    setResult(tri.tier === 'ON_PLAN' ? 'On plan' : tri.tier);
  };

  return (
    <div className="wa-overlay" role="dialog" aria-modal="true" aria-label="Simulated WhatsApp chat" data-testid="wa-sim">
      <div className="wa-side">
        <h2>WhatsApp check-in</h2>
        <p>How {firstName(patient.name)} answers the daily check-in on WhatsApp. This is a simulation: nothing is sent.</p>
        <p className="wa-note">The questions come from this patient's protocol pack, and the answers go through the same triage rules as the app. No AI chooses anything.</p>
        <div className="wa-ctrl">
          <span id="wa-lang-label">Patient language</span>
          <div role="group" aria-labelledby="wa-lang-label" className="wa-langs">
            {LANGS.map((l) => <button key={l} type="button" className={`btn${l === lang ? ' primary' : ''}`} aria-pressed={l === lang} onClick={() => setLang(l)}>{LANG_NAME[l]}</button>)}
          </div>
        </div>
        {canSave ? (
          <label className="wa-save"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Also save these answers to {firstName(patient.name)}'s record (the Physio dashboard will react; Reset undoes it)</label>
        ) : (
          <p className="wa-note" data-testid="wa-preview-note">Preview only. Nothing you tap here is saved to a patient.</p>
        )}
        {unsupported.length > 0 && <p className="hint">This condition asks a question the chat cannot show yet ({unsupported.join(', ')}). The app handles it.</p>}
        {result && <p className="wa-result" role="status" data-testid="wa-result">Result of these answers: <b>{result}</b>{canSave && save ? ' (saved to the record)' : ''}</p>}
        <div className="btnrow">
          <button type="button" className="btn" onClick={() => setRun(run + 1)}>↺ Start again</button>
          <button type="button" className="btn primary" ref={closeRef} onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="wa-phone">
        <div className="wa-head"><span className="wa-avatar" aria-hidden="true">R</span><span><b>RehabPath</b><small>Business account</small></span></div>
        <div className="wa-sim-banner">Simulated chat. Not live WhatsApp.</div>
        <div className="wa-body" aria-live="polite">
          <div className="wa-day">Today</div>
          {msgs.map((m, i) => <div key={i} className={`wa-msg ${m.from}${m.tone ? ` ${m.tone}` : ''}`}>{m.text}</div>)}
          {!started && session && (
            <div className="wa-qr">
              {templateButtons(OPENING, lang).map((b) => <button key={b} type="button" onClick={start}>{b}</button>)}
            </div>
          )}
          {question && (
            <div className={`wa-qr${question.choices.length > 3 ? ' list' : ''}`} role="group" aria-label={question.prompt.split('\n')[0]}>
              {question.choices.map((c) => <button key={c.id} type="button" onClick={() => pick(c.id, c.label)}>{c.label}</button>)}
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="wa-foot">Reply with the buttons</div>
      </div>
    </div>
  );
}
