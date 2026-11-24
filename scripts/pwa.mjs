// Builds the offline pieces of the site (Phase 7.3): docs/sw.js from scripts/sw.template.js. Used by build.mjs and by the tests.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/** Files under docs/<dir>, sub-folders included (media/gif/*.gif). */
function walk(docs, dir) {
  const out = [];
  for (const e of readdirSync(`${docs}/${dir}`, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) out.push(...(e.isDirectory() ? walk(docs, `${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  return out;
}

/** Every file the app needs to open offline, as paths relative to docs/. */
export function precacheList(docs = 'docs') {
  const files = ['index.html', 'app.js', 'app.css', 'manifest.webmanifest'];
  for (const dir of ['icons', 'media']) if (existsSync(`${docs}/${dir}`)) files.push(...walk(docs, dir));
  return files;
}
/** Changes whenever any cached file changes, so every deploy that changes the app gives phones a new version to update to. */
export function siteVersion(docs = 'docs', template = 'scripts/sw.template.js') {
  const h = createHash('sha256');
  h.update(readFileSync(template));
  for (const f of precacheList(docs)) { h.update(f); h.update(readFileSync(`${docs}/${f}`)); }
  return h.digest('hex').slice(0, 12);
}
export function writeServiceWorker(docs = 'docs', template = 'scripts/sw.template.js') {
  const list = precacheList(docs);
  const src = readFileSync(template, 'utf8').replace('__VERSION__', siteVersion(docs, template)).replace('__PRECACHE__', JSON.stringify(list));
  writeFileSync(`${docs}/sw.js`, src);
  return { version: siteVersion(docs, template), files: list.length };
}
