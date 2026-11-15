// Builds the static site into docs/ (GitHub Pages serves this folder only).
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';

mkdirSync('docs', { recursive: true });
await build({
  entryPoints: { app: 'src/main.tsx' }, bundle: true, minify: true, outdir: 'docs', format: 'iife', target: 'es2020',
  jsx: 'automatic', loader: { '.json': 'json', '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info',
});
copyFileSync('index.html', 'docs/index.html');
// pdf.js is loaded only when a PDF is imported; its files are served next to the app.
mkdirSync('docs/vendor', { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  const src = `node_modules/pdfjs-dist/build/${f}`;
  if (existsSync(src)) copyFileSync(src, `docs/vendor/${f}`); else console.warn(`warning: ${src} not found, PDF import will be unavailable`);
}
mkdirSync('docs/media', { recursive: true });
for (const f of readdirSync('public/media')) copyFileSync(`public/media/${f}`, `docs/media/${f}`);
