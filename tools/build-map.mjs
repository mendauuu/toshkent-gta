// Turns the raw OpenStreetMap extract (tools/extract-osm.mjs) into the game's map file.
//
//   node tools/build-map.mjs <tashkent-raw.json> [data/tashkent.json]
//
// Everything is converted to local metres around the centre of the playable area:
// +x = east, +z = south (three.js convention with y up). Coordinates are stored in decimetres.

import fs from 'node:fs';

const [, , inPath, outPath = 'data/tashkent.json'] = process.argv;
if (!inPath) { console.error('usage: node tools/build-map.mjs <raw.json> [out.json]'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));

// ------------------------------------------------------------------ projection & bounds
const PLAY = { minLat: 41.2985, maxLat: 41.3505, minLon: 69.2290, maxLon: 69.2950 };
const MARGIN = 230; // metres of scenery rendered outside the playable area
const LAT0 = (PLAY.minLat + PLAY.maxLat) / 2, LON0 = (PLAY.minLon + PLAY.maxLon) / 2;
const RAD = Math.PI / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * LAT0 * RAD) + 1.175 * Math.cos(4 * LAT0 * RAD);
const M_LON = 111412.84 * Math.cos(LAT0 * RAD) - 93.5 * Math.cos(3 * LAT0 * RAD);
const toX = (lon) => (lon - LON0) * M_LON;
const toZ = (lat) => -(lat - LAT0) * M_LAT;
const play = { minX: toX(PLAY.minLon), maxX: toX(PLAY.maxLon), minZ: toZ(PLAY.maxLat), maxZ: toZ(PLAY.minLat) };
const box = { minX: play.minX - MARGIN, maxX: play.maxX + MARGIN, minZ: play.minZ - MARGIN, maxZ: play.maxZ + MARGIN };
const inBox = (x, z, m = 0) => x >= box.minX - m && x <= box.maxX + m && z >= box.minZ - m && z <= box.maxZ + m;
const inPlay = (x, z, m = 0) => x >= play.minX - m && x <= play.maxX + m && z >= play.minZ - m && z <= play.maxZ + m;

// ------------------------------------------------------------------ small utils
const dm = (v) => Math.round(v * 10);
const flat = (pts) => { const o = new Array(pts.length * 2); pts.forEach((p, i) => { o[i * 2] = dm(p[0]); o[i * 2 + 1] = dm(p[1]); }); return o; };
function rng(seed) {
  let a = (seed % 4294967296) >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
function parseLen(v) {
  if (v == null) return NaN;
  const m = String(v).replace(',', '.').match(/-?[\d.]+/);
  if (!m) return NaN;
  let n = parseFloat(m[0]);
  if (/ft|'/.test(String(v))) n *= 0.3048;
  return n;
}
const nameOf = (t) => t['name:uz'] || t.name || t['name:en'] || t['name:ru'] || '';

function toPts(coords) { // [lat,lon,...] -> [[x,z],...]; null if incomplete
  const pts = [];
  for (let i = 0; i < coords.length; i += 2) {
    if (coords[i] == null) return null;
    pts.push([toX(coords[i + 1]), toZ(coords[i])]);
  }
  return pts;
}
function signedArea(r) { let s = 0; for (let i = 0, n = r.length; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function centroid(r) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; const f = p[0] * q[1] - q[0] * p[1]; a += f; cx += (p[0] + q[0]) * f; cz += (p[1] + q[1]) * f; }
  if (Math.abs(a) < 1e-6) { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; }
  return [cx / (3 * a), cz / (3 * a)];
}
function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}
function cleanRing(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p); }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.05) out.pop();
  return out;
}
function simplifyRing(r, tol) {
  const pts = r.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const p = pts[(i - 1 + pts.length) % pts.length], c = pts[i], n = pts[(i + 1) % pts.length];
      if (distToSeg(c, p, n) < tol) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts;
}
function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let md = 0, mi = -1;
    for (let i = s + 1; i < e; i++) { const d = distToSeg(pts[i], pts[s], pts[e]); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function prepRing(pts, tol = 0.25, ccw = true) {
  let r = cleanRing(pts);
  if (r.length < 3) return null;
  r = simplifyRing(r, tol);
  if (r.length < 3) return null;
  const a = signedArea(r);
  if ((a > 0) !== ccw) r.reverse();
  return r;
}
// minimum-area oriented box: returns {w, l, angle} (w <= l)
function orientedBox(r) {
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity;
    for (const p of r) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; mnU = Math.min(mnU, u); mxU = Math.max(mxU, u); mnV = Math.min(mnV, v); mxV = Math.max(mxV, v); }
    const area = (mxU - mnU) * (mxV - mnV);
    if (!best || area < best.area) best = { area, du: mxU - mnU, dv: mxV - mnV, ang };
  }
  return { w: Math.min(best.du, best.dv), l: Math.max(best.du, best.dv), area: best.area };
}
function isRectangular(r) {
  if (r.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const p = r[(i + 3) % 4], c = r[i], n = r[(i + 1) % 4];
    const ax = p[0] - c[0], az = p[1] - c[1], bx = n[0] - c[0], bz = n[1] - c[1];
    const cos = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz));
    if (Math.abs(cos) > 0.2) return false;
  }
  return true;
}

// ------------------------------------------------------------------ uniform grid for spatial tests
class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(ix, iz) { return ix * 100003 + iz; }
  insertBox(minX, minZ, maxX, maxZ, item) {
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = this.key(ix, iz);
        let a = this.map.get(k); if (!a) this.map.set(k, a = []);
        a.push(item);
      }
  }
  query(x, z) { return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || []; }
}
const ringBounds = (r) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of r) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); } return [a, b, c, d]; };

