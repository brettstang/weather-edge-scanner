// Weather Edge Scanner – serverless scan function (Vercel)
// Finds Polymarket "Highest temperature in X on DATE" markets, reads the settlement
// station from each market's rules, gets the Open-Meteo forecast high at that exact
// airport, and reports any city/day where the forecast lands in an edge bucket.

const GAMMA = "https://gamma-api.polymarket.com";

// Common Polymarket settlement stations: [lat, lon, name]. Unknown codes are looked up from OurAirports.
const STATIONS = {
  KLGA: [40.7769, -73.8740, "LaGuardia, New York"],
  KJFK: [40.6413, -73.7781, "JFK, New York"],
  KNYC: [40.7789, -73.9692, "Central Park, New York"],
  KORD: [41.9786, -87.9048, "O'Hare, Chicago"],
  KMDW: [41.7868, -87.7522, "Midway, Chicago"],
  KMIA: [25.7959, -80.2870, "Miami Intl"],
  KDAL: [32.8471, -96.8518, "Love Field, Dallas"],
  KDFW: [32.8998, -97.0403, "DFW, Dallas"],
  KATL: [33.6407, -84.4277, "Atlanta Intl"],
  KSEA: [47.4502, -122.3088, "Sea-Tac, Seattle"],
  KLAX: [33.9416, -118.4085, "LAX, Los Angeles"],
  KSFO: [37.6213, -122.3790, "SFO, San Francisco"],
  KDEN: [39.8561, -104.6737, "Denver Intl"],
  KAUS: [30.1975, -97.6664, "Austin-Bergstrom"],
  KPHX: [33.4342, -112.0116, "Phoenix Sky Harbor"],
  KBOS: [42.3656, -71.0096, "Logan, Boston"],
  KIAH: [29.9902, -95.3368, "Houston Intercontinental"],
  KHOU: [29.6454, -95.2789, "Hobby, Houston"],
  KLAS: [36.0840, -115.1537, "Las Vegas Harry Reid"],
  KPHL: [39.8744, -75.2424, "Philadelphia Intl"],
  KDCA: [38.8512, -77.0402, "Reagan National, DC"],
  KMSP: [44.8848, -93.2223, "Minneapolis-St Paul"],
  EGLC: [51.5048, 0.0495, "London City"],
  EGLL: [51.4700, -0.4543, "London Heathrow"],
  LFPG: [49.0097, 2.5479, "Paris CDG"],
  RJTT: [35.5494, 139.7798, "Tokyo Haneda"],
  RKSI: [37.4602, 126.4407, "Seoul Incheon"],
  CYYZ: [43.6777, -79.6248, "Toronto Pearson"],
  NZWN: [-41.3272, 174.8053, "Wellington"],
  SAEZ: [-34.8222, -58.5358, "Buenos Aires Ezeiza"],
  LTAC: [40.1281, 32.9951, "Ankara Esenboga"],
  // Non-airport settlement sources
  HKO: [22.3022, 114.1742, "Hong Kong Observatory HQ, Tsim Sha Tsui"]
};

// Markets that name an official observatory in words instead of an airport code.
const NAMED_SOURCES = [
  [/hong kong observatory/i, "HKO"]
];

