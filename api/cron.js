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

    // Each phone chooses daily high and/or daily low alerts (older sign-ups = high only)
    const wants = s => s.kinds || { high: true };
    const t0 = Date.now();
    const hitsByKind = { high: [], low: [] };
    await Promise.all(["high", "low"].filter(k => subs.some(s => wants(s)[k])).map(async k => {
      const events = await getTempEvents(t0, k);
      hitsByKind[k] = (await tempScan(events, t0, 1, k)).hits; // includes near misses; filtered per phone below
    }));
    const hits = [...hitsByKind.high, ...hitsByKind.low];

    let sent = 0, removed = 0;
    for (const s of subs) {
      const mine = hits.filter(h => wants(s)[h.kind || "high"] && (s.near || !h.nearMiss));
      const fresh = [];
      for (const h of mine) {
        const key = `sent:${s.id}:${h.slug}:${h.bucket}:${h.nearMiss ? "n" : "h"}`;
        if ((await redis("SET", key, "1", "NX", "EX", String(SENT_TTL))) === "OK") fresh.push(h);
      }
      if (!fresh.length) continue;
      const fmtDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
      const line = h => `${h.nearMiss ? "🟡" : "🟢"} ${h.kind === "low" ? "Low" : "High"} · ${h.city} ${fmtDay(h.date)}: ${Math.round(h.forecast * 10) / 10}°${h.unit} → ${h.bucket} (${h.yesPct ?? "?"}%)${h.models && h.models.length ? ` · ${h.agree}/${h.models.length} models` : ""}`;
      const title = fresh.length === 1
        ? `🌡️ Edge ${fresh[0].kind === "low" ? "low" : "high"} hit: ${fresh[0].city}, ${fmtDay(fresh[0].date)}`
        : `🌡️ ${fresh.length} new Edge temp hits`;
      const onlyLow = fresh.every(h => h.kind === "low");
      const body = fresh.slice(0, 4).map(line).join("\n") + (fresh.length > 4 ? `\n+${fresh.length - 4} more` : "");
      try {
        const status = await sendPush(s.subscription, { title, body, url: onlyLow ? "/?scan=temp&kind=low" : "/?scan=temp", tag: "edge-temp-" + Date.now() });
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