// ------------------------------------------------------------------ multipolygon assembly
function assemble(members) {
  const outers = [], inners = [];
  const open = { outer: [], inner: [] };
  for (const m of members) {
    const pts = toPts(m.coords);
    if (!pts || pts.length < 2) continue;
    const role = m.role === 'inner' ? 'inner' : 'outer';
    const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    if (closed) (role === 'outer' ? outers : inners).push(pts); else open[role].push(pts);
  }
  for (const role of ['outer', 'inner']) {
    const segs = open[role];
    while (segs.length) {
      let ring = segs.pop();
      let progress = true;
      while (progress) {
        progress = false;
        const end = ring[ring.length - 1];
        if (ring.length > 3 && end[0] === ring[0][0] && end[1] === ring[0][1]) break;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (s[0][0] === end[0] && s[0][1] === end[1]) { ring = ring.concat(s.slice(1)); }
          else if (s[s.length - 1][0] === end[0] && s[s.length - 1][1] === end[1]) { ring = ring.concat(s.slice(0, -1).reverse()); }
          else continue;
          segs.splice(i, 1); progress = true; break;
        }
      }
      const end = ring[ring.length - 1];
      if (ring.length > 3 && end[0] === ring[0][0] && end[1] === ring[0][1]) (role === 'outer' ? outers : inners).push(ring);
    }
  }
  return outers.map((o) => ({ outer: o, holes: inners.filter((h) => pointInRing(h[0][0], h[0][1], o)) }));
}

// ------------------------------------------------------------------ collect area features
const features = []; // {id, tags, outer, holes}
for (const w of raw.ways) {
  const t = w.tags;
  const area = 'building' in t || 'building:part' in t || t.natural === 'water' || t.landuse || t.leisure || t.natural || t.amenity === 'parking' ||
    t.waterway === 'riverbank' || (t.highway && t.area === 'yes') || t['place'] === 'square' || t.amenity;
  if (!area) continue;
  const pts = toPts(w.coords);
  if (!pts || pts.length < 4) continue;
  const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  if (!closed) continue;
  features.push({ id: w.id, tags: t, outer: pts, holes: [] });
}
for (const r of raw.relations) {
  for (const poly of assemble(r.members)) features.push({ id: r.id * 7 + 3, tags: r.tags, outer: poly.outer, holes: poly.holes, rel: true });
}

// ------------------------------------------------------------------ landmarks (real coordinates from OSM)
const L = (lat, lon) => [toX(lon), toZ(lat)];
const landmarks = [
  { id: 'tvtower', name: 'Toshkent teleminorasi', pos: L(41.345678, 69.2848233), height: 375 },
  { id: 'temur', name: 'Amir Temur haykali', pos: L(41.3111759, 69.2797551) },
  { id: 'globe', name: "O'zbekiston globusi", pos: L(41.31643, 69.26680) },
  { id: 'chorsu', name: 'Chorsu bozori', pos: L(41.32678, 69.23516) },
  { id: 'kukeldash', name: "Ko'kaldosh madrasasi", pos: L(41.32342, 69.23624) },
  { id: 'minor', name: 'Minor masjidi', pos: L(41.33547, 69.27520) },
  { id: 'hazratimam', name: 'Hazrati Imom majmuasi', pos: L(41.33745, 69.24126) },
  { id: 'beshqozon', name: 'Besh Qozon palov markazi', pos: L(41.3476022, 69.2852151) },
  { id: 'tashkentcity', name: 'Tashkent City', pos: L(41.31450, 69.25084) },
  { id: 'nestone', name: 'Nest One', pos: L(41.31205, 69.25210) },
  { id: 'hoteluz', name: "O'zbekiston mehmonxonasi", pos: L(41.31141, 69.28272) },
  { id: 'mustaqillik', name: 'Mustaqillik maydoni', pos: L(41.3153897, 69.2674378) },
  { id: 'navoitheatre', name: 'Alisher Navoiy teatri', pos: L(41.30927, 69.27131) },
  { id: 'magiccity', name: 'Magic City', pos: L(41.30331, 69.24467) },
  { id: 'cityPark', name: 'Tashkent City Park', pos: L(41.31710, 69.24785) },
  { id: 'hyatt', name: 'Hyatt Regency', pos: L(41.31657, 69.27751) },
];
const lm = Object.fromEntries(landmarks.map((l) => [l.id, l]));
const HEIGHT_OVERRIDES = new Map([[878651866, 260]]); // Nest One (51 floors, not tagged in OSM)
// exact OSM outlines of the big mosques (multipolygon relation ids) so minarets sit at their corners
const LANDMARK_OUTLINES = { hazratimam: 19934455, minor: 4827007, kukeldash: 2324986 };
for (const [key, relId] of Object.entries(LANDMARK_OUTLINES)) {
  const f = features.find((ft) => ft.rel && ft.id === relId * 7 + 3 && ('building' in ft.tags));
  if (f) { const r = prepRing(f.outer, 0.3, true); if (r) lm[key].ring = flat(r); }
}

// ------------------------------------------------------------------ buildings
const PAL = {
  house: [0xd8c4a0, 0xcfb58e, 0xe3dccb, 0xe2cf9a, 0xc9a77c, 0xd9d3c4, 0xbfa58a, 0xe6d8b8],
  soviet: [0xd9d6cf, 0xcfcac0, 0xe6e1d5, 0xc8c3b8, 0xd6c9b0, 0xb9c2c6, 0xe0d2bc, 0xc7b8a2, 0xd2c0a8, 0xbdb4a6],
  modern: [0x8fa6b8, 0x7d97ab, 0xa9b9c4, 0x6f8799, 0xb7c3cc, 0x9aa7a8, 0xc9d1d6],
  brick: [0xc89d6e, 0xb98a5e, 0xd4ae7f, 0xa8775a, 0xc4a27e],
  industrial: [0xa6a094, 0x9b9488, 0xb3ab9c, 0x8f8a80, 0xa9a49a],
  civic: [0xe8dcc0, 0xeadfc9, 0xd9c8a5, 0xf0e8d6, 0xe4d4b0],
  religious: [0xd8b58a, 0xcfa577, 0xe3c9a0, 0xd9bf95],
};
const METAL_ROOFS = [0x6b7f73, 0x7a8a99, 0x8e5b45, 0x9a9a96, 0x5f7a8f, 0xa08066, 0x77806b];
const FLAT_ROOFS = [0x7d7a74, 0x8f8b84, 0xa9a69e, 0x6f6d69, 0x9b958a];
const DOME_COLORS = [0x2f8fb5, 0x2a7fa8, 0x3aa0c0, 0x1f6f96];
// window styles used by the building shader
const STYLE = { none: 0, house: 1, soviet: 2, glass: 3, office: 4, industrial: 5 };
const ROOF = { flat: 0, hipped: 1, gabled: 2, dome: 3, pyramidal: 4, canopy: 5 };

