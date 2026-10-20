/* Domso reminder worker
 * Runs every minute (Cloudflare cron). Reads her routine + today's ticks
 * from Firestore (shared/domso) and sends a Web Push when a rite is due.
 * Secrets: VAPID_PRIVATE_JWK, TEST_TOKEN.  Vars: see wrangler.toml.
 */

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/* RFC 8291 aes128gcm payload encryption */
export async function encryptPayload(payload, p256dh, auth) {
  const uaPub = unb64u(p256dh), authSecret = unb64u(auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

/* VAPID JWT (ES256) */
export async function vapidHeader(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function sendPush(sub, msg, env) {
  const body = await encryptPayload(JSON.stringify(msg), sub.keys.p256dh, sub.keys.auth);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, env),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '1800',
      Urgency: 'high',
    },
    body,
  });
  return { status: r.status, text: r.ok ? '' : (await r.text()).slice(0, 200) };
}

/* ---- schedule logic (mirrors the app) ---- */
const mins = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function nowIn(tz, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(at).map(x => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { key: `${p.year}-${p.month}-${p.day}`, m: (+p.hour % 24) * 60 + +p.minute, dow };
}
function itemsFor(cfg, dow) {
  const list = (cfg.items || []).slice();
  if ((cfg.hairDays || []).includes(dow)) list.push({ id: 'hair', title: 'Hair wash', sub: 'wash day', time: cfg.hairTime || '10:00' });
  return list;
}

export function due(cfg, log, now) {
  const out = [];
  const today = (log && log[now.key]) || { done: {}, water: [] };
  const done = today.done || {};
  for (const it of itemsFor(cfg, now.dow)) {
    if (done[it.id]) continue;
    const t = mins(it.time);
    if (t === now.m) out.push({ title: `🩸 ${it.title}`, body: it.sub ? `${it.sub} · tap to tick it off` : 'tap to tick it off', tag: it.id, url: './#today' });
    else if (cfg.nudge && t + 30 === now.m) out.push({ title: `Still pending: ${it.title}`, body: 'it was due 30 min ago', tag: it.id, url: './#today' });
  }
  const w = cfg.waterRemind || {};
  if (w.on && w.start && w.end && w.every) {
    const s = mins(w.start), e = mins(w.end), every = Math.max(15, +w.every);
    if (now.m > s && now.m <= e && (now.m - s) % every === 0) {
      const goal = +cfg.waterGoal || 2500;
      const drunk = (today.water || []).reduce((a, x) => a + (+x.ml || 0), 0);
      const pace = Math.round(goal * (now.m - s) / (e - s));
      const glass = +cfg.glass || 250;
      if (drunk < goal && drunk + glass / 2 < pace) {
        const behind = Math.ceil((pace - drunk) / glass);
        out.push({ title: '💧 Time for the elixir', body: `${drunk} ml so far, about ${behind} glass${behind > 1 ? 'es' : ''} behind`, tag: 'water', url: './#water' });
      }
    }
  }
  return out;
}

async function loadDoc(env) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/${env.DOC_PATH}?key=${env.FIREBASE_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`firestore ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const f = (await r.json()).fields || {};
  const s = k => (f[k] && f[k].stringValue) || '';
  return { cfg: s('cfg') ? JSON.parse(s('cfg')) : null, log: s('log') ? JSON.parse(s('log')) : {}, sub: s('sub') ? JSON.parse(s('sub')) : null };
}

async function run(env, at) {
  const { cfg, log, sub } = await loadDoc(env);
  if (!cfg || !sub || !sub.endpoint) return { skipped: 'no config or no subscription yet' };
  const now = nowIn(cfg.tz || 'Asia/Kolkata', at);
  const msgs = due(cfg, log, now);
  const results = [];
  for (const m of msgs) results.push({ tag: m.tag, ...(await sendPush(sub, m, env)) });
  return { at: `${now.key} ${hhmm(now.m)}`, sent: results };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env, new Date(event.scheduledTime)).then(r => console.log(JSON.stringify(r)), e => console.error(e.stack || e)));
  },
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/test') {
      if (!env.TEST_TOKEN || u.searchParams.get('t') !== env.TEST_TOKEN) return new Response('nope', { status: 403 });
      try {
        const { sub } = await loadDoc(env);
        if (!sub) return new Response('No phone linked yet. Open Domso → Me → Enable reminders.', { status: 404 });
        const r = await sendPush(sub, { title: '🩸 Domso', body: 'Reminders are working. Sleep well, Queen.', tag: 'test', url: './#today' }, env);
        return Response.json(r);
      } catch (e) { return new Response(String(e), { status: 500 }); }
    }
    return new Response('domso reminders are alive 🩸');
  },
};
