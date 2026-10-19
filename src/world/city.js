// Builds the static city from OpenStreetMap data: ground layers, roads, markings, buildings,
// trees and street furniture, grouped in chunks for distance culling.
import * as THREE from 'three';
import { FloatBuf, IndexBuf, ringArea, ringCentroid, mulberry32 } from '../util/math.js';
import {
  makeGroundMaterial, makeMarkingMaterial, makeWaterMaterial, makeBuildingMaterial, makeFoliageMaterial, sharedUniforms, toon, hideBeyond,
} from './materials.js';
import { PAL, wallColor, roofColor } from './palette.js';

export const CHUNK = 300;
const STYLE_PARAMS = [null, { bay: 3.6, floor: 3.0 }, { bay: 3.0, floor: 2.9 }, { bay: 1.6, floor: 3.6 }, { bay: 3.2, floor: 3.6 }, { bay: 6.0, floor: 6.5 }];
export const ORDER = { ground: -30, green: -29, plaza: -28, water: -27, rail: -26, sidewalk: -25, path: -24, road: -23, marking: -22, decal: -21, shadow: -20 };
// palette colours (see palette.js): road classes 0-4, green kinds, plaza kinds
const ROAD_COLORS = [PAL.slate, PAL.slate, 0x67658f, PAL.cream, PAL.apricotLt];
const GREEN_COLORS = [PAL.grass, PAL.leaf, 0x9bdb55, PAL.mint, PAL.apricotLt];
const PLAZA_COLORS = [0xf2dfc0, 0x6c6a94];
const tmpC = new THREE.Color();
const v3 = new THREE.Vector3();
const col = (hex) => new THREE.Color(hex);
// yield to the event loop so the loading screen can repaint (works even when the window is hidden)
export const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------- geometry builders
class FlatBuilder {
  constructor(dash = false) {
    this.pos = new FloatBuf(4096); this.col = new FloatBuf(4096); this.idx = new IndexBuf(4096);
    this.dash = dash ? new FloatBuf(2048) : null; this.vc = 0;
  }
  vert(x, y, z, c, du = 0, dt = 0) {
    this.pos.push3(x, y, z); this.col.push3(c.r, c.g, c.b);
    if (this.dash) this.dash.push2(du, dt);
    return this.vc++;
  }
  triUp(a, b, c) {
    const p = this.pos.a;
    const ux = p[b * 3] - p[a * 3], uz = p[b * 3 + 2] - p[a * 3 + 2], vx = p[c * 3] - p[a * 3], vz = p[c * 3 + 2] - p[a * 3 + 2];
    if (uz * vx - ux * vz >= 0) this.idx.push3(a, b, c); else this.idx.push3(a, c, b);
  }
  get empty() { return this.idx.n === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.array(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.array(), 3));
    const n = new Float32Array(this.vc * 3);
    for (let i = 0; i < this.vc; i++) n[i * 3 + 1] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    if (this.dash) g.setAttribute('aDash', new THREE.BufferAttribute(this.dash.array(), 2));
    g.setIndex(new THREE.BufferAttribute(this.idx.array(), 1));
    g.computeBoundingSphere();
    return g;
  }
}

class SolidBuilder {
  constructor() {
    this.pos = new FloatBuf(8192); this.nrm = new FloatBuf(8192); this.col = new FloatBuf(8192);
    this.win = new FloatBuf(8192); this.sty = new FloatBuf(4096); this.idx = new IndexBuf(8192); this.vc = 0;
  }
  vert(x, y, z, nx, ny, nz, c, wu = 0, wv = 0, wf = 0, st = 0, seed = 0, shade = 1) {
    this.pos.push3(x, y, z); this.nrm.push3(nx, ny, nz); this.col.push3(c.r * shade, c.g * shade, c.b * shade);
    this.win.push3(wu, wv, wf); this.sty.push2(st, seed);
    return this.vc++;
  }
  // triangle with flat normal oriented along hint
  tri(a, b, c, color, hx, hy, hz) {
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * hx + ny * hy + nz * hz < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
    const i = this.vert(a[0], a[1], a[2], nx, ny, nz, color), j = this.vert(b[0], b[1], b[2], nx, ny, nz, color), k = this.vert(c[0], c[1], c[2], nx, ny, nz, color);
    this.idx.push3(i, j, k);
  }
  get empty() { return this.idx.n === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.array(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.array(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.array(), 3));
    g.setAttribute('aWin', new THREE.BufferAttribute(this.win.array(), 3));
    g.setAttribute('aStyle', new THREE.BufferAttribute(this.sty.array(), 2));
    g.setIndex(new THREE.BufferAttribute(this.idx.array(), 1));
    g.computeBoundingSphere();
    return g;
  }
}

// triangulate a polygon (flat ring + holes) -> {verts:[x,z,...], tris:[i,j,k,...]}
function triangulate(ring, holes = []) {
  const contour = [], hv = [];
  for (let i = 0; i < ring.length; i += 2) contour.push(new THREE.Vector2(ring[i], ring[i + 1]));
  for (const h of holes) { const a = []; for (let i = 0; i < h.length; i += 2) a.push(new THREE.Vector2(h[i], h[i + 1])); hv.push(a); }
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, hv); } catch { return null; }
  const all = contour.concat(...hv);
  return { pts: all, faces };
}

function fillPolygon(B, ring, holes, y, c) {
  const t = triangulate(ring, holes);
  if (!t) return;
  const base = B.vc;
  for (const p of t.pts) B.vert(p.x, y, p.y, c);
  for (const f of t.faces) B.triUp(base + f[0], base + f[1], base + f[2]);
}

