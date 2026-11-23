// Weather Edge Scanner – serverless scan function (Vercel)
// Finds Polymarket "Highest temperature in X on DATE" markets, reads the settlement
// station from each market's rules, gets the Open-Meteo forecast high at that exact
// airport, and reports any city/day where the forecast lands in an edge bucket.

import { redis, hasRedis } from "./_push.js";

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
  EDDM: [48.3538, 11.7861, "Munich Airport"],
  WSSS: [1.3644, 103.9915, "Singapore Changi"],
  ZSPD: [31.1443, 121.8083, "Shanghai Pudong"],
  ZBAA: [40.0799, 116.6031, "Beijing Capital"],
  LEMD: [40.4983, -3.5676, "Madrid Barajas"],
  LIMC: [45.6306, 8.7281, "Milan Malpensa"],
  EPWA: [52.1657, 20.9671, "Warsaw Chopin"],
  LLBG: [32.0114, 34.8867, "Tel Aviv Ben Gurion"],
  MMMX: [19.4361, -99.0719, "Mexico City Intl"],
  SBGR: [-23.4356, -46.4731, "Sao Paulo Guarulhos"],
  VILK: [26.7606, 80.8893, "Lucknow Airport"],
  VIDP: [28.5562, 77.1000, "Delhi Indira Gandhi"],
  VABB: [19.0896, 72.8656, "Mumbai Airport"],
  OMDB: [25.2532, 55.3657, "Dubai Intl"],
  YSSY: [-33.9399, 151.1753, "Sydney Airport"],
  CYVR: [49.1967, -123.1815, "Vancouver Intl"],
  CYUL: [45.4706, -73.7408, "Montreal Trudeau"],
  EHAM: [52.3105, 4.7683, "Amsterdam Schiphol"],
  EDDB: [52.3667, 13.5033, "Berlin Brandenburg"],
  LTFM: [41.2753, 28.7519, "Istanbul Airport"],
  ZGSZ: [22.6393, 113.8107, "Shenzhen Bao'an"],
  ZUUU: [30.5785, 103.9471, "Chengdu Shuangliu"],
  ZHHH: [30.7838, 114.2081, "Wuhan Tianhe"],
  ZUCK: [29.7192, 106.6417, "Chongqing Jiangbei"],
  RCTP: [25.0797, 121.2342, "Taipei Taoyuan"],
  KSAN: [32.7338, -117.1933, "San Diego Intl"],
  KMSY: [29.9934, -90.2580, "New Orleans Intl"],
  KOKC: [35.3931, -97.6007, "Oklahoma City Will Rogers"],
  KSAT: [29.5337, -98.4698, "San Antonio Intl"],
  KDTW: [42.2162, -83.3554, "Detroit Metro"],
  KCLT: [35.2140, -80.9431, "Charlotte Douglas"],
  KTPA: [27.9755, -82.5332, "Tampa Intl"],
  KBNA: [36.1263, -86.6774, "Nashville Intl"],
  // Non-airport settlement sources
  HKO: [22.3022, 114.1742, "Hong Kong Observatory HQ, Tsim Sha Tsui"]
};

// Markets that name an official observatory in words instead of an airport code.
const NAMED_SOURCES = [
  [/hong kong observatory/i, "HKO"]
];

