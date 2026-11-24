const { default: handler } = await import("../../api/scan.js");
const run = async q => { const res = { setHeader(){}, status(c){ this.c=c; return this; }, json(o){ this.o=o; } }; await handler({ query: q }, res); return res.o; };
const ext = (pts, lo, a, b) => { const v = pts.filter(p => p.m >= a && p.m < b).map(p => p.v); return v.length ? (lo ? Math.min(...v) : Math.max(...v)) : null; };
let tS = 0, tB = 0, tn = 0;
for (const kind of ["low", "high"]) {
  const sc = await run({ kind, near: "1" }); await new Promise(r => setTimeout(r, 20000));
  const seen = new Set();
  for (const row of sc.overview) {
    if (seen.has(row.city) || seen.size >= 6) continue; seen.add(row.city);
    const S = row.smart; await new Promise(r => setTimeout(r, 4000));
    const g = await run({ mode: "graph", slug: row.slug, days: "4" });
    if (!g || !g.smart) { console.log(`RESULT ${kind} ${row.city} no smart line: ${g && g.smartError}`); continue; }
    const lo = kind === "low"; let sE = 0, bE = 0, n = 0;
    for (let d = 0; d < 3; d++) { const a = d * 1440, b = a + 1440, o = ext(g.observed, lo, a, b), s = ext(g.smart.points, lo, a, b), f = ext(g.forecast, lo, a, b);
      if (o == null || s == null || f == null) continue; sE += Math.abs(s - o); bE += Math.abs(f - o); n++; }
    if (n) { tS += sE; tB += bE; tn += n; }
    console.log(`RESULT ${kind} ${row.city} model ${g.smart.lineModels} value ${S?.value} | 7-day miss smart ±${S?.smartMiss} vs OM ±${S?.blendMiss} | graph past ${n} days smart ${n ? (sE/n).toFixed(1) : "-"} vs OM ${n ? (bE/n).toFixed(1) : "-"}`);
  }
}
console.log(`RESULT TOTAL graph past-day extreme miss smart ${(tS/tn).toFixed(2)} vs OM ${(tB/tn).toFixed(2)} over ${tn}`);
