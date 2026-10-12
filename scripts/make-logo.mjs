// Renders public/logo-120.png, the square logo Google's OAuth consent screen wants.
//
// Done in plain Node rather than by rasterising the SVG so the output is
// deterministic and reproducible: run `node scripts/make-logo.mjs` any time the
// mark changes. Anti-aliasing comes from supersampling at 4x and averaging down.
//
// The mark is a competition task — a route through three turnpoint cylinders,
// which also traces the V of VTasker.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 120;
const SS = 4;                    // supersample factor
const N = SIZE * SS;

const BLUE = [0x1d, 0x4e, 0xd8];
const WHITE = [0xff, 0xff, 0xff];
const AMBER = [0xfb, 0xbf, 0x24];

const s = (v) => v * SS;         // design units -> supersampled pixels

/** Distance from point to a line segment. */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Inside a rounded rectangle spanning the whole canvas? */
function inRoundedSquare(x, y, radius) {
  const r = s(radius), max = N;
  if (x < r && y < r) return Math.hypot(x - r, y - r) <= r;
  if (x > max - r && y < r) return Math.hypot(x - (max - r), y - r) <= r;
  if (x < r && y > max - r) return Math.hypot(x - r, y - (max - r)) <= r;
  if (x > max - r && y > max - r) return Math.hypot(x - (max - r), y - (max - r)) <= r;
  return true;
}

// Supersampled RGBA buffer.
const hi = new Uint8Array(N * N * 4);

const route = [[34, 40], [60, 82], [86, 40]];
const cylinders = [
  { cx: 34, cy: 40, r: 14, stroke: AMBER, filled: false },
  { cx: 60, cy: 82, r: 11, stroke: WHITE, filled: false },
  { cx: 86, cy: 40, r: 11, stroke: WHITE, filled: true },
];

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;

    if (!inRoundedSquare(x + 0.5, y + 0.5, 27)) {
      hi[i + 3] = 0;             // transparent outside the rounded square
      continue;
    }

    let colour = BLUE;

    // route line, 7 units wide with round caps
    for (let k = 0; k < route.length - 1; k++) {
      const d = distToSegment(x + 0.5, y + 0.5,
        s(route[k][0]), s(route[k][1]), s(route[k + 1][0]), s(route[k + 1][1]));
      if (d <= s(3.5)) { colour = WHITE; break; }
    }

    // cylinders drawn over the route
    for (const c of cylinders) {
      const d = Math.hypot(x + 0.5 - s(c.cx), y + 0.5 - s(c.cy));
      if (c.filled) {
        if (d <= s(c.r)) colour = c.stroke;
      } else {
        if (d <= s(c.r - 3)) colour = BLUE;                       // clear centre
        else if (d <= s(c.r + 3)) colour = c.stroke;              // 6-unit ring
      }
    }

    hi[i] = colour[0]; hi[i + 1] = colour[1]; hi[i + 2] = colour[2]; hi[i + 3] = 255;
  }
}

// Average each SSxSS block down to one output pixel.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let p = 0;
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0;                                     // PNG filter type: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * N + (x * SS + dx)) * 4;
        const alpha = hi[i + 3] / 255;
        r += hi[i] * alpha; g += hi[i + 1] * alpha; b += hi[i + 2] * alpha; a += hi[i + 3];
      }
    }
    const n = SS * SS;
    const aOut = a / n;
    // Un-premultiply so edge pixels keep their colour as they fade out.
    const scale = aOut > 0 ? 255 / aOut : 0;
    raw[p++] = Math.min(255, Math.round((r / n) * scale));
    raw[p++] = Math.min(255, Math.round((g / n) * scale));
    raw[p++] = Math.min(255, Math.round((b / n) * scale));
    raw[p++] = Math.round(aOut);
  }
}

// --- minimal PNG encoder ----------------------------------------------------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;    // bit depth
ihdr[9] = 6;    // colour type: RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(new URL('../public/logo-120.png', import.meta.url), png);
console.log(`wrote public/logo-120.png (${SIZE}x${SIZE}, ${png.length} bytes)`);
