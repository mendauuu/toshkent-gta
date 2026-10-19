// Extracts the features the game needs from an OpenStreetMap .osm.pbf file.
//
//   node tools/extract-osm.mjs <input.osm.pbf> <output.json> [minLat minLon maxLat maxLon]
//
// Input is a regional extract such as https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf
// Output is a cropped, tag-filtered JSON file that tools/build-map.mjs turns into game data.
// The PBF reader is self-contained (no dependencies) and supports zlib-compressed blobs.

import fs from 'node:fs';
import zlib from 'node:zlib';

const [, , inPath, outPath, ...bbArgs] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node tools/extract-osm.mjs <input.osm.pbf> <output.json> [minLat minLon maxLat maxLon]');
  process.exit(1);
}
const [MIN_LAT, MIN_LON, MAX_LAT, MAX_LON] = bbArgs.length === 4 ? bbArgs.map(Number) : [41.275, 69.205, 41.370, 69.325];

const KEEP_KEYS = new Set([
  'building', 'building:levels', 'building:min_level', 'height', 'min_height', 'roof:shape', 'roof:height',
  'roof:levels', 'roof:colour', 'building:colour', 'building:material', 'building:part',
  'name', 'name:uz', 'name:en', 'name:ru', 'highway', 'lanes', 'oneway', 'width', 'maxspeed', 'junction',
  'bridge', 'tunnel', 'layer', 'service', 'surface', 'waterway', 'natural', 'water', 'landuse', 'leisure',
  'amenity', 'religion', 'man_made', 'tower:type', 'railway', 'place', 'sport', 'area', 'tourism', 'historic',
  'shop', 'denotation', 'leaf_type', 'public_transport', 'type', 'crossing', 'healthcare', 'office', 'location',
]);
const AREA_KEYS = ['building', 'natural', 'landuse', 'leisure', 'amenity', 'waterway', 'water', 'man_made', 'place', 'tourism', 'historic'];

// ---------------------------------------------------------------- protobuf
class PB {
  constructor(buf, start, end) { this.buf = buf; this.pos = start; this.end = end; }
  varint() {
    const b = this.buf;
    let byte = b[this.pos++];
    let val = byte & 0x7f;
    if (byte < 0x80) return val;
    byte = b[this.pos++]; val |= (byte & 0x7f) << 7; if (byte < 0x80) return val;
    byte = b[this.pos++]; val |= (byte & 0x7f) << 14; if (byte < 0x80) return val;
    byte = b[this.pos++]; val |= (byte & 0x7f) << 21; if (byte < 0x80) return val;
    let mul = 268435456;
    do { byte = b[this.pos++]; val += (byte & 0x7f) * mul; mul *= 128; } while (byte >= 0x80);
    return val;
  }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) { const len = this.varint(); this.pos += len; }
    else if (wire === 5) this.pos += 4;
    else throw new Error('unsupported wire type ' + wire);
  }
  view() { const len = this.varint(); const s = this.pos; this.pos += len; return [s, s + len]; }
}
const zz = (n) => (n < 4294967296 ? ((n >>> 1) ^ -(n & 1)) : (n % 2 === 0 ? n / 2 : -(n + 1) / 2));

// ---------------------------------------------------------------- file blocks
const file = fs.readFileSync(inPath);
const blobs = [];
for (let off = 0; off < file.length;) {
  const hlen = file.readUInt32BE(off); off += 4;
  const h = new PB(file, off, off + hlen); off += hlen;
  let type = '', datasize = 0;
  while (h.pos < h.end) {
    const tag = h.varint(), f = tag >> 3;
    if (f === 1) { const [s, e] = h.view(); type = file.toString('utf8', s, e); }
    else if (f === 3) datasize = h.varint();
    else h.skip(tag & 7);
  }
  if (type === 'OSMData') blobs.push([off, off + datasize]);
  off += datasize;
}

function inflateBlob([start, end]) {
  const p = new PB(file, start, end);
  let raw = null, z = null;
  while (p.pos < p.end) {
    const tag = p.varint(), f = tag >> 3;
    if (f === 1) { const [s, e] = p.view(); raw = file.subarray(s, e); }
    else if (f === 3) { const [s, e] = p.view(); z = file.subarray(s, e); }
    else if (f >= 4 && f <= 7) throw new Error('unsupported blob compression field ' + f);
    else p.skip(tag & 7);
  }
  return raw || zlib.inflateSync(z);
}

