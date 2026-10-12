// Minimal IGC B-record parser — deliberately hand-rolled rather than pulling in a
// dependency, since all we need is position+time+validity per fix and the flight
// date, not full IGC checksum/A-record validation.
//
// B-record layout (fixed-width, 1-indexed per the IGC spec):
//   B HHMMSS DDMMmmm N/S DDDMMmmm E/W A/V PPPPP GGGGG
//   1 2-7    8-14     15  16-23    24  25  26-30 31-35

export interface IgcFix {
  time: Date; // absolute UTC instant
  lat: number; // decimal degrees
  lng: number; // decimal degrees
  valid: boolean; // false for 'V' (voided) fixes — excluded from cylinder-crossing checks
}

export interface ParsedIgc {
  date: Date | null; // midnight UTC of the flight date, from the HFDTE record
  fixes: IgcFix[];
}

function decodeLat(raw: string, dir: string): number {
  const deg = parseInt(raw.slice(0, 2), 10);
  const minutes = parseInt(raw.slice(2, 4), 10) + parseInt(raw.slice(4, 7), 10) / 1000;
  const value = deg + minutes / 60;
  return dir === 'S' ? -value : value;
}

function decodeLng(raw: string, dir: string): number {
  const deg = parseInt(raw.slice(0, 3), 10);
  const minutes = parseInt(raw.slice(3, 5), 10) + parseInt(raw.slice(5, 8), 10) / 1000;
  const value = deg + minutes / 60;
  return dir === 'W' ? -value : value;
}

function parseFlightDate(text: string): Date | null {
  const match = text.match(/HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, dd, mm, yy] = match;
  const year = 2000 + parseInt(yy, 10);
  return new Date(Date.UTC(year, parseInt(mm, 10) - 1, parseInt(dd, 10)));
}

export function parseIGC(text: string): ParsedIgc {
  const date = parseFlightDate(text);
  const fixes: IgcFix[] = [];

  // B-records carry only a time of day, so a flight that crosses UTC midnight
  // rolls over — 23:59:59 is followed by 00:00:00 on the NEXT day. Every
  // afternoon flight in New Zealand does this (NZDT is UTC+13), so without the
  // rollover the first half of the track is stamped a day late and fix times run
  // backwards mid-file.
  let dayOffset = 0;
  let previousSeconds = -1;

  for (const line of text.split(/\r?\n/)) {
    if (line[0] !== 'B' || line.length < 35) continue;

    const hh = parseInt(line.slice(1, 3), 10);
    const mm = parseInt(line.slice(3, 5), 10);
    const ss = parseInt(line.slice(5, 7), 10);
    if (Number.isNaN(hh) || Number.isNaN(mm) || Number.isNaN(ss)) continue;

    const secondsOfDay = hh * 3600 + mm * 60 + ss;
    // Only a genuine wrap counts. A one-off out-of-order fix (loggers do emit
    // them) would otherwise shunt the rest of the flight forward a day, so
    // require the jump to look like midnight rather than a small hiccup.
    if (previousSeconds >= 0 && secondsOfDay + 12 * 3600 < previousSeconds) {
      dayOffset++;
    }
    previousSeconds = secondsOfDay;

    const lat = decodeLat(line.slice(7, 14), line[14]);
    const lng = decodeLng(line.slice(15, 23), line[23]);
    const valid = line[24] === 'A';

    const base = date ?? new Date(Date.UTC(1970, 0, 1));
    const time = new Date(Date.UTC(
      base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + dayOffset,
      hh, mm, ss
    ));

    fixes.push({ time, lat, lng, valid });
  }

  return { date, fixes };
}