let airportDb = null; // one shared download per scan, never one per market
function loadAirports() {
  if (!airportDb) airportDb = fetch("https://davidmegginson.github.io/ourairports-data/airports.csv", { signal: AbortSignal.timeout(8000) })
    .then(r => r.text())
    .then(csv => {
      const db = {};
      for (const line of csv.split("\n")) {
        const c = line.split(",");
        const ident = (c[1] || "").replace(/"/g, "");
        if (ident.length === 4) db[ident] = [parseFloat(c[4]), parseFloat(c[5]), (c[3] || "").replace(/"/g, "")];
      }
      return db;
    })
    .catch(() => ({}));
  return airportDb;
}
async function lookupStation(code) {
  if (STATIONS[code]) return STATIONS[code];
  return (await loadAirports())[code] || null;
}

async function getJSON(url, ms = 8000) {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}
// Run at most n requests of one kind at a time, so a big scan doesn't hit a service's rate limit
function limiter(n) {
  let active = 0; const queue = [];
  const next = () => { if (active >= n || !queue.length) return; active++; const { fn, res, rej } = queue.shift();
    fn().then(res, rej).finally(() => { active--; next(); }); };
  return fn => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}
const metarLimit = limiter(4), historyLimit = limiter(5);

const KIND_RE = { high: /highest temperature in/i, low: /lowest temperature in/i };
const kindOf = ev => KIND_RE.low.test(ev.title || "") ? "low" : "high";
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

export async function getTempEvents(t0, kind = "high") {
  const isTempEvent = ev => KIND_RE[kind].test(ev.title || "");
  const found = new Map();
  const add = list => { for (const ev of list || []) if (ev && isTempEvent(ev) && !ev.closed) found.set(String(ev.id), ev); };
  const now = Date.now();
  const min = new Date(now - 2 * 86400000).toISOString();
  const max = new Date(now + 14 * 86400000).toISOString();

  // 1) Every open event ending in the next two weeks, plus the weather tag (max ~20s).
  const listDeadline = t0 + 12000;
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
    const m = (ev.slug || "").match(/^((?:highest|lowest)-temperature-in-.+?)-on-[a-z]+-\d{1,2}(-\d{4})?$/);
    if (m) cities.set(m[1], !!m[2]);
  }
  const missing = [];
  for (const [prefix, withYear] of cities) for (let d = 0; d <= 3; d++) {
    const t = new Date(now + d * 86400000);
    const sl = `${prefix}-on-${MONTHS[t.getUTCMonth()]}-${t.getUTCDate()}${withYear ? "-" + t.getUTCFullYear() : ""}`;
    if (!have.has(sl)) missing.push(sl);
  }
  const probes = missing.slice(0, 150);
  for (let i = 0; i < probes.length && Date.now() < t0 + 20000; i += 50) {
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
  let end = ev.endDate ? new Date(ev.endDate) : new Date();
  if (isNaN(end)) end = new Date();
  if (!m) return end.toISOString().slice(0, 10);
  let d = new Date(`${m[1]} ${end.getUTCFullYear()} 12:00 UTC`);
  if (isNaN(d)) return end.toISOString().slice(0, 10);
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
async function forecastHigh(lat, lon, unit, date, kind = "high") {
  const v = kind === "low" ? "temperature_2m_min" : "temperature_2m_max";
  const key = `${lat},${lon},${unit},${kind}`;
  if (!forecastCache[key]) {
    const u = unit === "C" ? "celsius" : "fahrenheit";
    forecastCache[key] = getJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${v}&temperature_unit=${u}&timezone=auto&past_days=1&forecast_days=16`
    );
  }
  const data = await forecastCache[key];
  const d = data.daily;
  const i = d ? d.time.indexOf(date) : -1;
  // The station's local date right now, so finished days can be skipped.
  const localToday = new Date(Date.now() + (data.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 10);
  return { value: i >= 0 ? d[v][i] : null, localToday, offset: data.utc_offset_seconds || 0, tz: data.timezone || null };
}

// ---------- Observed temperatures so far today (aviationweather.gov METARs) ----------
// Airport reports, roughly hourly. Weather Underground's airport history is built from these.
const obsCache = {};
const signed = (s, d) => (s === "1" ? -1 : 1) * Number(d) / 10;
export function parseMetar(o) {
  const raw = o.rawOb || o.raw_text || "";
  const rmk = raw.includes(" RMK ") ? raw.split(" RMK ")[1] : "";
  let c = typeof o.temp === "number" ? o.temp : null;
  const t = rmk.match(/(?:^|\s)T([01])(\d{3})[01]\d{3}(?=\s|$)/);       // precise temp, e.g. T01560072 = 15.6°C
  if (t) c = signed(t[1], t[2]);
  const time = typeof o.obsTime === "number" ? o.obsTime * 1000 : Date.parse(o.reportTime || o.obsTime);
  // Polymarket settles on ROUTINE reports only (not SPECI specials)
  const special = o.metarType === "SPECI" || /^SPECI\b/.test(raw);
  return { time, c, special };
}
function stationObs(code, hours = 168) {
  if (code === "HKO") return hkoReadings().catch(() => null);
  if (!/^[A-Z]{4}$/.test(code)) return Promise.resolve(null);
  const ck = `${code},${hours}`;
  const fetchObs = h => metarLimit(() => getJSON(`https://aviationweather.gov/api/data/metar?ids=${code}&format=json&hours=${h}`, 15000))
    .then(list => (Array.isArray(list) ? list : []).map(parseMetar).filter(x => x.time && x.c != null && !x.special));
  // Shared between the high/low tabs, auto-scans and every phone for 20 minutes
  const get = async h => {
    const key = `metar:v1:${code}:${h}`;
    if (hasRedis()) { try { const v = await redis("GET", key); if (v) return JSON.parse(v).map(([time, c]) => ({ time, c })); } catch {} }
    const list = await fetchObs(h);
    if (hasRedis() && list.length) redis("SET", key, JSON.stringify(list.map(o => [o.time, o.c])), "EX", "1200").catch(() => {});
    return list;
  };
  // Ask for 7 days; if the service won't give that much, fall back to the last 36 hours
  if (!obsCache[ck]) obsCache[ck] = get(hours)
    .then(list => list.length || hours <= 36 ? list : get(36))
    .catch(() => hours > 36 ? get(36).catch(() => null) : null);
  return obsCache[ck];
}
// ---------- Hong Kong Observatory (HKO): official readings, since there is no METAR for it ----------
// Polymarket's Hong Kong markets settle on the Observatory HQ in Tsim Sha Tsui, not the airport.
const HKO_API = "https://data.weather.gov.hk/weatherAPI";
async function getText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status} from ${url}`);
  return r.text();
}
// Latest reading + max/min since midnight (updated every 10 min). Each call also records the
// reading in Redis, building the Observatory's own reading history for graphs and today's track.
function hkoNow() {
  return memoize("hko:now", async () => {
    const pick = csv => csv.split(/\r?\n/).map(l => l.split(",")).find(c => /observatory/i.test(c[1] || ""));
    const [mm, cur] = await Promise.all([
      getText(`${HKO_API}/hko_data/regional-weather/latest_since_midnight_maxmin.csv`),
      getText(`${HKO_API}/hko_data/regional-weather/latest_1min_temperature.csv`).catch(() => "")
    ]);
    const a = pick(mm), b = pick(cur);
    if (!a) return null;
    const dt = a[0].trim();
    const date = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`, at = `${dt.slice(8, 10)}:${dt.slice(10, 12)}`;
    const time = Date.UTC(+dt.slice(0, 4), +dt.slice(4, 6) - 1, +dt.slice(6, 8), +dt.slice(8, 10) - 8, +dt.slice(10, 12));
    const res = { date, at, time, max: parseFloat(a[2]), min: parseFloat(a[3]), temp: b ? parseFloat(b[2]) : null };
    if (hasRedis() && res.temp != null && Number.isFinite(res.temp)) {
      redis("HSET", `hko:obs:${date}`, String(time), String(res.temp)).catch(() => {});
      redis("EXPIRE", `hko:obs:${date}`, String(16 * 86400)).catch(() => {});
    }
    return res;
  });
}
// Official daily high/low for a finished day ("Yesterday's Weather" report, published ~01:30 HKT)
function hkoDay(date) {
  return cached(`hko:ryes:${date}`, 40 * 86400, async () => {
    const ymd = date.replace(/-/g, "");
    const j = await getJSON(`${HKO_API}/opendata/opendata.php?dataType=RYES&date=${ymd}&lang=en&station=HKO`);
    const max = parseFloat(j.HKOReadingsMaxTemp), min = parseFloat(j.HKOReadingsMinTemp);
    return j.ReportTimeInfoDate === ymd && Number.isFinite(max) && Number.isFinite(min) ? { max, min } : null;
  }).catch(() => null);
}
// Recorded Observatory readings for the past week (for graphs and the shape of today)
function hkoReadings() {
  return memoize("hko:readings", async () => {
    const now = await hkoNow().catch(() => null);
    const out = [];
    if (hasRedis()) {
      const today = now ? now.date : new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
      const dates = Array.from({ length: 8 }, (_, i) => new Date(Date.parse(today + "T12:00:00Z") - i * 86400000).toISOString().slice(0, 10));
      const rows = await Promise.all(dates.map(d => redis("HGETALL", `hko:obs:${d}`).catch(() => null)));
      for (const r of rows) for (let i = 0; r && i < r.length; i += 2) out.push({ time: +r[i], c: parseFloat(r[i + 1]) });
    }
    if (now && now.temp != null && !out.some(o => o.time === now.time)) out.push({ time: now.time, c: now.temp });
    return out.filter(o => Number.isFinite(o.c)).sort((a, b) => a.time - b.time);
  });
}
// Today's observed summary for any station: METARs for airports, official readings for the Observatory
async function observedNow(code, offsetSec, date, unit) {
  const ob = observedToday(await stationObs(code), offsetSec, date, unit);
  if (code !== "HKO") return ob;
  const now = await hkoNow().catch(() => null);
  if (!now || now.date !== date) return ob;
  const conv = c => unit === "C" ? c : c * 9 / 5 + 32;
  // Official max/min since midnight beats our sparse recorded readings
  const base = ob || { hourly: new Array(24).fill(null), low: new Array(24).fill(null), count: 0,
    nowHour: new Date(Date.now() + offsetSec * 1000).getUTCHours() };
  const max = conv(now.max), min = conv(now.min);
  return { ...base, max: Math.round(max * 10) / 10, min: Math.round(min * 10) / 10,
    maxHour: base.max != null && base.max >= max - 0.05 ? base.maxHour : null,
    minHour: base.min != null && base.min <= min + 0.05 ? base.minHour : null,
    count: Math.max(base.count || 0, 1), source: "hko", asOf: now.at };
}

// Summarise today's observations in the station's local time and the market's unit.
export function observedToday(obs, offsetSec, date, unit) {
  if (!obs || !obs.length) return null;
  const conv = c => unit === "C" ? c : c * 9 / 5 + 32;
  const hourly = new Array(24).fill(null);
  const low = new Array(24).fill(null);
  let max = null, maxHour = null, min = null, minHour = null, count = 0;
  for (const o of obs) {
    const local = new Date(o.time + offsetSec * 1000);
    if (local.toISOString().slice(0, 10) !== date) continue;
    const hr = local.getUTCHours();
    if (o.c != null) {
      const v = conv(o.c); count++;
      if (hourly[hr] == null || v > hourly[hr]) hourly[hr] = v;
      if (low[hr] == null || v < low[hr]) low[hr] = v;
      if (max == null || v > max) { max = v; maxHour = hr; }
      if (min == null || v < min) { min = v; minHour = hr; }
    }
  }
  if (max == null) return null;
  const nowHour = new Date(Date.now() + offsetSec * 1000).getUTCHours();
  return { hourly, low, max: Math.round(max * 10) / 10, maxHour, min: Math.round(min * 10) / 10, minHour, nowHour, count };
}
const hh = h => String(h).padStart(2, "0") + ":00";

// ---------- Rain scan ----------
// An hour is "rainy" when Open-Meteo forecasts at least RAIN_PROB % chance AND at least RAIN_MM mm.
// A day is flagged when it has RAIN_STREAK or more rainy hours in a row (station local time).
const RAIN_PROB = 50, RAIN_MM = 0.1, RAIN_STREAK = 3;
const rainCache = {};
async function rainDay(lat, lon, date) {
  const key = `${lat},${lon}`;
  if (!rainCache[key]) rainCache[key] = getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation,precipitation_probability&timezone=auto&past_days=1&forecast_days=16`
  );
  const data = await rainCache[key];
  const localToday = new Date(Date.now() + (data.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 10);
  const h = data.hourly;
  if (!h) return { localToday, tz: data.timezone || null, hours: null };
  const hours = [];
  for (let i = 0; i < h.time.length; i++) if (h.time[i].startsWith(date)) {
    const mm = h.precipitation[i], prob = h.precipitation_probability ? h.precipitation_probability[i] : null;
    hours.push({ t: h.time[i].slice(11, 16), mm, prob, rainy: mm != null && prob != null && mm >= RAIN_MM && prob >= RAIN_PROB });
  }
  // Longest run of rainy hours
  let best = null, cur = null;
  for (const hr of hours) {
    if (hr.rainy) {
      if (!cur) cur = { start: hr.t, end: hr.t, len: 0, mm: 0, maxProb: 0 };
      cur.len++; cur.end = hr.t; cur.mm += hr.mm; cur.maxProb = Math.max(cur.maxProb, hr.prob);
      if (!best || cur.len > best.len) best = { ...cur };
    } else cur = null;
  }
  const dayMm = hours.reduce((a, x) => a + (x.mm || 0), 0);
  const rainyHours = hours.filter(x => x.rainy).length;
  return { localToday, tz: data.timezone || null, hours: hours.map(x => (x.rainy ? 1 : 0)), streak: best, dayMm, rainyHours };
}

async function rainScan(events, t0) {
  const hits = [], overview = [], skipped = [];
  let finished = 0, partial = false;
  const work = Promise.all(events.map(async ev => { try {
    const code = findStation(ev);
    const st = code ? await lookupStation(code) : null;
    if (!st) { skipped.push({ title: ev.title, reason: code ? `Unknown station ${code}` : "No station in rules" }); return; }
    const date = parseDate(ev);
    const city = (ev.title || "").replace(/.*(?:highest|lowest) temperature in /i, "").replace(/ on .*/i, "").replace(/\?$/, "");
    let r;
    try { r = await rainDay(st[0], st[1], date); } catch { return; }
    if (date < r.localToday) { finished++; return; }
    if (!r.hours || !r.hours.length) return;
    const row = {
      city, date, station: code, stationName: st[2], url: `https://polymarket.com/event/${ev.slug}`, slug: ev.slug,
      longest: r.streak ? r.streak.len : 0, start: r.streak?.start ?? null, end: r.streak?.end ?? null,
      streakMm: r.streak ? Math.round(r.streak.mm * 10) / 10 : 0, maxProb: r.streak?.maxProb ?? null,
      dayMm: Math.round(r.dayMm * 10) / 10, rainyHours: r.rainyHours, hours: r.hours, tz: r.tz
    };
    overview.push(row);
    if (row.longest >= RAIN_STREAK) hits.push(row);
  } catch (e) { skipped.push({ title: ev.title, reason: "Error: " + (e && e.message || e) }); } }));
  let timer;
  const stop = new Promise(r => { timer = setTimeout(() => { partial = true; r(); }, Math.max(5000, 40000 - (Date.now() - t0))); });
  await Promise.race([work, stop]);
  clearTimeout(timer);
  // Most rain first: longest run of rainy hours, then total rainy hours, then rainfall.
  const byRain = (a, b) => b.longest - a.longest || b.rainyHours - a.rainyHours || b.dayMm - a.dayMm
    || a.date.localeCompare(b.date) || a.city.localeCompare(b.city);
  hits.sort(byRain); overview.sort(byRain);
  return { mode: "rain", rules: { prob: RAIN_PROB, mm: RAIN_MM, streak: RAIN_STREAK }, hits, overview, skipped, finished, partial };
}

