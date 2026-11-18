// A tiny stand-in for Supabase, used by tests and the browser check (the real service cannot be reached from the build sandbox).
// It mimics row-level security as written in supabase/schema.sql and supabase/schema-v2.sql, and the Auth endpoints the app uses.
//   anon (no user token): sees only rows whose sync_key equals its x-sync-key header; may write "up"; may write "down" only while the key is unclaimed.
//   authenticated physio (user token): sees both slices of keys they own; may write only "down" for keys they own.
//   authenticated patient account (schema-v3): claims a key once (needs the key); then reads both slices and writes only "up";
//   once a key is claimed the secret link (anon) no longer works for it.
import http from 'node:http';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

export function startFake(port = 0, opts = {}) {
  const rows = new Map(); // `${sync_key}|${slice}` -> row
  const owners = new Map(); // sync_key -> physio user id
  const patients = new Map(); // sync_key -> { patientId, email, invite, created_at } (schema-v3 rehab_patient)
  const claimHashes = new Map(); // sync_key -> sha256 hex (schema-v4 rehab_owner.claim_hash)
  const users = new Map(); // email -> { id, password }
  const access = new Map(); // access token -> user id
  const refresh = new Map(); // refresh token -> user id
  const log = [];
  const issue = (email, id) => {
    const a = 'at_' + randomBytes(12).toString('hex'), r = 'rt_' + randomBytes(12).toString('hex');
    access.set(a, id); refresh.set(r, id);
    return { access_token: a, refresh_token: r, token_type: 'bearer', expires_in: opts.ttlSeconds ?? 3600, user: { id, email } };
  };
  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-sync-key, apikey, authorization, content-type, prefer', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const key = req.headers['x-sync-key'] ?? '';
    const send = (code, body) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    if (!req.headers.apikey) return send(401, { message: 'No API key' });
    const url = new URL(req.url, 'http://x');
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const userId = bearer ? access.get(bearer) : undefined; // undefined: anon
    if (bearer && !userId && bearer !== req.headers.apikey) return send(401, { message: 'JWT invalid' });
    const body = (cb) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { cb(b ? JSON.parse(b) : {}); } catch { send(400, { message: 'bad json' }); } }); };

    // ---- Auth (GoTrue) ----
    if (url.pathname === '/auth/v1/signup' && req.method === 'POST') return body((j) => {
      if (!j.email || !j.password || String(j.password).length < 6) return send(422, { msg: 'Password should be at least 6 characters.' });
      if (users.has(j.email)) return send(422, { msg: 'User already registered' });
      const id = randomUUID(); users.set(j.email, { id, password: j.password });
      log.push('SIGNUP');
      return opts.confirmEmail ? send(200, { id, email: j.email }) : send(200, issue(j.email, id));
    });
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') return body((j) => {
      const gt = url.searchParams.get('grant_type');
      if (gt === 'password') {
        const u = users.get(j.email);
        if (!u || u.password !== j.password) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        log.push('LOGIN'); return send(200, issue(j.email, u.id));
      }
      if (gt === 'refresh_token') {
        const id = refresh.get(j.refresh_token);
        if (!id) return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        refresh.delete(j.refresh_token);
        const email = [...users].find(([, u]) => u.id === id)?.[0];
        log.push('REFRESH'); return send(200, issue(email, id));
      }
      return send(400, { error: 'unsupported_grant_type' });
    });
    if (url.pathname === '/auth/v1/recover' && req.method === 'POST') return body((j) => { log.push(`RECOVER ${j.email}`); return send(200, {}); });
    if (url.pathname === '/auth/v1/user' && req.method === 'PUT') return body((j) => {
      if (!userId) return send(401, { msg: 'invalid token' });
      if (!j.password || String(j.password).length < 6) return send(422, { msg: 'Password should be at least 6 characters.' });
      const em = [...users].find(([, u]) => u.id === userId)?.[0]; if (em) users.get(em).password = j.password;
      log.push('PASSWORD_SET'); return send(200, { id: userId });
    });
    if (url.pathname === '/auth/v1/logout' && req.method === 'POST') { if (bearer) access.delete(bearer); log.push('LOGOUT'); return send(204); }

    if (url.pathname === '/rest/v1/rpc/rehab_delete_my_account' && req.method === 'POST') {
      if (!userId) return send(401, { message: 'not signed in' });
      for (const [k, v] of [...patients]) if (v.patientId === userId) patients.delete(k);
      const em = [...users].find(([, u]) => u.id === userId)?.[0]; if (em) users.delete(em);
      access.delete(bearer); log.push('ACCOUNT_DELETED'); return send(204);
    }

    // ---- Ownership table ----
    if (url.pathname === '/rest/v1/rehab_owner' && req.method === 'POST') return body((j) => {
      if (!userId) return send(401, { message: 'permission denied for table rehab_owner' }); // anon has no policy here
      if (!/^[0-9a-f]{32}$/.test(j.sync_key ?? '')) return send(400, { message: 'check constraint violated' });
      if (!owners.has(j.sync_key)) { owners.set(j.sync_key, userId); if (j.claim_hash) claimHashes.set(j.sync_key, j.claim_hash); } // on conflict do nothing
      log.push('CLAIM'); return send(201);
    });

    if (url.pathname === '/rest/v1/rehab_owner' && req.method === 'PATCH') return body((j) => {
      const k = /^eq\.(.*)$/.exec(url.searchParams.get('sync_key') ?? '')?.[1];
      if (!userId || !k || owners.get(k) !== userId) return send(204); // update policy: only the owner's own row
      if (typeof j.claim_hash === 'string') claimHashes.set(k, j.claim_hash);
      log.push('SET_PIN'); return send(204);
    });
    if (url.pathname === '/rest/v1/rehab_owner' && req.method === 'DELETE') {
      const k = /^eq\.(.*)$/.exec(url.searchParams.get('sync_key') ?? '')?.[1];
      if (userId && k && owners.get(k) === userId) { owners.delete(k); claimHashes.delete(k); log.push('OWNER_ERASED'); }
      return send(204);
    }

    // ---- Patient accounts (schema-v3) ----
    const emailOf = (id) => [...users].find(([, u]) => u.id === id)?.[0];
    if (url.pathname === '/rest/v1/rehab_patient') {
      if (!userId) return send(401, { message: 'permission denied for table rehab_patient' });
      if (req.method === 'POST') return body((j) => {
        if (!/^[0-9a-f]{32}$/.test(j.sync_key ?? '') || typeof j.invite !== 'string' || j.invite.length < 20) return send(400, { message: 'check constraint violated' });
        if (j.sync_key !== key) return send(403, { code: '42501', message: 'new row violates row-level security policy' }); // claiming needs the secret link
        if (patients.has(j.sync_key)) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        const need = claimHashes.get(j.sync_key);
        if (need) {
          const got = typeof j.pin === 'string' ? createHash('sha256').update(j.pin).digest('hex') : '';
          if (got !== need) return send(403, { code: '42501', message: 'claim PIN required or wrong' });
        }
        patients.set(j.sync_key, { patientId: userId, email: emailOf(userId), invite: j.invite, created_at: new Date().toISOString() });
        log.push('PATIENT_CLAIM'); return send(201);
      });
      if (req.method === 'GET') {
        const k = /^eq\.(.*)$/.exec(url.searchParams.get('sync_key') ?? '')?.[1];
        const out = [...patients].filter(([sk, r]) => (!k || sk === k) && (r.patientId === userId || owners.get(sk) === userId)).map(([sk, r]) => ({ sync_key: sk, email: r.email, invite: r.invite, created_at: r.created_at }));
        return send(200, out);
      }
      if (req.method === 'DELETE') {
        const k = /^eq\.(.*)$/.exec(url.searchParams.get('sync_key') ?? '')?.[1];
        if (k && owners.get(k) === userId) { patients.delete(k); log.push('PATIENT_RESET'); }
        return send(204);
      }
      return send(405, {});
    }

    // ---- Sync table ----
    if (url.pathname !== '/rest/v1/rehab_sync') return send(404, { message: 'not found' });
    if (req.method === 'GET') {
      const k = /^eq\.(.*)$/.exec(url.searchParams.get('sync_key') ?? '')?.[1];
      const s = /^eq\.(.*)$/.exec(url.searchParams.get('slice') ?? '')?.[1];
      log.push(`GET ${s}`);
      const r = rows.get(`${k}|${s}`);
      const visible = r && (userId ? (owners.get(r.sync_key) === userId || patients.get(r.sync_key)?.patientId === userId) : (r.sync_key === key && !patients.has(r.sync_key)));
      return send(200, visible ? [{ data: r.data, updated_at: r.updated_at }] : []); // row-level security: everything else is invisible
    }
    if (req.method === 'POST') return body((row) => {
      const valid = /^[0-9a-f]{32}$/.test(row.sync_key ?? '') && ['up', 'down'].includes(row.slice);
      const allowed = valid && (userId
        ? (owners.get(row.sync_key) === userId && row.slice === 'down') || (patients.get(row.sync_key)?.patientId === userId && row.slice === 'up')
        : row.sync_key === key && !patients.has(row.sync_key) && (row.slice === 'up' || !owners.has(row.sync_key)));
      if (!allowed) return send(403, { code: '42501', message: 'new row violates row-level security policy' });
      log.push(`POST ${row.slice}`);
      rows.set(`${row.sync_key}|${row.slice}`, { ...row, updated_at: new Date().toISOString() + Math.random() });
      send(201);
    });
    if (req.method === 'DELETE') { // schema-v4: the owning physio may erase a patient's rows
      const k = /^eq\.(.*)$/.exec(url.searchParams.get('sync_key') ?? '')?.[1];
      if (userId && k && owners.get(k) === userId) { rows.delete(`${k}|up`); rows.delete(`${k}|down`); log.push('SYNC_ERASED'); }
      return send(204);
    }
    send(405, {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port, rows, owners, patients, claimHashes, users, access, log,
    revokeAccess: () => access.clear(), // simulate expired access tokens (refresh tokens still work)
    close: () => new Promise((r) => server.close(r)),
  })));
}
if (process.argv[1]?.endsWith('fake-supabase.mjs')) { const f = await startFake(Number(process.argv[2] ?? 8790)); console.log('fake supabase on', f.port); }
