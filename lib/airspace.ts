import index from './airspace/index.json';

/**
 * Airspace, snapshotted from openAIP (see scripts/fetch-airspace.mjs).
 *
 * ADVISORY ONLY. It is a dated snapshot, boundaries are simplified to ~50 m for
 * size, and airspace changes on the 28-day AIRAC cycle. Pilots must check the
 * official AIP and their instrument — the UI says so wherever this is drawn.
 *
 * Stored per country and loaded on demand: the full set is ~15,000 airspaces,
 * and a pilot only ever needs the countries currently on screen.
 */
export interface Airspace {
  name: string;
  type: number;
  icaoClass: number;
  lower: AirspaceLimit;
  upper: AirspaceLimit;
  /** Outer rings, decoded to [lat, lng] pairs for Leaflet. */
  rings: [number, number][][];
}

export interface AirspaceLimit {
  value: number;
  /** 0 = metres, 1 = feet, 6 = flight level. */
  unit: number;
  /** 0 = ground, 1 = mean sea level, 2 = standard (flight level). */
  datum: number;
}

interface CountryIndex { c: string; n: number; bbox: [number, number, number, number]; }

export const AIRSPACE_SOURCE = index.source as string;
export const AIRSPACE_FETCHED = index.fetched as string;
const COUNTRIES = index.countries as CountryIndex[];

const files = import.meta.glob('./airspace/*.json', { import: 'default' }) as
  Record<string, () => Promise<unknown>>;

type Encoded = [string, number, number, number[], number[], number[][]];

const cache = new Map<string, Airspace[]>();
const inFlight = new Map<string, Promise<Airspace[]>>();

/** Feet above ground/sea, for filtering by height. Flight levels become feet. */
export function limitInFeet(l: AirspaceLimit): number {
  if (l.unit === 6) return l.value * 100;
  if (l.unit === 0) return l.value * 3.28084;
  return l.value;
}

export function describeLimit(l: AirspaceLimit): string {
  if (l.datum === 0 && l.value === 0) return 'GND';
  if (l.unit === 6) return `FL${l.value}`;
  const ft = Math.round(limitInFeet(l));
  return `${ft.toLocaleString()} ft ${l.datum === 0 ? 'AGL' : 'AMSL'}`;
}

function decode(raw: Encoded): Airspace {
  const rings = raw[5].map(flat => {
    const ring: [number, number][] = [];
    let x = 0, y = 0;
    for (let i = 0; i < flat.length; i += 2) {
      x += flat[i]; y += flat[i + 1];
      ring.push([y / 1e4, x / 1e4]); // Leaflet wants [lat, lng]
    }
    return ring;
  });
  return {
    name: raw[0], type: raw[1], icaoClass: raw[2],
    lower: { value: raw[3][0], unit: raw[3][1], datum: raw[3][2] },
    upper: { value: raw[4][0], unit: raw[4][1], datum: raw[4][2] },
    rings,
  };
}

function loadCountry(iso: string): Promise<Airspace[]> {
  const cached = cache.get(iso);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(iso);
  if (running) return running;

  const loader = files[`./airspace/${iso}.json`];
  if (!loader) return Promise.resolve([]);

  const p = loader()
    .then((mod) => {
      const decoded = ((mod as { spaces: Encoded[] }).spaces ?? []).map(decode);
      cache.set(iso, decoded);
      return decoded;
    })
    .catch(() => { inFlight.delete(iso); return []; });
  inFlight.set(iso, p);
  return p;
}

/** Countries whose bounding box overlaps the given view. */
export function countriesInView(south: number, west: number, north: number, east: number): string[] {
  return COUNTRIES
    .filter(({ bbox: [s, w, n, e] }) => s <= north && n >= south && w <= east && e >= west)
    .map(c => c.c);
}

/** Airspace for everything on screen, loading each country's chunk once. */
export async function airspaceInView(
  south: number, west: number, north: number, east: number,
): Promise<Airspace[]> {
  const isos = countriesInView(south, west, north, east);
  const sets = await Promise.all(isos.map(loadCountry));
  const out: Airspace[] = [];
  for (const set of sets) {
    for (const a of set) {
      // Cheap ring-level reject: skip anything wholly outside the view.
      const hit = a.rings.some(ring => {
        let rs = 90, rw = 180, rn = -90, re = -180;
        for (const [lat, lng] of ring) {
          if (lat < rs) rs = lat; if (lat > rn) rn = lat;
          if (lng < rw) rw = lng; if (lng > re) re = lng;
        }
        return rs <= north && rn >= south && rw <= east && re >= west;
      });
      if (hit) out.push(a);
    }
  }
  return out;
}
