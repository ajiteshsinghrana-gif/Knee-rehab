/**
 * Phase 3.2: protocol import. NO LLM here. A deterministic reader turns text into field proposals that the physio
 * approves one by one against the default pack. A future LLM step (Phase 6) can only produce the same JSON shape
 * (`{ "<target>": value }`), which is validated and reviewed the same way.
 */
import type { ProtocolPack, Tier } from '../types';
import { LIBRARY } from '../exercises/library';
import { listOverridable } from '../engine/overrides';

export type FieldKind = 'number' | 'exercises';
export interface Field {
  target: string;
  label: string;
  kind: FieldKind;
  current: number | string[];
  /** Score > 0 when the (lower-cased) line refers to this field; higher = more specific. */
  test: (lc: string) => number;
  /** Sanity range for numbers. */
  range?: [number, number];
}
export interface Proposal { target: string; label: string; kind: FieldKind; current: number | string[]; proposed: number | string[]; line: string }
export interface Ambiguous { line: string; value: number | string[]; kind: FieldKind; candidates: { target: string; label: string }[] }
export interface ExtractResult { proposals: Proposal[]; ambiguous: Ambiguous[]; unmatched: string[]; rejected: { line: string; why: string }[] }

const TIERS: Tier[] = ['SAFETY', 'URGENT', 'REVIEW'] as unknown as Tier[];
const has = (lc: string, k: string) => (k.length >= 2 && new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(lc) ? k.length : 0);
const hasText = (lc: string, k: string) => (k.length >= 4 && lc.includes(k) ? k.length : 0);

/** Every field the importer can change in a pack. */
export function catalogue(pack: ProtocolPack): Field[] {
  const out: Field[] = [];
  const num = (target: string, label: string, current: number, test: Field['test'], range: [number, number]) => out.push({ target, label, kind: 'number', current, test, range });
  const explicit = (target: string) => (lc: string) => (lc.includes(`[${target.toLowerCase()}]`) ? 1000 : 0);

  for (const o of listOverridable(pack)) {
    const [kind, id, field, idx] = o.target.split(':');
    const label = o.label;
    let test: (lc: string) => number = () => 0;
    let range: [number, number] = [0, 1000];
    if (kind === 'gate') {
      const crit = pack.gates.flatMap((g) => g.criteria).find((c) => c.id === id)!;
      const m = pack.measures.find((x) => x.id === crit.measure);
      test = (lc) => Math.max(has(lc, id.toLowerCase()), hasText(lc, crit.label.en.toLowerCase()) + 0, m?.short ? hasText(lc, m.short.en.toLowerCase()) : 0) ;
      range = [0, 1000];
    } else {
      const rule = pack.rules.find((r) => r.id === id)!;
      const base = (lc: string) => Math.max(has(lc, id.toLowerCase()), hasText(lc, rule.label.en.toLowerCase()));
      if (field === 'stage' && rule.type === 'threshold') {
        const st = rule.stages[Number(idx)];
        test = (lc) => {
          const b = base(lc);
          if (!b) return 0;
          const wk = /weeks?\s*(\d+)\s*(?:-|–|to)\s*(\d+|end)/.exec(lc);
          if (wk) return Number(wk[1]) === st.minWeek ? b + 50 : 0;
          const from = /(?:from|after)\s*week\s*(\d+)/.exec(lc);
          if (from) return Number(from[1]) === st.minWeek ? b + 50 : 0;
          return b;
        };
        range = [0, 10000];
      } else if (field === 'adherence') { test = (lc) => (/adherence|%/.test(lc) ? base(lc) + 20 : 0); range = [0, 100]; }
      else if (field === 'count' && rule.type === 'streak' && rule.orAdherenceBelowPct !== undefined) { test = (lc) => (/adherence/.test(lc) ? 0 : base(lc)); range = [1, 60]; }
      else if (field === 'hours') { test = base; range = [1, 720]; }
      else { test = base; range = field === 'delta' ? [-10, 10] : [1, 60]; }
    }
    num(o.target, label, o.current, (lc) => Math.max(explicit(o.target)(lc), test(lc)), range);
  }
  for (const t of TIERS) {
    const tl = String(t).toLowerCase();
    num(`hours:${t}`, `Response time ${t} (hours)`, pack.responseHours[t as 'SAFETY'].hours, (lc) => Math.max(explicit(`hours:${t}`)(lc), /response|reply|within|hours?|\bh\b/.test(lc) ? has(lc, tl) : 0), [1, 720]);
  }
  for (const ph of pack.phases) {
    const n = ph.order;
    const inPhase = (lc: string) => new RegExp(`(^|[^a-z0-9])(phase\\s*${n}|${ph.id})($|[^a-z0-9])`).test(lc);
    num(`phase:${ph.id}:followUp`, `${ph.name.en}: review every N days`, ph.followUpEveryDays, (lc) => Math.max(explicit(`phase:${ph.id}:followUp`)(lc), inPhase(lc) && /follow-?up|review/.test(lc) ? 30 : 0), [1, 60]);
    num(`phase:${ph.id}:sessions`, `${ph.name.en}: sessions per day`, ph.sessionsPerDay, (lc) => Math.max(explicit(`phase:${ph.id}:sessions`)(lc), inPhase(lc) && /sessions?/.test(lc) ? 30 : 0), [0, 10]);
    out.push({ target: `phase:${ph.id}:exercises`, label: `${ph.name.en}: exercises`, kind: 'exercises', current: [...ph.exercises], range: undefined,
      test: (lc) => Math.max(explicit(`phase:${ph.id}:exercises`)(lc), inPhase(lc) && /exercise/.test(lc) ? 30 : 0) });
  }
  return out;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0900-\u097f |]/g, ' ').replace(/\s+/g, ' ').trim();
