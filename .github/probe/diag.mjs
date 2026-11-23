// Temporary: measure the live Smart line against real readings (will be removed)
const { default: handler } = await import("../../api/scan.js");
const run = async q => { const res = { setHeader(){}, status(c){ this.c=c; return this; }, json(o){ this.o=o; } }; await handler({ query: q }, res); return res.o; };
for (const kind of ["low", "high"]) {
  const sc = await run({ kind, near: "1" });
  for (const city of ["Denver", "NYC", "Chicago", "London", "Toronto"]) {
    const row = [...sc.overview].reverse().find(o => o.city === city); if (!row) continue;
    const g = await run({ mode: "graph", slug: row.slug, days: "4" });
    const past = g.observed.filter(o => o.m < Math.floor(g.nowMin / 60) * 60);
    const at = (pts, m) => { const p = pts.find(q => q.m === m); return p ? p.v : null; };
    const mae = pts => { const e = []; for (const o of past) { const v = at(pts || [], Math.round(o.m / 60) * 60); if (v != null) e.push(Math.abs(v - o.v)); } return e.length ? (e.reduce((a, b) => a + b, 0) / e.length).toFixed(1) : "-"; };
    const ext = (pts, f) => { const out = []; for (let i = 0; i < g.days - 1; i++) { const d = (pts || []).filter(p => p.m >= i * 1440 && p.m < (i + 1) * 1440); if (d.length >= 18) out.push(f(...d.map(p => p.v)).toFixed(1)); } return out.join("/"); };
    const f = kind === "low" ? Math.min : Math.max;
    console.log(`RESULT ${kind} ${city.padEnd(8)} hourly miss: Smart ${mae(g.smart?.points)}° vs blend ${mae(g.forecast)}° | past ${kind}s real ${ext(past, f)} smart ${ext(g.smart?.points, f)} blend ${ext(g.forecast, f)} | line ${(g.smart?.lineModels||[]).map(x=>x.split("_")[0]).join("+")} @${g.smart?.hourly?.strength} | card Smart ${row.smart?.value} (±${row.smart?.smartMiss}) vs OM ${row.forecast?.toFixed?.(1)} (±${row.smart?.blendMiss})`);
  }
}
