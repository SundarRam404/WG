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
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function itemsFor(cfg) { return (cfg.items || []).slice(); }

export function due(cfg, log, now) {
  const out = [];
  const today = (log && log[now.key]) || { done: {}, water: [] };
  const done = today.done || {};
  // hair wash: one heads-up the night before, at hairEve (default 22:00)
  const hd = cfg.hairDays || [];
  if (hd.includes((now.dow + 1) % 7) && now.m === mins(cfg.hairEve || '22:00'))
    out.push({ title: '🪮 Hair wash tomorrow', body: `${DAYS[(now.dow + 1) % 7]} is wash day · get ready tonight`, tag: 'hair', url: './#today' });
  // and a morning ping on the wash day itself (default 06:15), skipped if already washed
  if (hd.includes(now.dow) && !done.hair && now.m === mins(cfg.hairDay || '06:15'))
    out.push({ title: '🪮 Hair wash today', body: `It's ${DAYS[now.dow]}, wash day · tap Done once washed`, tag: 'hair', url: './#today' });
  for (const it of itemsFor(cfg)) {
    if (done[it.id]) continue;
    const t = mins(it.time);
    if (t === now.m) out.push({ title: `🩸 ${it.title}`, body: it.sub ? `${it.sub} · tap to tick it off` : 'tap to tick it off', tag: it.id, url: './#today' });
    else if (cfg.nudge && t + 30 === now.m) out.push({ title: `Still pending: ${it.title}`, body: 'it was due 30 min ago', tag: it.id, url: './#today' });
  }
  const w = cfg.waterRemind || {};
  if (w.on && w.start && w.end && w.every) {
    const s = mins(w.start), e = mins(w.end), every = Math.max(15, +w.every);
    if (now.m >= s && now.m <= e && (now.m - s) % every === 0) {
      const goal = +cfg.waterGoal || 2500;
      const drunk = (today.water || []).reduce((a, x) => a + (+x.ml || 0), 0);
      const pace = Math.round(goal * (now.m - s) / (e - s));
      const glass = +cfg.glass || 250;
      const behind = drunk + glass / 2 < pace;
      if (drunk < goal && (!w.behindOnly || behind)) {          // every interval until the goal is met
        const left = ((goal - drunk) / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
        const n = Math.ceil((pace - drunk) / glass);
        out.push({ title: '💧 Time for the elixir', body: behind ? `${drunk} ml so far, about ${n} glass${n > 1 ? 'es' : ''} behind` : `a sip now, my Queen · ${left} L left today`, tag: 'water', url: './#water' });
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
  const n = k => f[k] ? +(f[k].integerValue || f[k].doubleValue || 0) : 0;
  return { cfg: s('cfg') ? JSON.parse(s('cfg')) : null, log: s('log') ? JSON.parse(s('log')) : {}, sub: s('sub') ? JSON.parse(s('sub')) : null,
    subS: s('subS') ? JSON.parse(s('subS')) : null, ev: s('ev') ? JSON.parse(s('ev')) : [], evDone: n('evDone') };
}

/* mark Sundar's events as delivered (touches only the evDone field) */
async function markDone(env, t) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/${env.DOC_PATH}?key=${env.FIREBASE_KEY}&updateMask.fieldPaths=evDone`;
  const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { evDone: { integerValue: String(t) } } }) });
  if (!r.ok) throw new Error(`firestore write ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/* her news for Sundar: queued by her phone in "ev", delivered here once */
export function pendingFor(ev, evDone, nowMs) {
  return (ev || []).filter(e => e && e.t > evDone && nowMs - e.t < 30 * 60e3).sort((a, b) => a.t - b.t);
}

async function run(env, at) {
  const { cfg, log, sub, subS, ev, evDone } = await loadDoc(env);
  if (!cfg) return { skipped: 'no config yet' };
  const now = nowIn(cfg.tz || 'Asia/Kolkata', at);
  const results = [];
  // her reminders → her phone
  if (sub && sub.endpoint) for (const m of due(cfg, log, now)) results.push({ tag: m.tag, ...(await sendPush(sub, m, env)) });
  // her news → Sundar's phone
  const news = pendingFor(ev, evDone, Date.now());
  if (news.length) {
    if (subS && subS.endpoint) for (const e of news) results.push({ tag: 'him:' + e.tag, ...(await sendPush(subS, { title: e.title, body: e.body, tag: 'him-' + e.tag + '-' + e.t, url: './#today' }, env)) });
    await markDone(env, Math.max(...news.map(e => e.t)));
  }
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
        const { sub, subS } = await loadDoc(env);
        const him = u.searchParams.get('who') === 'him', s = him ? subS : sub;
        if (!s) return new Response(him ? "Sundar's phone isn't linked yet. On his phone: Me → this phone → Sundar's, then Ping me when she finishes." : 'No phone linked yet. Open Domso → Me → Enable reminders.', { status: 404 });
        const r = await sendPush(s, him ? { title: '🩸 Domso', body: "You'll hear when she seals every rite.", tag: 'test', url: './#today' } : { title: '🩸 Domso', body: 'Reminders are working. Sleep well, Queen.', tag: 'test', url: './#today' }, env);
        return Response.json(r);
      } catch (e) { return new Response(String(e), { status: 500 }); }
    }
    return new Response('domso reminders are alive 🩸');
  },
};
