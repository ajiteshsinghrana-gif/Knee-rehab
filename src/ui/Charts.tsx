import type { ReactNode } from 'react';

export interface Pt { x: number; y: number }
export interface Series { name: string; color: string; points: Pt[]; dashed?: boolean; dots?: boolean }
export interface Band { x: number; lo: number; hi: number }

const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
const nice = (lo: number, hi: number): [number, number, number] => {
  const span = hi - lo || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const m = [1, 2, 5, 10].find((k) => span / (k * step) <= 5) ?? 10;
  const s = m * step;
  return [Math.floor(lo / s) * s, Math.ceil(hi / s) * s, s];
};

export function LineChart(p: { title: string; note?: string; xLabel: string; yLabel: string; series: Series[]; band?: Band[]; refs?: { y: number; label: string; color: string }[]; yMin?: number; yMax?: number }): ReactNode {
  const xs = p.series.flatMap((s) => s.points.map((q) => q.x)).concat((p.band ?? []).map((b) => b.x));
  const ys = p.series.flatMap((s) => s.points.map((q) => q.y)).concat((p.band ?? []).flatMap((b) => [b.lo, b.hi])).concat((p.refs ?? []).map((r) => r.y));
  if (!xs.length) return null;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1, ys_] = nice(p.yMin ?? Math.min(...ys), p.yMax ?? Math.max(...ys));
  const X = scale(x0, x1, 52, 588), Y = scale(y0, y1, 190, 14);
  const yt: number[] = [];
  for (let v = y0; v <= y1 + 1e-9; v += ys_) yt.push(Math.round(v * 100) / 100);
  const xt: number[] = [];
  const xs_ = Math.max(1, Math.ceil((x1 - x0) / 6));
  for (let v = Math.ceil(x0); v <= x1; v += xs_) xt.push(v);
  const path = (pts: Pt[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join(' ');
  const band = p.band && p.band.length > 1
    ? `${p.band.map((b, i) => `${i ? 'L' : 'M'}${X(b.x).toFixed(1)},${Y(b.hi).toFixed(1)}`).join(' ')} ${[...p.band].reverse().map((b) => `L${X(b.x).toFixed(1)},${Y(b.lo).toFixed(1)}`).join(' ')} Z`
    : null;
  return (
    <figure className="chart">
      <figcaption>{p.title}{p.note && <span className="chartnote" tabIndex={0} title={p.note} aria-label={p.note} data-testid="curve-note" data-origin="placeholder">ⓘ</span>}</figcaption>
      <svg viewBox="0 0 600 230" role="img" aria-label={p.title}>
        {yt.map((v) => (<g key={'y' + v}><line x1={52} x2={588} y1={Y(v)} y2={Y(v)} stroke="#eef2f3" /><text x={46} y={Y(v) + 4} textAnchor="end" fontSize="12" fill="#4a5a60">{v}</text></g>))}
        {xt.map((v) => (<text key={'x' + v} x={X(v)} y={208} textAnchor="middle" fontSize="12" fill="#4a5a60">{v}</text>))}
        <text x={320} y={226} textAnchor="middle" fontSize="12" fill="#4a5a60">{p.xLabel}</text>
        <text x={10} y={102} fontSize="12" fill="#4a5a60" transform="rotate(-90 10 102)" textAnchor="middle">{p.yLabel}</text>
        {band && <path d={band} className="band" />}
        {(p.refs ?? []).map((r) => (<g key={r.label}><line x1={52} x2={588} y1={Y(r.y)} y2={Y(r.y)} stroke={r.color} strokeDasharray="4 4" strokeWidth="1" /><text x={586} y={Y(r.y) - 4} textAnchor="end" fontSize="12" fill={r.color} stroke="#fff" strokeWidth="4" paintOrder="stroke">{r.label}</text></g>))}
        {p.series.map((s) => (
          <g key={s.name}>
            <path d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '6 5' : undefined} />
            {s.dots && s.points.map((q, i) => <circle key={i} cx={X(q.x)} cy={Y(q.y)} r={i === s.points.length - 1 ? 4 : 2.5} fill={s.color} />)}
          </g>
        ))}
      </svg>
      <div className="legend">{p.series.map((s) => (<span key={s.name}><i style={{ background: s.color }} />{s.name}</span>))}{band && <span><i style={{ background: '#0a6b6b', opacity: 0.3 }} />expected band</span>}</div>
    </figure>
  );
}

/** A small trend line for the evidence strip: no axes, a dashed line at the threshold, the last value marked. */
export function Sparkline(p: { points: Pt[]; xMin: number; xMax: number; yMin: number; yMax: number; threshold?: number; label: string }): ReactNode {
  const W = 160, H = 44;
  const X = scale(p.xMin, p.xMax, 4, W - 4), Y = scale(p.yMin, p.yMax, H - 4, 4);
  const last = p.points[p.points.length - 1];
  return (
    <span className="spark">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.label}: ${p.points.length ? p.points.map((q) => q.y).join(', ') : 'no answers'}${p.threshold !== undefined ? `. Urgent at ${p.threshold}` : ''}`}>
        <line x1={0} x2={W} y1={H - 4} y2={H - 4} stroke="#eef2f3" />
        {p.threshold !== undefined && <line x1={0} x2={W} y1={Y(p.threshold)} y2={Y(p.threshold)} stroke="#c62828" strokeDasharray="3 3" strokeWidth="1" />}
        {p.points.length > 1 && <path d={p.points.map((q, i) => `${i ? 'L' : 'M'}${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join(' ')} fill="none" stroke="#0a6b6b" strokeWidth="1.5" />}
        {last && <circle cx={X(last.x)} cy={Y(last.y)} r={3} fill="#0a6b6b" />}
      </svg>
      {last ? <b>{last.y}<small>/10 now</small></b> : <small>No answers</small>}
    </span>
  );
}
