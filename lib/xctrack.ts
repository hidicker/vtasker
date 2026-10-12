import { TaskPoint, TaskPointType, TurnDirection } from '../types';

/** Google-polyline encoding of a turnpoint, as XCTrack's `z` field expects. */
export const encodePolylinePoint = (lat: number, lon: number, alt: number, radius: number): string => {
  const encodeValue = (value: number): string => {
    let v = Math.round(value);
    v = v < 0 ? ~(v << 1) : v << 1;
    let res = '';
    while (v >= 0x20) {
      res += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    res += String.fromCharCode(v + 63);
    return res;
  };
  return encodeValue(lon * 1e5) + encodeValue(lat * 1e5) + encodeValue(Math.round(alt)) + encodeValue(Math.round(radius));
};

/**
 * The XCTrack task payload, as scanned from a QR code.
 *
 * Shared by the builder and the fly-day page: a pilot who joined an event needs
 * the same QR the task author saw, built from the event's own start time and
 * race type rather than whatever is loaded in the builder.
 */
export function buildXctrackJson(
  taskPoints: TaskPoint[],
  sssOpenTime: string,
  taskDeadline: string,
  raceType: number,
): string {
  const sssPoint = taskPoints.find(tp => tp.type === TaskPointType.SSS);

  const formatTimeZ = formatTaskTimeZ;

  const data: any = {
    taskType: 'CLASSIC',
    version: 2,
    g: { d: formatTimeZ(taskDeadline) || '23:00:00Z', t: 2 },
    s: { d: sssPoint?.direction === TurnDirection.EXIT ? 2 : 1, g: [formatTimeZ(sssOpenTime) || '12:00:00Z'], t: raceType },
    t: taskPoints.map((tp) => {
      let typeVal: number | undefined;
      if (tp.type === TaskPointType.SSS) typeVal = 2;
      else if (tp.type === TaskPointType.ESS) typeVal = 3;
      const turnpoint: any = {
        n: tp.waypoint.shortName,
        d: tp.waypoint.name,
        z: encodePolylinePoint(tp.waypoint.lat, tp.waypoint.lng, tp.waypoint.altM, tp.radius),
      };
      if (typeVal !== undefined) turnpoint.t = typeVal;
      return turnpoint;
    }),
  };

  return `XCTSK:${JSON.stringify(data)}`;
}

/** "1300" or "13:00" -> "13:00:00Z", the form XCTrack task times take. */
export function formatTaskTimeZ(t: string): string | null {
  if (!t) return null;
  const clean = t.replace(/[^0-9]/g, '');
  if (clean.length === 4) {
    return `${clean.substring(0, 2)}:${clean.substring(2, 4)}:00Z`;
  }
  const parts = t.trim().split(':');
  if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00Z`;
  return null;
}

/**
 * The full .xctsk file (format version 1), as XCTrack saves and XContest's task
 * sharing accepts.
 *
 * The compact QR payload above is a different, polyline-encoded format — the
 * sharing service rejects it ("Incorrect points in xctask"), so uploading needs
 * this longer form. Numbers must be real numbers: the service refuses a radius
 * or coordinate sent as a string.
 */
export interface XctskFile {
  version: 1;
  taskType: 'CLASSIC';
  earthModel: 'WGS84';
  turnpoints: {
    type?: 'TAKEOFF' | 'SSS' | 'ESS';
    radius: number;
    waypoint: { lat: number; lon: number; altSmoothed: number; name: string; description: string };
  }[];
  sss: { type: 'RACE' | 'ELAPSED-TIME'; direction: 'ENTER' | 'EXIT'; timeGates: string[] };
  goal: { type: 'CYLINDER'; deadline: string };
}

export function buildXctskFile(
  taskPoints: TaskPoint[],
  sssOpenTime: string,
  taskDeadline: string,
  raceType: number,
): XctskFile {
  const sssPoint = taskPoints.find(tp => tp.type === TaskPointType.SSS);
  const typeOf = (t: TaskPointType): 'TAKEOFF' | 'SSS' | 'ESS' | undefined =>
    t === TaskPointType.TAKEOFF ? 'TAKEOFF'
      : t === TaskPointType.SSS ? 'SSS'
      : t === TaskPointType.ESS ? 'ESS'
      : undefined;

  return {
    version: 1,
    taskType: 'CLASSIC',
    earthModel: 'WGS84',
    turnpoints: taskPoints.map(tp => {
      const type = typeOf(tp.type);
      return {
        ...(type ? { type } : {}),
        radius: Math.round(tp.radius),
        waypoint: {
          lat: tp.waypoint.lat,
          lon: tp.waypoint.lng,
          altSmoothed: Math.round(tp.waypoint.altM || 0),
          name: tp.waypoint.shortName,
          description: tp.waypoint.name || tp.waypoint.shortName,
        },
      };
    }),
    sss: {
      // 1 = race to goal; anything else is VTasker's elapsed-time default.
      type: raceType === 1 ? 'RACE' : 'ELAPSED-TIME',
      direction: sssPoint?.direction === TurnDirection.EXIT ? 'EXIT' : 'ENTER',
      // Required by the service even for elapsed time, where it is when the
      // start opens.
      timeGates: [formatTaskTimeZ(sssOpenTime) || '12:00:00Z'],
    },
    goal: { type: 'CYLINDER', deadline: formatTaskTimeZ(taskDeadline) || '23:00:00Z' },
  };
}