// ---------- Night high scan ----------
// Flags days where the forecast daily high happens at night (21:00–05:00 local),
// i.e. the warmest night hour is warmer than every daytime hour (06:00–20:00).
const isNight = h => h >= 21 || h <= 5;
const hourlyTempCache = {};
async function hourlyTemps(lat, lon, unit) {
  const key = `${lat},${lon},${unit}`;
  if (!hourlyTempCache[key]) hourlyTempCache[key] = getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&temperature_unit=${unit === "C" ? "celsius" : "fahrenheit"}&timezone=auto&past_days=1&forecast_days=16`
  );
  return hourlyTempCache[key];
}

function leadingBucket(ev) {
  let best = null;
  for (const m of ev.markets || []) {
    if (m.closed) continue;
    const p = yesPrice(m);
    if (p != null && (!best || p > best.p)) best = { p, label: m.groupItemTitle || m.question || "" };
  }
  return best ? { label: best.label, yesPct: Math.round(best.p * 1000) / 10 } : null;
}

// high: flag when the day's HIGH comes at night (21:00–05:00)
// low:  flag when the day's LOW comes in the daytime (09:00–17:00)
const WINDOW = { high: isNight, low: h => h >= 9 && h <= 17 };
async function nightScan(events, t0, kind = "high") {
  const inWin = WINDOW[kind], hi = kind !== "low";
  const better = (a, b) => hi ? a > b : a < b;
  const hits = [], overview = [], skipped = [];
  let finished = 0, partial = false;
  const work = Promise.all(events.map(async ev => { try {
    const code = findStation(ev);
    const st = code ? await lookupStation(code) : null;
    if (!st) { skipped.push({ title: ev.title, reason: code ? `Unknown station ${code}` : "No station in rules" }); return; }
    const date = parseDate(ev);
    const city = (ev.title || "").replace(/.*(?:highest|lowest) temperature in /i, "").replace(/ on .*/i, "").replace(/\?$/, "");
    // Use the market's own unit
    let unit = "F";
    for (const m of ev.markets || []) { const lbl = m.groupItemTitle || m.question || ""; if (/°\s*C|celsius/i.test(lbl)) { unit = "C"; break; } if (/°\s*F/i.test(lbl)) break; }
    let data;
    try { data = await hourlyTemps(st[0], st[1], unit); } catch { return; }
    const localToday = new Date(Date.now() + (data.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 10);
    if (date < localToday) { finished++; return; }
    const h = data.hourly; if (!h) return;
    const temps = new Array(24).fill(null);
    for (let i = 0; i < h.time.length; i++) if (h.time[i].startsWith(date)) temps[+h.time[i].slice(11, 13)] = h.temperature_2m[i];
    if (temps.every(v => v == null)) return;
    // Today: replace hours already passed with what the airport actually recorded
    let observed = null;
    if (date === localToday) {
      const ob = await observedNow(code, data.utc_offset_seconds || 0, date, unit);
      if (ob) {
        for (let hr = 0; hr <= ob.nowHour; hr++) if (ob.hourly[hr] != null) {
          const o = hi ? ob.hourly[hr] : ob.low[hr];
          temps[hr] = hr < ob.nowHour ? o : (hi ? Math.max(temps[hr] ?? -Infinity, o) : Math.min(temps[hr] ?? Infinity, o));
        }
        const ohr = hi ? ob.maxHour : ob.minHour;
        observed = { value: hi ? ob.max : ob.min, at: ohr != null ? hh(ohr) : null, count: ob.count, nowHour: ob.nowHour,
          source: ob.source || "metar", asOf: ob.asOf || null };
      }
    }
    // peak = the day's extreme (max for highs, min for lows); dayMax = the most extreme value OUTSIDE the window
    const worst = hi ? -Infinity : Infinity;
    let peakHour = -1, peak = worst, dayMax = worst, dayHour = -1, winExt = worst;
    temps.forEach((v, hr) => {
      if (v == null) return;
      if (better(v, peak)) { peak = v; peakHour = hr; }
      if (inWin(hr)) { if (better(v, winExt)) winExt = v; }
      else if (better(v, dayMax)) { dayMax = v; dayHour = hr; }
    });
    const margin = Math.round((hi ? winExt - dayMax : dayMax - winExt) * 10) / 10;
    const row = {
      city, date, unit, station: code, stationName: st[2], url: `https://polymarket.com/event/${ev.slug}`, slug: ev.slug,
      peak, peakTime: String(peakHour).padStart(2, "0") + ":00", dayMax, dayTime: String(dayHour).padStart(2, "0") + ":00",
      margin, temps, leading: leadingBucket(ev), night: better(winExt, dayMax), kind,
      observed, locked: !!(observed && peakHour < observed.nowHour), tz: data.timezone || null
    };
    overview.push(row);
    if (row.night) hits.push(row);
  } catch (e) { skipped.push({ title: ev.title, reason: "Error: " + (e && e.message || e) }); } }));
  let timer;
  const stop = new Promise(r => { timer = setTimeout(() => { partial = true; r(); }, Math.max(5000, 40000 - (Date.now() - t0))); });
  await Promise.race([work, stop]);
  clearTimeout(timer);
  // Biggest night-over-day margin first
  const byMargin = (a, b) => b.margin - a.margin || a.date.localeCompare(b.date) || a.city.localeCompare(b.city);
  hits.sort(byMargin); overview.sort(byMargin);
  return { mode: "night", kind, hits, overview, skipped, finished, partial };
}

