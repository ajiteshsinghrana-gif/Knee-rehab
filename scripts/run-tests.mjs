// Runs tests/*.test.ts. Uses real vitest when installed; otherwise bundles with esbuild + a tiny shim.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (existsSync('node_modules/vitest') && !process.env.FORCE_SHIM) {
  process.exit(spawnSync('npx', ['vitest', 'run'], { stdio: 'inherit' }).status ?? 1);
}
const esbuild = await import('esbuild');
const shim = resolve('scripts/vitest-shim.ts');
const out = mkdtempSync(join(tmpdir(), 'rehab-tests-'));
let failed = 0;
for (const f of readdirSync('tests').filter((x) => x.endsWith('.test.ts'))) {
  console.log(`\n== ${f}`);
  const outfile = join(out, f.replace('.ts', '.mjs'));
  await esbuild.build({
    stdin: {
      contents: `import ${JSON.stringify(resolve('tests', f))};\nimport { __run } from ${JSON.stringify(shim)};\nprocess.exit((await __run()) ? 1 : 0);\n`,
      resolveDir: process.cwd(), sourcefile: 'entry.ts', loader: 'ts',
    },
    outfile, bundle: true, platform: 'node', format: 'esm', loader: { '.json': 'json' }, alias: { vitest: shim }, logLevel: 'error',
  });
  if (spawnSync('node', [outfile], { stdio: 'inherit' }).status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
