// Temporary diagnostics against live data (will be removed)
const { default: handler, stationSkill } = await import("../../api/scan.js");
const run = async q => { const res = { setHeader(){}, status(c){ this.c=c; return this; }, json(o){ this.o=o; } }; await handler({ query: q }, res); return res.o; };
const low = await run({ kind: "low", near: "1" });
for (const city of ["Denver", "NYC"]) {
  const row = [...low.overview].reverse().find(o => o.city === city); if (!row) continue;
  console.log(`\n=== ${city} ${row.date} ${row.station} unit ${row.unit} | OM ${row.forecast} | Smart ${row.smart.value} used ${row.smart.used.map(u => u.id + "@" + u.w + (u.hb ? " hb" : "")).join(", ")}`);
  for (const u of row.smart.used) console.log(`  ${u.id} dailyBias ${u.bias} hourBias ${JSON.stringify(u.hb)}`);
  const g = await run({ mode: "graph", slug: row.slug, days: "4" });
  const past = g.observed.filter(o => o.m < (g.days - 1) * 1440);
  const at = (pts, m) => { const p = pts.find(q => q.m === m); return p ? p.v : null; };
  const mae = pts => { const e = []; for (const o of past) { const v = at(pts, Math.round(o.m / 60) * 60); if (v != null) e.push(Math.abs(v - o.v)); } return e.length ? (e.reduce((a, b) => a + b, 0) / e.length).toFixed(2) + ` (n=${e.length})` : "-"; };
  console.log(`  graph range ${g.dates.join(",")} obs past=${past.length}  | MAE smart ${mae(g.smart.points)} | blend ${mae(g.forecast)}`);
  for (const m of g.models) console.log(`    raw ${m.id.padEnd(22)} MAE ${mae(m.points)}`);
  // sample a few hours side by side
  for (const o of past.filter((_, i) => i % 6 === 0).slice(0, 8)) {
    const m = Math.round(o.m / 60) * 60;
    console.log(`    m=${o.m} obs ${o.v} | smart ${at(g.smart.points, m)} | blend ${at(g.forecast, m)} | ${g.models.map(mm => mm.id.split("_")[0] + " " + at(mm.points, m)).join(" ")}`);
  }
}