const outlines = [], parts = [];
for (const f of features) {
  const t = f.tags;
  if (!('building' in t) && !('building:part' in t)) continue;
  if (t.building === 'no' || t['building:part'] === 'no') continue;
  const [cx, cz] = centroid(f.outer);
  if (!inBox(cx, cz)) continue;
  const outer = prepRing(f.outer, 0.25, true);
  if (!outer) continue;
  const holes = f.holes.map((h) => prepRing(h, 0.25, false)).filter(Boolean);
  const area = Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
  if (area < 6) continue;
  const rec = { id: f.id, tags: t, outer, holes, area, c: [cx, cz], isPart: !('building' in t) || t.building === undefined };
  if ('building:part' in t && !('building' in t)) parts.push(rec); else outlines.push(rec);
}

// the TV tower and other landmark structures get custom models
const nearLandmark = (b, id, r) => Math.hypot(b.c[0] - lm[id].pos[0], b.c[1] - lm[id].pos[1]) < r;
const removeIds = new Set();
for (const b of [...outlines, ...parts]) {
  if (nearLandmark(b, 'tvtower', 45) && (b.tags.man_made === 'tower' || b.tags.building === 'tower' || b.area < 2500)) removeIds.add(b.id);
}

// attach parts to outlines
const outlineGrid = new Grid(50);
outlines.forEach((b, i) => { const [a, c, d, e] = ringBounds(b.outer); outlineGrid.insertBox(a, c, d, e, i); });
for (const p of parts) {
  const cands = outlineGrid.query(p.c[0], p.c[1]);
  for (const i of cands) {
    const o = outlines[i];
    if (pointInRing(p.c[0], p.c[1], o.outer)) { (o.parts ||= []).push(p); p.parent = o; break; }
  }
}

function estimateHeight(t, area, ob, r) {
  const type = t.building || 'yes';
  const elong = ob.l / Math.max(ob.w, 1);
  switch (type) {
    case 'house': case 'detached': case 'semidetached_house': case 'bungalow': case 'terrace':
      return area < 120 ? 3.4 + r() * 1.2 : 4.4 + r() * 2.8;
    case 'garage': case 'garages': case 'shed': case 'hut': case 'kiosk': case 'toilets': case 'service': case 'transformer_tower': case 'cabin':
      return 2.7 + r() * 0.8;
    case 'apartments': case 'residential': case 'dormitory':
      if (area < 300) return 7 + r() * 3;
      if (area < 900) return r() < 0.75 ? 13.2 + r() * 3.3 : 28.5;
      return r() < 0.6 ? 16.5 : (r() < 0.7 ? 28.5 : 38);
    case 'commercial': case 'retail': case 'office': case 'hotel': case 'supermarket':
      if (area < 200) return 4 + r() * 3;
      if (area < 1000) return 8 + r() * 7;
      return 10 + r() * 12;
    case 'industrial': case 'warehouse': case 'factory': case 'manufacture':
      return 6 + r() * 4;
    case 'school': case 'kindergarten': case 'university': case 'college': case 'hospital': case 'public': case 'civic': case 'government': case 'train_station':
      return area < 400 ? 7 + r() * 3 : 10 + r() * 4;
    case 'mosque': case 'church': case 'religious': case 'temple': case 'cathedral':
      return 8 + r() * 4;
    case 'construction':
      return 8 + r() * 20;
    case 'stadium': case 'grandstand':
      return 9 + r() * 5;
    default:
      if (area < 40) return 2.8 + r() * 0.7;
      if (area < 130) return 3.3 + r() * 1.4;
      if (area < 320) return r() < 0.75 ? 4 + r() * 3.5 : 7 + r() * 3;
      if (elong > 2.6 && area > 380) { const q = r(); return q < 0.55 ? 16.5 : q < 0.85 ? 28.5 : 13.2; }
      if (area < 750) return r() < 0.7 ? 7.5 + r() * 6 : 16.5;
      if (area < 2200) return r() < 0.65 ? 12 + r() * 6 : 28.5;
      return 12 + r() * 10;
  }
}

function styleFor(t, h, area, r) {
  const type = t.building || t['building:part'] || 'yes';
  if (['garage', 'garages', 'shed', 'hut', 'kiosk', 'toilets', 'service', 'transformer_tower', 'roof', 'carport'].includes(type)) return { s: STYLE.none, c: pick(r, PAL.industrial) };
  if (['mosque', 'church', 'religious', 'temple', 'cathedral', 'shrine'].includes(type) || t.religion === 'muslim' || t.historic) return { s: STYLE.none, c: pick(r, PAL.religious) };
  if (['industrial', 'warehouse', 'factory', 'manufacture'].includes(type)) return { s: STYLE.industrial, c: pick(r, PAL.industrial) };
  if (h > 45) return { s: STYLE.glass, c: pick(r, PAL.modern) };
  if (['commercial', 'retail', 'office', 'hotel', 'supermarket'].includes(type)) return r() < 0.5 ? { s: STYLE.office, c: pick(r, PAL.modern) } : { s: STYLE.office, c: pick(r, PAL.civic) };
  if (['school', 'kindergarten', 'university', 'college', 'hospital', 'public', 'civic', 'government'].includes(type)) return { s: STYLE.office, c: pick(r, PAL.civic) };
  if (h <= 8.5) return { s: STYLE.house, c: pick(r, PAL.house) };
  if (r() < 0.12) return { s: STYLE.soviet, c: pick(r, PAL.brick) };
  return { s: STYLE.soviet, c: pick(r, PAL.soviet) };
}

