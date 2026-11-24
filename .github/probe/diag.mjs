const G = "https://gamma-api.polymarket.com";
const get = async u => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u); if (r.ok) return r.json(); } catch {} await new Promise(r => setTimeout(r, 1000)); } return []; };
const all = [];
for (let off = 0; off < 6000; off += 100) { const p = await get(`${G}/events?closed=false&tag_slug=weather&limit=100&offset=${off}`); if (!p.length) break; all.push(...p); }
const now = Date.now(), min = new Date(now - 2*864e5).toISOString(), max = new Date(now + 14*864e5).toISOString();
for (let off = 0; off < 5000; off += 100) { const p = await get(`${G}/events?closed=false&end_date_min=${min}&end_date_max=${max}&limit=100&offset=${off}`); if (!p.length) break; all.push(...p); }
const ev = new Map(all.filter(e => !e.closed).map(e => [e.slug, e]));
const hi = [...ev.values()].filter(e => /highest temperature in/i.test(e.title)), lo = [...ev.values()].filter(e => /lowest temperature in/i.test(e.title));
const cityOf = e => e.title.replace(/.*temperature in /i, "").replace(/ on .*/i, "");
const hc = new Set(hi.map(cityOf)), lc = new Set(lo.map(cityOf));
console.log("RESULT high events", hi.length, "cities", hc.size, "| low events", lo.length, "cities", lc.size);
console.log("RESULT high-only cities:", [...hc].filter(c => !lc.has(c)).join(", "));
console.log("RESULT low-only cities:", [...lc].filter(c => !hc.has(c)).join(", "));
// probe low slugs for high-only cities
const M = ["january","february","march","april","may","june","july","august","september","october","november","december"];
let extra = [];
for (const e of hi) { const m = e.slug.match(/^highest-temperature-in-(.+?)-on-([a-z]+)-(\d+)(-\d{4})?$/); if (!m) continue;
  const sl = `lowest-temperature-in-${m[1]}-on-${m[2]}-${m[3]}${m[4] || ""}`; if (ev.has(sl)) continue;
  const r = await get(`${G}/events?slug=${sl}`); const x = Array.isArray(r) ? r[0] : r; if (x && x.slug && !x.closed) extra.push(sl); }
console.log("RESULT low events found only by slug probe:", extra.length, extra.slice(0, 20).join(" "));
const byDate = {}; for (const e of lo) { const d = (e.endDate || "").slice(0, 10); byDate[d] = (byDate[d] || 0) + 1; }
console.log("RESULT low by end date", JSON.stringify(byDate));