function forEachBlock(handlers) {
  for (const blob of blobs) {
    const buf = inflateBlob(blob);
    const p = new PB(buf, 0, buf.length);
    let strings = null, gran = 100, latOff = 0, lonOff = 0;
    const groups = [];
    while (p.pos < p.end) {
      const tag = p.varint(), f = tag >> 3;
      if (f === 1) {
        const [s, e] = p.view();
        strings = [];
        const st = new PB(buf, s, e);
        while (st.pos < st.end) {
          const t = st.varint();
          if (t >> 3 === 1) { const [a, b] = st.view(); strings.push(buf.toString('utf8', a, b)); } else st.skip(t & 7);
        }
      } else if (f === 2) groups.push(p.view());
      else if (f === 17) gran = p.varint();
      else if (f === 19) latOff = p.varint();
      else if (f === 20) lonOff = p.varint();
      else p.skip(tag & 7);
    }
    for (const [s, e] of groups) {
      const g = new PB(buf, s, e);
      while (g.pos < g.end) {
        const tag = g.varint(), f = tag >> 3;
        if (f === 2 && handlers.dense) { const [a, b] = g.view(); readDense(buf, a, b, strings, gran, latOff, lonOff, handlers.dense); }
        else if (f === 1 && handlers.dense) { const [a, b] = g.view(); readNode(buf, a, b, strings, gran, latOff, lonOff, handlers.dense); }
        else if (f === 3 && handlers.way) { const [a, b] = g.view(); readWay(buf, a, b, strings, handlers.way); }
        else if (f === 4 && handlers.relation) { const [a, b] = g.view(); readRelation(buf, a, b, strings, handlers.relation); }
        else g.skip(tag & 7);
      }
    }
  }
}

const inBox = (lat, lon) => lat >= MIN_LAT && lat <= MAX_LAT && lon >= MIN_LON && lon <= MAX_LON;

function readDense(buf, s, e, strings, gran, latOff, lonOff, cb) {
  const p = new PB(buf, s, e);
  let ids, lats, lons, kv;
  while (p.pos < p.end) {
    const tag = p.varint(), f = tag >> 3;
    if (f === 1) ids = p.view(); else if (f === 8) lats = p.view(); else if (f === 9) lons = p.view();
    else if (f === 10) kv = p.view(); else p.skip(tag & 7);
  }
  const pi = new PB(buf, ids[0], ids[1]), pa = new PB(buf, lats[0], lats[1]), po = new PB(buf, lons[0], lons[1]);
  const pk = kv ? new PB(buf, kv[0], kv[1]) : null;
  let id = 0, la = 0, lo = 0;
  while (pi.pos < pi.end) {
    id += zz(pi.varint()); la += zz(pa.varint()); lo += zz(po.varint());
    const lat = 1e-9 * (latOff + gran * la), lon = 1e-9 * (lonOff + gran * lo);
    const inside = inBox(lat, lon);
    let tags = null;
    if (pk) {
      while (pk.pos < pk.end) {
        const k = pk.varint();
        if (k === 0) break;
        const v = pk.varint();
        if (inside && KEEP_KEYS.has(strings[k])) (tags ||= {})[strings[k]] = strings[v];
      }
    }
    if (inside) cb(id, lat, lon, tags);
  }
}

function readNode(buf, s, e, strings, gran, latOff, lonOff, cb) {
  const p = new PB(buf, s, e);
  let id = 0, la = 0, lo = 0, keys = null, vals = null;
  while (p.pos < p.end) {
    const tag = p.varint(), f = tag >> 3;
    if (f === 1) id = zz(p.varint()); else if (f === 8) la = zz(p.varint()); else if (f === 9) lo = zz(p.varint());
    else if (f === 2) keys = p.view(); else if (f === 3) vals = p.view(); else p.skip(tag & 7);
  }
  const lat = 1e-9 * (latOff + gran * la), lon = 1e-9 * (lonOff + gran * lo);
  if (!inBox(lat, lon)) return;
  let tags = null;
  if (keys) {
    const pk = new PB(buf, keys[0], keys[1]), pv = new PB(buf, vals[0], vals[1]);
    while (pk.pos < pk.end) { const k = strings[pk.varint()], v = strings[pv.varint()]; if (KEEP_KEYS.has(k)) (tags ||= {})[k] = v; }
  }
  cb(id, lat, lon, tags);
}

function readTags(buf, keys, vals, strings) {
  const tags = {};
  if (!keys) return tags;
  const pk = new PB(buf, keys[0], keys[1]), pv = new PB(buf, vals[0], vals[1]);
  while (pk.pos < pk.end) { const k = strings[pk.varint()], v = strings[pv.varint()]; if (KEEP_KEYS.has(k)) tags[k] = v; }
  return tags;
}

function readWay(buf, s, e, strings, cb) {
  const p = new PB(buf, s, e);
  let id = 0, keys = null, vals = null, refs = null;
  while (p.pos < p.end) {
    const tag = p.varint(), f = tag >> 3;
    if (f === 1) id = p.varint(); else if (f === 2) keys = p.view(); else if (f === 3) vals = p.view();
    else if (f === 8) refs = p.view(); else p.skip(tag & 7);
  }
  const refList = () => {
    const out = [];
    if (refs) { const pr = new PB(buf, refs[0], refs[1]); let r = 0; while (pr.pos < pr.end) { r += zz(pr.varint()); out.push(r); } }
    return out;
  };
  cb(id, () => readTags(buf, keys, vals, strings), refList);
}