const singular = (s: string) => s.replace(/(es|s)$/, '');

/** Library exercises named in a list line. Unknown names come back separately so nothing is silently dropped. */
export function parseExerciseList(line: string): { ids: string[]; unknown: string[] } {
  const noTok = line.replace(/\[[^\]]*\]/g, '');
  let body = norm((noTok.includes(':') ? noTok.slice(noTok.lastIndexOf(':') + 1) : noTok).replace(/[,;•·\n]/g, ' | '));
  const ids: string[] = [];
  const at: Record<string, number> = {};
  const names = (e: (typeof LIBRARY)[number]) => [norm(e.name.en), norm(e.name.en.replace(/\(.*?\)/g, '')), norm(e.name.hi), e.id.replace(/-/g, ' ')].filter((x) => x.length >= 3);
  // 1) whole library names first, longest first, so names that contain "and" or commas stay whole
  const all = LIBRARY.flatMap((e) => names(e).map((n) => ({ id: e.id, n }))).sort((x, y) => y.n.length - x.n.length);
  for (const { id, n } of all) {
    const re = new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
    const m = re.exec(body);
    if (m) { if (!ids.includes(id)) { ids.push(id); at[id] = m.index; } body = body.replace(re, ' | '); }
  }
  // 2) whatever is left: plural/partial names, otherwise reported as unknown
  const unknown: string[] = [];
  for (const raw of body.split(/\||\band\b/).map((x) => x.trim()).filter(Boolean)) {
    const it = singular(raw);
    const hit = LIBRARY.find((e) => names(e).some((n) => singular(n) === it)) ?? (it.length >= 5 ? LIBRARY.find((e) => names(e).some((n) => n.includes(it))) : undefined);
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id); } else unknown.push(raw);
  }
  ids.sort((x, y) => (at[x] ?? 1e9) - (at[y] ?? 1e9));
  return { ids, unknown };
}

function numberOf(line: string): number | null {
  const explicit = /\]\s*[:=]\s*(-?\d+(?:\.\d+)?)/.exec(line) ?? /[:=]\s*(-?\d+(?:\.\d+)?)\s*[a-z%°]*\s*$/i.exec(line);
  if (explicit) return Number(explicit[1]);
  const cleaned = line.toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/weeks?\s*\d+\s*(?:-|–|to)\s*(?:\d+|end)/g, ' ')
    .replace(/(?:from|after)\s*week\s*\d+/g, ' ')
    .replace(/phase\s*\d+/g, ' ')
    .replace(/\b[a-z]\d+(?:\.[a-z0-9.]+)?\b/g, ' ');
  const m = /(-?\d+(?:\.\d+)?)/.exec(cleaned);
  return m ? Number(m[1]) : null;
}