const buildings = [];
function emitBuilding(b, opts) {
  const t = b.tags, r = rng(b.id);
  const ob = orientedBox(b.outer);
  let h = HEIGHT_OVERRIDES.get(b.id) || parseLen(t.height);
  const lv = parseLen(t['building:levels']);
  const roofLv = parseLen(t['roof:levels']) || 0;
  if (!(h > 0) && lv > 0) h = lv * 3.1 + 0.6 + roofLv * 2.4;
  if (!(h > 0)) h = estimateHeight(t, b.area, ob, r);
  let minH = parseLen(t.min_height);
  const minLv = parseLen(t['building:min_level']);
  if (!(minH >= 0) && minLv > 0) minH = minLv * 3.1;
  if (!(minH >= 0)) minH = 0;
  h = Math.min(h, 400);
  if (minH >= h - 0.3) minH = Math.max(0, h - 1);

  const type = t.building || t['building:part'];
  // parts inherit the look of their building (a mosque's parts stay a mosque)
  const styleTags = opts.parentTags ? { ...opts.parentTags, ...t, building: opts.parentTags.building } : t;
  let roof = ROOF.flat, roofH = 0;
  const shape = t['roof:shape'];
  if (type === 'roof' || type === 'carport') { roof = ROOF.canopy; minH = Math.max(minH, Math.min(h - 0.4, 3)); }
  else if (shape === 'dome' || shape === 'onion') roof = ROOF.dome;
  else if (shape === 'pyramidal') roof = ROOF.pyramidal;
  else if (shape === 'hipped' || shape === 'gambrel' || shape === 'mansard' || shape === 'half-hipped') roof = ROOF.hipped;
  else if (shape === 'gabled' || shape === 'saltbox') roof = ROOF.gabled;
  else if (!shape && !opts.isPart && b.area < 280 && h <= 8.5 && isRectangular(b.outer)) {
    const q = r(); roof = q < 0.6 ? ROOF.hipped : q < 0.85 ? ROOF.gabled : ROOF.flat;
  }
  if ((roof === ROOF.hipped || roof === ROOF.gabled) && !isRectangular(b.outer)) roof = ROOF.pyramidal;
  const tagRoofH = parseLen(t['roof:height']);
  if (roof === ROOF.dome) {
    const rad = Math.sqrt(b.area / Math.PI);
    roofH = tagRoofH > 0 ? tagRoofH : Math.min(rad * 0.85, 4 + rad * 0.35);
    if (tagRoofH > 0 || t.height) h = Math.max(minH + 1, h - roofH); // OSM height includes the roof
  } else if (roof === ROOF.hipped || roof === ROOF.gabled || roof === ROOF.pyramidal) {
    roofH = tagRoofH > 0 ? tagRoofH : Math.min(3, ob.w * 0.32);
    if (tagRoofH > 0) h = Math.max(minH + 1, h - roofH);
  }
  const st = styleFor(styleTags, h, b.area, r);
  let wall = st.c;
  const colour = t['building:colour'];
  if (colour && /^#[0-9a-f]{6}$/i.test(colour)) wall = parseInt(colour.slice(1), 16);
  let roofCol = roof === ROOF.flat ? pick(r, FLAT_ROOFS) : roof === ROOF.dome ? pick(r, DOME_COLORS) : pick(r, METAL_ROOFS);
  const rc = t['roof:colour'];
  if (rc === 'blue') roofCol = 0x2f8fb5; else if (rc && /^#[0-9a-f]{6}$/i.test(rc)) roofCol = parseInt(rc.slice(1), 16);
  const rec = {
    p: flat(b.outer),
    h: Math.round(h * 10),
    s: st.s,
    c: wall,
    rf: roof,
    rc: roofCol,
  };
  if (minH > 0) rec.m = Math.round(minH * 10);
  if (roofH > 0) rec.rh = Math.round(roofH * 10);
  if (b.holes.length) rec.ho = b.holes.map(flat);
  if (!opts.collide) rec.nc = 1; // not solid
  if (!opts.render) rec.nr = 1; // collision only
  buildings.push(rec);
  return h;
}

let partRendered = 0, outlineHidden = 0;
for (const o of outlines) {
  if (removeIds.has(o.id)) continue;
  const canopy = o.tags.building === 'roof' || o.tags.building === 'carport';
  const ps = (o.parts || []).filter((p) => !removeIds.has(p.id));
  if (ps.length) {
    const cover = ps.filter((p) => !(parseLen(p.tags.min_height) > 0)).reduce((s, p) => s + p.area, 0) / o.area;
    if (cover >= 0.8) {
      emitBuilding(o, { collide: !canopy, render: false });
      for (const p of ps) { emitBuilding(p, { collide: false, render: true, isPart: true, parentTags: o.tags }); partRendered++; }
      outlineHidden++;
      continue;
    }
    const oh = emitBuilding(o, { collide: !canopy, render: true });
    for (const p of ps) {
      const ph = parseLen(p.tags.height) || (parseLen(p.tags['building:levels']) * 3.1 + 0.6) || 0;
      if (ph > oh + 0.5 || p.tags['roof:shape'] === 'dome') { emitBuilding(p, { collide: false, render: true, isPart: true, parentTags: o.tags }); partRendered++; }
    }
    continue;
  }
  emitBuilding(o, { collide: !canopy, render: true });
}
for (const p of parts) if (!p.parent && !removeIds.has(p.id)) { emitBuilding(p, { collide: true, render: true, isPart: true }); partRendered++; }

// make sure the Chorsu bazaar dome reads as the big blue dome it is
for (const b of buildings) {
  if (b.rf !== ROOF.dome) continue;
  const n = b.p.length / 2;
  let x = 0, z = 0; for (let i = 0; i < n; i++) { x += b.p[i * 2]; z += b.p[i * 2 + 1]; }
  x /= n * 10; z /= n * 10;
  if (Math.hypot(x - lm.chorsu.pos[0], z - lm.chorsu.pos[1]) < 40) { b.rc = 0x2f8fb5; b.c = 0xd9c7a2; b.s = STYLE.none; }
}

// ------------------------------------------------------------------ roads
const HW = {
  //            render class, drivable(graph), width 2-way, width 1-way, lanes/dir (2-way), lanes (1-way), speed m/s
  motorway: [0, 1, 24, 11, 3, 3, 25], trunk: [0, 1, 20, 10.5, 3, 3, 22], primary: [0, 1, 16, 10.5, 2, 3, 17],
  secondary: [0, 1, 12, 7.5, 2, 2, 15], tertiary: [1, 1, 9.5, 6.5, 1, 2, 13], unclassified: [1, 1, 7, 5, 1, 1, 10],
  residential: [1, 1, 7, 5, 1, 1, 10], busway: [1, 1, 7, 5, 1, 1, 12],
  motorway_link: [0, 1, 8, 6, 1, 1, 15], trunk_link: [0, 1, 8, 6, 1, 1, 14], primary_link: [0, 1, 8, 6, 1, 1, 12],
  secondary_link: [1, 1, 7, 5.5, 1, 1, 11], tertiary_link: [1, 1, 7, 5.5, 1, 1, 10],
  living_street: [2, 1, 6, 4.5, 1, 1, 7], service: [2, 0, 4.5, 4, 1, 1, 6], track: [2, 0, 3.5, 3.5, 1, 1, 6],
  pedestrian: [3, 0, 6, 6, 1, 1, 4], footway: [4, 0, 2.6, 2.6, 1, 1, 3], path: [4, 0, 2, 2, 1, 1, 3],
  cycleway: [4, 0, 2.2, 2.2, 1, 1, 3], steps: [4, 0, 2.4, 2.4, 1, 1, 3], bridleway: [4, 0, 2, 2, 1, 1, 3],
};
const names = [], nameIdx = new Map();
const nameId = (s) => { if (!s) return -1; if (!nameIdx.has(s)) { nameIdx.set(s, names.length); names.push(s); } return nameIdx.get(s); };

// split a way into runs of consecutive vertices that are known and inside the scenery box
function runsOf(w, margin = 30) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < w.coords.length / 2; i++) {
    const la = w.coords[i * 2], lo = w.coords[i * 2 + 1];
    const ok = la != null && inBox(toX(lo), toZ(la), margin);
    if (ok) { if (!cur) runs.push(cur = []); cur.push({ x: toX(lo), z: toZ(la), id: w.nodes ? w.nodes[i] : -1 }); }
    else cur = null;
  }
  return runs.filter((r) => r.length >= 2);
}

