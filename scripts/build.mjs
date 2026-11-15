// Builds the static site into docs/ (GitHub Pages serves this folder only).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('docs', { recursive: true });
await build({
  entryPoints: { app: 'src/main.tsx' }, bundle: true, minify: true, outdir: 'docs', format: 'iife', target: 'es2020',
  jsx: 'automatic', loader: { '.json': 'json', '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info',
});
copyFileSync('index.html', 'docs/index.html');
