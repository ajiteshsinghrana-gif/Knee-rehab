// Supabase Edge Function (Deno): whatsapp
//
// SCAFFOLD. Written without a WhatsApp Business number, so it has NOT been tested against Meta. It does three things:
//   GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...   Meta's webhook handshake
//   GET  ?action=status    (physio signed in)  says whether the secrets below are set; never returns their values
//   POST ?action=send      (physio signed in)  sends ONE approved template message to ONE number
//   POST (no action)       Meta's webhook: checks the X-Hub-Signature-256 signature, then acknowledges
//
// NOT DONE YET (needs the number to test; see WHATSAPP.md "What is left"): mapping an incoming reply to a patient, running the chat
// flow on the server (src/whatsapp/flow.ts is pure and can be reused), saving the check-in, the reminder schedule, delivery receipts.
// Inbound messages are therefore acknowledged and NOT stored.
//
// Deploy:
//   supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_VERIFY_TOKEN=<any long random string> WHATSAPP_APP_SECRET=...
//   supabase functions deploy whatsapp
// In Meta's WhatsApp > Configuration set the callback URL to  https://<project>.supabase.co/functions/v1/whatsapp  and the same verify token.
// The Meta webhook calls cannot carry a Supabase JWT, so deploy with:  supabase functions deploy whatsapp --no-verify-jwt
// (the physio actions check the signed-in physio themselves, below).

const GRAPH = Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v21.0';
const REQUIRED = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'];
const ALLOWED_TEMPLATES = new Set(['rp_checkin_prompt', 'rp_daily_reminder', 'rp_missed_checkin', 'rp_appointment', 'rp_plan_changed', 'rp_form_reply']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const missing = (): string[] => REQUIRED.filter((k) => !Deno.env.get(k));

/** The caller must be a signed-in physio: ask Supabase Auth who the bearer token belongs to. */
async function signedIn(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!auth || !url || !anon) return false;
  const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: anon } });
  return r.ok;
}

async function validSignature(req: Request, raw: string): Promise<boolean> {
  const secret = Deno.env.get('WHATSAPP_APP_SECRET');
  const sig = req.headers.get('x-hub-signature-256');
  if (!secret || !sig?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const want = Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
  const got = sig.slice(7);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // 1. Meta's webhook handshake
  if (req.method === 'GET' && url.searchParams.get('hub.mode') === 'subscribe') {
    const ok = url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN') && !!Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('Forbidden', { status: 403 });
  }

  // 2. Status for the setup screen
  if (req.method === 'GET' && action === 'status') {
    if (!(await signedIn(req))) return json(401, { error: 'Sign in as a physio.' });
    const m = missing();
    return json(200, { configured: m.length === 0, missing: m });
  }

  // 3. Send one template message
  if (req.method === 'POST' && action === 'send') {
    if (!(await signedIn(req))) return json(401, { error: 'Sign in as a physio.' });
    const m = missing();
    if (m.length) return json(503, { configured: false, missing: m, error: 'WhatsApp is not connected yet.' });
    let b: { to?: string; template?: string; lang?: string; vars?: unknown };
    try { b = await req.json(); } catch { return json(400, { error: 'Bad request.' }); }
    if (!b.to || !/^\+\d{8,15}$/.test(b.to)) return json(400, { error: 'The number must look like +919876543210.' });
    if (!b.template || !ALLOWED_TEMPLATES.has(b.template)) return json(400, { error: 'Unknown template.' });
    const lang = b.lang === 'hi' || b.lang === 'bn' ? b.lang : 'en';
    const vars = Array.isArray(b.vars) ? b.vars.map((v) => String(v).slice(0, 60)) : [];
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: b.to.slice(1), type: 'template',
        template: { name: b.template, language: { code: lang }, components: vars.length ? [{ type: 'body', parameters: vars.map((text) => ({ type: 'text', text })) }] : [] },
      }),
    });
    if (!r.ok) return json(502, { error: `WhatsApp refused the message (${r.status}).` });
    return json(200, { ok: true });
  }

  // 4. Meta's webhook: verify the signature, then acknowledge. Replies are not stored yet (see the header).
  if (req.method === 'POST' && !action) {
    const raw = await req.text();
    if (!(await validSignature(req, raw))) return new Response('Forbidden', { status: 403 });
    return new Response('ok', { status: 200 });
  }

  return json(404, { error: 'Not found.' });
});
