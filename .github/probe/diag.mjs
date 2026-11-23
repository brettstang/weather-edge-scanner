const { default: handler } = await import("../../api/scan.js");
const run = async q => { const res = { setHeader(){}, status(c){ this.c=c; return this; }, json(o){ this.o=o; } }; await handler({ query: q }, res); return res.o; };
const ext = (pts, lo, a, b) => { const v = pts.filter(p => p.m >= a && p.m < b).map(p => p.v); return v.length ? (lo ? Math.min(...v) : Math.max(...v)) : null; };
for (const kind of ["low", "high"]) {
  const sc = await run({ kind, near: "1" });
  const rows = sc.overview.filter(o => ["Denver", "New York City", "Chicago", "London", "Toronto", "Dallas"].includes(o.city));
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.city)) continue; seen.add(row.city);
    const g = await run({ mode: "graph", slug: row.slug, days: "4" });
    if (!g.smart) { console.log(`RESULT ${kind} ${row.city} no smart: ${g.smartError}`); continue; }
    const lo = kind === "low"; let sE = 0, bE = 0, n = 0, parts = [];
    for (let d = 0; d < 3; d++) {
      const a = d * 1440, b = a + 1440, o = ext(g.observed, lo, a, b), s = ext(g.smart.points, lo, a, b), f = ext(g.forecast, lo, a, b);
      if (o == null || s == null || f == null) continue;
      sE += Math.abs(s - o); bE += Math.abs(f - o); n++; parts.push(`${g.dates[d].slice(5)} real ${o} smart ${s} blend ${f}`);
    }
    console.log(`RESULT ${kind} ${row.city} past-day ${kind} miss smart ${(sE/n).toFixed(1)} vs blend ${(bE/n).toFixed(1)} | ${parts.join(" ; ")}`);
  }
}