const roads = [];
const graphWays = [];
for (const w of raw.ways) {
  const t = w.tags;
  const cls = HW[t.highway];
  if (!cls) continue;
  if (t.area === 'yes') continue;
  if (t.tunnel === 'yes' && cls[0] >= 3) continue; // pedestrian underpasses
  if (t.tunnel === 'building_passage' && cls[0] >= 2) continue;
  if (t.service === 'parking_aisle' || t.service === 'drive-through') { /* rendered, not in graph */ }
  let oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.highway === 'motorway' || t.junction === 'circular' ? 1 : t.oneway === '-1' ? -1 : 0;
  if (t.oneway === 'no') oneway = 0;
  const lanesTag = parseInt(t.lanes, 10);
  let lanesFwd, lanesBwd;
  if (oneway) { lanesFwd = lanesTag > 0 ? Math.min(lanesTag, 6) : cls[5]; lanesBwd = 0; }
  else { const per = lanesTag > 1 ? Math.max(1, Math.floor(lanesTag / 2)) : cls[4]; lanesFwd = lanesBwd = per; }
  const lanesTotal = lanesFwd + lanesBwd;
  let width = parseLen(t.width);
  if (!(width > 1.5 && width < 60)) width = cls[0] <= 1 ? Math.max(oneway ? cls[3] : cls[2], lanesTotal * 3.3) : (oneway ? cls[3] : cls[2]);
  const nid = nameId(nameOf(t));
  for (let run of runsOf(w)) {
    if (oneway === -1) run = run.slice().reverse();
    const pts = simplifyLine(run.map((v) => [v.x, v.z]), 0.4);
    roads.push({ t: cls[0], w: Math.round(width * 10), n: nid, o: oneway ? 1 : 0, l: lanesTotal, b: t.bridge && t.bridge !== 'no' ? 1 : 0, p: flat(pts) });
    if (cls[1] && !(t.service)) graphWays.push({ run, oneway: oneway ? 1 : 0, lanesFwd, lanesBwd, width, speed: cls[6], cls: cls[0], hw: t.highway, n: nid, maxspeed: parseLen(t.maxspeed) });
  }
}
// pedestrian plazas & parking as polygons
const plazas = [];
for (const f of features) {
  const t = f.tags;
  let kind = -1;
  if (t.highway === 'pedestrian' || t.place === 'square' || (t.highway === 'footway' && t.area === 'yes')) kind = 0;
  else if (t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey') kind = 1;
  if (kind < 0) continue;
  const [cx, cz] = centroid(f.outer);
  if (!inBox(cx, cz)) continue;
  const outer = prepRing(f.outer, 0.4, true);
  if (!outer || Math.abs(signedArea(outer)) < 20) continue;
  plazas.push({ k: kind, p: flat(outer), ho: f.holes.map((h) => prepRing(h, 0.4, false)).filter(Boolean).map(flat) });
}

// ------------------------------------------------------------------ road graph (for AI traffic, pedestrians & GPS)
const useCount = new Map();
for (const g of graphWays) for (let i = 0; i < g.run.length; i++) {
  const id = g.run[i].id;
  const isEnd = i === 0 || i === g.run.length - 1;
  useCount.set(id, (useCount.get(id) || 0) + (isEnd ? 2 : 1));
}
const gNodes = [], gNodeIdx = new Map();
const nodeFor = (v) => { if (!gNodeIdx.has(v.id)) { gNodeIdx.set(v.id, gNodes.length); gNodes.push({ x: v.x, z: v.z, osm: v.id }); } return gNodeIdx.get(v.id); };
const edges = [];
for (const g of graphWays) {
  let start = 0;
  for (let i = 1; i < g.run.length; i++) {
    const v = g.run[i];
    if (i === g.run.length - 1 || (useCount.get(v.id) || 0) >= 2) {
      const seg = g.run.slice(start, i + 1);
      const a = nodeFor(seg[0]), b = nodeFor(seg[seg.length - 1]);
      let pts = simplifyLine(seg.map((s) => [s.x, s.z]), 0.4);
      let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      if (len > 0.5 && a !== b) {
        const spd = g.maxspeed > 0 ? Math.min(g.speed * 1.1, g.maxspeed / 3.6) : g.speed;
        edges.push({ a, b, p: flat(pts), len: Math.round(len * 10) / 10, o: g.oneway, lf: g.lanesFwd, lb: g.lanesBwd, w: Math.round(g.width * 10), s: Math.round(spd * 10) / 10, c: g.cls, n: g.n, major: ['trunk', 'primary', 'secondary', 'tertiary', 'motorway', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'].includes(g.hw) ? 1 : 0 });
      }
      start = i;
    }
  }
}
// connected components (undirected) -> keep id of the main network
const adj = gNodes.map(() => []);
edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });
const comp = new Int32Array(gNodes.length).fill(-1);
let compSizes = [];
for (let s = 0; s < gNodes.length; s++) {
  if (comp[s] >= 0) continue;
  const id = compSizes.length; let size = 0; const stack = [s]; comp[s] = id;
  while (stack.length) { const n = stack.pop(); size++; for (const ei of adj[n]) { const e = edges[ei]; const o = e.a === n ? e.b : e.a; if (comp[o] < 0) { comp[o] = id; stack.push(o); } } }
  compSizes.push(size);
}
const mainComp = compSizes.indexOf(Math.max(...compSizes));

// traffic signals: graph nodes near highway=traffic_signals, clustered per junction
const signalPois = raw.pois.filter((p) => p.tags.highway && p.tags.highway.includes('traffic_signals')).map((p) => [toX(p.lon), toZ(p.lat)]);
const sigGrid = new Grid(30);
signalPois.forEach((p, i) => sigGrid.insertBox(p[0], p[1], p[0], p[1], i));
const nearSignal = (x, z, r) => {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
    for (const i of sigGrid.query(x + dx * 30, z + dz * 30)) if (Math.hypot(signalPois[i][0] - x, signalPois[i][1] - z) < r) return true;
  return false;
};
const signalNodes = [];
gNodes.forEach((n, i) => {
  const deg = adj[i].length;
  if (deg >= 3 && comp[i] === mainComp && nearSignal(n.x, n.z, 22)) signalNodes.push(i);
});
// cluster signalised nodes within 45 m so a junction of two dual carriageways shares one cycle
const cluster = new Map();
let clusterCount = 0;
for (const i of signalNodes) {
  if (cluster.has(i)) continue;
  const cid = clusterCount++;
  const queue = [i]; cluster.set(i, cid);
  while (queue.length) {
    const n = queue.pop();
    for (const j of signalNodes) if (!cluster.has(j) && Math.hypot(gNodes[j].x - gNodes[n].x, gNodes[j].z - gNodes[n].z) < 45) { cluster.set(j, cid); queue.push(j); }
  }
}

// ------------------------------------------------------------------ water & green areas
const water = [], greens = [];
const GREEN_CLASS = (t) => {
  if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'stadium') return 2;
  if (t.leisure === 'playground') return 4;
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 3;
  if (t.natural === 'wood' || t.landuse === 'forest' || t.landuse === 'orchard') return 1;
  if (['park', 'garden', 'common', 'recreation_ground', 'golf_course', 'dog_park'].includes(t.leisure)) return 0;
  if (['grass', 'greenery', 'meadow', 'village_green', 'flowerbed', 'recreation_ground', 'allotments', 'greenfield', 'plant_nursery'].includes(t.landuse)) return 0;
  if (['grassland', 'scrub', 'heath', 'grass'].includes(t.natural)) return 0;
  return -1;
};
const parkPolys = [], woodPolys = [];
for (const f of features) {
  const t = f.tags;
  const [cx, cz] = centroid(f.outer);
  if (!inBox(cx, cz, 400)) continue;
  const isWater = t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.leisure === 'swimming_pool' || t.water;
  if (isWater && t.tunnel !== 'yes' && t.covered !== 'yes') {
    const outer = prepRing(f.outer, 0.4, true);
    if (outer && Math.abs(signedArea(outer)) > 8) water.push({ p: flat(outer), ho: f.holes.map((h) => prepRing(h, 0.4, false)).filter(Boolean).map(flat) });
    continue;
  }
  const g = GREEN_CLASS(t);
  if (g < 0 || 'building' in t) continue;
  const outer = prepRing(f.outer, 0.4, true);
  if (!outer || Math.abs(signedArea(outer)) < 15) continue;
  const holes = f.holes.map((h) => prepRing(h, 0.4, false)).filter(Boolean);
  greens.push({ k: g, p: flat(outer), ho: holes.map(flat) });
  if (g === 0 && (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'greenery' || t.landuse === 'grass')) parkPolys.push({ outer, holes, area: Math.abs(signedArea(outer)) });
  if (g === 1) woodPolys.push({ outer, holes, area: Math.abs(signedArea(outer)) });
}
const waterways = [];
for (const w of raw.ways) {
  const t = w.tags;
  if (!t.waterway || t.tunnel || t.layer === '-1' && t.tunnel) continue;
  const def = { canal: 9, river: 18, stream: 3, ditch: 1.3, drain: 1.6 }[t.waterway];
  if (!def) continue;
  let width = parseLen(t.width);
  if (!(width > 0.5 && width < 80)) width = def;
  for (const run of runsOf(w, 60)) waterways.push({ w: Math.round(width * 10), p: flat(simplifyLine(run.map((v) => [v.x, v.z]), 0.4)) });
}

// railways (surface only)
const rails = [];
for (const w of raw.ways) {
  const t = w.tags;
  if (t.railway !== 'rail' && t.railway !== 'light_rail' && t.railway !== 'tram') continue;
  if (t.tunnel && t.tunnel !== 'no') continue;
  for (const run of runsOf(w, 30)) rails.push({ p: flat(simplifyLine(run.map((v) => [v.x, v.z]), 0.4)) });
}

// ------------------------------------------------------------------ occupancy helpers for scattering trees
const bGrid = new Grid(40);
const solid = buildings.filter((b) => !b.nc);
solid.forEach((b, i) => {
  const ring = []; for (let k = 0; k < b.p.length; k += 2) ring.push([b.p[k] / 10, b.p[k + 1] / 10]);
  b._ring = ring;
  const [a, c, d, e] = ringBounds(ring);
  bGrid.insertBox(a - 2, c - 2, d + 2, e + 2, i);
});
const insideBuilding = (x, z) => bGrid.query(x, z).some((i) => pointInRing(x, z, solid[i]._ring) || solid[i]._ring.some((p, k, r) => distToSeg([x, z], p, r[(k + 1) % r.length]) < 1.6));
const rGrid = new Grid(30);
const segs = [];
for (const r of roads) {
  const hw = r.w / 20;
  for (let k = 0; k + 3 < r.p.length; k += 2) {
    const a = [r.p[k] / 10, r.p[k + 1] / 10], b = [r.p[k + 2] / 10, r.p[k + 3] / 10];
    segs.push({ a, b, hw });
    rGrid.insertBox(Math.min(a[0], b[0]) - hw - 3, Math.min(a[1], b[1]) - hw - 3, Math.max(a[0], b[0]) + hw + 3, Math.max(a[1], b[1]) + hw + 3, segs.length - 1);
  }
}
const onRoad = (x, z, pad) => rGrid.query(x, z).some((i) => distToSeg([x, z], segs[i].a, segs[i].b) < segs[i].hw + pad);
const waterRings = water.map((w) => { const r = []; for (let k = 0; k < w.p.length; k += 2) r.push([w.p[k] / 10, w.p[k + 1] / 10]); return r; });
const wGrid = new Grid(60);
waterRings.forEach((r, i) => { const [a, c, d, e] = ringBounds(r); wGrid.insertBox(a, c, d, e, i); });
const wwSegs = []; const wwGrid = new Grid(30);
for (const w of waterways) for (let k = 0; k + 3 < w.p.length; k += 2) {
  const a = [w.p[k] / 10, w.p[k + 1] / 10], b = [w.p[k + 2] / 10, w.p[k + 3] / 10], hw = w.w / 20;
  wwSegs.push({ a, b, hw }); wwGrid.insertBox(Math.min(a[0], b[0]) - hw - 2, Math.min(a[1], b[1]) - hw - 2, Math.max(a[0], b[0]) + hw + 2, Math.max(a[1], b[1]) + hw + 2, wwSegs.length - 1);
}
const inWater = (x, z) => wGrid.query(x, z).some((i) => pointInRing(x, z, waterRings[i])) || wwGrid.query(x, z).some((i) => distToSeg([x, z], wwSegs[i].a, wwSegs[i].b) < wwSegs[i].hw + 1);

// ------------------------------------------------------------------ trees
const trees = [];
const treeGrid = new Grid(6);
function tryTree(x, z, type, scale, minGap = 3.2, roadPad = 1.2) {
  if (!inBox(x, z)) return false;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
    for (const i of treeGrid.query(x + dx * 6, z + dz * 6)) if (Math.hypot(trees[i][0] - x, trees[i][1] - z) < minGap) return false;
  if (onRoad(x, z, roadPad) || insideBuilding(x, z) || inWater(x, z)) return false;
  trees.push([x, z, scale, type]);
  treeGrid.insertBox(x, z, x, z, trees.length - 1);
  return true;
}
const tr = rng(12345);
const randomType = (poplarBias = 0.2, conifer = 0.06) => { const q = tr(); return q < conifer ? 3 : q < conifer + poplarBias ? 1 : q < conifer + poplarBias + 0.12 ? 2 : 0; };
// mapped trees first
for (const p of raw.pois) if (p.tags.natural === 'tree') tryTree(toX(p.lon), toZ(p.lat), p.tags.leaf_type === 'needleleaved' ? 3 : randomType(0.15, 0.04), 0.85 + tr() * 0.45, 2.2, 0.6);
for (const w of raw.ways) {
  if (w.tags.natural !== 'tree_row') continue;
  for (const run of runsOf(w, 0)) {
    for (let k = 1; k < run.length; k++) {
      const a = run[k - 1], b = run[k], len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s < len; s += 7.5) { const f = s / len; tryTree(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, randomType(0.3, 0.02), 0.85 + tr() * 0.4, 3, 0.8); }
    }
  }
}
// street trees: Tashkent's avenues are lined with plane trees and poplars
for (const r of roads) {
  if (r.t > 1) continue;
  const hw = r.w / 20;
  const pts = []; for (let k = 0; k < r.p.length; k += 2) pts.push([r.p[k] / 10, r.p[k + 1] / 10]);
  const type = tr() < 0.3 ? 1 : 0;
  for (const side of [-1, 1]) {
    const off = hw + 2.4 + tr() * 0.8;
    let carry = tr() * 9;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      for (let s = carry; s < len; s += 9 + tr() * 4) {
        if (s < 8 && k === 1) continue;
        if (len - s < 8 && k === pts.length - 1) continue;
        const f = s / len;
        tryTree(a[0] + (b[0] - a[0]) * f + nx * off * side, a[1] + (b[1] - a[1]) * f + nz * off * side, tr() < 0.85 ? type : randomType(), 0.9 + tr() * 0.35, 4.5, 1.5);
      }
      carry = 0;
    }
  }
}
// parks & woods
function scatter(poly, spacing, poplar, conifer) {
  const [a, c, d, e] = ringBounds(poly.outer);
  const maxCount = Math.min(4000, poly.area / (spacing * spacing) * 1.2);
  let n = 0;
  for (let x = a; x < d; x += spacing) for (let z = c; z < e; z += spacing) {
    if (n > maxCount) return;
    const px = x + (tr() - 0.5) * spacing * 0.9, pz = z + (tr() - 0.5) * spacing * 0.9;
    if (!pointInRing(px, pz, poly.outer) || poly.holes.some((h) => pointInRing(px, pz, h))) continue;
    if (tr() < 0.35) continue; // keep clearings
    if (tryTree(px, pz, randomType(poplar, conifer), 0.8 + tr() * 0.5, spacing * 0.6, 1.5)) n++;
  }
}
for (const p of parkPolys) if (p.area > 400) scatter(p, 9, 0.15, 0.12);
for (const p of woodPolys) scatter(p, 6, 0.25, 0.1);

