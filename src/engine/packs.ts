import type { ProtocolPack } from '../types';
import acl from '../packs/acl-reconstruction.json';
import tkr from '../packs/total-knee-replacement.json';
import rc from '../packs/rotator-cuff-repair.json';
import { assertValidPack, validateLibrary } from './validator';
import { LIBRARY } from '../exercises/library';

/** All packs are validated at load. A pack that fails never reaches the app. */
const RAW = [acl, tkr, rc] as unknown as ProtocolPack[];
export const PACKS: Record<string, ProtocolPack> = {};
for (const p of RAW) {
  assertValidPack(p);
  PACKS[p.id] = p;
}
export const PACK_LIST: ProtocolPack[] = Object.values(PACKS);
export const getPack = (id: string): ProtocolPack => {
  const p = PACKS[id];
  if (!p) throw new Error(`Unknown protocol pack: ${id}`);
  return p;
};

const libErrors = validateLibrary(LIBRARY, PACK_LIST);
if (libErrors.length) throw new Error(`Exercise library is invalid:\n- ${libErrors.join('\n- ')}`);
