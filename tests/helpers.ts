import { planDefaults } from '../src/engine/plan';
import type { Patient, PeriodicEntry, ProtocolPack, Value } from '../src/types';
import { addDays } from '../src/engine/dates';
import { dailyEntry } from '../src/demo/seed';
import { getPack } from '../src/engine/packs';

export const ANCHOR = '2026-01-01';
export const aclPack = (): ProtocolPack => getPack('acl-reconstruction');
export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

type Over = { pain?: number; swelling?: string; ex?: 'all' | 'some' | 'none'; hard?: string; skip?: string; warnings?: Record<string, boolean>; breaches?: Record<string, boolean> };

/** A quiet ACL patient: pain 2, swelling less, all exercises, no hard movement. `f(day)` overrides a day. */
export function mk(days: number, f: (day: number) => Over = () => ({}), opts: { pack?: ProtocolPack; phase?: string; phaseStart?: number; periodic?: PeriodicEntry[] } = {}): Patient {
  const pack = opts.pack ?? aclPack();
  const daily = Array.from({ length: days }, (_, n) => {
    const day = n + 1;
    const o = f(day);
    const e = dailyEntry(pack, { date: addDays(ANCHOR, day), pain: o.pain ?? 2, swelling: o.swelling ?? 'less', ex: o.ex ?? 'all', per: 2, hard: o.hard ?? 'none', skip: o.skip, warnings: o.warnings });
    if (o.breaches) e.precautionBreaches = o.breaches;
    return e;
  });
  return {
    id: 't', name: 'T', age: 30, packId: pack.id, language: 'en', anchorDate: ANCHOR, currentPhase: opts.phase ?? 'p1', phaseStartDate: addDays(ANCHOR, opts.phaseStart ?? 0),
    sessionsPrescribedPerDay: 2, daily, reviewed: {}, decisions: [], ...planDefaults(), periodic: opts.periodic ?? [],
  };
}
export const wk = (day: number, values: Record<string, Value>): PeriodicEntry => ({ date: addDays(ANCHOR, day), values });
export const ids = (r: { triggers: { ruleId: string }[] }): string[] => r.triggers.map((t) => t.ruleId);
