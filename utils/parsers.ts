
import { Waypoint } from '../types';

/**
 * Every parser takes an `idPrefix` naming the dataset the file came from.
 * Several waypoint sets can be switched on at once and they routinely reuse the
 * same codes (A01, W07, S01...), so ids have to be namespaced per dataset or
 * two active sets collide and lookups resolve to the wrong point.
 */
const makeId = (idPrefix: string | undefined, key: string | number) =>
  idPrefix ? `${idPrefix}-${key}` : `wp-${key}`;

/**
 * Parses the specific CSV format provided in the prompt.
 * #,"Short Name","Long Name/Description","Latitude","Longitude","Alt.(m)","Alt.(ft)"
 */
export const parseCSVWaypoints = (text: string, idPrefix?: string): Waypoint[] => {
  const lines = text.split('\n');
  const waypoints: Waypoint[] = [];

  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;

    const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
    if (parts.length < 5) continue;

    const [id, shortName, name, latStr, lngStr, altStr] = parts;

    const parseCoord = (str: string) => {
      const match = str.match(/([NSEW])\s+([\d.]+)/);
      if (!match) return parseFloat(str);
      const sign = (match[1] === 'S' || match[1] === 'W') ? -1 : 1;
      return sign * parseFloat(match[2]);
    };

    const lat = parseCoord(latStr);
    const lng = parseCoord(lngStr);
    const altM = parseInt(altStr) || 0;

    waypoints.push({ id: makeId(idPrefix, shortName || id), shortName, name, lat, lng, altM });
  }

  return waypoints;
};

/**
 * Parses SeeYou (.cup) format.
 * Format: name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc
 * Coords: DDMM.MMM[NS], DDDMM.MMM[EW]
 */
export const parseCUPWaypoints = (text: string, idPrefix?: string): Waypoint[] => {
  const lines = text.split('\n');
  const waypoints: Waypoint[] = [];

  const parseCupCoord = (val: string, isLat: boolean) => {
    const direction = val.slice(-1);
    const numericPart = val.slice(0, -1);
    const degLen = isLat ? 2 : 3;
    const degrees = parseFloat(numericPart.slice(0, degLen));
    const minutes = parseFloat(numericPart.slice(degLen));
    let decimal = degrees + (minutes / 60);
    if (direction === 'S' || direction === 'W') decimal = -decimal;
    return decimal;
  };

  for (const line of lines) {
    if (!line.trim() || line.toLowerCase().startsWith('name,') || line.startsWith('-----')) continue;
    
    // Split by comma, but handle quoted strings correctly
    const parts = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$)/g)?.map(p => p.trim().replace(/^"|"$/g, '')) || [];
    if (parts.length < 5) continue;

    const [name, code, , latStr, lonStr, elevStr] = parts;
    if (!latStr || !lonStr) continue;

    try {
      const lat = parseCupCoord(latStr, true);
      const lng = parseCupCoord(lonStr, false);
      const altM = parseFloat(elevStr.replace(/[^\d.-]/g, '')) || 0;

      waypoints.push({
        id: makeId(idPrefix, code || name),
        shortName: code || name.substring(0, 6).toUpperCase(),
        name,
        lat,
        lng,
        altM
      });
    } catch (e) {
      console.warn("Failed to parse CUP line:", line);
    }
  }
  return waypoints;
};

/**
 * GPX parser.
 *
 * Competition sets exported by GpsDump put the code in <name> and the place
 * name in <cmt>/<desc> ("A01" + "Waipu"). Both are worth keeping: the code is
 * what pilots call the turnpoint, the place name is what makes the library
 * searchable.
 */
export const parseGPXWaypoints = (text: string, idPrefix?: string): Waypoint[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "text/xml");
  const wpts = xmlDoc.getElementsByTagName("wpt");
  const waypoints: Waypoint[] = [];

  const childText = (el: Element, tag: string) =>
    el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

  for (let i = 0; i < wpts.length; i++) {
    const wpt = wpts[i];
    const lat = parseFloat(wpt.getAttribute("lat") || "0");
    const lng = parseFloat(wpt.getAttribute("lon") || "0");
    const code = childText(wpt, "name") || `WPT${i}`;
    const description = childText(wpt, "cmt") || childText(wpt, "desc");
    const ele = parseFloat(childText(wpt, "ele") || "0");

    waypoints.push({
      // Codes should be unique within a set, but fall back to the index so a
      // malformed file can't silently drop points to key collisions.
      id: makeId(idPrefix, `${code}-${i}`),
      shortName: code.length <= 10 ? code : code.substring(0, 6).toUpperCase(),
      name: description || code,
      lat,
      lng,
      altM: ele
    });
  }

  return waypoints;
};

/**
 * Basic WPT parser (Commonly CompeGPS format)
 */
export const parseWPTWaypoints = (text: string, idPrefix?: string): Waypoint[] => {
  const lines = text.split('\n');
  const waypoints: Waypoint[] = [];

  for (const line of lines) {
    if (!line.startsWith('W ')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    
    const shortName = parts[1];
    const latRaw = parts[3];
    const lngRaw = parts[4];
    
    const parseWptCoord = (val: string) => {
      const num = parseFloat(val.replace(/[^\d.-]/g, ''));
      const isNegative = val.includes('S') || val.includes('W');
      return isNegative ? -Math.abs(num) : Math.abs(num);
    };

    waypoints.push({
      id: makeId(idPrefix, shortName),
      shortName,
      name: shortName,
      lat: parseWptCoord(latRaw),
      lng: parseWptCoord(lngRaw),
      altM: 0
    });
  }
  return waypoints;
};
