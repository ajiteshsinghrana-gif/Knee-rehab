import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getSyncStatus, subscribeSync, type SyncStatus } from '../sync/engine';
import { getMode } from '../mode';

/** The one slim bar at the top of the app (UI redesign): app name left, view switch centre, small controls right. */
export function TopBar({ center, right, tag }: { center?: ReactNode; right?: ReactNode; tag?: ReactNode }) {
  return (
    <header className="topbar" data-testid="top-bar">
      <div className="tb-left">
        <img src="./icons/icon-192.png" alt="" width={24} height={24} />
        <span className="tb-name">RehabPath</span>
        {tag}
      </div>
      <div className="tb-center">{center}</div>
      <div className="tb-right">{right}</div>
    </header>
  );
}

/** Segmented view switch. Short labels on narrow screens; the full label stays in the accessible name. */
export function ViewSwitch<V extends string>({ value, options, onChange, label }: { value: V; options: { id: V; label: string; short: string; testid?: string }[]; onChange: (v: V) => void; label: string }) {
  return (
    <nav className="viewswitch" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={value === o.id ? 'on' : ''} aria-current={value === o.id ? 'page' : undefined} data-testid={o.testid} onClick={() => onChange(o.id)}>
          <span className="vs-long">{o.label}</span><span className="vs-short" aria-hidden>{o.short}</span>
        </button>
      ))}
    </nav>
  );
}

/** The full sync sentence, unchanged from the old full-width line; now shown in the dot's tooltip. */
export function syncText(s: SyncStatus): { state: 'ok' | 'bad'; text: string } {
  if (s.state === 'login') return { state: 'bad', text: 'Sign in as a physio (Physio dashboard tab) to sync your patients. Their data stays on this device until then.' };
  if (s.state === 'error') return { state: 'bad', text: `Sync problem. Your data is safe on this device and will send when it works. (${s.error})` };
  const t = s.lastOkAt ? new Date(s.lastOkAt).toLocaleTimeString() : '';
  return { state: 'ok', text: `Live sync on${s.patients ? ` · ${s.patients} patient${s.patients === 1 ? '' : 's'}` : ''}${t ? ` · last ${t}` : ''}${getMode() === 'demo' ? ' · demo: only patients you add sync; the six built-in ones stay on this device' : ''}` };
}

/** A small coloured dot. Hover or focus shows the full sentence; screen readers hear it as a status. */
export function SyncDot() {
  const s = useSyncExternalStore(subscribeSync, getSyncStatus);
  const id = useId();
  if (!s.enabled) return null;
  const { state, text } = syncText(s);
  return (
    <span className={`syncdot ${state}`} tabIndex={0} aria-describedby={id} data-testid="sync-chip">
      <span className="sd-dot" aria-hidden />
      <span className="sd-label">{state === 'ok' ? 'Synced' : 'Not synced'}</span>
      <span className="tooltip" role="status" id={id}>{text}</span>
    </span>
  );
}

/**
 * A small drop-down panel (disclosure pattern): the button says whether it is open, Escape or a click outside closes it,
 * and focus returns to the button. `keepOpen` children (like Fast-forward) can be pressed several times without reopening.
 */
export function Menu({ label, buttonLabel, children, align = 'right', testid, className = '' }: { label: string; buttonLabel: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; testid?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>('select, button:not(:disabled), a, input');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) close(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  return (
    <div className={`menu ${className}`} ref={wrap}>
      <button ref={btn} type="button" className="menubtn" aria-expanded={open} aria-controls={id} aria-label={label} data-testid={testid} onClick={() => setOpen(!open)}>
        {buttonLabel}<span className="caret" aria-hidden>▾</span>
      </button>
      {open && <div className={`menupanel ${align}`} id={id} role="group" aria-label={label} ref={panel}>{children(() => close())}</div>}
    </div>
  );
}

/** One short line under the header for the current demo step. Dismissing hides it until the next step. */
export function StepLine({ stepKey, text }: { stepKey: string; text: string }) {
  const [hidden, setHidden] = useState<string | null>(null);
  if (hidden === stepKey) return null;
  return (
    <div className="stepline" role="status" data-testid="demo-step">
      <span className="sl-text" title={text}>{text}</span>
      <button type="button" className="iconbtn" aria-label="Hide this demo hint" onClick={() => setHidden(stepKey)}>✕</button>
    </div>
  );
}
