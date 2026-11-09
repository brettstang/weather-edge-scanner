// Shared helpers: Upstash Redis (REST) + Web Push (VAPID + RFC 8291 aes128gcm), no dependencies.
// Files starting with "_" in /api are not exposed as endpoints by Vercel.
import crypto from "node:crypto";

// ---------- Redis (Upstash REST, set up via Vercel → Storage → Upstash Redis) ----------
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasRedis = () => !!(REDIS_URL && REDIS_TOKEN);

export async function redis(...cmd) {
  if (!hasRedis()) throw new Error("Database not connected. In Vercel: Storage → Upstash Redis → Connect to project, then redeploy.");
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd.map(String)),
    signal: AbortSignal.timeout(8000)
  });
  const j = await r.json();
  if (j.error) throw new Error("Redis: " + j.error);
  return j.result;
}

// ---------- base64url ----------
const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = str => Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// ---------- VAPID keys: generated once, kept in Redis ----------
let vapidCache = null;
export async function getVapid() {
  if (vapidCache) return vapidCache;
  let stored = await redis("GET", "vapid");
  if (!stored) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = privateKey.export({ format: "jwk" });
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-65); // uncompressed point
    const candidate = JSON.stringify({ jwk, publicKey: b64u(raw) });
    await redis("SET", "vapid", candidate, "NX"); // first writer wins
    stored = await redis("GET", "vapid");
  }
  const v = JSON.parse(stored);
  vapidCache = { publicKey: v.publicKey, key: crypto.createPrivateKey({ key: v.jwk, format: "jwk" }) };
  return vapidCache;
}

function vapidJWT(audience, key) {
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://weather-edge-scanner.vercel.app" }));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64u(sig)}`;
}

// ---------- RFC 8291 payload encryption (aes128gcm) ----------
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));

export function encryptPayload(plaintext, p256dh, auth, _test = {}) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const ecdh = crypto.createECDH("prime256v1");
  if (_test.asPrivate) ecdh.setPrivateKey(_test.asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const salt = _test.salt || crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Send one notification. Returns the push service status code (201 = ok, 404/410 = subscription gone).
export async function sendPush(subscription, data) {
  const { key, publicKey } = await getVapid();
  const url = new URL(subscription.endpoint);
  const body = encryptPayload(JSON.stringify(data), subscription.keys.p256dh, subscription.keys.auth);
  const r = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "3600",
      Urgency: "high",
      Authorization: `vapid t=${vapidJWT(url.origin, key)}, k=${publicKey}`
    },
    body,
    signal: AbortSignal.timeout(10000)
  });
  return r.status;
}

export const subId = endpoint => crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 20);
