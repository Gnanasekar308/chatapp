// ============================================================================
// Our Chat — Cloudflare Worker v2  (push + scheduled push + TURN credentials)
//
// ❗ இந்த file-ல் எந்த ரகசிய key-ம் இல்லை. இதை GitHub-ல் ஏற்றலாம், ஆனாலும்
//    Cloudflare-ல் மட்டும் வைத்திருப்பதே நல்லது.
//
// Cloudflare → Workers → ourchat-push → Settings → Variables and Secrets:
//   VAPID_PRIVATE   (Secret)  = keygen.html தந்த Private key
//   VAPID_PUBLIC    (Text)    = keygen.html தந்த Public key
//   VAPID_SUBJECT   (Text)    = mailto:உங்கள்-email
//   MEMBERS         (Text)    = email1@gmail.com,email2@gmail.com
//   ALLOWED_ORIGIN  (Text)    = https://gnanasekar308.github.io
//   FIREBASE_PROJECT(Text)    = our-chat-57278
//   TURN_KEY_ID     (Text)    = (விருப்பம்) Cloudflare TURN key ID
//   TURN_API_TOKEN  (Secret)  = (விருப்பம்) Cloudflare TURN API token
// Also needs: KV binding named SCHED, and Cron Trigger "* * * * *"
// ============================================================================

const ALLOW = /^https:\/\/([\w.-]+\.)?(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)\//;
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const DAY = 86400000;

const te = new TextEncoder(), td = new TextDecoder();
const b64u = {
  dec: s => Uint8Array.from(
    atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")),
    c => c.charCodeAt(0)
  ),
  enc: b => btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
};

// ---------- 1) Firebase ID token சரிபார்ப்பு (உங்கள் இருவர் மட்டுமே) ----------
let _jwks = null, _jwksAt = 0;
async function jwks() {
  if (_jwks && Date.now() - _jwksAt < 3600e3) return _jwks;
  const r = await fetch(JWKS_URL);
  _jwks = await r.json();
  _jwksAt = Date.now();
  return _jwks;
}

async function verifyToken(tok, env) {
  const [h, p, s] = (tok || "").split(".");
  if (!s) throw new Error("format");
  const head = JSON.parse(td.decode(b64u.dec(h)));
  const pay = JSON.parse(td.decode(b64u.dec(p)));
  if (head.alg !== "RS256") throw new Error("alg");
  const k = (await jwks()).keys.find(x => x.kid === head.kid);
  if (!k) throw new Error("kid");
  const key = await crypto.subtle.importKey(
    "jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u.dec(s), te.encode(h + "." + p));
  if (!ok) throw new Error("signature");
  const proj = env.FIREBASE_PROJECT || "our-chat-57278";
  if (pay.aud !== proj || pay.iss !== "https://securetoken.google.com/" + proj) throw new Error("claims");
  if (!pay.sub || pay.exp < Date.now() / 1000) throw new Error("expired");
  if (!pay.email_verified) throw new Error("unverified");
  const members = (env.MEMBERS || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
  if (!members.includes((pay.email || "").toLowerCase())) throw new Error("not a member");
  return pay;
}

// ---------- 2) Web Push (VAPID) ----------
let _sk = null;
async function signingKey(env) {
  if (_sk) return _sk;
  const pub = b64u.dec(env.VAPID_PUBLIC);
  _sk = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), d: env.VAPID_PRIVATE, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  return _sk;
}

async function makeJwt(aud, key, env) {
  const enc = o => b64u.enc(te.encode(JSON.stringify(o)));
  const data =
    enc({ typ: "JWT", alg: "ES256" }) + "." +
    enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@example.com" });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(data));
  return data + "." + b64u.enc(sig);
}

async function sendAll(eps, env) {
  const key = await signingKey(env);
  return Promise.all(eps.map(async u => {
    try {
      const jwt = await makeJwt(new URL(u).origin, key, env);
      const r = await fetch(u, {
        method: "POST",
        headers: { TTL: "86400", Urgency: "high", Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}` }
      });
      return r.status; // 201 = வெற்றி, 404/410 = subscription காலாவதி
    } catch (e) { return 0; }
  }));
}

// ---------- 3) TURN credentials (Cloudflare Realtime TURN) ----------
async function turnServers(env) {
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return [];
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: 86400 })
    });
    if (!r.ok) return [];
    const j = await r.json();
    const list = Array.isArray(j.iceServers) ? j.iceServers : (j.iceServers ? [j.iceServers] : []);
    // port 53 URL-கள் சில browser-ல் தாமதம் உண்டாக்கும்; நீக்கிவிடுகிறோம்
    return list.map(s => ({ ...s, urls: [].concat(s.urls).filter(u => !/:53(\?|$)/.test(u)) }));
  } catch (e) { return []; }
}

// ---------- 4) HTTP handler ----------
export default {
  async fetch(req, env) {
    const cors = {
      "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "86400",
      "vary": "origin"
    };
    const json = (o, s = 200) =>
      new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return new Response("ok", { headers: cors });

    // யார் கேட்கிறார்கள்? — Firebase token இல்லையென்றால் உள்ளே விடாது
    try {
      await verifyToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), env);
    } catch (e) {
      return json({ error: "unauthorized" }, 401);
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }

    if (body.action === "turn") return json({ iceServers: await turnServers(env) });

    // action: "status" — ஆப்பின் 🩺 சோதனைக்கு (ரகசியம் எதுவும் திருப்பாது)
    if (body.action === "status") {
      let kv = false, match = false;
      try { await env.SCHED.list({ limit: 1 }); kv = true; } catch (e) {}
      try {
        const sk = await signingKey(env);
        const pub = b64u.dec(env.VAPID_PUBLIC);
        const vk = await crypto.subtle.importKey(
          "jwk",
          { kty: "EC", crv: "P-256", x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ext: true },
          { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
        );
        const data = te.encode("ourchat");
        const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, sk, data);
        match = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk, sig, data);
      } catch (e) {}
      const members = (env.MEMBERS || "").split(",").map(x => x.trim()).filter(Boolean).length;
      return json({ ok: true, kv, vapidKeysMatch: match, vapidPublic: env.VAPID_PUBLIC || "", members, turn: (await turnServers(env)).length > 0 });
    }

    // action: "push"
    const eps = (body.endpoints || [])
      .filter(u => typeof u === "string" && ALLOW.test(u))
      .slice(0, 10);
    if (!eps.length) return json({ res: [] });

    const at = Number(body.at || 0);
    if (at > Date.now() + 20000) {
      if (at > Date.now() + 30 * DAY) return json({ error: "too far" }, 400);
      const l = await env.SCHED.list({ prefix: "q:" });
      if (l.keys.length >= 100) return json({ error: "queue full" }, 429);
      const k = "q:" + String(at).padStart(14, "0") + ":" + crypto.randomUUID();
      await env.SCHED.put(k, JSON.stringify(eps), { expirationTtl: 40 * 86400 });
      return json({ queued: true });
    }
    return json({ res: await sendAll(eps, env) });
  },

  // ஒவ்வொரு நிமிடமும் (Cron Trigger)
  async scheduled(event, env) {
    const now = Date.now();
    const l = await env.SCHED.list({ prefix: "q:" });
    for (const k of l.keys) {
      const at = Number(k.name.split(":")[1]);
      if (!(at <= now)) continue;
      const v = await env.SCHED.get(k.name);
      await env.SCHED.delete(k.name);
      if (v) await sendAll(JSON.parse(v), env);
    }
  }
};