let airportCache = null;
async function lookupStation(code) {
  if (STATIONS[code]) return STATIONS[code];
  try {
    if (!airportCache) {
      const csv = await (await fetch("https://davidmegginson.github.io/ourairports-data/airports.csv")).text();
      airportCache = {};
      for (const line of csv.split("\n")) {
        const c = line.split(",");
        const ident = (c[1] || "").replace(/"/g, "");
        if (ident.length === 4) airportCache[ident] = [parseFloat(c[4]), parseFloat(c[5]), (c[3] || "").replace(/"/g, "")];
      }
    }
    return airportCache[code] || null;
  } catch {
    return null;
  }
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status} from ${url}`);
  return r.json();
}

const isTempEvent = ev => /highest temperature in/i.test(ev.title || "");
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

// Page through a Gamma list endpoint 100 at a time with no gaps, in parallel waves.
async function pageAll(base, maxPages, deadline) {
  const out = [];
  for (let start = 0; start < maxPages && Date.now() < deadline; start += 10) {
    const wave = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      getJSON(`${base}&limit=100&offset=${(start + i) * 100}`).catch(() => [])));
    let done = false;
    for (const page of wave) {
      if (!Array.isArray(page) || page.length === 0) { done = true; continue; }
      out.push(...page);
      if (page.length < 100) done = true;
    }
    if (done) break;
  }
  return out;
}

async function getTempEvents(t0) {
  const found = new Map();
  const add = list => { for (const ev of list || []) if (ev && isTempEvent(ev) && !ev.closed) found.set(String(ev.id), ev); };
  const now = Date.now();
  const min = new Date(now - 2 * 86400000).toISOString();
  const max = new Date(now + 14 * 86400000).toISOString();

  // 1) Every open event ending in the next two weeks, plus the weather tag (max ~20s).
  const listDeadline = t0 + 20000;
  const [byDate, byTag] = await Promise.all([
    pageAll(`${GAMMA}/events?closed=false&end_date_min=${min}&end_date_max=${max}`, 40, listDeadline),
    pageAll(`${GAMMA}/events?closed=false&tag_slug=weather`, 10, listDeadline)
  ]);
  add(byDate); add(byTag);

  // 2) For each city, look up today and the next 3 days directly by slug if they weren't found.
  const cities = new Map(); // prefix -> slug style (with or without year)
  const have = new Set();
  for (const ev of found.values()) {
    have.add(ev.slug);
    const m = (ev.slug || "").match(/^(highest-temperature-in-.+?)-on-[a-z]+-\d{1,2}(-\d{4})?$/);
    if (m) cities.set(m[1], !!m[2]);
  }
  const missing = [];
  for (const [prefix, withYear] of cities) for (let d = 0; d <= 3; d++) {
    const t = new Date(now + d * 86400000);
    const sl = `${prefix}-on-${MONTHS[t.getUTCMonth()]}-${t.getUTCDate()}${withYear ? "-" + t.getUTCFullYear() : ""}`;
    if (!have.has(sl)) missing.push(sl);
  }
  const probes = missing.slice(0, 150);
  for (let i = 0; i < probes.length && Date.now() < t0 + 35000; i += 50) {
    const batch = await Promise.all(probes.slice(i, i + 50).map(sl =>
      getJSON(`${GAMMA}/events?slug=${encodeURIComponent(sl)}`).catch(() => [])));
    for (const r of batch) add(Array.isArray(r) ? r : [r]);
  }
  return [...found.values()];
}

function findStation(ev) {
  const text = [ev.resolutionSource, ev.description, ...(ev.markets || []).flatMap(m => [m.resolutionSource, m.description])]
    .filter(Boolean).join(" ");
  for (const [re, code] of NAMED_SOURCES) if (re.test(text)) return code;
  // Weather Underground history links end in the ICAO code, e.g. .../history/daily/us/ny/new-york-city/KLGA
  const wu = text.match(/wunderground\.com\/[^\s"')]*?\/([A-Z]{4})(?=[\/\s"')?#.]|$)/);
  if (wu) return wu[1];
  // Rules usually say e.g. "reported at LaGuardia Airport (KLGA)".
  const paren = text.match(/\(([A-Z]{4})\)/);
  if (paren) return paren[1];
  // Fallback: a known station code mentioned anywhere in the rules.
  for (const code of Object.keys(STATIONS)) if (new RegExp(`\\b${code}\\b`).test(text)) return code;
  return null;
}

function parseDate(ev) {
  const m = (ev.title || "").match(/on ([A-Za-z]+ \d{1,2})/);
  const end = ev.endDate ? new Date(ev.endDate) : new Date();
  if (!m) return end.toISOString().slice(0, 10);
  let d = new Date(`${m[1]} ${end.getUTCFullYear()} 12:00 UTC`);
  if (d - end > 60 * 86400000) d = new Date(`${m[1]} ${end.getUTCFullYear() - 1} 12:00 UTC`);
  return d.toISOString().slice(0, 10);
}

function parseBucket(label) {
  const n = label.match(/(-?\d+(?:\.\d+)?)/);
  if (!n) return null;
  const value = parseFloat(n[1]);
  const unit = /°\s*C|\bC\b|celsius/i.test(label) ? "C" : "F";
  if (/or (below|lower|less|colder)/i.test(label)) return { side: "LOW", value, unit };
  if (/or (higher|above|more|hotter|warmer)/i.test(label)) return { side: "HIGH", value, unit };
  return null;
}

function yesPrice(m) {
  try {
    const p = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;
    const v = parseFloat(p[0]);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

const forecastCache = {};
async function forecastHigh(lat, lon, unit, date) {
  const key = `${lat},${lon},${unit}`;
  if (!forecastCache[key]) {
    const u = unit === "C" ? "celsius" : "fahrenheit";
    forecastCache[key] = getJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&temperature_unit=${u}&timezone=auto&past_days=1&forecast_days=16`
    );
  }
  const data = await forecastCache[key];
  const d = data.daily;
  const i = d ? d.time.indexOf(date) : -1;
  // The station's local date right now, so finished days can be skipped.
  const localToday = new Date(Date.now() + (data.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 10);
  return { value: i >= 0 ? d.temperature_2m_max[i] : null, localToday };
}

export default async function handler(req, res) {
  const near = parseFloat((req.query && req.query.near) || "0") || 0;
  const hits = [], skipped = [], overview = [];
  let finished = 0;
  const t0 = Date.now();
  try {
    const events = await getTempEvents(t0);
    await Promise.all(events.map(async ev => {
      const code = findStation(ev);
      const st = code ? await lookupStation(code) : null;
      if (!st) { skipped.push({ title: ev.title, reason: code ? `Unknown station ${code}` : "No station in rules" }); return; }
      const date = parseDate(ev);
      const city = (ev.title || "").replace(/.*highest temperature in /i, "").replace(/ on .*/i, "").replace(/\?$/, "");
      const row = { city, date, station: code, stationName: st[2], unit: null, forecast: null, low: null, high: null,
                    url: `https://polymarket.com/event/${ev.slug}` };
      let isFinished = false;
      for (const m of ev.markets || []) {
        if (m.closed) continue;
        const label = m.groupItemTitle || m.question || "";
        const b = parseBucket(label);
        if (!b) continue;
        let f;
        try { f = await forecastHigh(st[0], st[1], b.unit, date); } catch { f = null; }
        if (f && date < f.localToday) { isFinished = true; break; }
        const fc = f ? f.value : null;
        if (fc == null) continue;
        const p = yesPrice(m);
        const yesPct = p == null ? null : Math.round(p * 1000) / 10;
        row.unit = b.unit; row.forecast = fc;
        row[b.side === "LOW" ? "low" : "high"] = { threshold: b.value, label, yesPct };
        const r = Math.round(fc);
        const past = b.side === "HIGH" ? r - b.value : b.value - r;
        if (past >= -near) {
          hits.push({
            city, date, side: b.side, bucket: label,
            threshold: b.value, unit: b.unit, forecast: fc, rounded: r, past,
            yesPct, noPct: p == null ? null : Math.round((1 - p) * 1000) / 10,
            station: code, stationName: st[2], lat: st[0], lon: st[1],
            url: row.url, nearMiss: past < 0
          });
        }
      }
      if (isFinished) { finished++; return; }
      if (row.forecast != null) overview.push(row);
    }));
    const byDate = (a, b) => a.date.localeCompare(b.date) || a.city.localeCompare(b.city);
    hits.sort(byDate); overview.sort(byDate);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ scannedAt: new Date().toISOString(), marketsFound: events.length, finished, hits, overview, skipped, ms: Date.now() - t0 });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
