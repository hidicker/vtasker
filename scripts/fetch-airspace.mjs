/**
 * Snapshot airspace from openAIP into the repo, one file per country.
 *
 * Run manually (`npm run fetch:airspace`), never at build time: it needs an API
 * key, and a build that fails because someone else's server is down is a bad
 * trade. Airspace moves on the 28-day AIRAC cycle, so re-run occasionally and
 * check the date the app displays.
 *
 * Per country rather than one blob because Europe is ~20,000 airspaces — the map
 * only ever needs the countries currently in view.
 *
 * Data: openAIP (https://www.openaip.net), used under their terms.
 * Key: OPENAIP_API_KEY in .env.local — deliberately not VITE_ prefixed, so it
 * never reaches the browser bundle.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../lib/airspace');
const PAGE_SIZE = 1000;

function apiKey() {
  const envPath = resolve(here, '../.env.local');
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find(l => l.startsWith('OPENAIP_API_KEY='));
    if (line) return line.slice('OPENAIP_API_KEY='.length).trim();
  }
  if (process.env.OPENAIP_API_KEY) return process.env.OPENAIP_API_KEY;
  throw new Error('No OPENAIP_API_KEY in .env.local or the environment.');
}

const EUROPE = [
  'AL','AD','AT','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU',
  'IS','IE','IT','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT',
  'RO','RS','SK','SI','ES','SE','CH','UA','GB',
];
const GROUPS = { europe: EUROPE, nz: ['NZ'], au: ['AU'] };

const args = process.argv.slice(2);
const countries = args.length
  ? args.flatMap(a => GROUPS[a.toLowerCase()] ?? [a.toUpperCase()])
  : ['NZ', 'AU', ...EUROPE];

// 4 dp is ~11 m — finer than any airspace boundary is drawn, and it roughly
// halves the file compared with the raw 13-dp coordinates.
const round = (n) => Math.round(n * 1e4) / 1e4;

// Information regions (FIR/UIR/UTA/FIS) blanket entire countries and restrict
// nothing a paraglider does — they were also the heaviest geometry in the set.
const DROP_TYPES = new Set([10, 33, 34, 35]);

/** Ramer-Douglas-Peucker. ~50 m: invisible at the zooms airspace is read at. */
const SIMPLIFY_TOLERANCE_DEG = 50 / 111320;

function perpendicularDistance([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function simplify(points, eps) {
  if (points.length < 3) return points;
  let dmax = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > dmax) { dmax = d; index = i; }
  }
  if (dmax > eps) {
    const left = simplify(points.slice(0, index + 1), eps);
    const right = simplify(points.slice(index), eps);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

/**
 * Rings as delta-encoded integers at 1e-4 degrees: [lng0, lat0, dLng, dLat, ...].
 * Consecutive airspace vertices are close together, so the deltas are tiny
 * numbers — this roughly a third of the JSON of full coordinate pairs.
 */
function encodeRing(ring) {
  const out = [];
  let prevX = 0, prevY = 0;
  for (const [lng, lat] of ring) {
    const x = Math.round(lng * 1e4), y = Math.round(lat * 1e4);
    out.push(x - prevX, y - prevY);
    prevX = x; prevY = y;
  }
  return out;
}


async function fetchCountry(iso, key) {
  const all = [];
  for (let page = 1; ; page++) {
    const url = `https://api.core.openaip.net/api/airspaces?country=${iso}&limit=${PAGE_SIZE}&page=${page}`;
    const res = await fetch(url, { headers: { 'x-openaip-api-key': key } });
    if (!res.ok) throw new Error(`${iso}: HTTP ${res.status}`);
    const json = await res.json();
    const items = json.items ?? [];
    all.push(...items);
    if (all.length >= (json.totalCount ?? all.length) || items.length === 0) break;
  }
  return all;
}

/** [name, type, icaoClass, [lowVal,unit,datum], [upVal,unit,datum], encodedRings] */
function compact(a) {
  if (DROP_TYPES.has(a.type)) return null;
  const limit = (l) => l ? [l.value ?? 0, l.unit ?? 1, l.referenceDatum ?? 1] : [0, 1, 1];
  const geom = a.geometry ?? {};
  const polygons = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates
    : [];

  const rings = [];
  for (const poly of polygons) {
    const ring = poly[0].map(([lng, lat]) => [round(lng), round(lat)]);
    const thinned = ring.length > 4 ? simplify(ring, SIMPLIFY_TOLERANCE_DEG) : ring;
    if (thinned.length >= 3) rings.push(encodeRing(thinned));
  }
  if (rings.length === 0) return null;
  return [a.name ?? '', a.type ?? 0, a.icaoClass ?? 8, limit(a.lowerLimit), limit(a.upperLimit), rings];
}

const key = apiKey();
mkdirSync(OUT_DIR, { recursive: true });
const index = [];

for (const iso of countries) {
  try {
    const raw = await fetchCountry(iso, key);
    const spaces = raw.map(compact).filter(Boolean);
    if (spaces.length === 0) { console.log(`${iso}: none`); continue; }

    // Bounding box, so the map can decide which countries to load without
    // reading the files themselves.
    let s = 90, w = 180, n = -90, e = -180;
    for (const [, , , , , rings] of spaces) {
      for (const ring of rings) {
        let x = 0, y = 0;
        for (let i = 0; i < ring.length; i += 2) {
          x += ring[i]; y += ring[i + 1];
          const lng = x / 1e4, lat = y / 1e4;
          if (lat < s) s = lat; if (lat > n) n = lat;
          if (lng < w) w = lng; if (lng > e) e = lng;
        }
      }
    }

    writeFileSync(resolve(OUT_DIR, `${iso}.json`), JSON.stringify({ country: iso, spaces }) + '\n');
    index.push({ c: iso, n: spaces.length, bbox: [round(s), round(w), round(n), round(e)] });
    console.log(`${iso}: ${spaces.length}`);
  } catch (err) {
    console.error(`${iso}: FAILED — ${err.message}`);
  }
}

writeFileSync(
  resolve(OUT_DIR, 'index.json'),
  JSON.stringify({
    source: 'openAIP',
    url: 'https://www.openaip.net',
    fetched: new Date().toISOString().slice(0, 10),
    countries: index.sort((a, b) => a.c.localeCompare(b.c)),
  }) + '\n',
);
console.log(`\nIndexed ${index.length} countries, ${index.reduce((a, c) => a + c.n, 0)} airspaces.`);