// ------------------------------------------------------------------ points of interest
const centreOf = (f) => centroid(f.outer);
const poiList = (pred) => {
  const out = [];
  for (const f of features) if (pred(f.tags)) { const [x, z] = centreOf(f); if (inPlay(x, z, -40)) out.push({ n: nameOf(f.tags), x: dm(x), z: dm(z) }); }
  for (const p of raw.pois) if (pred(p.tags)) { const x = toX(p.lon), z = toZ(p.lat); if (inPlay(x, z, -40)) out.push({ n: nameOf(p.tags), x: dm(x), z: dm(z) }); }
  return out;
};
const dedupe = (list, r) => { const out = []; for (const p of list) if (!out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < r * 10)) out.push(p); return out; };
const hospitals = dedupe(poiList((t) => t.amenity === 'hospital' && t.healthcare === 'hospital' && (t.name || '').length > 3), 150);
const police = dedupe(poiList((t) => t.amenity === 'police' && /ГУВД|ГОМ|отдел|Опорный|милиц|Участков/i.test(t.name || '')), 250);
const carWashes = dedupe(poiList((t) => t.amenity === 'car_wash'), 120);
const fuel = dedupe(poiList((t) => t.amenity === 'fuel'), 60);
const places = [];
for (const p of raw.pois) {
  const pl = p.tags.place;
  if (!['neighbourhood', 'quarter', 'suburb', 'district', 'locality', 'square'].includes(pl)) continue;
  const x = toX(p.lon), z = toZ(p.lat);
  if (!inBox(x, z, 300)) continue;
  const n = nameOf(p.tags); if (!n) continue;
  places.push({ n, x: dm(x), z: dm(z), r: pl === 'district' || pl === 'suburb' ? 2 : pl === 'square' ? 0 : 1 });
}
const metroGroups = new Map();
for (const p of raw.pois) {
  if (p.tags.railway !== 'subway_entrance') continue;
  const n = nameOf(p.tags); if (!n) continue;
  const x = toX(p.lon), z = toZ(p.lat);
  if (!inPlay(x, z, -30)) continue;
  if (!metroGroups.has(n)) metroGroups.set(n, []);
  metroGroups.get(n).push([x, z]);
}
const metro = [...metroGroups.entries()].map(([n, ps]) => ({ n, e: ps.map((p) => [dm(p[0]), dm(p[1])]) }));
const busStops = raw.pois.filter((p) => p.tags.highway === 'bus_stop').map((p) => [toX(p.lon), toZ(p.lat)]).filter(([x, z]) => inBox(x, z, -20)).map(([x, z]) => [dm(x), dm(z)]);