function readRelation(buf, s, e, strings, cb) {
  const p = new PB(buf, s, e);
  let id = 0, keys = null, vals = null, roles = null, memids = null, types = null;
  while (p.pos < p.end) {
    const tag = p.varint(), f = tag >> 3;
    if (f === 1) id = p.varint(); else if (f === 2) keys = p.view(); else if (f === 3) vals = p.view();
    else if (f === 8) roles = p.view(); else if (f === 9) memids = p.view(); else if (f === 10) types = p.view();
    else p.skip(tag & 7);
  }
  const tags = readTags(buf, keys, vals, strings);
  const members = [];
  if (memids) {
    const pr = new PB(buf, roles[0], roles[1]), pm = new PB(buf, memids[0], memids[1]), pt = new PB(buf, types[0], types[1]);
    let ref = 0;
    while (pm.pos < pm.end) {
      ref += zz(pm.varint());
      members.push({ type: ['node', 'way', 'relation'][pt.varint()], ref, role: strings[pr.varint()] });
    }
  }
  cb(id, tags, members);
}

// ---------------------------------------------------------------- pass 1: relations
const t0 = Date.now();
const relations = [];
const neededWays = new Set();
forEachBlock({
  relation(id, tags, members) {
    if (tags.type !== 'multipolygon' && tags.type !== 'building') return;
    if (!AREA_KEYS.some((k) => k in tags) && !('building:part' in tags)) return;
    const wayMembers = members.filter((m) => m.type === 'way');
    if (!wayMembers.length) return;
    relations.push({ id, tags, members: wayMembers.map(({ ref, role }) => ({ ref, role })) });
    for (const m of wayMembers) neededWays.add(m.ref);
  },
});
console.log(`pass 1: ${blobs.length} blocks, ${relations.length} area relations (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// ---------------------------------------------------------------- pass 2: nodes + ways
const nodeIndex = new Map();
let nodeCoords = new Float64Array(1 << 20);
let nodeCount = 0;
const pois = [];
const ways = [];
const memberWays = new Map();
const isInteresting = (t) =>
  'building' in t || 'building:part' in t || 'highway' in t || 'waterway' in t || 'natural' in t || 'landuse' in t ||
  'leisure' in t || 'railway' in t || 'man_made' in t || 'amenity' in t || 'water' in t || 'tourism' in t || 'historic' in t;

forEachBlock({
  dense(id, lat, lon, tags) {
    if (nodeCount * 2 + 2 > nodeCoords.length) { const n = new Float64Array(nodeCoords.length * 2); n.set(nodeCoords); nodeCoords = n; }
    nodeIndex.set(id, nodeCount);
    nodeCoords[nodeCount * 2] = lat; nodeCoords[nodeCount * 2 + 1] = lon;
    nodeCount++;
    if (tags) pois.push({ id, lat: +lat.toFixed(7), lon: +lon.toFixed(7), tags });
  },
  way(id, getTags, getRefs) {
    const needed = neededWays.has(id);
    const tags = getTags();
    if (!needed && !isInteresting(tags)) return;
    const refs = getRefs();
    let found = 0;
    const coords = new Array(refs.length * 2);
    for (let i = 0; i < refs.length; i++) {
      const ni = nodeIndex.get(refs[i]);
      if (ni === undefined) { coords[i * 2] = null; coords[i * 2 + 1] = null; continue; }
      found++;
      coords[i * 2] = +nodeCoords[ni * 2].toFixed(7);
      coords[i * 2 + 1] = +nodeCoords[ni * 2 + 1].toFixed(7);
    }
    if (!found) return;
    const rec = { id, tags, coords };
    if ('highway' in tags || 'railway' in tags) rec.nodes = refs;
    if (needed) memberWays.set(id, rec);
    if (isInteresting(tags)) ways.push(rec);
  },
});

// keep relations with at least one member way inside the box; attach member geometry
const outRelations = [];
for (const r of relations) {
  const members = [];
  for (const m of r.members) {
    const w = memberWays.get(m.ref);
    if (w) members.push({ ref: m.ref, role: m.role, coords: w.coords });
  }
  if (members.length) outRelations.push({ id: r.id, tags: r.tags, members });
}

const out = { bbox: [MIN_LAT, MIN_LON, MAX_LAT, MAX_LON], source: 'OpenStreetMap contributors (ODbL)', ways, relations: outRelations, pois };
fs.writeFileSync(outPath, JSON.stringify(out));
const count = (pred) => ways.filter(pred).length;
console.log(`pass 2: ${nodeCount} nodes in box, ${ways.length} ways, ${outRelations.length} relations, ${pois.length} tagged nodes`);
console.log(`  buildings: ${count((w) => 'building' in w.tags)}, highways: ${count((w) => 'highway' in w.tags)}, waterways: ${count((w) => 'waterway' in w.tags)}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${outPath} (${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB)`);
