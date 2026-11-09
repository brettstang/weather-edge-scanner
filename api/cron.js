// Auto-scan: runs the Edge temp scan and notifies subscribed phones about NEW hits.
// Triggered every 30 minutes by .github/workflows/autoscan.yml.
import { redis, hasRedis, sendPush } from "./_push.js";
import { getTempEvents, tempScan } from "./scan.js";

const SENT_TTL = 3 * 24 * 3600; // remember a hit for 3 days so it's only announced once

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!hasRedis()) return res.status(503).json({ error: "Database not connected" });

    // Don't run more than once per ~20 minutes, however often this URL is hit.
    const lock = await redis("SET", "cron:lock", Date.now(), "NX", "EX", "1200");
    if (lock !== "OK") return res.status(200).json({ skipped: "ran recently" });

    const subsRaw = (await redis("HGETALL", "subs")) || [];
    const subs = [];
    for (let i = 0; i < subsRaw.length; i += 2) subs.push({ id: subsRaw[i], ...JSON.parse(subsRaw[i + 1]) });

    const t0 = Date.now();
    let hits = [];
    if (subs.length) {
      const events = await getTempEvents(t0);
      hits = (await tempScan(events, t0, 1)).hits; // includes near misses; filtered per phone below
    }

    let sent = 0, removed = 0;
    for (const s of subs) {
      const mine = hits.filter(h => s.near || !h.nearMiss);
      const fresh = [];
      for (const h of mine) {
        const key = `sent:${s.id}:${h.slug}:${h.bucket}:${h.nearMiss ? "n" : "h"}`;
        if ((await redis("SET", key, "1", "NX", "EX", String(SENT_TTL))) === "OK") fresh.push(h);
      }
      if (!fresh.length) continue;
      const fmtDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
      const line = h => `${h.nearMiss ? "🟡" : "🟢"} ${h.city} ${fmtDay(h.date)}: ${Math.round(h.forecast * 10) / 10}°${h.unit} → ${h.bucket} (${h.yesPct ?? "?"}%)`;
      const title = fresh.length === 1
        ? `🌡️ Edge hit: ${fresh[0].city}, ${fmtDay(fresh[0].date)}`
        : `🌡️ ${fresh.length} new Edge temp hits`;
      const body = fresh.slice(0, 4).map(line).join("\n") + (fresh.length > 4 ? `\n+${fresh.length - 4} more` : "");
      try {
        const status = await sendPush(s.subscription, { title, body, url: "/?scan=temp", tag: "edge-temp" });
        if (status === 404 || status === 410) { await redis("HDEL", "subs", s.id); removed++; }
        else if (status < 300) sent++;
      } catch {}
    }

    const summary = { at: new Date().toISOString(), subscribers: subs.length, hits: hits.length, notified: sent, removed, ms: Date.now() - t0 };
    await redis("SET", "cron:last", JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
