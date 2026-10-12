import { parseCUPWaypoints, parseGPXWaypoints, parseWPTWaypoints, parseCSVWaypoints } from '../utils/parsers';
import type { Waypoint } from '../types';

/**
 * The waypoint library is built from the folder tree under data/, so adding
 * waypoints means dropping files in rather than editing code:
 *
 *   data/
 *     New Zealand/                  <- region
 *       Auckland_Region/            <- area: a collapsible group in the library
 *         Auckland.cup                             }
 *         Kariotahi_Waypoints.gpx                  }  three separate datasets
 *         Auckland_Competition_Waypoints_2016.gpx  }
 *       Nelson_Tasman_Region/
 *         45th_NZ_HG_Nationals_2023.SeeYou.cup     }  one dataset, six formats
 *         45th_NZ_HG_Nationals_2023.CompeGPS.wpt   }
 *         ...
 *
 * An area folder usually holds a mix: several different waypoint sets, some of
 * which are published in several formats at once, alongside PDFs and other
 * documents. Files are therefore grouped by their base name — the filename with
 * the extension and any format marker (.SeeYou, .CompeGPS, .FS, .GPX, ...)
 * removed — and each group becomes one dataset, read from whichever format is
 * best supported. Anything that isn't a readable waypoint file is ignored.
 *
 * Vite resolves the glob at build time and emits each file as its own lazily
 * fetched chunk, so nothing is downloaded until a dataset is switched on.
 */
