import type { ProtocolPack } from '../types';
import { setPackValue } from '../engine/overrides';
import { registerPack } from '../engine/packs';
import type { Proposal } from './extract';

export const IMPORT_TAG = 'PHYSIO_IMPORTED';

/** Default pack + only the fields the physio approved. Everything else keeps its default value and source tag. */
export function buildImportedPack(base: ProtocolPack, approved: Proposal[], fileName: string, newId: string): ProtocolPack {
  const pack: ProtocolPack = JSON.parse(JSON.stringify(base));
  const tag = `${IMPORT_TAG}: ${fileName || 'pasted text'}`;
  for (const a of approved) {
    const [kind, id, field] = a.target.split(':');
    if (kind === 'hours') {
      const t = id as 'SAFETY' | 'URGENT' | 'REVIEW';
      pack.responseHours[t] = { hours: a.proposed as number, source: tag };
    } else if (kind === 'phase') {
      const ph = pack.phases.find((x) => x.id === id);
      if (!ph) throw new Error(`Unknown phase ${id}`);
      if (field === 'exercises') ph.exercises = [...(a.proposed as string[])];
      else { if (field === 'followUp') ph.followUpEveryDays = a.proposed as number; else ph.sessionsPerDay = a.proposed as number; ph.source = `${ph.source}; ${tag}`; }
    } else if (!setPackValue(pack, a.target, a.proposed as number, tag)) throw new Error(`Cannot apply ${a.target}`);
  }
  pack.id = newId;
  pack.basedOn = base.id;
  pack.imported = { file: fileName || 'pasted text', fields: approved.map((a) => ({ target: a.target, value: a.proposed })) };
  pack.version = `${base.version}+import`;
  pack.condition = { en: `${base.condition.en} (custom protocol)`, hi: `${base.condition.hi} (अनुकूलित प्रोटोकॉल)` };
  pack.sources = [...base.sources, tag];
  registerPack(pack); // runs the same validator as the shipped packs; throws if invalid
  return pack;
}