// polyline ribbon with mitred joins; lateral offset `off` (+ = right of travel); u = distance along
function ribbon(B, pts, hw, y, c, off = 0, dashType = -1) {
  const n = pts.length / 2;
  if (n < 2) return;
  let pl = -1, pr = -1, u = 0;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    let ax = 0, az = 0, bx = 0, bz = 0;
    if (i > 0) { ax = x - pts[i * 2 - 2]; az = z - pts[i * 2 - 1]; const l = Math.hypot(ax, az) || 1; u += l; ax /= l; az /= l; }
    if (i < n - 1) { bx = pts[i * 2 + 2] - x; bz = pts[i * 2 + 3] - z; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
    if (i === 0) { ax = bx; az = bz; }
    if (i === n - 1) { bx = ax; bz = az; }
    let nx = -(az + bz), nz = ax + bx;
    let nl = Math.hypot(nx, nz);
    if (nl < 1e-6) { nx = -bz; nz = bx; nl = 1; }
    nx /= nl; nz /= nl;
    const cosh = Math.max(0.4, nx * -bz + nz * bx);
    const ml = 1 / cosh;
    const cx = x + nx * off * ml, cz = z + nz * off * ml;
    const L = B.vert(cx - nx * hw * ml, y, cz - nz * hw * ml, c, u, dashType);
    const R = B.vert(cx + nx * hw * ml, y, cz + nz * hw * ml, c, u, dashType);
    if (i > 0) { B.triUp(pl, pr, R); B.triUp(pl, R, L); }
    pl = L; pr = R;
  }
}

function disc(B, x, z, r, y, c, seg = 10) {
  const ctr = B.vert(x, y, z, c);
  let prev = -1, first = -1;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const v = B.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r, c);
    if (prev >= 0) B.triUp(ctr, prev, v); else first = v;
    prev = v;
  }
  B.triUp(ctr, prev, first);
}

// split long polylines so chunk culling stays tight
function splitPolyline(pts, maxLen) {
  const out = [];
  let cur = [pts[0], pts[1]], len = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const l = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    cur.push(pts[i], pts[i + 1]);
    len += l;
    if (len > maxLen && i < pts.length - 2) { out.push(Float32Array.from(cur)); cur = [pts[i], pts[i + 1]]; len = 0; }
  }
  if (cur.length >= 4) out.push(Float32Array.from(cur));
  return out;
}

// ---------------------------------------------------------------------- chunks
class Chunk {
  constructor(ix, iz, cx, cz) {
    this.ix = ix; this.iz = iz; this.cx = cx; this.cz = cz;
    this.layers = {}; // name -> FlatBuilder
    this.solid = null; // SolidBuilder
    this.trees = []; // [x, z, s, type]
    this.lamps = []; // [x, z, heading]
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.treeGroup = new THREE.Group();
    this.treeGroup.matrixAutoUpdate = false;
    this.center = new THREE.Vector3(cx, 0, cz);
    this.radius = CHUNK;
  }
  layer(name, dash = false) { return this.layers[name] || (this.layers[name] = new FlatBuilder(dash)); }
  solidB() { return this.solid || (this.solid = new SolidBuilder()); }
}

