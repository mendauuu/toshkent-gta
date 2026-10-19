// Draws the game icon (Tashkent TV tower on a night-blue tile with three wanted stars)
// and writes assets/icon.png and assets/icon.ico. No dependencies.
import fs from 'node:fs';
import zlib from 'node:zlib';

const S = 256;
const px = new Float32Array(S * S * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const ia = 1 - a;
  px[i] = px[i] * ia + r * a; px[i + 1] = px[i + 1] * ia + g * a; px[i + 2] = px[i + 2] * ia + b * a;
  px[i + 3] = Math.min(1, px[i + 3] + a * (1 - px[i + 3]));
}
// anti-aliased fill by signed-distance function sampled per pixel
function fill(sdf, r, g, b, alpha = 1) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = sdf(x + 0.5, y + 0.5);
    const a = Math.max(0, Math.min(1, 0.5 - d)) * alpha;
    if (a > 0) blend(x, y, r, g, b, a);
  }
}
const roundRect = (x0, y0, x1, y1, rad) => (x, y) => {
  const cx = Math.max(x0 + rad, Math.min(x, x1 - rad)), cy = Math.max(y0 + rad, Math.min(y, y1 - rad));
  return Math.hypot(x - cx, y - cy) - rad;
};
const segment = (ax, ay, bx, by, w0, w1 = w0) => (x, y) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) - (w0 + (w1 - w0) * t) / 2;
};
const ellipse = (cx, cy, rx, ry) => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
const star = (cx, cy, R, r) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? r : R;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  return (x, y) => {
    let inside = false, dmin = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[j];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      dmin = Math.min(dmin, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
    }
    return inside ? -dmin : dmin;
  };
};

// background tile with vertical gradient
const bg = roundRect(6, 6, 250, 250, 46);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const d = bg(x + 0.5, y + 0.5);
  const a = Math.max(0, Math.min(1, 0.5 - d));
  if (a <= 0) continue;
  const t = y / S;
  const r = 0.06 + 0.16 * (1 - t) * 0.5, g = 0.09 + 0.2 * (1 - t) * 0.5, b = 0.18 + 0.32 * (1 - t);
  blend(x, y, r + 0.35 * Math.max(0, 0.25 - Math.abs(t - 0.86)) * 2, g + 0.15 * Math.max(0, 0.25 - Math.abs(t - 0.86)), b, a);
}
// city skyline
const sky = [[20, 196, 26], [44, 176, 20], [62, 188, 30], [88, 170, 18], [150, 182, 24], [172, 160, 22], [192, 186, 30], [218, 172, 22]];
for (const [x, top, w] of sky) fill(roundRect(x, top, x + w, 236, 2), 0.1, 0.15, 0.27);
// TV tower
const W = [0.92, 0.95, 1.0];
fill(segment(128, 40, 128, 212, 7, 12), ...W);
fill(segment(128, 150, 92, 222, 7, 9), ...W);
fill(segment(128, 150, 164, 222, 7, 9), ...W);
fill(ellipse(128, 112, 34, 11), ...W);
fill(ellipse(128, 112, 30, 3.2), 0.22, 0.42, 0.62);
fill(ellipse(128, 76, 15, 6), ...W);
fill(segment(128, 18, 128, 44, 3, 5), 0.86, 0.2, 0.17);
fill(ellipse(128, 17, 3.2, 3.2), 1, 0.35, 0.3);
// wanted stars
for (const cx of [86, 128, 170]) fill(star(cx, 232, 13, 5.5), 0.96, 0.77, 0.26);
// ground band clipped to tile
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  if (bg(x + 0.5, y + 0.5) > 0.5) { const i = (y * S + x) * 4; px[i + 3] = 0; }
}

function png(size) {
  // box-downsample from 256
  const f = S / size;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) {
        const i = ((Math.floor(y * f) + yy) * S + Math.floor(x * f) + xx) * 4;
        r += px[i] * px[i + 3]; g += px[i + 1] * px[i + 3]; b += px[i + 2] * px[i + 3]; a += px[i + 3];
      }
      const n = f * f, o = y * (size * 4 + 1) + 1 + x * 4;
      const aa = a / n;
      raw[o] = Math.round(Math.min(1, a > 0 ? r / a : 0) * 255);
      raw[o + 1] = Math.round(Math.min(1, a > 0 ? g / a : 0) * 255);
      raw[o + 2] = Math.round(Math.min(1, a > 0 ? b / a : 0) * 255);
      raw[o + 3] = Math.round(aa * 255);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync('assets', { recursive: true });
const sizes = [256, 128, 64, 48, 32, 16];
const pngs = sizes.map((s) => png(s));
fs.writeFileSync('assets/icon.png', pngs[0]);
// ICO with embedded PNG images
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
fs.writeFileSync('assets/icon.ico', Buffer.concat([header, ...entries, ...pngs]));
console.log('wrote assets/icon.png and assets/icon.ico');