/** Lines from plain text. CSV rows `a,b` become `a: b`. */
export function linesOf(text: string, fileName = ''): string[] {
  let t = text.replace(/\r/g, '');
  if (/\.csv$/i.test(fileName)) t = t.split('\n').map((l) => { const i = l.indexOf(','); return i < 0 ? l : `${l.slice(0, i).replace(/^"|"$/g, '')}: ${l.slice(i + 1).replace(/^"|"$/g, '')}`; }).join('\n');
  return t.split('\n').map((l) => l.replace(/^[\s\-*•\d.)]+(?=[A-Za-z\[])/, '').trim()).filter((l) => l.length > 0);
}

export function extract(pack: ProtocolPack, text: string, fileName = ''): ExtractResult {
  const fields = catalogue(pack);
  const res: ExtractResult = { proposals: [], ambiguous: [], unmatched: [], rejected: [] };
  const byTarget = new Map(fields.map((f) => [f.target, f]));
  const taken = new Set<string>();

  const propose = (f: Field, value: number | string[], line: string) => {
    if (f.kind === 'number') {
      const v = value as number;
      if (!Number.isFinite(v) || (f.range && (v < f.range[0] || v > f.range[1]))) { res.rejected.push({ line, why: `${v} is outside the allowed range for ${f.label}` }); return; }
      if (v === f.current) return; // unchanged: keeps the default
    } else if (sameSet(value as string[], f.current as string[])) return;
    if (taken.has(f.target)) { res.rejected.push({ line, why: `${f.label} appears more than once; the first value is used` }); return; }
    taken.add(f.target);
    res.proposals.push({ target: f.target, label: f.label, kind: f.kind, current: f.current, proposed: value, line });
  };

  // JSON: { "<target>": number | string[] }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || /\.json$/i.test(fileName)) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object');
      for (const [k, v] of Object.entries(obj)) {
        const f = byTarget.get(k);
        const line = `${k}: ${JSON.stringify(v)}`;
        if (!f) { res.rejected.push({ line, why: 'Unknown field' }); continue; }
        if (f.kind === 'number' && typeof v === 'number') propose(f, v, line);
        else if (f.kind === 'exercises' && Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          const ok = (v as string[]).filter((id) => LIBRARY.some((e) => e.id === id));
          const bad = (v as string[]).filter((id) => !ok.includes(id));
          bad.forEach((b) => res.rejected.push({ line, why: `Exercise "${b}" is not in the library` }));
          if (ok.length) propose(f, ok, line);
        } else res.rejected.push({ line, why: 'Wrong type of value' });
      }
      return res;
    } catch { res.rejected.push({ line: trimmed.slice(0, 60), why: 'This file is not valid JSON' }); return res; }
  }

  for (const line of linesOf(text, fileName)) {
    const lc = line.toLowerCase();
    const scored = fields.map((f) => ({ f, s: f.test(lc) })).filter((x) => x.s > 0);
    if (!scored.length) { if (/\d/.test(line) && line.length > 3) res.unmatched.push(line); continue; }
    const best = Math.max(...scored.map((x) => x.s));
    const top = scored.filter((x) => x.s === best).map((x) => x.f);
    const kinds = new Set(top.map((f) => f.kind));
    if (kinds.size > 1) { res.unmatched.push(line); continue; }
    const kind = top[0].kind;
    let value: number | string[];
    if (kind === 'exercises') {
      const { ids, unknown } = parseExerciseList(line);
      unknown.forEach((u) => res.rejected.push({ line, why: `"${u}" is not in the exercise library` }));
      if (!ids.length) continue;
      value = ids;
    } else {
      const n = numberOf(line);
      if (n === null) { res.unmatched.push(line); continue; }
      value = n;
    }
    if (top.length === 1) propose(top[0], value, line);
    else res.ambiguous.push({ line, value, kind, candidates: top.map((f) => ({ target: f.target, label: f.label })) });
  }
  return res;
}

/** A starting file for the physio: every value in the pack, one per line, in the format the reader understands. */
export function buildTemplate(pack: ProtocolPack): string {
  const lines = [`# ${pack.condition.en}. Edit the numbers you want to change. Delete any line to keep the default.`];
  for (const f of catalogue(pack)) lines.push(`${f.label} [${f.target}]: ${Array.isArray(f.current) ? f.current.map((id) => LIBRARY.find((e) => e.id === id)?.name.en ?? id).join('; ') : f.current}`);
  return lines.join('\n');
}
