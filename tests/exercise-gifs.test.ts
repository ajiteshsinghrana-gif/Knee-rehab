import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { LIBRARY } from '../src/exercises/library';
import { gifFor } from '../src/exercises/gif';
// @ts-ignore plain JS helper
import { precacheList } from '../scripts/pwa.mjs';

describe('exercise demo GIFs', () => {
  it('maps a picture file to the GIF of the same name', () => {
    expect(gifFor('media/squats.svg')).toBe('media/gif/squats.gif');
    expect(gifFor(undefined)).toBeUndefined();
    expect(gifFor('media/x.png')).toBeUndefined();
  });
  it('every library exercise has a real, small, looping GIF', () => {
    for (const e of LIBRARY) {
      const g = gifFor(e.picture)!;
      const f = `public/${g}`;
      expect(existsSync(f), g).toBe(true);
      const b = readFileSync(f);
      expect(b.subarray(0, 6).toString('latin1'), g).toMatch(/^GIF89a$/);
      expect(statSync(f).size, g).toBeLessThan(150_000);
      expect(b.includes(Buffer.from('NETSCAPE2.0')), `${g} loops`).toBe(true);
    }
  });
  it('the offline cache includes sub-folders such as media/gif', () => {
    const list: string[] = precacheList('public');
    expect(list.some((f) => f.startsWith('media/gif/'))).toBe(true);
  });
});
