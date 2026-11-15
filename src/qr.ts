/**
 * Small QR code encoder (byte mode, error correction L, versions 1-20, mask chosen by penalty score).
 * Written from the ISO/IEC 18004 tables so the app needs no network or extra package.
 */

// [total codewords, ec codewords per block, blocks in group1, data cw group1, blocks in group2, data cw group2] for EC level L
const VERSIONS: number[][] = [
  [], [26, 7, 1, 19, 0, 0], [44, 10, 1, 34, 0, 0], [70, 15, 1, 55, 0, 0], [100, 20, 1, 80, 0, 0], [134, 26, 1, 108, 0, 0],
  [172, 18, 2, 68, 0, 0], [196, 20, 2, 78, 0, 0], [242, 24, 2, 97, 0, 0], [292, 30, 2, 116, 0, 0], [346, 18, 2, 68, 2, 69],
  [404, 20, 4, 81, 0, 0], [466, 24, 2, 92, 2, 93], [532, 26, 4, 107, 0, 0], [581, 30, 3, 115, 1, 116], [655, 22, 5, 87, 1, 88],
  [733, 24, 5, 98, 1, 99], [815, 28, 1, 107, 5, 108], [901, 30, 5, 120, 1, 121], [991, 28, 3, 113, 4, 114], [1085, 28, 3, 107, 5, 108],
];
const ALIGN: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
];

// GF(256) arithmetic for Reed-Solomon
const EXP = new Array<number>(512), LOG = new Array<number>(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
    g = next;
  }
  return g;
}
function rsRemainder(data: number[], n: number): number[] {
  const g = rsGenerator(n);
  const res = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ res[0];
    res.shift(); res.push(0);
    for (let i = 0; i < n; i++) res[i] ^= mul(g[i + 1], f);
  }
  return res;
}

function utf8(s: string): number[] { return [...new TextEncoder().encode(s)]; }

export function pickVersion(len: number): number {
  for (let v = 1; v <= 20; v++) {
    const [, , b1, d1, b2, d2] = VERSIONS[v];
    const cap = b1 * d1 + b2 * d2;
    const header = v < 10 ? 2 : 3; // mode (4 bits) + count (8 or 16 bits) = 12 or 20 bits -> 1.5 / 2.5 bytes, rounded up
    if (len + header <= cap) return v;
  }
  throw new Error('Text is too long for a QR code');
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = utf8(text);
  const ver = pickVersion(bytes.length);
  const [total, ecLen, b1, d1, b2, d2] = VERSIONS[ver];
  const dataCap = b1 * d1 + b2 * d2;
  const size = ver * 4 + 17;

  // --- bit stream ---
  const bits: number[] = [];
  const push = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const cw: number[] = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; cw.length < dataCap; pad ^= 0xec ^ 0x11) cw.push(pad);

  // --- blocks + error correction, interleaved ---
  const blocks: number[][] = [];
  let pos = 0;
  for (let i = 0; i < b1 + b2; i++) { const n = i < b1 ? d1 : d2; blocks.push(cw.slice(pos, pos + n)); pos += n; }
  const ecs = blocks.map((b) => rsRemainder(b, ecLen));
  const out: number[] = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  if (out.length !== total) throw new Error('QR internal error: codeword count');

  // --- matrix ---
  const m: (boolean | null)[][] = Array.from({ length: size }, () => new Array(size).fill(null));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r: number, c: number, v: boolean) => { m[r][c] = v; fn[r][c] = true; };
  const finder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      const on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      set(r, c, on);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const ap = ALIGN[ver] ?? [];
  for (const r of ap) for (const c of ap) {
    if ((r === 6 && c === 6) || (r === 6 && c === ap[ap.length - 1]) || (r === ap[ap.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  set(size - 8, 8, true); // dark module
  // reserve format areas
  for (let i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, false); if (!fn[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { if (!fn[8][size - 1 - i]) set(8, size - 1 - i, false); if (!fn[size - 1 - i][8]) set(size - 1 - i, 8, false); }
  set(size - 8, 8, true);
  // version info (v >= 7)
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bitsV = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bitsV >>> i) & 1) === 1;
      const a = Math.floor(i / 3), b = (i % 3) + size - 11;
      set(a, b, bit); set(b, a, bit);
    }
  }

  // --- place data (zigzag) ---
  const dataBits: boolean[] = [];
  for (const c of out) for (let i = 7; i >= 0; i--) dataBits.push(((c >>> i) & 1) === 1);
  const place = (mask: number): boolean[][] => {
    const g = m.map((row) => row.slice());
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const c = right - j;
        const up = ((right + 1) & 2) === 0;
        const r = up ? size - 1 - v : v;
        if (fn[r][c]) continue;
        let bit = k < dataBits.length ? dataBits[k] : false;
        k++;
        const inv = [(r + c) % 2 === 0, r % 2 === 0, c % 3 === 0, (r + c) % 3 === 0, (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, ((r * c) % 2) + ((r * c) % 3) === 0, (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (((r + c) % 2) + ((r * c) % 3)) % 2 === 0][mask];
        if (inv) bit = !bit;
        g[r][c] = bit;
      }
    }
    // format info, EC level L = 01
    let f = (0b01 << 3) | mask;
    let rem = f;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fmt = ((f << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((fmt >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) g[i][8] = bit(i);
    g[7][8] = bit(6); g[8][8] = bit(7); g[8][7] = bit(8);
    for (let i = 9; i < 15; i++) g[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) g[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) g[size - 15 + i][8] = bit(i);
    g[size - 8][8] = true;
    return g as boolean[][];
  };
  const penalty = (g: boolean[][]): number => {
    let p = 0;
    for (let r = 0; r < size; r++) for (const horiz of [true, false]) {
      let run = 1;
      for (let i = 1; i < size; i++) {
        const a = horiz ? g[r][i] : g[i][r], b = horiz ? g[r][i - 1] : g[i - 1][r];
        if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
      }
    }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) if (g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 1][c + 1]) p += 3;
    const pat = [true, false, true, true, true, false, true, false, false, false, false];
    for (let r = 0; r < size; r++) for (let c = 0; c <= size - 11; c++) for (const horiz of [true, false]) {
      const get = (k: number) => (horiz ? g[r][c + k] : g[c + k][r]);
      if (pat.every((v, k) => get(k) === v) || pat.every((v, k) => get(10 - k) === v)) p += 40;
    }
    const dark = g.flat().filter(Boolean).length;
    p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return p;
  };
  let best = place(0), bp = penalty(best);
  for (let mask = 1; mask < 8; mask++) { const g = place(mask), pp = penalty(g); if (pp < bp) { best = g; bp = pp; } }
  return best;
}

/** SVG string for the QR code (4-module quiet zone). */
export function qrSvg(text: string, px = 4): string {
  const g = qrMatrix(text);
  const n = g.length + 8;
  let d = '';
  g.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + 4},${r + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