// ---------- Sunny day scan ----------
// Flags days where EVERY daylight hour (sunrise..sunset, station local time) has
// cloud cover <= SUN_MAX_CLOUD % and no precipitation.
const SUN_MAX_CLOUD = 10;
const skyCache = {};
async function skyData(lat, lon) {
  const key = `${lat},${lon}`;
  if (!skyCache[key]) skyCache[key] = getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=cloud_cover,precipitation&daily=sunrise,sunset,sunshine_duration,daylight_duration&timezone=auto&past_days=1&forecast_days=16`
  );
  return skyCache[key];
}

async function sunScan(events, t0, maxCloudLimit = SUN_MAX_CLOUD) {
  const hits = [], overview = [], skipped = [];
  let finished = 0, partial = false;
  const work = Promise.all(events.map(async ev => { try {
    const code = findStation(ev);
    const st = code ? await lookupStation(code) : null;
    if (!st) { skipped.push({ title: ev.title, reason: code ? `Unknown station ${code}` : "No station in rules" }); return; }
    const date = parseDate(ev);
    const city = (ev.title || "").replace(/.*(?:highest|lowest) temperature in /i, "").replace(/ on .*/i, "").replace(/\?$/, "");
    let data;
    try { data = await skyData(st[0], st[1]); } catch { return; }
    const localToday = new Date(Date.now() + (data.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 10);
    if (date < localToday) { finished++; return; }
    const d = data.daily, h = data.hourly;
    const di = d ? d.time.indexOf(date) : -1;
    if (di < 0 || !h) return;
    const sunrise = d.sunrise[di].slice(11, 16), sunset = d.sunset[di].slice(11, 16);
    const clouds = new Array(24).fill(null), rain = new Array(24).fill(0), daylight = new Array(24).fill(false);
    for (let i = 0; i < h.time.length; i++) if (h.time[i].startsWith(date)) {
      const hr = +h.time[i].slice(11, 13), hhmm = h.time[i].slice(11, 16);
      clouds[hr] = h.cloud_cover[i]; rain[hr] = h.precipitation[i] || 0;
      daylight[hr] = hhmm >= sunrise.slice(0, 2) + ":00" && hhmm <= sunset;
    }
    const dayIdx = clouds.map((_, i) => i).filter(i => daylight[i] && clouds[i] != null);
    if (!dayIdx.length) return;
    const maxCloud = Math.max(...dayIdx.map(i => clouds[i]));
    const avgCloud = Math.round(dayIdx.reduce((a, i) => a + clouds[i], 0) / dayIdx.length);
    const dayRain = Math.round(dayIdx.reduce((a, i) => a + rain[i], 0) * 10) / 10;
    const sunPct = d.daylight_duration && d.daylight_duration[di] ? Math.round((d.sunshine_duration[di] / d.daylight_duration[di]) * 100) : null;
    const row = {
      city, date, station: code, stationName: st[2], url: `https://polymarket.com/event/${ev.slug}`, slug: ev.slug,
      sunrise, sunset, maxCloud, avgCloud, dayRain, sunPct, clouds, daylight, leading: leadingBucket(ev), tz: data.timezone || null,
      clear: maxCloud <= maxCloudLimit && dayRain === 0
    };
    overview.push(row);
    if (row.clear) hits.push(row);
  } catch (e) { skipped.push({ title: ev.title, reason: "Error: " + (e && e.message || e) }); } }));
  let timer;
  const stop = new Promise(r => { timer = setTimeout(() => { partial = true; r(); }, Math.max(5000, 40000 - (Date.now() - t0))); });
  await Promise.race([work, stop]);
  clearTimeout(timer);
  // Clearest first: lowest peak cloud, then lowest average cloud, then most sunshine
  const byClear = (a, b) => a.maxCloud - b.maxCloud || a.avgCloud - b.avgCloud || (b.sunPct ?? 0) - (a.sunPct ?? 0)
    || a.date.localeCompare(b.date) || a.city.localeCompare(b.city);
  hits.sort(byClear); overview.sort(byClear);
  return { mode: "sun", rules: { maxCloud: maxCloudLimit }, hits, overview, skipped, finished, partial };
}

