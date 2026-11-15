// Regenerates the NEEDS_PHYSIO_SIGNOFF list inside README.md from the packs (single source of truth).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'signoff-')), 'run.mjs');
await build({
  stdin: {
    contents: `import { LIBRARY } from ${JSON.stringify(process.cwd() + '/src/exercises/library.ts')};
import { PACK_LIST } from ${JSON.stringify(process.cwd() + '/src/engine/packs.ts')};
import { collectSignoffs, collectLibrarySignoffs } from ${JSON.stringify(process.cwd() + '/src/engine/signoff.ts')};
const lines = [];
for (const p of PACK_LIST) {
  const items = collectSignoffs(p).filter((x) => x.needsSignoff);
  lines.push('', '#### ' + p.id + ' (' + items.length + ' values)', '', '| Where | Value | Source tag |', '|---|---|---|');
  for (const i of items) lines.push('| ' + i.where.replace(p.id + ': ', '') + ' | ' + i.value.replace(/\\|/g, '/') + ' | ' + i.source + ' |');
}
{ const items = collectLibrarySignoffs(LIBRARY).filter((x) => x.needsSignoff);
lines.push('', '#### exercise library (' + items.length + ' values)', '', '| Where | Value | Source tag |', '|---|---|---|');
for (const i of items) lines.push('| ' + i.where + ' | ' + i.value.replace(/\\|/g, '/') + ' | ' + i.source + ' |'); }
console.log(lines.join('\\n'));`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: out, loader: { '.json': 'json' }, logLevel: 'error',
});
const { execFileSync } = await import('node:child_process');
const md = execFileSync('node', [out], { encoding: 'utf8' });
const readme = readFileSync('README.md', 'utf8');
const a = '<!-- SIGNOFF:START -->', b = '<!-- SIGNOFF:END -->';
writeFileSync('README.md', readme.replace(new RegExp(`${a}[\\s\\S]*${b}`), `${a}\n${md}\n${b}`));
console.log('README.md signoff list updated');
