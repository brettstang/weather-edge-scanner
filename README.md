# Weather Scanner

iPhone home-screen web app. Tap **Scan** to find Polymarket daily-high temperature markets where the Open-Meteo forecast (at the market's settlement airport) lands in the "or below" / "or higher" edge bucket, with the market's Yes/No percentage.

- `index.html`, `manifest.json`, `sw.js`, `icon.png` – the app
- `api/scan.js` – Vercel serverless function that does the scan
