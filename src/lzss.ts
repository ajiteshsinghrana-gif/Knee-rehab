/**
 * Small, dependency-free LZSS compressor for invite links (Phase 3.4).
 * Format: groups of up to 8 tokens, each group led by a flag byte (bit set = literal byte; bit clear = match).
 * A match is 2 bytes: 12-bit distance (1..4095) and 4-bit length-3 (3..18). The decoder stops at the end of the input.
 */
const MAX_OUT = 400_000;

export function compress(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  const table = new Map<number, number[]>();
  const key = (i: number) => (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
  const add = (i: number) => {
    if (i + 2 >= src.length) return;
    const k = key(i);
    const l = table.get(k);
    if (l) { l.push(i); if (l.length > 8) l.shift(); } else table.set(k, [i]);
  };
  let i = 0;
  while (i < src.length) {
    const flagAt = out.length;
    out.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && i < src.length; bit++) {
      let bestLen = 0;
      let bestDist = 0;
      if (i + 2 < src.length) {
        for (const j of table.get(key(i)) ?? []) {
          const dist = i - j;
          if (dist < 1 || dist > 4095) continue;
          let len = 0;
          while (len < 18 && i + len < src.length && src[j + len] === src[i + len]) len++;
          if (len > bestLen) { bestLen = len; bestDist = dist; }
        }
      }
      if (bestLen >= 3) {
        out.push((bestDist >> 4) & 0xff, ((bestDist & 0xf) << 4) | (bestLen - 3));
        for (let k = 0; k < bestLen; k++) add(i + k);
        i += bestLen;
      } else {
        flags |= 1 << bit;
        out.push(src[i]);
        add(i);
        i++;
      }
    }
    out[flagAt] = flags;
  }
  return Uint8Array.from(out);
}

/** Throws on damaged data. */
export function decompress(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const flags = src[i++];
    for (let bit = 0; bit < 8 && i < src.length; bit++) {
      if (flags & (1 << bit)) out.push(src[i++]);
      else {
        if (i + 1 >= src.length) throw new Error('damaged data');
        const a = src[i++];
        const b = src[i++];
        const dist = (a << 4) | (b >> 4);
        const len = (b & 0xf) + 3;
        if (dist < 1 || dist > out.length) throw new Error('damaged data');
        for (let k = 0; k < len; k++) out.push(out[out.length - dist]);
      }
      if (out.length > MAX_OUT) throw new Error('too large');
    }
  }
  return Uint8Array.from(out);
}
