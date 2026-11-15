import { useEffect, useRef, useState } from 'react';
import type { Lang, Measure } from '../types';
import { photoAngle, type Pt } from '../angle';
import { L, t } from '../i18n';

/** Phase 4.1: tap three points on the photo; the app computes the angle. The photo is shown from memory and never stored or sent. */
export function AngleTool({ file, measure, lang, onUse }: { file: File; measure: Measure; lang: Lang; onUse: (deg: number) => void }) {
  const cfg = measure.photoAngle!;
  const T = (k: string, p?: Record<string, string | number>) => t(lang, k, p);
  const [url, setUrl] = useState('');
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [pts, setPts] = useState<Pt[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  const [bad, setBad] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const u = URL.createObjectURL(file); setUrl(u); setPts([]); setBad(false); return () => URL.revokeObjectURL(u); }, [file]);

  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
  };
  const deg = pts.length === 3 ? photoAngle(cfg.reading, pts[0], pts[1], pts[2]) : null;
  const lo = measure.input?.min ?? 0, hi = measure.input?.max ?? 180;
  const radius = Math.max(size.w, size.h) / 40;

  return (
    <div className="card angle" data-testid="angle-tool">
      <b>{T('angleTitle')}</b>
      <small>{pts.length < 3 ? T('angleTap', { what: L(cfg.points[pts.length], lang), n: pts.length + 1 }) : T('angleHelp')} {T('angleLocal')}</small>
      <div ref={box} className="anglebox" onPointerDown={(e) => { if (pts.length < 3 && drag === null) { setPts([...pts, at(e)]); setBad(false); } }}
        onPointerMove={(e) => { if (drag !== null) setPts(pts.map((p, i) => (i === drag ? at(e) : p))); }}
        onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        {url && <img src={url} alt="" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })} draggable={false} />}
        <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden="true">
          {pts.length > 1 && <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ffb703" strokeWidth={radius / 3} />}
          {pts.map((p, i) => <circle key={i} data-testid={`pt${i}`} cx={p.x} cy={p.y} r={radius} fill={i === 1 ? '#b00020' : '#0a6b6b'} stroke="#fff" strokeWidth={radius / 5} onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i); }} />)}
        </svg>
      </div>
      {deg !== null && <p className="sub" data-testid="angle-result">{T('angleResult', { deg })}</p>}
      {bad && <p className="hint" role="alert">{T('angleBad')}</p>}
      <div className="btnrow">
        <button type="button" className="btn primary" disabled={deg === null} onClick={() => { if (deg === null || deg < lo || deg > hi) { setBad(true); setPts([]); } else onUse(deg); }}>{T('angleUse')}</button>
        <button type="button" className="btn" onClick={() => { setPts([]); setBad(false); }}>{T('angleAgain')}</button>
      </div>
    </div>
  );
}
