// A tiny stand-in for Supabase's REST interface, used by tests and the browser check (the real service cannot be reached from the
// build sandbox). It mimics the table's row-level security: a request only sees or writes rows whose sync_key equals its x-sync-key header.
import http from 'node:http';

export function startFake(port = 0) {
  const rows = new Map(); // `${sync_key}|${slice}` -> row
  const log = [];
  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-sync-key, apikey, authorization, content-type, prefer', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const key = req.headers['x-sync-key'] ?? '';
    const send = (code, body) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    if (!req.headers.apikey) return send(401, { message: 'No API key' });
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/rest/v1/rehab_sync') return send(404, { message: 'not found' });
    if (req.method === 'GET') {
      const k = /^eq\.(.*)$/.exec(url.searchParams.get('sync_key') ?? '')?.[1];
      const s = /^eq\.(.*)$/.exec(url.searchParams.get('slice') ?? '')?.[1];
      log.push(`GET ${s}`);
      const r = rows.get(`${k}|${s}`);
      return send(200, r && r.sync_key === key ? [{ data: r.data, updated_at: r.updated_at }] : []); // row-level security: other keys see nothing
    }
    if (req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const row = JSON.parse(b);
        if (row.sync_key !== key || !/^[0-9a-f]{32}$/.test(row.sync_key) || !['up', 'down'].includes(row.slice)) return send(403, { code: '42501', message: 'new row violates row-level security policy' });
        log.push(`POST ${row.slice}`);
        rows.set(`${row.sync_key}|${row.slice}`, { ...row, updated_at: new Date().toISOString() + Math.random() });
        send(201);
      });
      return;
    }
    send(405, {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, rows, log, close: () => new Promise((r) => server.close(r)) })));
}
if (process.argv[1]?.endsWith('fake-supabase.mjs')) { const f = await startFake(Number(process.argv[2] ?? 8790)); console.log('fake supabase on', f.port); }
