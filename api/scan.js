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
  if (!h) return { localToday, hours: null };
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
  return { localToday, hours: hours.map(x => (x.rainy ? 1 : 0)), streak: best, dayMm, rainyHours };
}

async function rainScan(events, t0) {
  const hits = [], overview = [], skipped = [];
  let finished = 0, partial = false;
  const work = Promise.all(events.map(async ev => { try {
    const code = findStation(ev);
    const st = code ? await lookupStation(code) : null;
    if (!st) { skipped.push({ title: ev.title, reason: code ? `Unknown station ${code}` : "No station in rules" }); return; }
    const date = parseDate(ev);
    const city = (ev.title || "").replace(/.*highest temperature in /i, "").replace(/ on .*/i, "").replace(/\?$/, "");
    let r;
    try { r = await rainDay(st[0], st[1], date); } catch { return; }
    if (date < r.localToday) { finished++; return; }
    if (!r.hours || !r.hours.length) return;
    const row = {
      city, date, station: code, stationName: st[2], url: `https://polymarket.com/event/${ev.slug}`,
      longest: r.streak ? r.streak.len : 0, start: r.streak?.start ?? null, end: r.streak?.end ?? null,
      streakMm: r.streak ? Math.round(r.streak.mm * 10) / 10 : 0, maxProb: r.streak?.maxProb ?? null,
      dayMm: Math.round(r.dayMm * 10) / 10, rainyHours: r.rainyHours, hours: r.hours
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

async function nightScan(events, t0) {
  const hits = [], overview = [], skipped = [];
  let finished = 0, partial = false;
  const work = Promise.all(events.map(async ev => { try {
    const code = findStation(ev);
    const st = code ? await lookupStation(code) : null;
    if (!st) { skipped.push({ title: ev.title, reason: code ? `Unknown station ${code}` : "No station in rules" }); return; }
    const date = parseDate(ev);
    const city = (ev.title || "").replace(/.*highest temperature in /i, "").replace(/ on .*/i, "").replace(/\?$/, "");
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
    let peakHour = -1, peak = -Infinity, dayMax = -Infinity, dayHour = -1, nightMax = -Infinity;
    temps.forEach((v, hr) => {
      if (v == null) return;
      if (v > peak) { peak = v; peakHour = hr; }
      if (isNight(hr)) nightMax = Math.max(nightMax, v);
      else if (v > dayMax) { dayMax = v; dayHour = hr; }
    });
    const margin = Math.round((nightMax - dayMax) * 10) / 10;
    const row = {
      city, date, unit, station: code, stationName: st[2], url: `https://polymarket.com/event/${ev.slug}`,
      peak, peakTime: String(peakHour).padStart(2, "0") + ":00", dayMax, dayTime: String(dayHour).padStart(2, "0") + ":00",
      margin, temps, leading: leadingBucket(ev), night: nightMax > dayMax
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
  return { mode: "night", hits, overview, skipped, finished, partial };
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
    const city = (ev.title || "").replace(/.*highest temperature in /i, "").replace(/ on .*/i, "").replace(/\?$/, "");
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
      city, date, station: code, stationName: st[2], url: `https://polymarket.com/event/${ev.slug}`,
      sunrise, sunset, maxCloud, avgCloud, dayRain, sunPct, clouds, daylight, leading: leadingBucket(ev),
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

export default async function handler(req, res) {
  if ((req.query && req.query.mode) === "sun") {
    const t0 = Date.now();
    try {
      const events = await getTempEvents(t0);
      const cloud = Math.min(100, Math.max(0, parseInt(req.query.cloud, 10)));
      const out = await sunScan(events, t0, Number.isFinite(cloud) ? cloud : SUN_MAX_CLOUD);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ scannedAt: new Date().toISOString(), marketsFound: events.length, ...out, ms: Date.now() - t0 });
    } catch (e) {
      return res.status(500).json({ error: String(e && e.message || e) });
    }
  }
  if ((req.query && req.query.mode) === "night") {
    const t0 = Date.now();
    try {
      const events = await getTempEvents(t0);
      const out = await nightScan(events, t0);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ scannedAt: new Date().toISOString(), marketsFound: events.length, ...out, ms: Date.now() - t0 });
    } catch (e) {
      return res.status(500).json({ error: String(e && e.message || e) });
    }
  }
  if ((req.query && req.query.mode) === "rain") {
    const t0 = Date.now();
    try {
      const events = await getTempEvents(t0);
      const out = await rainScan(events, t0);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ scannedAt: new Date().toISOString(), marketsFound: events.length, ...out, ms: Date.now() - t0 });
    } catch (e) {
      return res.status(500).json({ error: String(e && e.message || e) });
    }
  }
  const near = parseFloat((req.query && req.query.near) || "0") || 0;
  const hits = [], skipped = [], overview = [];
  let finished = 0;
  const t0 = Date.now();
  try {
    const events = await getTempEvents(t0);
    let partial = false;
    const work = Promise.all(events.map(async ev => { try {
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
    } catch (e) { skipped.push({ title: ev.title, reason: "Error: " + (e && e.message || e) }); } }));
    let timer;
    const stop = new Promise(r => { timer = setTimeout(() => { partial = true; r(); }, Math.max(5000, 40000 - (Date.now() - t0))); });
    await Promise.race([work, stop]);
    clearTimeout(timer);
    const byDate = (a, b) => a.date.localeCompare(b.date) || a.city.localeCompare(b.city);
    hits.sort(byDate); overview.sort(byDate);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ scannedAt: new Date().toISOString(), marketsFound: events.length, finished, hits, overview, skipped, partial, ms: Date.now() - t0 });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
