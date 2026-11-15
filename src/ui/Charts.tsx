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

export function LineChart(p: { title: string; xLabel: string; yLabel: string; series: Series[]; band?: Band[]; refs?: { y: number; label: string; color: string }[]; yMin?: number; yMax?: number }): ReactNode {
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
      <figcaption>{p.title}</figcaption>
      <svg viewBox="0 0 600 230" role="img" aria-label={p.title}>
        {yt.map((v) => (<g key={'y' + v}><line x1={52} x2={588} y1={Y(v)} y2={Y(v)} stroke="#e3ebeb" /><text x={46} y={Y(v) + 4} textAnchor="end" fontSize="14" fill="#4a5a60">{v}</text></g>))}
        {xt.map((v) => (<text key={'x' + v} x={X(v)} y={208} textAnchor="middle" fontSize="14" fill="#4a5a60">{v}</text>))}
        <text x={320} y={226} textAnchor="middle" fontSize="14" fill="#4a5a60">{p.xLabel}</text>
        <text x={10} y={102} fontSize="14" fill="#4a5a60" transform="rotate(-90 10 102)" textAnchor="middle">{p.yLabel}</text>
        {band && <path d={band} className="band" />}
        {(p.refs ?? []).map((r) => (<g key={r.label}><line x1={52} x2={588} y1={Y(r.y)} y2={Y(r.y)} stroke={r.color} strokeDasharray="5 4" /><text x={586} y={Y(r.y) - 4} textAnchor="end" fontSize="14" fill={r.color} stroke="#fff" strokeWidth="4" paintOrder="stroke">{r.label}</text></g>))}
        {p.series.map((s) => (
          <g key={s.name}>
            <path d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dashed ? '6 5' : undefined} />
            {s.dots && s.points.map((q, i) => <circle key={i} cx={X(q.x)} cy={Y(q.y)} r={i === s.points.length - 1 ? 5 : 3.5} fill={s.color} />)}
          </g>
        ))}
      </svg>
      <div className="legend">{p.series.map((s) => (<span key={s.name}><i style={{ background: s.color }} />{s.name}</span>))}{band && <span><i style={{ background: '#0a6b6b', opacity: 0.3 }} />expected band</span>}</div>
    </figure>
  );
}
