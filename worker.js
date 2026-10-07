// Cloudflare Worker: "Our Chat" push sender + scheduled messages
// Keys are inside this file. Do not share this file.
// Needs: KV binding named SCHED, and a Cron Trigger "* * * * *"

const VAPID_PUB = "BKGwGqwRNoBlqiK6NnUj49baitsygCPwEVRM4CV0ItcwnvahrQSQXGYrPkpIHKMqIxGzcAepOQt33g993Z9xOxE";
const VAPID_PRIVATE = "1dTkp3buUKI7geqnjTfCBKp52aE-HIyOvi2ZGnpb_2c";
const VAPID_SUBJECT = "mailto:gnanasekar308@gmail.com";

const ALLOW = /^https:\/\/([\w.-]+\.)?(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)\//;

const b64u = {
  dec: s => Uint8Array.from(
    atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")),
    c => c.charCodeAt(0)
  ),
  enc: b => btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
};

async function signingKey() {
  const pub = b64u.dec(VAPID_PUB);
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), d: VAPID_PRIVATE, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

async function makeJwt(aud, key) {
  const enc = o => b64u.enc(new TextEncoder().encode(JSON.stringify(o)));
  const data =
    enc({ typ: "JWT", alg: "ES256" }) + "." +
    enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(data));
  return data + "." + b64u.enc(sig);
}

async function sendAll(eps) {
  const key = await signingKey();
  return Promise.all(eps.map(async u => {
    try {
      const jwt = await makeJwt(new URL(u).origin, key);
      const r = await fetch(u, {
        method: "POST",
        headers: { TTL: "86400", Urgency: "high", Authorization: `vapid t=${jwt}, k=${VAPID_PUB}` }
      });
      return r.status; // 201 = success, 404/410 = subscription expired
    } catch (e) { return 0; }
  }));
}

export default {
  async fetch(req, env) {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("ok", { headers: cors });

    let body;
    try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }

    const eps = (body.endpoints || [])
      .filter(u => typeof u === "string" && ALLOW.test(u))
      .slice(0, 10);
    if (!eps.length) return json({ sent: 0 });

    const at = Number(body.at || 0);
    if (at > Date.now() + 20000) {
      // schedule for later: store in KV, cron will send it
      const q = JSON.parse((await env.SCHED.get("q")) || "[]");
      q.push({ at, eps });
      await env.SCHED.put("q", JSON.stringify(q.slice(-50)));
      return json({ queued: true });
    }
    return json(await sendAll(eps));
  },

  // runs every minute (Cron Trigger)
  async scheduled(event, env) {
    const raw = await env.SCHED.get("q");
    if (!raw) return;
    const q = JSON.parse(raw), now = Date.now();
    const due = q.filter(x => x.at <= now), rest = q.filter(x => x.at > now);
    if (!due.length) return;
    await env.SCHED.put("q", JSON.stringify(rest));
    for (const x of due) await sendAll(x.eps);
  }
};
