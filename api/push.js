// Subscribe / unsubscribe this phone for auto-scan notifications, and send a test.
import { redis, hasRedis, getVapid, sendPush, subId } from "./_push.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const action = (req.query && req.query.action) || "";
  try {
    if (!hasRedis()) return res.status(503).json({ error: "Database not connected yet. In Vercel open the project → Storage → create an Upstash Redis database and connect it, then redeploy." });

    if (action === "key") return res.status(200).json({ publicKey: (await getVapid()).publicKey });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    if (action === "subscribe") {
      const sub = body.subscription;
      if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: "Missing subscription" });
      const id = subId(sub.endpoint);
      const kinds = { high: body.kinds ? !!body.kinds.high : true, low: body.kinds ? !!body.kinds.low : false };
      await redis("HSET", "subs", id, JSON.stringify({ subscription: sub, near: !!body.near, kinds, since: new Date().toISOString() }));
      return res.status(200).json({ ok: true, id });
    }

    if (action === "unsubscribe") {
      if (!body.endpoint) return res.status(400).json({ error: "Missing endpoint" });
      await redis("HDEL", "subs", subId(body.endpoint));
      return res.status(200).json({ ok: true });
    }

    if (action === "test") {
      const raw = body.endpoint ? await redis("HGET", "subs", subId(body.endpoint)) : null;
      if (!raw) return res.status(404).json({ error: "This phone isn't subscribed yet" });
      const status = await sendPush(JSON.parse(raw).subscription, {
        title: "✅ Weather Scanner", body: "Notifications are working. You'll be alerted about new Edge temp hits.", url: "/", tag: "test"
      });
      return res.status(200).json({ ok: status < 300, status });
    }

    if (action === "status") {
      const last = await redis("GET", "cron:last");
      const count = await redis("HLEN", "subs");
      return res.status(200).json({ subscribers: count, lastRun: last ? JSON.parse(last) : null });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
