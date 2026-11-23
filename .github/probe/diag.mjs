// Temporary diagnostics against live data (will be removed)
const { previousRunsDaily, observedHourly, stationObs } = await import("../../api/scan.js");
for (const [code, lat, lon] of [["KLGA", 40.7769, -73.8740], ["KDEN", 39.8561, -104.6737]]) {
  const pr = await previousRunsDaily(lat, lon, "F", "low");
  const obs = await stationObs(code);
  const obsH = observedHourly(obs, pr.offset, "F");
  const keys = Object.keys(pr.hourly.gfs_seamless || {}).sort();
  console.log(`=== ${code} offset ${pr.offset} | model hours ${keys.length} first ${keys[0]} last ${keys.at(-1)} | obs hours ${Object.keys(obsH).length} first ${Object.keys(obsH).sort()[0]}`);
  // raw response check
  const raw = await (await fetch(`https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m_previous_day1,temperature_2m&models=gfs_seamless&past_days=3&forecast_days=1&timezone=auto&temperature_unit=fahrenheit`)).json();
  console.log("  raw keys:", Object.keys(raw.hourly), "tz", raw.timezone, raw.utc_offset_seconds);
  const t = raw.hourly.time;
  for (let i = 0; i < t.length; i += 6) {
    const k = t[i].slice(0, 13);
    console.log(`  ${t[i]} prev_day1 ${raw.hourly.temperature_2m_previous_day1?.[i]} | day0 ${raw.hourly.temperature_2m?.[i]} | obs ${obsH[k]?.toFixed(1)} | pr.hourly ${pr.hourly.gfs_seamless?.[k]}`);
  }
}