// ---------- Multi-model comparison (Open-Meteo, one request per model so one failure can't break the rest) ----------
const MODELS = [
  ["ecmwf_ifs025", "ECMWF (Europe)"],
  ["gfs_seamless", "GFS (US)"],
  ["gem_seamless", "GEM (Canada)"],
  ["icon_seamless", "ICON (Germany)"],
  ["ukmo_seamless", "UKMO (UK)"],
  ["meteofrance_seamless", "Météo-France"],
  ["jma_seamless", "JMA (Japan)"]
];
const modelCache = {};
function modelHighs(lat, lon, unit, kind = "high") {
  const v = kind === "low" ? "temperature_2m_min" : "temperature_2m_max";
  const key = `${lat},${lon},${unit},${kind}`;
  if (!modelCache[key]) modelCache[key] = Promise.all(MODELS.map(async ([id, name]) => {
    try {
      const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${v}&temperature_unit=${unit === "C" ? "celsius" : "fahrenheit"}&timezone=auto&forecast_days=16&models=${id}`);
      const k = Object.keys(d.daily || {}).find(x => x.startsWith(v));
      return k ? { id, name, time: d.daily.time, max: d.daily[k] } : null;
    } catch { return null; }
  }));
  return modelCache[key];
}
async function addModels(hit) {
  const cur = await currentModelsDaily(hit.lat, hit.lon, hit.station, hit.unit, hit.kind);
  const day = (cur && cur[hit.date]) || {};
  const models = [];
  for (const [id, name] of MODELS) {
    const v = day[id];
    if (v == null) continue;
    const r = Math.round(v);
    models.push({ id, name, value: Math.round(v * 10) / 10, inBucket: hit.side === "HIGH" ? r >= hit.threshold : r <= hit.threshold });
  }
  hit.models = models;
  hit.agree = models.filter(m => m.inBucket).length;
}

// Settlement-source link (Weather Underground) from the market rules, if present
function settlementLink(ev) {
  const text = [ev.resolutionSource, ev.description, ...(ev.markets || []).flatMap(m => [m.resolutionSource, m.description])].filter(Boolean).join(" ");
  const m = text.match(/https?:\/\/(?:www\.)?wunderground\.com\/[^\s"')<]+/);
  if (m) return m[0].replace(/[.,;]+$/, "");
  const code = findStation(ev);
  if (code === "HKO") return "https://www.hko.gov.hk/textonly/v2/forecast/text_readings_e.htm";
  return code && /^[A-Z]{4}$/.test(code) ? `https://aviationweather.gov/data/metar/?id=${code}&hours=24` : null;
}

// ---------- Smart forecast: per-airport, self-calibrating blend of the best models ----------
// 1) Previous Runs API → what each model forecast 1 and 2 days ahead, for the past ~7 days.
// 2) Airport METARs (routine reports, Polymarket's settlement data) → the actual daily high/low.
// 3) Per model: bias (shrunk toward 0 when data is thin) and an honest leave-one-out error.
// 4) Keep the best model(s), weight by accuracy, subtract each model's bias, combine.
// Recomputed from a rolling 7-day window, so it re-learns as new days come in.
const SMART_IDS = MODELS.map(m => m[0]);
const MODEL_NAME = Object.fromEntries(MODELS);
const SMART_DAYS = 7, MIN_DAYS = 3, MIN_REPORTS = 18;
const shrink = k => k / (k + 1);   // trust the learned bias more as days accumulate (6 days → 86%)
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const r1 = v => Math.round(v * 10) / 10;
const addDaysIso = (date, n) => new Date(Date.parse(date + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

const memo = {};
function memoize(key, fn) {
  if (!memo[key]) memo[key] = fn().catch(e => { delete memo[key]; throw e; });
  return memo[key];
}
// Shared cache: Redis when connected (survives between scans and phones), otherwise this run only
function cached(key, ttlSec, fn) {
  return memoize(key, async () => {
    if (hasRedis()) { try { const v = await redis("GET", key); if (v) return JSON.parse(v); } catch {} }
    const val = await fn();
    // A result can ask for a shorter life (e.g. "not enough data yet" should be retried soon)
    const ttl = val && val._ttl ? val._ttl : ttlSec;
    if (val != null && hasRedis()) redis("SET", key, JSON.stringify(val), "EX", String(ttl)).catch(() => {});
    return val;
  });
}

// Daily high/low from each model's forecast made 1 and 2 days earlier
async function previousRunsDaily(lat, lon, unit, kind) {
  let ids = ["best_match", ...SMART_IDS];
  const leads = [1, 2];
  const url = list => `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=${leads.map(L => `temperature_2m_previous_day${L}`).join(",")}&models=${list.join(",")}` +
    `&past_days=${SMART_DAYS + 2}&forecast_days=1&timezone=auto&temperature_unit=${unit === "C" ? "celsius" : "fahrenheit"}`;
  let d;
  try { d = await historyLimit(() => getJSON(url(ids), 20000)); }
  catch (e) {
    if (/^4/.test(e.message)) { ids = SMART_IDS; d = await historyLimit(() => getJSON(url(ids), 20000)); }   // retry without the blend if it isn't accepted
    else throw e;
  }
  const h = d.hourly || {}, out = {}, outHourly = {};
  for (const id of ids) for (const L of leads) {
    const arr = h[`temperature_2m_previous_day${L}_${id}`];
    if (!arr) continue;
    const byDate = {};
    (h.time || []).forEach((t, i) => {
      const v = arr[i]; if (v == null) return;
      const dt = t.slice(0, 10), e = byDate[dt];
      if (!e) byDate[dt] = { v, n: 1 }; else { e.v = kind === "low" ? Math.min(e.v, v) : Math.max(e.v, v); e.n++; }
    });
    const series = {};
    for (const [dt, e] of Object.entries(byDate)) if (e.n >= 20) series[dt] = e.v;
    (out[id] = out[id] || {})[L] = series;
    if (L === 1) {
      const hourly = {};
      (h.time || []).forEach((t, i) => { if (arr[i] != null) hourly[t.slice(0, 13)] = arr[i]; });   // "YYYY-MM-DDTHH"
      (outHourly[id] = hourly);
    }
  }
  return { offset: d.utc_offset_seconds || 0, byModel: out, hourly: outHourly };
}

// Airport readings snapped to the nearest whole hour (local), for learning hour-of-day corrections
function observedHourly(obs, offset, unit) {
  const conv = c => unit === "C" ? c : c * 9 / 5 + 32, out = {};
  for (const o of obs || []) {
    const local = new Date(o.time + offset * 1000), min = local.getUTCMinutes();
    if (min > 20 && min < 40) continue;                       // too far from a whole hour
    const t = new Date(local.getTime() + (min >= 40 ? 3600e3 : 0)).toISOString().slice(0, 13);
    out[t] = conv(o.c);
  }
  return out;
}

// Per model, a correction for each hour of the day: the TYPICAL (median) amount its 1-day-ahead
// forecast ran from the airport at that hour, pooled over neighbouring hours, shrunk when few days
// agree, and capped so one unusual spell of weather can't dominate. `skipDate` leaves a day out.
const median = a => { const b = [...a].sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
function hourOfDayBias(modelHourly, obsH, skipDate = null) {
  const err = Array.from({ length: 24 }, () => []);
  for (const [t, ov] of Object.entries(obsH)) {
    if (skipDate && t.startsWith(skipDate)) continue;
    const mv = modelHourly[t];
    if (mv != null) err[+t.slice(11, 13)].push(mv - ov);
  }
  return Array.from({ length: 24 }, (_, hr) => {
    const pool = [...err[(hr + 23) % 24], ...err[hr], ...err[(hr + 1) % 24]];
    if (pool.length < 6) return null;
    const days = pool.length / 3;
    const v = median(pool) * shrink(days / 2);                 // need several days before trusting fully
    return Math.round(Math.max(-5, Math.min(5, v)) * 10) / 10;
  });
}
// Honest check at this airport: predict each past hour with corrections learned WITHOUT that day,
// at 0 %, 50 % and 100 % strength, and keep whichever tracked the real readings best.
function chooseHourlyStrength(hourly, obsH, chosen) {
  const dates = [...new Set(Object.keys(obsH).map(t => t.slice(0, 10)))];
  const loo = {};                                              // loo[id][date] = corrections without that day
  for (const c of chosen) { loo[c.id] = {}; for (const d of dates) loo[c.id][d] = hourOfDayBias(hourly[c.id] || {}, obsH, d); }
  const strengths = [0, 0.5, 1], errs = strengths.map(() => []), blendErr = [];
  for (const [t, ov] of Object.entries(obsH)) {
    const d = t.slice(0, 10), hr = +t.slice(11, 13);
    if (!chosen.every(c => hourly[c.id] && hourly[c.id][t] != null)) continue;
    strengths.forEach((a, i) => {
      let num = 0, den = 0;
      for (const c of chosen) { const hb = loo[c.id][d][hr]; num += c.w * (hourly[c.id][t] - a * (hb ?? 0)); den += c.w; }
      errs[i].push(Math.abs(num / den - ov));
    });
    if (hourly.best_match && hourly.best_match[t] != null) blendErr.push(Math.abs(hourly.best_match[t] - ov));
  }
  if (!errs[0].length) return null;
  const mae = errs.map(e => avg(e)), best = mae.indexOf(Math.min(...mae));
  return { strength: strengths[best], miss: r1(mae[best]), uncorrectedMiss: r1(mae[0]), blendMiss: blendErr.length ? r1(avg(blendErr)) : null, hours: errs[0].length };
}

// Actual daily high/low at the airport from routine reports (complete days only)
async function observedDaily(code, offset, unit, kind) {
  if (code === "HKO") {
    const conv = c => unit === "C" ? c : c * 9 / 5 + 32;
    const today = new Date(Date.now() + offset * 1000).toISOString().slice(0, 10);
    const dates = Array.from({ length: SMART_DAYS + 1 }, (_, i) => addDaysIso(today, -(i + 1)));
    const vals = await Promise.all(dates.map(hkoDay));
    const days = {};
    dates.forEach((d, i) => { if (vals[i]) days[d] = { ext: conv(kind === "low" ? vals[i].min : vals[i].max), n: 99 }; });
    return days;
  }
  const obs = await stationObs(code);
  const conv = c => unit === "C" ? c : c * 9 / 5 + 32;
  const days = {};
  for (const o of obs || []) {
    const dt = new Date(o.time + offset * 1000).toISOString().slice(0, 10), v = conv(o.c), e = days[dt];
    if (!e) days[dt] = { ext: v, n: 1 }; else { e.ext = kind === "low" ? Math.min(e.ext, v) : Math.max(e.ext, v); e.n++; }
  }
  return days;
}

// Score every model at this airport and choose/weight the best ones (cached 12 h)
function stationSkill(st, code, unit, kind) {
  return cached(`skill:v7:${code}:${unit}:${kind}`, 12 * 3600, async () => {
    if (!/^[A-Z]{4}$/.test(code) && code !== "HKO") return { days: 0, leads: {}, reason: "No airport reports for this station", _ttl: 3600 };
    const pr = await previousRunsDaily(st[0], st[1], unit, kind);
    const obs = await observedDaily(code, pr.offset, unit, kind);
    const localToday = new Date(Date.now() + pr.offset * 1000).toISOString().slice(0, 10);
    const days = Object.keys(obs).filter(d => d < localToday && obs[d].n >= MIN_REPORTS).sort().slice(-SMART_DAYS);
    const res = { days: days.length, dates: days, leads: {}, at: new Date().toISOString() };

    if (days.length < MIN_DAYS) { res.reason = code === "HKO" ? "Not enough Observatory daily reports yet" : "Not enough complete days of airport reports yet"; res._ttl = 3600; return res; }
    for (const L of [1, 2]) {
      const stats = {};
      for (const id of ["best_match", ...SMART_IDS]) {
        const series = pr.byModel[id]?.[L];
        if (!series) continue;
        const ds = days.filter(d => series[d] != null);
        if (ds.length < MIN_DAYS) continue;
        const err = Object.fromEntries(ds.map(d => [d, series[d] - obs[d].ext]));   // + = model too warm
        const errs = Object.values(err), n = errs.length;
        // Typical (median) error, so one unusual day can't drag the correction; shrunk when days are few
        const looBias = d => median(ds.filter(x => x !== d).map(x => err[x])) * shrink(n - 1);   // learned without day d
        // Judge each model at its best correction strength (none / half / full), on days it didn't learn from
        const rmseAt = a => Math.sqrt(avg(ds.map(d => (err[d] - a * looBias(d)) ** 2)));
        const rm = [0, 0.5, 1].map(rmseAt);
        stats[id] = { n, bias: r1(median(errs) * shrink(n)), rawMiss: r1(avg(errs.map(Math.abs))), rmse: Math.min(...rm), err, ds, looBias };
      }
      const ranked = SMART_IDS.filter(id => stats[id]).sort((a, b) => stats[a].rmse - stats[b].rmse);
      if (!ranked.length) continue;
      const best = stats[ranked[0]].rmse;
      const chosen = ranked.filter(id => stats[id].rmse <= best * 1.25 + 0.3).slice(0, 4);
      const w = Object.fromEntries(chosen.map(id => [id, 1 / (stats[id].rmse ** 2 + 0.1)]));
      // Honest track record of the Smart blend: each day uses corrections learned from the other days.
      // Try the corrections at none / half / full strength and keep what actually worked here.
      const testDays = days.filter(d => chosen.every(id => stats[id].err[d] != null));
      const blendErrs = a => testDays.map(d => {
        let num = 0, den = 0;
        for (const id of chosen) { num += w[id] * (stats[id].err[d] - a * stats[id].looBias(d)); den += w[id]; }
        return num / den;
      });
      const tries = [0, 0.5, 1].map(a => ({ a, e: blendErrs(a) }));
      const pick = tries.reduce((x, y) => (y.e.length && avg(y.e.map(Math.abs)) < avg(x.e.map(Math.abs)) - 0.02 ? y : x));
      const smartErrs = pick.e;
      const wsum = Object.values(w).reduce((a, b) => a + b, 0);
      res.leads[L] = {
        chosen: chosen.map(id => ({ id, w: r1(w[id] / wsum * 100) / 100, bias: r1(stats[id].bias * pick.a), miss: r1(stats[id].rmse) })),
        strength: pick.a,
        smartMiss: smartErrs.length ? r1(avg(smartErrs.map(Math.abs))) : null,
        blendMiss: stats.best_match ? stats.best_match.rawMiss : null,
        models: Object.fromEntries(Object.entries(stats).map(([id, S]) => [id, { bias: S.bias, rawMiss: S.rawMiss, n: S.n }]))
      };
    }
    // The Smart LINE (hour by hour) gets its own models: the ones that track this airport's readings best
    // through the whole day, tested on days they didn't learn from. (The daily value keeps the models that
    // are best at the high/low itself.) If no mix beats the plain blend, the line follows the blend.
    if (code !== "HKO" && pr.hourly) {
      const obsH = observedHourly(await stationObs(code), pr.offset, unit);
      const cands = ["best_match", ...SMART_IDS].filter(id => pr.hourly[id])
        .map(id => ({ id, ...(chooseHourlyStrength(pr.hourly, obsH, [{ id, w: 1 }]) || {}) }))
        .filter(c => c.miss != null).sort((a, b) => a.miss - b.miss);
      if (cands.length) {
        const top = cands.filter(c => c.miss <= cands[0].miss * 1.15 + 0.2).slice(0, 4);
        const mix = top.map(c => ({ id: c.id, w: 1 / (c.miss ** 2 + 0.1) }));
        const mixCheck = chooseHourlyStrength(pr.hourly, obsH, mix);
        const single = cands[0];
        const useMix = mixCheck && mix.length > 1 && mixCheck.miss < single.miss;
        const lineModels = useMix ? mix : [{ id: single.id, w: 1 }];
        const check = useMix ? mixCheck : single;
        const wsum = lineModels.reduce((a, c) => a + c.w, 0);
        res.hourly = { strength: check.strength, miss: check.miss, uncorrectedMiss: check.uncorrectedMiss, blendMiss: check.blendMiss, hours: check.hours };
        res.line = lineModels.map(c => ({ id: c.id, w: r1(c.w / wsum * 100) / 100, hb: hourOfDayBias(pr.hourly[c.id], obsH) }));
      }
    }
    if (!Object.keys(res.leads).length) res._ttl = 3600;
    return res;
  });
}

// Today's forecast high/low from every model in one request (cached 3 h; models update every ~6 h)
function currentModelsDaily(lat, lon, code, unit, kind) {
  return cached(`cur:v1:${code}:${unit}:${kind}`, 3 * 3600, async () => {
    const v = kind === "low" ? "temperature_2m_min" : "temperature_2m_max";
    const d = await historyLimit(() => getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${v}` +
      `&models=${SMART_IDS.join(",")}&temperature_unit=${unit === "C" ? "celsius" : "fahrenheit"}&timezone=auto&forecast_days=7`, 15000));
    const out = {};
    for (const id of SMART_IDS) {
      const arr = d.daily?.[`${v}_${id}`] || (SMART_IDS.length === 1 ? d.daily?.[v] : null);
      (d.daily?.time || []).forEach((t, i) => { if (arr && arr[i] != null) (out[t] = out[t] || {})[id] = arr[i]; });
    }
    return out;
  });
}

async function smartFor(st, code, unit, kind, date, localToday) {
  const [skill, cur] = await Promise.all([
    stationSkill(st, code, unit, kind).catch(e => ({ days: 0, leads: {}, reason: "Couldn't load model history (" + (e && e.message || e) + ")" })),
    currentModelsDaily(st[0], st[1], code, unit, kind)
  ]);
  const today = cur && cur[date];
  if (!today || !Object.keys(today).length) return null;
  const ahead = Math.round((Date.parse(date) - Date.parse(localToday)) / 86400000);
  const lead = Math.min(2, Math.max(1, ahead));
  const L = skill?.leads?.[lead] || skill?.leads?.[1];
  const used = L ? L.chosen.filter(c => today[c.id] != null) : [];
  if (!used.length) {
    // Not enough history: plain average of the models, no bias correction
    const ids = Object.keys(today);
    return { value: r1(avg(ids.map(id => today[id]))), fallback: true, reason: skill?.reason || "No model history yet",
      days: skill?.days || 0, used: ids.map(id => ({ id, name: MODEL_NAME[id] || id, w: r1(1 / ids.length * 100) / 100, bias: 0 })) };
  }
  const ws = used.reduce((a, c) => a + c.w, 0);
  const value = used.reduce((a, c) => a + c.w * (today[c.id] - c.bias), 0) / ws;
  return {
    value: r1(value), lead, days: skill.days,
    used: used.map(c => ({ id: c.id, name: MODEL_NAME[c.id] || c.id, w: r1(c.w / ws * 100) / 100, bias: c.bias, miss: c.miss, raw: r1(today[c.id]),
      hb: skill.hourBias && skill.hourBias[c.id] ? skill.hourBias[c.id] : null })),
    smartMiss: L.smartMiss, blendMiss: L.blendMiss,
    hourly: skill.hourly || null,     // { strength, miss, uncorrectedMiss, blendMiss, hours }
    line: skill.line || null          // models + hour-of-day corrections for the hourly Smart line
  };
}

// ---------- Edge temperature scan ----------
export async function tempScan(events, t0, near = 0, kind = "high") {
  const hi = kind !== "low";
  const hits = [], skipped = [], overview = [];
  let finished = 0, partial = false;
  const work = Promise.all(events.map(async ev => { try {
    const code = findStation(ev);
    const st = code ? await lookupStation(code) : null;
    if (!st) { skipped.push({ title: ev.title, reason: code ? `Unknown station ${code}` : "No station in rules" }); return; }
    const date = parseDate(ev);
    const city = (ev.title || "").replace(/.*(?:highest|lowest) temperature in /i, "").replace(/ on .*/i, "").replace(/\?$/, "");
    const row = { city, date, station: code, stationName: st[2], unit: null, forecast: null, low: null, high: null,
                  url: `https://polymarket.com/event/${ev.slug}`, slug: ev.slug, hit: null };
    let isFinished = false, smart, smartTried = false;
    for (const m of ev.markets || []) {
      if (m.closed) continue;
      const label = m.groupItemTitle || m.question || "";
      const b = parseBucket(label);
      if (!b) continue;
      let f;
      try { f = await forecastHigh(st[0], st[1], b.unit, date, kind); } catch { f = null; }
      if (f && !smartTried && date >= f.localToday) {
        smartTried = true;
        try { smart = await smartFor(st, code, b.unit, kind, date, f.localToday); } catch { smart = null; }
      }
      if (f && date < f.localToday) { isFinished = true; break; }
      let fc = f ? f.value : null;
      if (fc == null) continue;
      row.tz = f.tz;
      // Today: the high can't end up below what the airport has already recorded
      let obsNow = null;
      if (f && date === f.localToday) {
        obsNow = await observedNow(code, f.offset, date, b.unit);
        if (obsNow) { const hr = hi ? obsNow.maxHour : obsNow.minHour;
          row.observed = { value: hi ? obsNow.max : obsNow.min, at: hr != null ? hh(hr) : null, count: obsNow.count,
            source: obsNow.source || "metar", asOf: obsNow.asOf || null }; }
      }
      const fcModel = fc;
      // The day's high can't end below what's been recorded; the day's low can't end above it
      if (obsNow) fc = hi ? Math.max(fc, obsNow.max) : Math.min(fc, obsNow.min);
      let sfc = smart ? smart.value : null;
      if (sfc != null && obsNow) sfc = hi ? Math.max(sfc, obsNow.max) : Math.min(sfc, obsNow.min);
      if (smart) row.smart = { ...smart, adjusted: sfc };
      const p = yesPrice(m);
      const yesPct = p == null ? null : Math.round(p * 1000) / 10;
      row.unit = b.unit; row.forecast = fc;
      row[b.side === "LOW" ? "low" : "high"] = { threshold: b.value, label, yesPct };
      const r = Math.round(fc);
      const past = b.side === "HIGH" ? r - b.value : b.value - r;
      // Smart forecast is judged by exactly the same rule
      const sr = sfc != null ? Math.round(sfc) : null;
      const spast = sr == null ? null : b.side === "HIGH" ? sr - b.value : b.value - sr;
      const status = v => v == null ? "none" : v >= 0 ? "hit" : v >= -1 ? "near" : "none";
      const best = Math.max(past, spast ?? -Infinity);
      if (best >= -near) {
        const hit = {
          city, date, side: b.side, bucket: label,
          threshold: b.value, unit: b.unit, forecast: fc, rounded: r, past,
          yesPct, noPct: p == null ? null : Math.round((1 - p) * 1000) / 10,
          station: code, stationName: st[2], lat: st[0], lon: st[1],
          url: row.url, slug: ev.slug, nearMiss: best < 0, settle: settlementLink(ev),
          smart: row.smart || null, smartRounded: sr, smartPast: spast,
          triggers: { openmeteo: status(past), smart: status(spast) },
          forecastModel: fcModel, observed: row.observed || null, tz: f.tz,
          kind, locked: !!(obsNow && (hi ? b.side === "HIGH" && Math.round(obsNow.max) >= b.value
                                         : b.side === "LOW" && Math.round(obsNow.min) <= b.value))
        };
        hits.push(hit);
        if (!row.hit || (row.hit.nearMiss && !hit.nearMiss)) row.hit = hit;
      }
    }
    if (isFinished) { finished++; return; }
    if (row.forecast != null) overview.push(row);
  } catch (e) { skipped.push({ title: ev.title, reason: "Error: " + (e && e.message || e) }); } }));
  let timer;
  const stop = new Promise(r => { timer = setTimeout(() => { partial = true; r(); }, Math.max(5000, 40000 - (Date.now() - t0))); });
  await Promise.race([work, stop]);
  clearTimeout(timer);
  // Compare each hit against several independent models (max ~12 s)
  let t2;
  await Promise.race([
    Promise.all(hits.map(h => addModels(h).catch(() => {}))),
    new Promise(r => { t2 = setTimeout(r, 12000); })
  ]);
  clearTimeout(t2);
  const byDate = (a, b) => a.date.localeCompare(b.date) || a.city.localeCompare(b.city);
  hits.sort(byDate); overview.sort(byDate);
  // Health of the Smart forecast across markets: learned from history vs fell back to a plain average
  const smartStats = { learned: 0, fallback: 0, none: 0, avgDays: 0 };
  for (const o of overview) { if (!o.smart) smartStats.none++; else if (o.smart.fallback) smartStats.fallback++; else { smartStats.learned++; smartStats.avgDays += o.smart.days; } }
  if (smartStats.learned) smartStats.avgDays = r1(smartStats.avgDays / smartStats.learned);
  return { mode: "temp", kind, hits, overview, skipped, finished, partial, smartStats };
}

// ---------- Cross-check: run all four checks on one city/date ----------
async function checkOne(slug, near, cloud) {
  const found = await getJSON(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
  const ev = Array.isArray(found) ? found[0] : found;
  if (!ev) throw new Error("Market not found on Polymarket");
  const t0 = Date.now();
  const [t, r, n, s] = await Promise.all([
    tempScan([ev], t0, near, kindOf(ev)), rainScan([ev], t0), nightScan([ev], t0, kindOf(ev)), sunScan([ev], t0, cloud)
  ]);
  const fmt = v => Math.round(v * 10) / 10;
  const out = {};
  const T = t.overview[0];
  out.temp = !T ? { status: "na", detail: "No forecast available" }
    : T.hit && !T.hit.nearMiss ? { status: "pass", detail: `Forecast ${fmt(T.forecast)}°${T.unit} is in ${T.hit.bucket} (${T.hit.yesPct ?? "?"}%)` }
    : { status: T.hit ? "near" : "fail", detail: `Forecast ${fmt(T.forecast)}°${T.unit} · edges ${T.low ? "≤" + T.low.threshold + "°" : "–"} / ${T.high ? "≥" + T.high.threshold + "°" : "–"}` };
  const R = r.overview[0];
  out.rain = !R ? { status: "na", detail: "No forecast available" }
    : { status: R.longest >= RAIN_STREAK ? "pass" : "fail",
        detail: R.longest ? `Longest run ${R.longest} hr${R.longest > 1 ? "s" : ""} (${R.start}–${R.end}) · ${R.dayMm} mm all day` : `No rainy hours · ${R.dayMm} mm all day` };
  const N = n.overview[0];
  out.night = !N ? { status: "na", detail: "No forecast available" }
    : { status: N.night ? "pass" : "fail",
        detail: N.kind === "low"
          ? `Low ${fmt(N.peak)}°${N.unit} at ${N.peakTime} · daytime ${N.margin > 0 ? N.margin + "° colder" : Math.abs(N.margin) + "° warmer"} than other hours`
          : `Peak ${fmt(N.peak)}°${N.unit} at ${N.peakTime} · night ${N.margin > 0 ? "+" : ""}${N.margin}° vs day` };
  const S = s.overview[0];
  out.sun = !S ? { status: "na", detail: "No forecast available" }
    : { status: S.clear ? "pass" : "fail",
        detail: `Max daylight cloud ${S.maxCloud}% (limit ${cloud}%)${S.dayRain > 0 ? ` · ${S.dayRain} mm rain` : ` · ${S.sunPct ?? "?"}% sunny`}` };
  return { slug, kind: kindOf(ev), checks: out };
}

// ---------- Detail: full card info for any one market (hit or not) ----------
async function detailOne(slug, near) {
  const found = await getJSON(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
  const ev = Array.isArray(found) ? found[0] : found;
  if (!ev) throw new Error("Market not found on Polymarket");
  const t = await tempScan([ev], Date.now(), 999, kindOf(ev)); // every edge bucket, with model check
  const row = t.overview[0];
  if (!row || !t.hits.length) throw new Error("No forecast available for this market");
  // Show the edge the forecast is closest to (or already inside)
  const bp = x => Math.max(x.past, x.smartPast ?? -Infinity);   // closer of the two forecasts
  const h = t.hits.reduce((a, b) => (bp(b) > bp(a) ? b : a));
  h.nearMiss = bp(h) < 0;
  h.status = bp(h) >= 0 ? "hit" : bp(h) >= -near && near > 0 ? "near" : "none";
  return { hit: h, row };
}

// ---------- Day graph: hourly forecast + real airport readings for one market's day ----------
const modelHourlyCache = {};
function modelHourly(lat, lon, unit, pastDays = 1) {
  const key = `${lat},${lon},${unit},${pastDays}`;
  if (!modelHourlyCache[key]) modelHourlyCache[key] = Promise.all(MODELS.map(async ([id, name]) => {
    try {
      const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&temperature_unit=${unit === "C" ? "celsius" : "fahrenheit"}&timezone=auto&past_days=${pastDays}&forecast_days=16&models=${id}`);
      const k = Object.keys(d.hourly || {}).find(x => x.startsWith("temperature_2m"));
      return k ? { id, name, time: d.hourly.time, temp: d.hourly[k] } : null;
    } catch { return null; }
  }));
  return modelHourlyCache[key];
}
const blendCache = {};
function blendHourly(lat, lon, unit, pastDays) {
  const key = `${lat},${lon},${unit},${pastDays}`;
  if (!blendCache[key]) blendCache[key] = getJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&temperature_unit=${unit === "C" ? "celsius" : "fahrenheit"}&timezone=auto&past_days=${pastDays}&forecast_days=16`);
  return blendCache[key];
}
const addDays = (date, n) => new Date(Date.parse(date + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

async function graphOne(slug, days = 1) {
  days = Math.min(4, Math.max(1, days | 0));
  const found = await getJSON(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
  const ev = Array.isArray(found) ? found[0] : found;
  if (!ev) throw new Error("Market not found on Polymarket");
  const kind = kindOf(ev);
  const code = findStation(ev);
  const st = code ? await lookupStation(code) : null;
  if (!st) throw new Error("No settlement station in this market's rules");
  const date = parseDate(ev);
  let unit = "F", lowEdge = null, highEdge = null;
  for (const m of ev.markets || []) {
    const b = parseBucket(m.groupItemTitle || m.question || "");
    if (!b) continue;
    unit = b.unit;
    if (b.side === "LOW") lowEdge = b.value; else highEdge = b.value;
  }
  const past = days > 1 ? 5 : 1;
  const [data, mh] = await Promise.all([
    days > 1 ? blendHourly(st[0], st[1], unit, past) : hourlyTemps(st[0], st[1], unit),
    modelHourly(st[0], st[1], unit, past)
  ]);
  const off = data.utc_offset_seconds || 0;
  const dates = Array.from({ length: days }, (_, i) => addDays(date, i - (days - 1)));
  // minute offset from local midnight of the first day in the range
  const toM = t => { const i = dates.indexOf(t.slice(0, 10)); return i < 0 ? null : i * 1440 + +t.slice(11, 13) * 60 + +t.slice(14, 16); };
  const models = [];
  for (const m of mh) {
    if (!m) continue;
    const points = [];
    for (let i = 0; i < m.time.length; i++) { const mm = toM(m.time[i]); if (mm != null && m.temp[i] != null) points.push({ m: mm, v: m.temp[i] }); }
    if (points.length) models.push({ id: m.id, name: m.name, points });
  }
  const forecast = [];
  for (let i = 0; i < (data.hourly?.time || []).length; i++) {
    const mm = toM(data.hourly.time[i]);
    if (mm != null && data.hourly.temperature_2m[i] != null) forecast.push({ m: mm, v: data.hourly.temperature_2m[i] });
  }
  const localNow = new Date(Date.now() + off * 1000);
  const nowIso = localNow.toISOString();
  const nowIdx = dates.indexOf(nowIso.slice(0, 10));
  const nowMin = nowIdx >= 0 ? nowIdx * 1440 + localNow.getUTCHours() * 60 + localNow.getUTCMinutes()
               : nowIso.slice(0, 10) > dates[dates.length - 1] ? days * 1440 : null;
  const observed = [];
  if (nowMin != null || nowIso.slice(0, 10) >= dates[0]) {
    const conv = c => unit === "C" ? c : c * 9 / 5 + 32;
    for (const o of (await stationObs(code, days > 1 ? 120 : 36)) || []) {
      const local = new Date(o.time + off * 1000).toISOString();
      const mm = toM(local.slice(0, 16));
      if (mm == null) continue;
      observed.push({ m: mm, v: Math.round(conv(o.c) * 10) / 10 });
    }
    observed.sort((a, b) => a.m - b.m);
  }
  // ---- Past hours: show what each forecast said ONE DAY AHEAD (fair comparison with what happened) ----
  const toKey = mm => `${dates[Math.floor(mm / 60 / 24)]}T${String(Math.floor(mm / 60) % 24).padStart(2, "0")}`;
  const pastEnd = nowMin == null ? -1 : Math.floor(nowMin / 60) * 60;          // hours strictly before "now"
  let pr = null;
  if (pastEnd > 0 && code !== "HKO") {
    try { pr = await memoize(`pr:${code}:${unit}:${kind}`, () => previousRunsDaily(st[0], st[1], unit, kind)); } catch { pr = null; }
  }
  const dayAhead = (id, mm) => pr && pr.hourly && pr.hourly[id] ? pr.hourly[id][toKey(mm)] : undefined;
  if (pr) {
    for (const m of models) m.points = m.points.map(p => { const v = p.m < pastEnd ? dayAhead(m.id, p.m) : undefined; return v != null ? { m: p.m, v } : p; });
    for (let i = 0; i < forecast.length; i++) { const v = forecast[i].m < pastEnd ? dayAhead("best_match", forecast[i].m) : undefined; if (v != null) forecast[i] = { m: forecast[i].m, v }; }
  }

  // ---- The Smart (learned) forecast as an hourly line ----
  // Same models and weights as the card. Hour-of-day corrections are applied at the strength this
  // airport's own check chose (0, 50 or 100 %). Past hours use day-ahead forecasts with corrections
  // learned WITHOUT that day, so the past part of the line is an honest test, not a fit.
  let smart = null, smartError = null;
  try {
    const localToday = new Date(Date.now() + off * 1000).toISOString().slice(0, 10);
    const sm = date >= localToday ? await smartFor(st, code, unit, kind, date, localToday) : null;
    if (!sm) smartError = date < localToday ? "market day has passed" : "no Smart forecast";
    if (sm && sm.used && sm.used.length) {
      const strength = sm.hourly ? sm.hourly.strength : 0;
      const obsH = pr ? observedHourly(await stationObs(code), off, unit) : null;
      const looCache = {};
      const looBias = (id, d) => { const k = id + d; if (!(k in looCache)) looCache[k] = pr && pr.hourly[id] ? hourOfDayBias(pr.hourly[id], obsH, d) : null; return looCache[k]; };
      const byId = Object.fromEntries(models.map(m => [m.id, new Map(m.points.map(p => [p.m, p.v]))]));
      byId.best_match = new Map(forecast.map(p => [p.m, p.v]));
      const lineModels = sm.line && sm.line.length ? sm.line : sm.used;   // hourly-skill models when learned
      const total = lineModels.reduce((a, u) => a + u.w, 0);
      const minutes = [...new Set(models.flatMap(m => m.points.map(p => p.m)))].sort((a, b) => a - b);
      let points = [];
      for (const mm of minutes) {
        const hr = Math.floor(mm / 60) % 24, isPast = mm < pastEnd && pr;
        let num = 0, den = 0;
        for (const u of lineModels) {
          const v = byId[u.id] && byId[u.id].get(mm); if (v == null) continue;
          const hb = isPast ? looBias(u.id, toKey(mm).slice(0, 10)) : u.hb;
          const corr = hb && hb[hr] != null ? hb[hr] * strength : 0;
          num += u.w * (v - corr); den += u.w;
        }
        if (den >= total * 0.6) points.push({ m: mm, v: num / den });
      }
      const dayStart = (days - 1) * 1440, ahead = points.filter(p => p.m >= Math.max(dayStart, pastEnd));
      if (points.length) {
        // Gently pull the market day's remaining high/low onto the card's Smart value (±3 h bell)
        const e = ahead.reduce((a, p) => !a || (kind === "low" ? p.v < a.v : p.v > a.v) ? p : a, null);
        const delta = e ? sm.value - e.v : 0;
        points = points.map(p => ({ m: p.m, v: Math.round((p.v + (e && p.m >= Math.max(dayStart, pastEnd) ? delta * Math.exp(-(((p.m - e.m) / 180) ** 2)) : 0)) * 10) / 10 }));
        smart = { points, value: sm.value, used: sm.used.map(u => u.id), lineModels: lineModels.map(u => u.id), fallback: !!sm.fallback, hourly: sm.hourly || null };
      }
    }
  } catch (e) { smartError = String(e && e.stack || e).slice(0, 300); }
  const pastAhead = !!pr;
  const city = (ev.title || "").replace(/.*(?:highest|lowest) temperature in /i, "").replace(/ on .*/i, "").replace(/\?$/, "");
  return { city, date, dates, days, unit, kind, tz: data.timezone || null, station: code, stationName: st[2], forecast, models, smart, smartError, observed, nowMin, lowEdge, highEdge, pastAhead };
}

const send = (res, code, body) => { res.setHeader("Cache-Control", "no-store"); return res.status(code).json(body); };

export { stationSkill, previousRunsDaily, observedHourly, stationObs };

export default async function handler(req, res) {
  const q = req.query || {};
  const mode = q.mode || "temp";
  const near = parseFloat(q.near || "0") || 0;
  const cloudN = Math.min(100, Math.max(0, parseInt(q.cloud, 10)));
  const cloud = Number.isFinite(cloudN) ? cloudN : SUN_MAX_CLOUD;
  const t0 = Date.now();
  try {
    if (mode === "graph") {
      if (!q.slug) return send(res, 400, { error: "Missing market" });
      return send(res, 200, await graphOne(String(q.slug), parseInt(q.days, 10) || 1));
    }
    if (mode === "detail") {
      if (!q.slug) return send(res, 400, { error: "Missing market" });
      return send(res, 200, await detailOne(String(q.slug), near));
    }
    if (mode === "check") {
      if (!q.slug) return send(res, 400, { error: "Missing market" });
      return send(res, 200, await checkOne(String(q.slug), near, cloud));
    }
    const kind = q.kind === "low" ? "low" : "high";
    const events = await getTempEvents(t0, kind);
    const out = mode === "rain" ? await rainScan(events, t0)
      : mode === "night" ? await nightScan(events, t0, kind)
      : mode === "sun" ? await sunScan(events, t0, cloud)
      : await tempScan(events, t0, near, kind);
    return send(res, 200, { scannedAt: new Date().toISOString(), marketsFound: events.length, ...out, kind, ms: Date.now() - t0 });
  } catch (e) {
    return send(res, 500, { error: String(e && e.message || e) });
  }
}