// ------------------------------------------------------------------ write
const out = {
  version: 1,
  attribution: 'Map data © OpenStreetMap contributors (ODbL)',
  origin: { lat: LAT0, lon: LON0, mLat: M_LAT, mLon: M_LON },
  bounds: { minX: dm(play.minX), maxX: dm(play.maxX), minZ: dm(play.minZ), maxZ: dm(play.maxZ) },
  scenery: { minX: dm(box.minX), maxX: dm(box.maxX), minZ: dm(box.minZ), maxZ: dm(box.maxZ) },
  names,
  buildings: buildings.map(({ _ring, ...b }) => b),
  roads,
  plazas,
  water,
  waterways,
  greens,
  rails,
  trees: trees.flatMap((t) => [dm(t[0]), dm(t[1]), Math.round(t[2] * 100), t[3]]),
  graph: {
    nodes: gNodes.flatMap((n) => [dm(n.x), dm(n.z)]),
    main: Array.from(comp, (c) => (c === mainComp ? 1 : 0)),
    edges: edges.map((e) => [e.a, e.b, e.o, e.lf, e.lb, e.w, e.s, e.c, e.n, e.major, e.len, e.p]),
    signals: signalNodes.map((i) => [i, cluster.get(i)]),
  },
  landmarks: landmarks.map((l) => ({ id: l.id, n: l.name, x: dm(l.pos[0]), z: dm(l.pos[1]), h: l.height || 0, ...(l.ring ? { ring: l.ring } : {}) })),
  hospitals, police, carWashes, fuel, places, metro, busStops,
};
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`play area ${(play.maxX - play.minX).toFixed(0)} x ${(play.maxZ - play.minZ).toFixed(0)} m, origin ${LAT0.toFixed(5)},${LON0.toFixed(5)}`);
console.log(`buildings ${buildings.length} (solid ${solid.length}, parts rendered ${partRendered}, outlines replaced by parts ${outlineHidden})`);
console.log(`roads ${roads.length}, plazas ${plazas.length}, graph nodes ${gNodes.length}, edges ${edges.length}, main component ${compSizes[mainComp]} nodes, signals ${signalNodes.length} in ${clusterCount} junctions`);
console.log(`water ${water.length}, waterways ${waterways.length}, greens ${greens.length}, rails ${rails.length}, trees ${trees.length}`);
console.log(`hospitals ${hospitals.length}, police ${police.length}, car washes ${carWashes.length}, fuel ${fuel.length}, places ${places.length}, metro ${metro.length}, bus stops ${busStops.length}`);
console.log(`-> ${outPath} ${(fs.statSync(outPath).size / 1e6).toFixed(2)} MB`);
