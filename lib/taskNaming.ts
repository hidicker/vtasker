/**
 * The builder always has a task name so the panel is never empty, but the ones
 * it invents ("Draft 17/08/2026", "Quick Task 9:05:52 AM") are placeholders, not
 * names anyone chose. Published under those they're useless in the library — a
 * list of a dozen "Quick Task" rows tells nobody which route is which.
 *
 * So publishing is gated on the pilot having actually named the thing.
 *
 * Keep this list in step with the names App.tsx generates: everything the
 * builder invents starts with "Draft" or "Quick Task".
 */
import { nearestLaunch } from './launchSites';

const PLACEHOLDER_PREFIXES = ['draft', 'quick task'];

export function isPlaceholderTaskName(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return true;
  return PLACEHOLDER_PREFIXES.some(p => trimmed.startsWith(p));
}

export const NAME_REQUIRED_HINT = 'Give your task a name before publishing it.';

export interface NamePoint {
  id: string;
  lat: number;
  lng: number;
}

/**
 * A first-guess name like "Barnicoat 33km", offered when a pilot publishes
 * something still called "Draft".
 *
 * Two sources, best first:
 *
 *  1. The nearest known launch site to where the task starts. Works for any
 *     task, including one drawn freehand, and a launch name is what pilots
 *     actually call the place.
 *  2. Failing that, the region the waypoints came from — catalogue ids are
 *     their source path ("New Zealand/Nelson_Tasman_Region/Nelson 2026-ABC"),
 *     so the area folder is already on every point picked.
 *
 * Nothing is fetched; the launch list is baked in. Returns null when neither
 * source knows where this is, because a wrong guess is worse than no guess.
 */
export async function suggestTaskName(
  points: NamePoint[],
  distanceKm: number | string,
): Promise<string | null> {
  const km = Math.round(typeof distanceKm === 'string' ? parseFloat(distanceKm) : distanceKm);
  if (!Number.isFinite(km) || km <= 0) return null;

  const start = points[0];
  if (start && Number.isFinite(start.lat) && Number.isFinite(start.lng)) {
    // The launch list is a lazy chunk; if it can't be fetched we still have the
    // region fallback, so a failed load must not lose the suggestion entirely.
    try {
      const launch = await nearestLaunch(start.lat, start.lng);
      if (launch) return `${launch.name} ${km}km`;
    } catch {
      // fall through to the region name
    }
  }

  const area = commonestArea(points.map(p => p.id));
  return area ? `${area} ${km}km` : null;
}

/**
 * The area most of the task's points came from. Tasks occasionally straddle two
 * datasets, so this votes rather than trusting the first point.
 */
function commonestArea(ids: string[]): string | null {
  const counts = new Map<string, number>();

  for (const id of ids) {
    // A pilot's own import is "import/<filename>/<code>" — same shape as a
    // catalogue id but the middle segment is a filename, not a place, so it
    // would otherwise suggest names like "mine.gpx 40km".
    if (id.startsWith('import/')) continue;

    // "<region>/<area>/<dataset>-<code>" — anything else is drawn.
    const parts = id.split('/');
    if (parts.length < 3) continue;
    const area = prettifyArea(parts[1]);
    if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [area, n] of counts) {
    if (n > bestCount) { best = area; bestCount = n; }
  }
  return best;
}

/** "Nelson_Tasman_Region" -> "Nelson Tasman"; "Auckland_Region" -> "Auckland". */
function prettifyArea(folder: string): string {
  return folder
    .replace(/_/g, ' ')
    .replace(/\bregion\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
