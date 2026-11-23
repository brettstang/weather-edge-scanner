const { default: handler } = await import("../../api/scan.js");
const run = async q => { const res = { setHeader(){}, status(c){ this.c=c; return this; }, json(o){ this.o=o; } }; await handler({ query: q }, res); return res.o; };
const sc = await run({ kind: "high", near: "1" });
for (const row of sc.overview.filter(o => o.city === "Toronto")) {
  const g = await run({ mode: "graph", slug: row.slug, days: "4" });
  const g1 = await run({ mode: "graph", slug: row.slug });
  console.log(`RESULT Toronto ${row.date} card smart ${row.smart?.value} | 4-day smart ${!!g.smart} err ${g.smartError} | 1-day smart ${!!g1.smart} err ${g1.smartError} | models ${g.models?.length} nowMin ${g.nowMin} dates ${g.dates}`);
}