export class City {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.data = game.map;
    this.graph = game.graph;
    this.collision = game.collision;
    this.settings = game.settings;
    const s = this.data.scenery;
    this.minX = s.minX; this.minZ = s.minZ;
    this.cnx = Math.ceil((s.maxX - s.minX) / CHUNK);
    this.cnz = Math.ceil((s.maxZ - s.minZ) / CHUNK);
    this.chunks = new Array(this.cnx * this.cnz);
    this.chunkList = [];
    const ground = makeGroundMaterial();
    this.materials = {
      ground, green: ground, plaza: ground, sidewalk: ground, road: ground,
      water: makeWaterMaterial(),
      marking: makeMarkingMaterial(),
      building: makeBuildingMaterial(false),
      skyline: makeBuildingMaterial(true),
      foliage: makeFoliageMaterial(true),
      trunk: toon({ color: PAL.brown }),
    };
    this.lampHeads = null;
    this.signalHeads = [];
    this.skylineMeshes = [];
    this.stats = { tris: 0 };
  }

  chunkAt(x, z) {
    const ix = Math.min(this.cnx - 1, Math.max(0, Math.floor((x - this.minX) / CHUNK)));
    const iz = Math.min(this.cnz - 1, Math.max(0, Math.floor((z - this.minZ) / CHUNK)));
    const k = iz * this.cnx + ix;
    let c = this.chunks[k];
    if (!c) {
      c = this.chunks[k] = new Chunk(ix, iz, this.minX + (ix + 0.5) * CHUNK, this.minZ + (iz + 0.5) * CHUNK);
      this.chunkList.push(c);
    }
    return c;
  }

  async build(progress) {
    const steps = [
      ['Laying the ground…', () => this.buildGround()],
      ['Planting parks and gardens…', () => this.buildGreens()],
      ['Filling the Anhor and Bo‘zsuv canals…', () => this.buildWater()],
      ['Paving the streets…', () => this.buildRoads()],
      ['Painting road markings…', () => this.buildMarkings()],
      ['Raising 24 000 buildings…', () => this.buildBuildings()],
      ['Growing trees along the avenues…', () => this.buildTrees()],
      ['Installing street lights…', () => this.buildLamps()],
      ['Wiring traffic lights…', () => this.buildSignals()],
      ['Bus stops and metro entrances…', () => this.buildStops()],
      ['Uploading geometry…', () => this.finishChunks()],
    ];
    for (let i = 0; i < steps.length; i++) {
      progress(i / steps.length, steps[i][0]);
      await yieldFrame();
      await steps[i][1]();
    }
    progress(1, 'Ready');
  }

  // ------------------------------------------------------------------ ground
  buildGround() {
    const s = this.data.scenery;
    const pad = 4000;
    const g = new THREE.PlaneGeometry(s.maxX - s.minX + pad * 2, s.maxZ - s.minZ + pad * 2, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((s.minX + s.maxX) / 2, 0, (s.minZ + s.maxZ) / 2);
    const c = col(0xb3dd6a);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const m = new THREE.Mesh(g, this.materials.ground);
    m.renderOrder = ORDER.ground;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.scene.add(m);
    this.groundMesh = m;
  }

  buildGreens() {
    for (const g of this.data.greens) {
      const [cx, cz] = ringCentroid(g.ring);
      const c = col(GREEN_COLORS[g.kind] ?? GREEN_COLORS[0]);
      fillPolygon(this.chunkAt(cx, cz).layer('green'), g.ring, g.holes, 0, c);
    }
    for (const p of this.data.plazas) {
      const [cx, cz] = ringCentroid(p.ring);
      fillPolygon(this.chunkAt(cx, cz).layer('plaza'), p.ring, p.holes, 0, col(PLAZA_COLORS[p.kind]));
    }
  }

  buildWater() {
    const c = col(0xffffff);
    for (const w of this.data.water) {
      const [cx, cz] = ringCentroid(w.ring);
      fillPolygon(this.chunkAt(cx, cz).layer('water'), w.ring, w.holes, 0, c);
    }
    for (const w of this.data.waterways) {
      for (const piece of splitPolyline(w.pts, 160)) {
        const m = piece.length >> 1;
        const B = this.chunkAt(piece[(m >> 1) * 2], piece[(m >> 1) * 2 + 1]).layer('water');
        ribbon(B, piece, w.w / 2, 0, c);
        disc(B, piece[0], piece[1], w.w / 2, 0, c, 8);
      }
    }
    const rc = col(PAL.brownDk), steel = col(PAL.lilac);
    for (const r of this.data.rails) {
      for (const piece of splitPolyline(r.pts, 160)) {
        const m = piece.length >> 1;
        const ch = this.chunkAt(piece[(m >> 1) * 2], piece[(m >> 1) * 2 + 1]);
        ribbon(ch.layer('rail'), piece, 1.7, 0, rc);
        ribbon(ch.layer('marking', true), piece, 0.12, 0, steel, -0.72);
        ribbon(ch.layer('marking', true), piece, 0.12, 0, steel, 0.72);
      }
    }
  }

  // ------------------------------------------------------------------ roads
  buildRoads() {
    const sideC = col(0xf2d9c4), curb = col(PAL.cloud);
    const colors = ROAD_COLORS.map(col);
    for (const r of this.data.roads) {
      const pieces = splitPolyline(r.pts, 150);
      for (const piece of pieces) {
        const m = piece.length >> 1;
        const ch = this.chunkAt(piece[(m >> 1) * 2], piece[(m >> 1) * 2 + 1]);
        const hw = r.w / 2;
        if (r.cls <= 1) {
          // sidewalks + curb under major streets
          const sw = ch.layer('sidewalk');
          ribbon(sw, piece, hw + 3.2, 0, sideC);
          disc(sw, piece[0], piece[1], hw + 3.2, 0, sideC, 10);
          disc(sw, piece[piece.length - 2], piece[piece.length - 1], hw + 3.2, 0, sideC, 10);
          ribbon(sw, piece, hw + 0.35, 0, curb);
        }
        const layer = r.cls >= 3 ? ch.layer('path') : ch.layer('road');
        const c = colors[r.cls] || colors[2];
        ribbon(layer, piece, hw, 0, c);
        if (r.cls <= 2) {
          disc(layer, piece[0], piece[1], hw, 0, c, r.cls === 0 ? 12 : 8);
          disc(layer, piece[piece.length - 2], piece[piece.length - 1], hw, 0, c, r.cls === 0 ? 12 : 8);
        }
      }
    }
  }

  buildMarkings() {
    const G = this.graph;
    // lines are drawn 2-3x wider than real paint so they stay at least 2 pixels wide until the
    // marking shader hides them in the distance
    const white = col(PAL.white), worn = col(PAL.cloud);
    const trimAt = (n, ei) => {
      if (G.degree(n) < 3) return 0;
      let m = 0;
      for (const ej of G.nodeEdges[n]) if (ej !== ei) m = Math.max(m, G.edges[ej].w / 2);
      return m + 2.2;
    };
    const sub = (e, s0, s1) => {
      const out = [];
      const p = { x: 0, z: 0 };
      // collect polyline between arc lengths s0..s1 (from a)
      const cum = e.cum, pts = e.pts;
      const at = (s) => { let i = 0; while (i < cum.length - 2 && cum[i + 1] < s) i++; const f = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]); p.x = pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * f; p.z = pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * f; return p; };
      at(s0); out.push(p.x, p.z);
      for (let i = 1; i < cum.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i * 2], pts[i * 2 + 1]);
      at(s1); out.push(p.x, p.z);
      return Float32Array.from(out);
    };
    for (let ei = 0; ei < G.edges.length; ei++) {
      const e = G.edges[ei];
      if (e.cls > 1 || e.w < 5.5) continue;
      const ta = trimAt(e.a, ei), tb = trimAt(e.b, ei);
      if (e.len - ta - tb < 5) continue;
      const pts = sub(e, ta, e.len - tb);
      const mid = pts.length >> 2 << 1;
      const B = this.chunkAt(pts[mid], pts[mid + 1]).layer('marking', true);
      const c = e.major ? white : worn;
      if (e.oneway) {
        const lw = e.w / e.lf;
        for (let k = 1; k < e.lf; k++) ribbon(B, pts, 0.18, 0, c, -e.w / 2 + lw * k, 1);
        if (e.major && e.w > 7) { ribbon(B, pts, 0.16, 0, c, -e.w / 2 + 0.55, 0); ribbon(B, pts, 0.16, 0, c, e.w / 2 - 0.55, 0); }
      } else {
        if (e.major && e.w >= 9) ribbon(B, pts, 0.22, 0, c, 0, 0);
        else ribbon(B, pts, 0.18, 0, c, 0, 1);
        const lw = Math.min(3.7, e.w / Math.max(2, e.lf + e.lb));
        for (let k = 1; k < e.lf; k++) ribbon(B, pts, 0.18, 0, c, lw * k, 1);
        for (let k = 1; k < e.lb; k++) ribbon(B, pts, 0.18, 0, c, -lw * k, 1);
      }
      // stop lines and zebra crossings at signalised junctions
      for (const [n, dir] of [[e.b, 1], [e.a, -1]]) {
        if (G.signal[n] < 0 || !G.canTravel(ei, dir)) continue;
        const stop = G.stopDist(n, ei);
        if (stop + 2 > e.len) continue;
        const p = G.pointAt(ei, e.len - stop, dir, {});
        const rx = -p.tz, rz = p.tx;
        const half = e.w / 2;
        const from = e.oneway ? -half : 0;
        const a0x = p.x + rx * from, a0z = p.z + rz * from, a1x = p.x + rx * half, a1z = p.z + rz * half;
        ribbon(B, Float32Array.from([a0x, a0z, a1x, a1z]), 0.3, 0, white, 0, 0);
        // zebra between stop line and junction
        const zx = p.x + p.tx * 2.4, zz = p.z + p.tz * 2.4;
        const z0x = zx - rx * half, z0z = zz - rz * half, z1x = zx + rx * half, z1z = zz + rz * half;
        ribbon(B, Float32Array.from([z0x, z0z, z1x, z1z]), 1.5, 0, white, 0, 2);
      }
    }
  }

  // ------------------------------------------------------------------ buildings
  async buildBuildings() {
    const list = this.data.buildings;
    this.skyline = new SolidBuilder();
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.solid) this.collision.addBuilding(b.ring, b.holes, b.h + b.roofH * 0.5);
      if (!b.render) continue;
      const [cx, cz] = ringCentroid(b.ring);
      const B = b.h + b.roofH > 55 ? this.skyline : this.chunkAt(cx, cz).solidB();
      this.addBuilding(B, b, i, cx, cz);
      if ((i & 2047) === 2047) await yieldFrame();
    }
  }

  addBuilding(B, b, seedIdx, cx, cz) {
    const sp = STYLE_PARAMS[b.style];
    const h = b.h, y0 = b.minH;
    const seed = (seedIdx * 0.6180339) % 1 * 50;
    const wall = col(wallColor(b.color, seed));
    const roofC = col(roofColor(b.roofColor, seed + 0.37, b.roof));
    const floors = sp ? Math.max(1, Math.floor((h - 0.4) / sp.floor)) : 0;
    const rings = [b.ring, ...b.holes];
    for (const r of rings) {
      const m = r.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const nx = dz / len, nz = -dx / len;
        const nWin = sp ? Math.round(len / sp.bay) : 0;
        const fl = sp ? sp.floor : 1;
        const st = sp ? b.style : 0;
        const v0 = B.vert(ax, y0, az, nx, 0, nz, wall, 0, y0 / fl, floors, st, seed);
        const v1 = B.vert(bx, y0, bz, nx, 0, nz, wall, nWin, y0 / fl, floors, st, seed);
        const v2 = B.vert(bx, h, bz, nx, 0, nz, wall, nWin, h / fl, floors, st, seed);
        const v3 = B.vert(ax, h, az, nx, 0, nz, wall, 0, h / fl, floors, st, seed);
        B.idx.push3(v0, v2, v1);
        B.idx.push3(v0, v3, v2);
      }
    }
    // roof
    const flat = () => {
      const t = triangulate(b.ring, b.holes);
      if (!t) return;
      const base = B.vc;
      for (const p of t.pts) B.vert(p.x, h, p.y, 0, 1, 0, roofC);
      for (const f of t.faces) {
        const a = base + f[0], c1 = base + f[1], c2 = base + f[2];
        const p = B.pos.a;
        const ux = p[c1 * 3] - p[a * 3], uz = p[c1 * 3 + 2] - p[a * 3 + 2], vx = p[c2 * 3] - p[a * 3], vz = p[c2 * 3 + 2] - p[a * 3 + 2];
        if (uz * vx - ux * vz >= 0) B.idx.push3(a, c1, c2); else B.idx.push3(a, c2, c1);
      }
      if (y0 > 0.2) {
        const base2 = B.vc;
        for (const p of t.pts) B.vert(p.x, y0, p.y, 0, -1, 0, wall, 0, 0, 0, 0, 0, 0.7);
        for (const f of t.faces) {
          const a = base2 + f[0], c1 = base2 + f[1], c2 = base2 + f[2];
          const p = B.pos.a;
          const ux = p[c1 * 3] - p[a * 3], uz = p[c1 * 3 + 2] - p[a * 3 + 2], vx = p[c2 * 3] - p[a * 3], vz = p[c2 * 3 + 2] - p[a * 3 + 2];
          if (uz * vx - ux * vz >= 0) B.idx.push3(a, c2, c1); else B.idx.push3(a, c1, c2);
        }
      }
    };
    const ring = b.ring, n = ring.length / 2;
    const rh = b.roofH;
    if ((b.roof === 1 || b.roof === 2) && n === 4 && rh > 0.2) {
      let q = [0, 1, 2, 3].map((i) => [ring[i * 2], ring[i * 2 + 1]]);
      const e0 = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), e1 = Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]);
      if (e1 > e0) q = [q[1], q[2], q[3], q[0]];
      const L = Math.max(e0, e1), W = Math.min(e0, e1);
      const m03 = [(q[3][0] + q[0][0]) / 2, (q[3][1] + q[0][1]) / 2], m12 = [(q[1][0] + q[2][0]) / 2, (q[1][1] + q[2][1]) / 2];
      const dl = Math.hypot(m12[0] - m03[0], m12[1] - m03[1]) || 1;
      const ux = (m12[0] - m03[0]) / dl, uz = (m12[1] - m03[1]) / dl;
      const inset = b.roof === 1 ? Math.min(W / 2, L / 2 - 0.05) : 0;
      const ry = h + rh;
      const R0 = [m03[0] + ux * inset, ry, m03[1] + uz * inset], R1 = [m12[0] - ux * inset, ry, m12[1] - uz * inset];
      const P = q.map((p) => [p[0], h, p[1]]);
      const out = (pts) => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[2]; } x /= pts.length; z /= pts.length; const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
      const slope = (a, b2, c2, d) => { const [ox, oz] = out([a, b2, c2, d]); B.tri(a, b2, c2, roofC, ox, 1.2, oz); B.tri(a, c2, d, roofC, ox, 1.2, oz); };
      slope(P[0], P[1], R1, R0);
      slope(P[2], P[3], R0, R1);
      if (b.roof === 1) {
        let [ox, oz] = out([P[1], P[2], R1]); B.tri(P[1], P[2], R1, roofC, ox, 1.2, oz);
        [ox, oz] = out([P[3], P[0], R0]); B.tri(P[3], P[0], R0, roofC, ox, 1.2, oz);
      } else {
        let [ox, oz] = out([P[1], P[2], R1]); B.tri(P[1], P[2], R1, wall, ox, 0, oz);
        [ox, oz] = out([P[3], P[0], R0]); B.tri(P[3], P[0], R0, wall, ox, 0, oz);
      }
      if (y0 > 0.2) flat();
      return;
    }
    flat();
    if (b.roof === 3 && rh > 0.2) {
      const area = Math.abs(ringArea(ring));
      const R = Math.sqrt(area / Math.PI) * 0.92;
      const rings = 7, seg = 18;
      const base = B.vc;
      for (let i = 0; i <= rings; i++) {
        const th = (i / rings) * Math.PI / 2;
        const rr = R * Math.cos(th), y = h + rh * Math.sin(th);
        for (let k = 0; k <= seg; k++) {
          const a = (k / seg) * Math.PI * 2;
          const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
          let nx = (x - cx) / (R * R), ny = (y - h) / (rh * rh), nz = (z - cz) / (R * R);
          const l = Math.hypot(nx, ny, nz) || 1;
          B.vert(x, y, z, nx / l, ny / l, nz / l, roofC);
        }
      }
      for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) {
        const a = base + i * (seg + 1) + k, b2 = a + seg + 1;
        B.idx.push3(a, b2, a + 1);
        B.idx.push3(a + 1, b2, b2 + 1);
      }
      // little golden finial
      const gold = col(PAL.gold);
      const tip = [cx, h + rh + Math.max(0.6, rh * 0.18), cz];
      for (let k = 0; k < 4; k++) {
        const a0 = (k / 4) * Math.PI * 2, a1 = ((k + 1) / 4) * Math.PI * 2, rr = Math.max(0.12, R * 0.04);
        B.tri([cx + Math.cos(a0) * rr, h + rh - 0.05, cz + Math.sin(a0) * rr], [cx + Math.cos(a1) * rr, h + rh - 0.05, cz + Math.sin(a1) * rr], tip, gold, Math.cos(a0 + 0.78), 0.3, Math.sin(a0 + 0.78));
      }
    } else if ((b.roof === 4 || b.roof === 1 || b.roof === 2) && rh > 0.2) {
      const apex = [cx, h + rh, cz];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = [ring[i * 2], h + 0.01, ring[i * 2 + 1]], c2 = [ring[j * 2], h + 0.01, ring[j * 2 + 1]];
        const mx = (a[0] + c2[0]) / 2 - cx, mz = (a[2] + c2[2]) / 2 - cz, l = Math.hypot(mx, mz) || 1;
        B.tri(a, c2, apex, roofC, mx / l, 1, mz / l);
      }
    }
  }

  // ------------------------------------------------------------------ trees
  buildTrees() {
    const t = this.data.trees;
    const quality = this.settings.quality;
    const keep = quality === 'low' ? 0.45 : quality === 'medium' ? 0.8 : 1;
    const rnd = mulberry32(99);
    for (let i = 0; i < t.length; i += 4) {
      const x = t[i], z = t[i + 1], s = t[i + 2], type = t[i + 3];
      if (rnd() > keep) continue;
      this.collision.addCircle(x, z, 0.28 * s + 0.06, 6);
      this.chunkAt(x, z).trees.push(x, z, s, type);
    }
  }

  // ------------------------------------------------------------------ street lights
  buildLamps() {
    const G = this.graph;
    this.lampData = [];
    for (let ei = 0; ei < G.edges.length; ei++) {
      const e = G.edges[ei];
      if (e.cls > 1) continue;
      const spacing = e.major ? 32 : 44;
      const sides = e.major || !e.oneway ? [1, -1] : [1];
      const p = { x: 0, z: 0, tx: 0, tz: 0 };
      for (const side of sides) {
        const startOff = side > 0 ? 6 : 6 + spacing / 2;
        for (let s = startOff; s < e.len - 6; s += spacing) {
          G.pointAt(ei, s, 1, p);
          const rx = -p.tz * side, rz = p.tx * side;
          const off = e.w / 2 + 0.7;
          const x = p.x + rx * off, z = p.z + rz * off;
          if (this.collision.insideBuilding(x, z)) continue;
          // face the road: arm points from pole toward road centre
          const heading = Math.atan2(-rx, -rz);
          this.chunkAt(x, z).lamps.push(x, z, heading);
          this.collision.addCircle(x, z, 0.16, 8);
          this.lampData.push(x, z);
        }
      }
    }
  }

  // ------------------------------------------------------------------ traffic lights
  buildSignals() {
    const G = this.graph;
    const heads = [];
    const p = {};
    for (const n of G.signalNodes) {
      for (const ei of G.nodeEdges[n]) {
        const e = G.edges[ei];
        const dir = e.b === n ? 1 : -1;
        if (!G.canTravel(ei, dir)) continue;
        const stop = G.stopDist(n, ei);
        if (stop + 1 > e.len) continue;
        G.pointAt(ei, e.len - stop, dir, p);
        const rx = -p.tz, rz = p.tx;
        const off = e.w / 2 + 0.6;
        const x = p.x + rx * off, z = p.z + rz * off;
        heads.push({ x, z, heading: Math.atan2(-p.tx, -p.tz), node: n, edge: ei, armLen: Math.min(e.w * 0.5, 5) });
        this.collision.addCircle(x, z, 0.18, 6);
      }
    }
    this.signalHeads = heads;
    if (!heads.length) return;
    // pole + arm + housing as one geometry, lamps as a separate instanced mesh; chunky enough to stay
    // 2+ pixels wide, and hidden in the distance where they would shrink to stray pixels
    const poleGeo = mergeBoxes([
      [0, 2.6, 0, 0.3, 5.2, 0.3, PAL.plum],
      [-1.4, 5.0, 0, 2.8, 0.24, 0.24, PAL.plum],
      [-2.6, 4.25, 0.05, 0.5, 1.3, 0.36, PAL.ink],
      [0, 2.7, 0.05, 0.44, 1.1, 0.32, PAL.ink],
    ]);
    const poles = new THREE.InstancedMesh(poleGeo, hideBeyond(toon({ vertexColors: true }), 110, 'signal'), heads.length);
    const lampGeo = new THREE.BoxGeometry(0.32, 0.3, 0.1);
    const lamps = new THREE.InstancedMesh(lampGeo, hideBeyond(new THREE.MeshBasicMaterial(), 110, 'signal-lamp'), heads.length * 6);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    heads.forEach((h, i) => {
      q.setFromAxisAngle(up, h.heading);
      m.compose(v.set(h.x, 0, h.z), q, s);
      poles.setMatrixAt(i, m);
      // lamps on the arm housing (local x=-2.6) and on the pole housing (local x=0), facing +z
      const local = [[-2.6, 4.62], [-2.6, 4.25], [-2.6, 3.88], [0, 3.04], [0, 2.7], [0, 2.36]];
      local.forEach(([lx, ly], k) => {
        v.set(lx, ly, 0.24).applyQuaternion(q);
        m.compose(v.add(new THREE.Vector3(h.x, 0, h.z)), q, s);
        lamps.setMatrixAt(i * 6 + k, m);
        lamps.setColorAt(i * 6 + k, tmpC.set(0x111111));
      });
    });
    poles.castShadow = true;
    poles.receiveShadow = true;
    this.scene.add(poles, lamps);
    this.signalPoles = poles;
    this.signalLamps = lamps;
    this.signalTimer = 0;
  }

  updateSignals(time) {
    if (!this.signalLamps) return;
    const G = this.graph;
    const RED = [new THREE.Color(0xff4a3a), new THREE.Color(0x5a2030)];
    const YEL = [new THREE.Color(0xffd23a), new THREE.Color(0x5a4630)];
    const GRN = [new THREE.Color(0x4dff7a), new THREE.Color(0x20503a)];
    this.signalHeads.forEach((h, i) => {
      const st = G.signalState(h.node, h.edge, time);
      for (let k = 0; k < 2; k++) {
        this.signalLamps.setColorAt(i * 6 + k * 3, st === 2 ? RED[0] : RED[1]);
        this.signalLamps.setColorAt(i * 6 + k * 3 + 1, st === 1 ? YEL[0] : YEL[1]);
        this.signalLamps.setColorAt(i * 6 + k * 3 + 2, st === 0 ? GRN[0] : GRN[1]);
      }
    });
    this.signalLamps.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ bus stops & metro
  buildStops() {
    const G = this.graph;
    const shelters = [];
    const p = {};
    for (const [bx, bz] of this.data.busStops) {
      const near = G.nearest(bx, bz, 30);
      if (!near) continue;
      G.pointAt(near.ei, near.s, 1, p);
      const e = G.edges[near.ei];
      const rx = -p.tz, rz = p.tx;
      let side = Math.sign((bx - near.x) * rx + (bz - near.z) * rz);
      if (Math.abs((bx - near.x) * rx + (bz - near.z) * rz) < 1.5 || side === 0) side = 1;
      const off = e.w / 2 + 2.3;
      const x = near.x + rx * side * off, z = near.z + rz * side * off;
      if (this.collision.insideBuilding(x, z)) continue;
      const heading = Math.atan2(-rx * side, -rz * side);
      shelters.push({ x, z, heading });
      const ax = Math.cos(heading) * 1.7, az = -Math.sin(heading) * 1.7;
      this.collision.addCircle(x + ax - Math.sin(heading) * 0.6, z + az - Math.cos(heading) * 0.6, 0.3, 3);
      this.collision.addCircle(x - ax - Math.sin(heading) * 0.6, z - az - Math.cos(heading) * 0.6, 0.3, 3);
    }
    this.busStops = shelters;
    if (shelters.length) {
      const geo = mergeBoxes([
        [0, 2.45, 0, 3.6, 0.2, 1.7, PAL.blue],
        [0, 1.3, -0.75, 3.5, 2.2, 0.1, PAL.skyLt],
        [1.75, 1.2, -0.7, 0.2, 2.4, 0.2, PAL.navy],
        [-1.75, 1.2, -0.7, 0.2, 2.4, 0.2, PAL.navy],
        [0, 0.45, -0.45, 2.6, 0.16, 0.42, PAL.brown],
        [1.2, 2.8, 0.5, 0.9, 0.45, 0.1, PAL.leaf],
      ]);
      const mesh = new THREE.InstancedMesh(geo, toon({ vertexColors: true }), shelters.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(1, 1, 1);
      shelters.forEach((sh, i) => { q.setFromAxisAngle(up, sh.heading); m.compose(new THREE.Vector3(sh.x, 0, sh.z), q, s); mesh.setMatrixAt(i, m); });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    // metro entrances: blue "M" signs
    const signs = [];
    for (const st of this.data.metro) for (const [x, z] of st.entrances) {
      const [fx, fz] = this.collision.findOutside(x, z, 12);
      signs.push({ x: fx, z: fz, name: st.name });
      this.collision.addCircle(fx, fz, 0.18, 4);
    }
    this.metroSigns = signs;
    if (signs.length) {
      // 16x16 pixel-art "M" sign, point-sampled
      const M = ['................', '.##############.', '.#............#.', '.#.##......##.#.', '.#.###....###.#.', '.#.####..####.#.', '.#.##.####.##.#.',
        '.#.##..##..##.#.', '.#.##......##.#.', '.#.##......##.#.', '.#.##......##.#.', '.#.##......##.#.', '.#.##......##.#.', '.#............#.', '.##############.', '................'];
      const cnv = document.createElement('canvas');
      cnv.width = cnv.height = 16;
      const g = cnv.getContext('2d');
      M.forEach((row, y) => [...row].forEach((ch, x) => { g.fillStyle = ch === '#' ? '#ffffff' : '#3a8fe0'; g.fillRect(x, y, 1, 1); }));
      const tex = new THREE.CanvasTexture(cnv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      const signGeo = new THREE.BoxGeometry(1.1, 1.1, 0.2);
      signGeo.translate(0, 3.1, 0);
      const postGeo = new THREE.BoxGeometry(0.22, 2.7, 0.22);
      postGeo.translate(0, 1.35, 0);
      const signMesh = new THREE.InstancedMesh(signGeo, toon({ map: tex, emissive: 0x10306a, emissiveIntensity: 0.4 }), signs.length);
      const postMesh = new THREE.InstancedMesh(postGeo, toon({ color: PAL.navy }), signs.length);
      const m = new THREE.Matrix4();
      signs.forEach((sg, i) => { m.makeRotationY((i * 1.3) % Math.PI); m.setPosition(sg.x, 0, sg.z); signMesh.setMatrixAt(i, m); postMesh.setMatrixAt(i, m); });
      this.scene.add(signMesh, postMesh);
      this.metroSignMat = signMesh.material;
    }
  }

  // ------------------------------------------------------------------ meshes
  finishChunks() {
    const M = this.materials;
    const layerDefs = [
      ['green', M.green, ORDER.green], ['plaza', M.plaza, ORDER.plaza], ['water', M.water, ORDER.water],
      ['rail', M.road, ORDER.rail], ['sidewalk', M.sidewalk, ORDER.sidewalk], ['path', M.sidewalk, ORDER.path],
      ['road', M.road, ORDER.road], ['marking', M.marking, ORDER.marking],
    ];
    // tree templates: round crowns with smooth normals (clean toon bands, no facet lines), chunky trunks
    const trunkGeo = new THREE.CylinderGeometry(0.26, 0.36, 1, 6, 1, true);
    trunkGeo.translate(0, 0.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1, this.settings.quality === 'high' ? 1 : 0);
    const cp = crownGeo.attributes.position, cn = crownGeo.attributes.normal;
    for (let i = 0; i < cp.count; i++) { v3.set(cp.getX(i), cp.getY(i), cp.getZ(i)).normalize(); cn.setXYZ(i, v3.x, v3.y, v3.z); }
    const coneGeo = new THREE.ConeGeometry(1, 1, 8, 1);
    coneGeo.translate(0, 0.5, 0);
    const lampGeo = mergeBoxes([
      [0, 4.1, 0, 0.3, 8.2, 0.3, PAL.plum],
      [0, 8.1, 0.9, 0.2, 0.2, 1.8, PAL.plum],
    ]);
    const bulbGeo = new THREE.BoxGeometry(0.6, 0.24, 0.36);
    bulbGeo.translate(0, 7.95, 1.75);
    const lampMat = hideBeyond(toon({ vertexColors: true }), 75, 'lamp');
    this.bulbMat = hideBeyond(new THREE.MeshBasicMaterial({ color: 0x777777 }), 75, 'bulb');
    const poolGeo = new THREE.CircleGeometry(5.5, 16);
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.translate(0, 0, 2.6);
    this.poolMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: radialTexture() });
    const greens = [PAL.leaf, PAL.grass, 0x5cc24f, 0x43a047, PAL.leaf];
    const autumn = [PAL.apricot, PAL.orange, PAL.yellow, PAL.gold];
    const poplar = [PAL.grass, 0x9bdb55, PAL.lime, PAL.yellow];
    const conifer = [PAL.forest, 0x2a8a5a, 0x267a4c];
    const rnd = mulberry32(7);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let tris = 0;
    for (const ch of this.chunkList) {
      for (const [name, mat, order] of layerDefs) {
        const B = ch.layers[name];
        if (!B || B.empty) continue;
        const mesh = new THREE.Mesh(B.geometry(), mat);
        mesh.renderOrder = order;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        ch.group.add(mesh);
        tris += B.idx.n / 3;
        ch.layers[name] = null;
      }
      if (ch.solid && !ch.solid.empty) {
        const mesh = new THREE.Mesh(ch.solid.geometry(), M.building);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        ch.group.add(mesh);
        tris += ch.solid.idx.n / 3;
        ch.buildingMesh = mesh;
        ch.solid = null;
      }
      // trees
      const T = ch.trees;
      const count = T.length / 4;
      if (count) {
        let nRound = 0, nCone = 0;
        for (let i = 0; i < count; i++) if (T[i * 4 + 3] === 3) nCone++; else nRound++;
        const trunks = new THREE.InstancedMesh(trunkGeo, M.trunk, count);
        const crowns = nRound ? new THREE.InstancedMesh(crownGeo, M.foliage, nRound) : null;
        const cones = nCone ? new THREE.InstancedMesh(coneGeo, M.foliage, nCone) : null;
        let ir = 0, ic = 0;
        for (let i = 0; i < count; i++) {
          const x = T[i * 4], z = T[i * 4 + 1], s = T[i * 4 + 2], type = T[i * 4 + 3];
          q.setFromAxisAngle(up, rnd() * 6.28);
          const trunkH = [3.0, 2.2, 1.4, 1.6][type] * s;
          m4.compose(v.set(x, 0, z), q, sc.set(s, trunkH, s));
          trunks.setMatrixAt(i, m4);
          if (type === 3) {
            m4.compose(v.set(x, trunkH * 0.7, z), q, sc.set(1.9 * s, 6.5 * s, 1.9 * s));
            cones.setMatrixAt(ic, m4);
            cones.setColorAt(ic++, tmpC.set(conifer[Math.floor(rnd() * conifer.length)]));
          } else {
            const dims = type === 0 ? [3.1, 2.6, 3.1, 4.4] : type === 1 ? [1.25, 5.2, 1.25, 6.0] : [1.7, 1.5, 1.7, 2.6];
            const j = 0.85 + rnd() * 0.3;
            m4.compose(v.set(x, dims[3] * s, z), q, sc.set(dims[0] * s * j, dims[1] * s * (0.9 + rnd() * 0.2), dims[2] * s * j));
            crowns.setMatrixAt(ir, m4);
            const pal = type === 1 ? poplar : rnd() < 0.14 ? autumn : greens;
            crowns.setColorAt(ir++, tmpC.set(pal[Math.floor(rnd() * pal.length)]));
          }
        }
        for (const im of [trunks, crowns, cones]) {
          if (!im) continue;
          im.castShadow = this.settings.quality === 'high';
          im.receiveShadow = false;
          im.computeBoundingSphere();
          ch.treeGroup.add(im);
          tris += (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3 * im.count;
        }
        ch.trees = null;
      }
      // street lamps
      const L = ch.lamps;
      const nl = L.length / 3;
      if (nl) {
        const poles = new THREE.InstancedMesh(lampGeo, lampMat, nl);
        const bulbs = new THREE.InstancedMesh(bulbGeo, this.bulbMat, nl);
        const pools = new THREE.InstancedMesh(poolGeo, this.poolMat, nl);
        for (let i = 0; i < nl; i++) {
          m4.makeRotationY(L[i * 3 + 2]);
          m4.setPosition(L[i * 3], 0, L[i * 3 + 1]);
          poles.setMatrixAt(i, m4);
          bulbs.setMatrixAt(i, m4);
          m4.setPosition(L[i * 3], 0.02, L[i * 3 + 1]);
          pools.setMatrixAt(i, m4);
        }
        poles.castShadow = true;
        pools.renderOrder = ORDER.decal;
        for (const im of [poles, bulbs, pools]) { im.computeBoundingSphere(); ch.group.add(im); }
        ch.pools = pools;
        ch.lamps = null;
      }
      // bounding sphere for culling: union of children
      const box = new THREE.Box3();
      for (const c of [...ch.group.children, ...ch.treeGroup.children]) {
        if (c.geometry.boundingSphere === null) c.geometry.computeBoundingSphere();
        if (c.isInstancedMesh) { if (!c.boundingSphere) c.computeBoundingSphere(); const s = c.boundingSphere; box.expandByPoint(s.center.clone().addScalar(s.radius)); box.expandByPoint(s.center.clone().addScalar(-s.radius)); }
        else { const s = c.geometry.boundingSphere; box.expandByPoint(s.center.clone().addScalar(s.radius)); box.expandByPoint(s.center.clone().addScalar(-s.radius)); }
      }
      if (!box.isEmpty()) {
        box.getCenter(ch.center);
        ch.radius = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
      }
      this.scene.add(ch.group, ch.treeGroup);
    }
    if (!this.skyline.empty) {
      const mesh = new THREE.Mesh(this.skyline.geometry(), M.skyline);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.skylineMesh = mesh;
      tris += this.skyline.idx.n / 3;
    }
    this.skyline = null;
    this.stats.tris = tris;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, camera, drawDistance, night) {
    const cx = camera.position.x, cz = camera.position.z;
    const treeDist = drawDistance * 0.72;
    for (const ch of this.chunkList) {
      const d = Math.hypot(ch.center.x - cx, ch.center.z - cz) - ch.radius;
      ch.group.visible = d < drawDistance;
      ch.treeGroup.visible = d < treeDist;
    }
    // night lighting of street furniture
    const nl = night;
    this.bulbMat.color.setRGB(0.35 + nl * 2.6, 0.33 + nl * 2.0, 0.3 + nl * 1.1);
    this.poolMat.opacity = nl * 0.5;
    this.poolMat.visible = nl > 0.02;
    if (this.metroSignMat) this.metroSignMat.emissiveIntensity = 0.3 + nl * 1.4;
  }
}

// ---------------------------------------------------------------------- helpers
// merge axis-aligned boxes [x, y, z, sx, sy, sz, color] into one geometry with vertex colors
export function mergeBoxes(list) {
  const pos = [], nrm = [], colr = [], idx = [];
  const c = new THREE.Color();
  for (const [x, y, z, sx, sy, sz, hex] of list) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    const base = pos.length / 3;
    c.set(hex);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nrm.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) colr.push(c.r, c.g, c.b);
    for (const i of g.index.array) idx.push(base + i);
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// round blob in three hard rings (blob shadows, lamp pools, headlight glow), point-sampled
let radialTex = null;
export function radialTexture() {
  if (radialTex) return radialTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const r = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16;
    const a = r < 0.42 ? 1 : r < 0.72 ? 0.62 : r < 0.98 ? 0.3 : 0;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(x, y, 1, 1);
  }
  radialTex = new THREE.CanvasTexture(c);
  radialTex.magFilter = radialTex.minFilter = THREE.NearestFilter;
  radialTex.generateMipmaps = false;
  return radialTex;
}

export { sharedUniforms };
