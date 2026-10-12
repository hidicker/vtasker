/**
 * Launch sites worldwide, snapshotted from ParaglidingEarth (CC BY-SA 3.0).
 *
 * ~11,500 sites, so this is deliberately **not** imported at the top level:
 * `import()` puts it in its own chunk that Vite only fetches the first time
 * something actually needs a launch — zooming the map in far enough to show
 * them, or publishing a task that wants a name. First paint never pays for it.
 *
 * Their API sends no CORS header, so a live lookup isn't possible from the
 * browser anyway. Refresh the snapshot with `npm run fetch:sites`.
 */
export interface LaunchSite {
  name: string;
  lat: number;
  lng: number;
}

export const LAUNCH_SITE_ATTRIBUTION = 'ParaglidingEarth (CC BY-SA 3.0)';

type SiteTuple = [name: string, lat: number, lng: number];

let cached: LaunchSite[] | null = null;
let inFlight: Promise<LaunchSite[]> | null = null;

/** Loads the snapshot once; concurrent callers share the same request. */
export function loadLaunchSites(): Promise<LaunchSite[]> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = import('./launchSites.json')
      .then((mod) => {
        // JSON imports widen tuples to (string | number)[], so the shape has to
        // be asserted rather than inferred.
        const raw = (mod.default ?? mod) as unknown as { sites: SiteTuple[] };
        cached = raw.sites.map(([name, lat, lng]) => ({ name, lat, lng }));
        return cached;
      })
      .catch((err) => {
        inFlight = null; // let a later attempt retry rather than fail forever
        throw err;
      });
  }
  return inFlight;
}

/** Whatever is already loaded, for render paths that can't await. */
export function launchSitesIfLoaded(): LaunchSite[] | null {
  return cached;
}

/** Great-circle distance in km. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The closest known launch to a point, or null if nothing is near enough to be
 * worth naming a task after.
 *
 * 25 km is deliberately generous — a task often starts over the valley rather
 * than on the hill — but bounded, because "Barnicoat 40km" is worse than no
 * suggestion when the task is actually in Canterbury.
 */
export async function nearestLaunch(lat: number, lng: number, maxKm = 25): Promise<LaunchSite | null> {
  const sites = await loadLaunchSites();

  let best: LaunchSite | null = null;
  let bestKm = Infinity;
  for (const site of sites) {
    // Cheap reject before the trig: 1 degree of latitude is ~111 km.
    if (Math.abs(site.lat - lat) * 111 > maxKm) continue;
    const km = distanceKm(lat, lng, site.lat, site.lng);
    if (km < bestKm) { bestKm = km; best = site; }
  }
  return bestKm <= maxKm ? best : null;
}

/** Sites inside a lat/lng box, for drawing only what's on screen. */
export function sitesInBounds(
  sites: LaunchSite[],
  south: number, west: number, north: number, east: number,
): LaunchSite[] {
  return sites.filter(s => s.lat >= south && s.lat <= north && s.lng >= west && s.lng <= east);
}