const files = import.meta.glob('../data/*/*/**/*.{cup,CUP,gpx,GPX,wpt,WPT,csv,CSV}', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

// .cup first: it carries codes and elevations and is the most consistently
// exported. .wpt last — that extension covers several incompatible formats
// (this data has both CompeGPS and FS files claiming it).
const FORMAT_PREFERENCE = ['cup', 'gpx', 'csv', 'wpt'];

// Format markers competition organisers append before the real extension.
const FORMAT_MARKERS = /\.(SeeYou|CompeGPS|FS|GPX|GoogleEarth|UTM|KML|Garmin|OziExplorer)$/i;

export interface WaypointDataset {
  /** Stable id, also used to prefix waypoint ids. */
  id: string;
  label: string;
  /** Which format was actually chosen, for the tooltip. */
  format: string;
  /** How many formats this set is published in. */
  formatCount: number;
  load: () => Promise<Waypoint[]>;
}

export interface WaypointGroup {
  name: string;
  datasets: WaypointDataset[];
}

export interface WaypointRegion {
  name: string;
  groups: WaypointGroup[];
}

/**
 * Folder names double as labels, minus any "01_" ordering prefix — those are
 * there to control the order on disk, not to be read out.
 */
const prettify = (name: string) =>
  name.replace(/^\d+[_-]\s*/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

/** The "01" from "01_Ozone_Chabre_Open", so on-disk ordering is honoured. */
function orderPrefix(name: string): number | null {
  const match = name.match(/^(\d+)[_-]/);
  return match ? parseInt(match[1], 10) : null;
}

function byPrefixThenName(a: string, b: string): number {
  const pa = orderPrefix(a);
  const pb = orderPrefix(b);
  if (pa !== null && pb !== null && pa !== pb) return pa - pb;
  if (pa !== null && pb === null) return -1;
  if (pa === null && pb !== null) return 1;
  return prettify(a).localeCompare(prettify(b));
}

/** "45th_NZ_HG_Nationals_2023.SeeYou.cup" -> "45th_NZ_HG_Nationals_2023" */
function baseName(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  return withoutExt.replace(FORMAT_MARKERS, '');
}

function parseFor(format: string, text: string, idPrefix: string): Waypoint[] {
  switch (format) {
    case 'cup': return parseCUPWaypoints(text, idPrefix);
    case 'gpx': return parseGPXWaypoints(text, idPrefix);
    case 'csv': return parseCSVWaypoints(text, idPrefix);
    case 'wpt': return parseWPTWaypoints(text, idPrefix);
    default: return [];
  }
}

function buildCatalogue(): WaypointRegion[] {
  type Candidate = { format: string; path: string };
  const sets = new Map<string, { region: string; area: string; base: string; sortKey: string; candidates: Candidate[] }>();

  for (const path of Object.keys(files)) {
    const match = path.match(/\.\.\/data\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match) continue;
    const [, region, area, remainder] = match;
    const segments = remainder.split('/');
    const filename = segments.pop()!;
    const format = (filename.split('.').pop() || '').toLowerCase();
    if (!FORMAT_PREFERENCE.includes(format)) continue;

    // Two layouts appear in the wild, and both mean the same thing:
    //
    //   region/area/Nelson_2026.cup                      -> dataset per base name
    //   region/area/Chabre_Open_2022/*.{cup,gpx,wpt}      -> dataset per folder
    //
    // The French sets nest a folder per competition year with the same set in
    // four formats inside; the NZ ones put files straight in the area folder.
    // Where a folder exists it names the dataset, because that's what the person
    // who filed it intended.
    const nested = segments.length > 0;
    const rawLabel = nested ? segments[segments.length - 1] : baseName(filename);
    const key = nested
      ? `${region}/${area}/${segments.join('/')}`
      : `${region}/${area}/${rawLabel}`;

    if (!sets.has(key)) {
      sets.set(key, { region, area, base: rawLabel, sortKey: rawLabel, candidates: [] });
    }
    sets.get(key)!.candidates.push({ format, path });
  }

  // Keyed on the RAW folder names so the "01_" prefixes can still drive the
  // order; prettified only on the way out.
  type Entry = { raw: string; datasets: (WaypointDataset & { sortKey: string })[] };
  const regions = new Map<string, Map<string, Entry>>();

  for (const [key, { region, area, base, candidates }] of sets) {
    candidates.sort((a, b) => FORMAT_PREFERENCE.indexOf(a.format) - FORMAT_PREFERENCE.indexOf(b.format));
    const chosen = candidates[0];

    const dataset = {
      id: key,
      label: prettify(base),
      format: chosen.format,
      formatCount: candidates.length,
      load: async () => parseFor(chosen.format, await files[chosen.path](), key),
      sortKey: base,
    };

    if (!regions.has(region)) regions.set(region, new Map());
    const areas = regions.get(region)!;
    if (!areas.has(area)) areas.set(area, { raw: area, datasets: [] });
    areas.get(area)!.datasets.push(dataset);
  }

  return [...regions.entries()]
    .map(([regionRaw, areas]) => ({
      name: prettify(regionRaw),
      groups: [...areas.entries()]
        .map(([areaRaw, entry]) => ({
          name: prettify(areaRaw),
          // Newest first where the name carries a year, otherwise by any ordering
          // prefix, then alphabetical — the current season is what people reach for.
          datasets: entry.datasets
            .sort((a, b) => {
              const ya = a.label.match(/(20\d{2})/)?.[1];
              const yb = b.label.match(/(20\d{2})/)?.[1];
              if (ya && yb && ya !== yb) return Number(yb) - Number(ya);
              return byPrefixThenName(a.sortKey, b.sortKey);
            })
            .map(({ sortKey, ...d }) => d as WaypointDataset),
          sortKey: areaRaw,
        }))
        .sort((a, b) => byPrefixThenName(a.sortKey, b.sortKey))
        .map(({ sortKey, ...g }) => g as WaypointGroup),
      sortKey: regionRaw,
    }))
    .sort((a, b) => byPrefixThenName(a.sortKey, b.sortKey))
    .map(({ sortKey, ...r }) => r as WaypointRegion);
}

export const WAYPOINT_REGIONS: WaypointRegion[] = buildCatalogue();

export const ALL_DATASETS: WaypointDataset[] =
  WAYPOINT_REGIONS.flatMap(r => r.groups.flatMap(g => g.datasets));

export function findDataset(id: string): WaypointDataset | undefined {
  return ALL_DATASETS.find(d => d.id === id);
}
