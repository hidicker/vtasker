/**
 * Snapshot launch sites from ParaglidingEarth into the repo.
 *
 * Run manually (`npm run fetch:sites`), not at build time — a build that fails
 * because someone else's server is down is a bad trade for data that changes a
 * few times a year.
 *
 * The API sends no CORS header, so the browser can't call it directly. Baking a
 * snapshot in sidesteps that entirely and works offline.
 *
 * Data: ParaglidingEarth, CC BY-SA 3.0 — https://paraglidingearth.com
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../lib/launchSites.json');

// 3 decimal places is ~110 m. A launch marker is a "there's a hill here" hint,
// not a survey point, and the shorter numbers cut the file by about a fifth.
const round = (n) => Math.round(n * 1e3) / 1e3;

// One request for the lot. The per-country endpoint would need a list of ISO
// codes we don't have, and getModifiedSites caps out well short of the full set.
const URL = 'https://www.paraglidingearth.com/api/geojson/getBoundingBoxSites.php'
  + '?north=90&south=-90&east=180&west=-180&limit=100000';

console.log('Fetching worldwide launch sites…');
const res = await fetch(URL, { headers: { 'User-Agent': 'VTasker/1.0 (nbparagliding.nz)' } });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const json = await res.json();

const sites = (json.features ?? [])
  .map((f) => {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const name = (f.properties?.name ?? '').trim();
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat === 0 && lng === 0) return null; // null island: bad rows in the source
    return [name, round(lat), round(lng)];
  })
  .filter(Boolean);

// The same site sometimes appears more than once.
const seen = new Set();
const deduped = sites.filter(([n, y, x]) => {
  const key = `${n}|${y}|${x}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// Sorted north-to-south so the file diffs sanely between refreshes.
deduped.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    source: 'ParaglidingEarth',
    licence: 'CC BY-SA 3.0',
    url: 'https://paraglidingearth.com',
    fetched: new Date().toISOString().slice(0, 10),
    // [name, lat, lng] — tuples rather than objects; 11k repeated keys is pure weight.
    format: ['name', 'lat', 'lng'],
    sites: deduped,
  }) + '\n',
);

console.log(`Wrote ${deduped.length} sites to ${OUT}`);
