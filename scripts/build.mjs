// Builds the static site into docs/ (GitHub Pages serves this folder only).
import { build } from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { writeServiceWorker } from './pwa.mjs';

mkdirSync('docs', { recursive: true });
await build({
  entryPoints: { app: 'src/main.tsx' }, bundle: true, minify: true, outdir: 'docs', format: 'iife', target: 'es2020',
  jsx: 'automatic', loader: { '.json': 'json', '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info',
});
copyFileSync('index.html', 'docs/index.html');
// Live sync settings (Phase 6.1). Empty url means sync is off.
if (existsSync('sync.config.json')) copyFileSync('sync.config.json', 'docs/sync.json');
// pdf.js is loaded only when a PDF is imported; its files are served next to the app.
mkdirSync('docs/vendor', { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  const src = `node_modules/pdfjs-dist/build/${f}`;
  if (existsSync(src)) copyFileSync(src, `docs/vendor/${f}`); else console.warn(`warning: ${src} not found, PDF import will be unavailable`);
}
// Optional offline model for the camera form check (README, "Camera form check"): copied only if the files were added.
if (existsSync('public/mediapipe')) cpSync('public/mediapipe', 'docs/mediapipe', { recursive: true });
mkdirSync('docs/media', { recursive: true });
for (const f of readdirSync('public/media')) copyFileSync(`public/media/${f}`, `docs/media/${f}`);
// Installable + offline (Phase 7.3): manifest and icons, then the service worker, which must be written LAST because its version is a hash of everything above.
copyFileSync('public/manifest.webmanifest', 'docs/manifest.webmanifest');
mkdirSync('docs/icons', { recursive: true });
for (const f of readdirSync('public/icons')) copyFileSync(`public/icons/${f}`, `docs/icons/${f}`);
const sw = writeServiceWorker();
console.log(`  docs/sw.js    version ${sw.version}, ${sw.files} files cached for offline`);
