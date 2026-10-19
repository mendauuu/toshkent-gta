// Procedural low-poly vehicles typical for Tashkent streets, one merged geometry per type, in the
// cute pixel palette with flat toon shading.
// aMat: 0 fixed colour, 1 paint, 2 glass, 3 headlight, 4 taillight, 5 siren red, 6 siren blue, 7 chrome/trim
import * as THREE from 'three';
import { PAL } from '../world/palette.js';
import { TOON_RAMP } from '../world/materials.js';

const WHITE = PAL.white;
// same list lengths as before, so traffic picks paints with the same random draws
const COMMON = [WHITE, WHITE, WHITE, WHITE, WHITE, WHITE, WHITE, PAL.lilac, PAL.plum, PAL.blue, PAL.cream, PAL.coral, PAL.skyLt];

export const VTYPES = {
  kobalt: { name: 'Kobalt', body: 'sedan', L: 4.48, W: 1.74, H: 1.5, clear: 0.27, wheelR: 0.31, mass: 1200, maxSpeed: 47, accel: 7.4, brake: 15, grip: 7.5, steer: 0.62, health: 1000, colors: COMMON },
  neksiya: { name: 'Neksiya', body: 'sedan_old', L: 4.48, W: 1.66, H: 1.43, clear: 0.27, wheelR: 0.3, mass: 1100, maxSpeed: 43, accel: 6.6, brake: 13, grip: 7, steer: 0.62, health: 900, colors: [...COMMON, PAL.leaf, PAL.lime] },
  lasetti: { name: 'Lasetti', body: 'sedan', L: 4.52, W: 1.73, H: 1.45, clear: 0.27, wheelR: 0.31, mass: 1250, maxSpeed: 49, accel: 7.8, brake: 15, grip: 7.6, steer: 0.6, health: 1000, colors: COMMON },
  spark: { name: 'Spark', body: 'hatch', L: 3.64, W: 1.6, H: 1.52, clear: 0.25, wheelR: 0.29, mass: 950, maxSpeed: 41, accel: 6.9, brake: 14, grip: 7.8, steer: 0.68, health: 800, colors: [WHITE, WHITE, WHITE, PAL.coral, PAL.blue, PAL.mint, PAL.yellow, PAL.pink] },
  matiz: { name: 'Matiz', body: 'hatch_small', L: 3.5, W: 1.5, H: 1.5, clear: 0.24, wheelR: 0.27, mass: 800, maxSpeed: 36, accel: 5.8, brake: 13, grip: 7.4, steer: 0.7, health: 700, colors: [WHITE, WHITE, PAL.coral, PAL.blue, PAL.mint, PAL.cream, PAL.grass, PAL.pink] },
  damas: { name: 'Damas', body: 'van', L: 3.48, W: 1.4, H: 1.92, clear: 0.26, wheelR: 0.27, mass: 950, maxSpeed: 31, accel: 5.0, brake: 12, grip: 6.4, steer: 0.68, health: 850, colors: [WHITE, WHITE, WHITE, WHITE, PAL.skyLt, PAL.cream] },
  labo: { name: 'Labo', body: 'pickup', L: 3.48, W: 1.4, H: 1.85, clear: 0.26, wheelR: 0.27, mass: 900, maxSpeed: 32, accel: 5.0, brake: 12, grip: 6.5, steer: 0.68, health: 850, colors: [WHITE, WHITE, WHITE, PAL.lilac, PAL.blue] },
  malibu: { name: 'Malibu', body: 'sedan_big', L: 4.93, W: 1.85, H: 1.46, clear: 0.27, wheelR: 0.33, mass: 1500, maxSpeed: 55, accel: 8.6, brake: 16, grip: 8, steer: 0.58, health: 1100, colors: [WHITE, PAL.plum, PAL.plum, PAL.lilac, PAL.navy, PAL.slateLt] },
  treker: { name: 'Treker', body: 'suv', L: 4.27, W: 1.79, H: 1.68, clear: 0.36, wheelR: 0.35, mass: 1450, maxSpeed: 47, accel: 7.4, brake: 14, grip: 7.2, steer: 0.6, health: 1150, colors: [WHITE, WHITE, PAL.plum, PAL.berry, PAL.lilac, PAL.tealDk] },
  gentra: { name: 'Gentra', body: 'sedan', L: 4.5, W: 1.72, H: 1.45, clear: 0.27, wheelR: 0.31, mass: 1220, maxSpeed: 48, accel: 7.6, brake: 15, grip: 7.6, steer: 0.6, health: 1000, colors: COMMON },
  bus: { name: 'Avtobus', body: 'bus', L: 11.2, W: 2.5, H: 3.05, clear: 0.42, wheelR: 0.5, mass: 9500, maxSpeed: 22, accel: 2.8, brake: 9, grip: 6, steer: 0.62, health: 2600, colors: [PAL.blue, PAL.teal] },
  police: { name: 'Politsiya', body: 'sedan_big', livery: 'police', L: 4.93, W: 1.85, H: 1.46, clear: 0.27, wheelR: 0.33, mass: 1500, maxSpeed: 56, accel: 9.4, brake: 17, grip: 8.4, steer: 0.6, health: 1300, colors: [WHITE] },
  taxi: { name: 'Taksi', body: 'sedan', livery: 'taxi', L: 4.48, W: 1.74, H: 1.5, clear: 0.27, wheelR: 0.31, mass: 1200, maxSpeed: 47, accel: 7.4, brake: 15, grip: 7.5, steer: 0.62, health: 1000, colors: [PAL.yellow] },
  sport: { name: 'Samarqand GT', body: 'sport', L: 4.45, W: 1.95, H: 1.18, clear: 0.2, wheelR: 0.33, mass: 1350, maxSpeed: 72, accel: 13, brake: 20, grip: 9.5, steer: 0.56, health: 1000, colors: [PAL.coral, PAL.yellow, PAL.plum, PAL.sky, WHITE] },
};
export const TRAFFIC_MIX = [
  ['kobalt', 26], ['neksiya', 14], ['lasetti', 10], ['gentra', 9], ['spark', 12], ['matiz', 10], ['damas', 9], ['labo', 3],
  ['malibu', 5], ['treker', 5], ['taxi', 5],
];

class VB {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.mat = []; this.idx = []; }
  quad(a, b, c, d, color, mat, cx, cy, cz) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    const fx = (a[0] + c[0]) / 2 - cx, fy = (a[1] + c[1]) / 2 - cy, fz = (a[2] + c[2]) / 2 - cz;
    let order = [a, b, c, d];
    if (nx * fx + ny * fy + nz * fz < 0) { order = [a, d, c, b]; nx = -nx; ny = -ny; nz = -nz; }
    const base = this.pos.length / 3;
    const cl = new THREE.Color(color);
    for (const p of order) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz); this.col.push(cl.r, cl.g, cl.b); this.mat.push(mat); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // frustum box: bottom w0 x l0 at y0, top w1 x l1 at y0+h shifted by sz along z; all centred at (cx, cz)
  frustum(cx, y0, cz, w0, l0, w1, l1, h, sz, color, mat, opts = {}) {
    const y1 = y0 + h;
    const B = [[cx - w0 / 2, y0, cz - l0 / 2], [cx + w0 / 2, y0, cz - l0 / 2], [cx + w0 / 2, y0, cz + l0 / 2], [cx - w0 / 2, y0, cz + l0 / 2]];
    const T = [[cx - w1 / 2, y1, cz + sz - l1 / 2], [cx + w1 / 2, y1, cz + sz - l1 / 2], [cx + w1 / 2, y1, cz + sz + l1 / 2], [cx - w1 / 2, y1, cz + sz + l1 / 2]];
    const ccy = y0 + h / 2, ccz = cz + sz / 2;
    const m = (k) => (opts[k] !== undefined ? opts[k] : mat);
    const c = (k) => (opts[k + 'C'] !== undefined ? opts[k + 'C'] : color);
    if (!opts.noTop) this.quad(T[0], T[1], T[2], T[3], c('top'), m('top'), cx, ccy, ccz);
    if (!opts.noBottom) this.quad(B[0], B[1], B[2], B[3], c('bottom'), m('bottom'), cx, ccy, ccz);
    this.quad(B[3], B[2], T[2], T[3], c('front'), m('front'), cx, ccy, ccz);
    this.quad(B[0], B[1], T[1], T[0], c('back'), m('back'), cx, ccy, ccz);
    this.quad(B[0], B[3], T[3], T[0], c('side'), m('side'), cx, ccy, ccz);
    this.quad(B[1], B[2], T[2], T[1], c('side'), m('side'), cx, ccy, ccz);
  }
  box(cx, cy, cz, sx, sy, sz, color, mat) { this.frustum(cx, cy - sy / 2, cz, sx, sz, sx, sz, sy, 0, color, mat); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const TRIM = PAL.plum, PLATE = PAL.white, GRILLE = PAL.ink;

function lights(b, L, W, y, front = true, back = true, inset = 0.24, hw = 0.34) {
  if (front) { for (const s of [-1, 1]) b.box(s * (W / 2 - inset), y, L / 2 - 0.01, hw, 0.13, 0.05, 0xffffff, 3); }
  if (back) { for (const s of [-1, 1]) b.box(s * (W / 2 - inset), y + 0.04, -L / 2 + 0.01, hw * 0.9, 0.14, 0.05, PAL.coral, 4); }
}

function plates(b, L, y) {
  b.box(0, y, L / 2 + 0.015, 0.52, 0.12, 0.02, PLATE, 0);
  b.box(0, y + 0.08, -L / 2 - 0.015, 0.52, 0.12, 0.02, PLATE, 0);
}

function buildBody(t) {
  const b = new VB();
  const { L, W, H, clear: c0 } = t;
  switch (t.body) {
    case 'sedan':
    case 'sedan_old':
    case 'sedan_big': {
      const old = t.body === 'sedan_old';
      const belt = c0 + (old ? 0.6 : 0.64);
      b.frustum(0, c0, 0, W, L, W - 0.08, L - (old ? 0.05 : 0.18), belt - c0, 0, 0xffffff, 1);
      const cabL = L * (old ? 0.48 : 0.5), topL = L * (old ? 0.32 : 0.27);
      const cabZ = -L * 0.06;
      b.frustum(0, belt, cabZ, W - 0.14, cabL, W - (old ? 0.36 : 0.42), topL, H - belt - 0.05, old ? -0.05 : -0.12, 0xffffff, 2, { bottom: 2 });
      b.frustum(0, H - 0.05, cabZ + (old ? -0.05 : -0.12), W - (old ? 0.38 : 0.44), topL + 0.02, W - (old ? 0.4 : 0.48), topL - 0.06, 0.05, 0, 0xffffff, 1);
      b.box(0, c0 + 0.12, L / 2 - 0.02, W - 0.02, 0.2, 0.08, TRIM, 7);
      b.box(0, c0 + 0.12, -L / 2 + 0.02, W - 0.02, 0.2, 0.08, TRIM, 7);
      b.box(0, belt - 0.2, L / 2 - 0.01, W * 0.38, 0.16, 0.04, GRILLE, 0);
      for (const s of [-1, 1]) b.box(s * (W / 2 + 0.06), belt + 0.06, cabZ + cabL / 2 - 0.12, 0.12, 0.09, 0.16, 0xffffff, 1);
      lights(b, L, W, belt - 0.14, true, true, 0.25, old ? 0.3 : 0.36);
      plates(b, L, c0 + 0.22);
      break;
    }
    case 'hatch':
    case 'hatch_small': {
      const belt = c0 + 0.62;
      b.frustum(0, c0, 0, W, L, W - 0.08, L - 0.14, belt - c0, 0, 0xffffff, 1);
      const cabL = L * 0.64, topL = L * 0.42;
      b.frustum(0, belt, -L * 0.1, W - 0.14, cabL, W - 0.36, topL, H - belt - 0.05, -0.12, 0xffffff, 2, { bottom: 2 });
      b.frustum(0, H - 0.05, -L * 0.1 - 0.12, W - 0.38, topL + 0.02, W - 0.42, topL - 0.04, 0.05, 0, 0xffffff, 1);
      b.box(0, c0 + 0.12, L / 2 - 0.02, W - 0.02, 0.2, 0.08, TRIM, 7);
      b.box(0, c0 + 0.12, -L / 2 + 0.02, W - 0.02, 0.2, 0.08, TRIM, 7);
      b.box(0, belt - 0.18, L / 2 - 0.01, W * 0.34, 0.12, 0.04, GRILLE, 0);
      for (const s of [-1, 1]) b.box(s * (W / 2 + 0.05), belt + 0.06, L * 0.1, 0.1, 0.08, 0.14, 0xffffff, 1);
      lights(b, L, W, belt - 0.12, true, true, 0.22, 0.3);
      plates(b, L, c0 + 0.22);
      break;
    }
    case 'suv': {
      const belt = c0 + 0.7;
      b.frustum(0, c0, 0, W, L, W - 0.06, L - 0.12, belt - c0, 0, 0xffffff, 1);
      b.frustum(0, belt, -L * 0.08, W - 0.12, L * 0.62, W - 0.3, L * 0.5, H - belt - 0.06, -0.08, 0xffffff, 2, { bottom: 2 });
      b.frustum(0, H - 0.06, -L * 0.08 - 0.08, W - 0.3, L * 0.52, W - 0.34, L * 0.48, 0.06, 0, 0xffffff, 1);
      for (const s of [-1, 1]) b.box(s * (W / 2 - 0.05), H + 0.02, -L * 0.1, 0.06, 0.05, L * 0.45, TRIM, 7);
      b.box(0, c0 + 0.12, L / 2 - 0.02, W, 0.24, 0.1, TRIM, 7);
      b.box(0, c0 + 0.12, -L / 2 + 0.02, W, 0.24, 0.1, TRIM, 7);
      b.box(0, belt - 0.2, L / 2 - 0.01, W * 0.5, 0.18, 0.04, GRILLE, 0);
      lights(b, L, W, belt - 0.14, true, true, 0.26, 0.36);
      plates(b, L, c0 + 0.24);
      break;
    }
    case 'van': {
      const belt = c0 + 0.78;
      b.frustum(0, c0, 0, W, L, W - 0.04, L - 0.05, belt - c0, -0.02, 0xffffff, 1);
      b.frustum(0, belt, -0.05, W - 0.06, L - 0.12, W - 0.1, L - 0.42, H - belt - 0.16, -0.12, 0xffffff, 2, { bottom: 2, back: 1 });
      b.frustum(0, H - 0.16, -0.17, W - 0.1, L - 0.42, W - 0.12, L - 0.5, 0.16, 0, 0xffffff, 1);
      // pillars between side windows
      for (const z of [-0.9, 0.2]) for (const s of [-1, 1]) b.box(s * (W / 2 - 0.04), (belt + H - 0.16) / 2, z, 0.04, H - belt - 0.2, 0.1, 0xffffff, 1);
      b.box(0, c0 + 0.08, L / 2 - 0.02, W, 0.16, 0.08, TRIM, 7);
      b.box(0, c0 + 0.08, -L / 2 + 0.02, W, 0.16, 0.08, TRIM, 7);
      lights(b, L, W, c0 + 0.5, true, true, 0.2, 0.26);
      plates(b, L, c0 + 0.26);
      break;
    }
    case 'pickup': {
      const belt = c0 + 0.78;
      b.frustum(0, c0, 0, W, L, W - 0.04, L - 0.05, belt - c0, -0.02, 0xffffff, 1);
      const cabZ = L / 2 - 0.62;
      b.frustum(0, belt, cabZ, W - 0.06, 1.15, W - 0.1, 0.85, H - belt - 0.14, -0.12, 0xffffff, 2, { bottom: 2, back: 1 });
      b.frustum(0, H - 0.14, cabZ - 0.12, W - 0.1, 0.85, W - 0.12, 0.8, 0.14, 0, 0xffffff, 1);
      // open bed walls
      const bedL = L - 1.3, bz = -L / 2 + bedL / 2;
      for (const s of [-1, 1]) b.box(s * (W / 2 - 0.03), belt + 0.2, bz, 0.06, 0.4, bedL, 0xffffff, 1);
      b.box(0, belt + 0.2, -L / 2 + 0.03, W, 0.4, 0.06, 0xffffff, 1);
      b.box(0, belt + 0.02, bz, W - 0.1, 0.04, bedL, PAL.slate, 0);
      lights(b, L, W, c0 + 0.5, true, true, 0.2, 0.26);
      plates(b, L, c0 + 0.26);
      break;
    }
    case 'bus': {
      const belt = c0 + 0.85;
      b.frustum(0, c0, 0, W, L, W, L, belt - c0, 0, 0xffffff, 1);
      b.frustum(0, belt, 0, W, L, W - 0.04, L - 0.1, 1.45, -0.02, 0xffffff, 2, { bottom: 2 });
      b.frustum(0, belt + 1.45, -0.02, W - 0.04, L - 0.1, W - 0.14, L - 0.3, H - belt - 1.45, 0, PAL.cloud, 0);
      for (let z = -L / 2 + 1.5; z < L / 2 - 1; z += 1.6) for (const s of [-1, 1]) b.box(s * (W / 2 - 0.02), belt + 0.72, z, 0.05, 1.4, 0.12, PAL.cloud, 0);
      b.box(0, c0 + 0.15, L / 2, W, 0.3, 0.1, TRIM, 7);
      b.box(0, c0 + 0.15, -L / 2, W, 0.3, 0.1, TRIM, 7);
      b.box(0, belt + 1.62, L / 2 + 0.02, W * 0.7, 0.24, 0.04, PAL.ink, 0);
      lights(b, L, W, c0 + 0.55, true, true, 0.3, 0.3);
      break;
    }
    case 'sport': {
      const belt = c0 + 0.5;
      b.frustum(0, c0, 0, W, L, W - 0.12, L - 0.35, belt - c0, -0.05, 0xffffff, 1);
      b.frustum(0, belt, -0.25, W - 0.3, L * 0.45, W - 0.62, L * 0.2, H - belt - 0.03, -0.25, 0xffffff, 2, { bottom: 2 });
      b.frustum(0, H - 0.03, -0.5, W - 0.62, L * 0.2, W - 0.64, L * 0.18, 0.03, 0, 0xffffff, 1);
      b.box(0, belt + 0.18, -L / 2 + 0.15, W - 0.2, 0.05, 0.3, PAL.ink, 7); // spoiler
      for (const s of [-1, 1]) b.box(s * (W / 2 - 0.3), belt + 0.08, -L / 2 + 0.2, 0.06, 0.16, 0.06, PAL.ink, 7);
      b.box(0, c0 + 0.1, L / 2 - 0.03, W - 0.05, 0.16, 0.08, PAL.ink, 7);
      lights(b, L, W, belt - 0.08, true, true, 0.3, 0.42);
      break;
    }
  }
  // liveries
  if (t.livery === 'police') {
    const roofY = t.H + 0.02;
    b.box(-0.32, roofY + 0.08, -L * 0.13, 0.62, 0.14, 0.26, PAL.coral, 5);
    b.box(0.32, roofY + 0.08, -L * 0.13, 0.62, 0.14, 0.26, PAL.blue, 6);
    for (const s of [-1, 1]) b.box(s * (W / 2 + 0.005), t.clear + 0.42, 0, 0.02, 0.2, L * 0.86, PAL.blue, 0);
    b.box(0, t.clear + 0.62, L / 2 + 0.005, W * 0.5, 0.06, 0.02, PAL.blue, 0);
  } else if (t.livery === 'taxi') {
    b.box(0, t.H + 0.12, -L * 0.13, 0.6, 0.2, 0.24, PAL.yellow, 3);
    for (const s of [-1, 1]) for (let k = 0; k < 10; k++) b.box(s * (W / 2 + 0.005), t.clear + 0.45 + (k % 2) * 0.09, -L * 0.36 + k * L * 0.08, 0.02, 0.09, L * 0.08, k % 2 ? PAL.ink : PAL.white, 0);
  }
  return b.build();
}

const geoCache = new Map();
export function vehicleGeometry(typeId) {
  if (!geoCache.has(typeId)) geoCache.set(typeId, buildBody(VTYPES[typeId]));
  return geoCache.get(typeId);
}

export function wheelGeometry() {
  const tire = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
  tire.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.58, 0.58, 1.04, 8, 1);
  hub.rotateZ(Math.PI / 2);
  const parts = [[tire, PAL.ink], [hub, PAL.lilac]];
  const pos = [], nrm = [], col = [], idx = [];
  const c = new THREE.Color();
  for (const [g, hex] of parts) {
    const base = pos.length / 3;
    c.set(hex);
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
    for (const i of g.index.array) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// toon body material: paint, sky-blue glass and lights that glow at night or when braking
export function makeVehicleMaterial() {
  const u = {
    uPaint: { value: new THREE.Color(0xffffff) }, uHead: { value: 0 }, uBrake: { value: 0 }, uRev: { value: 0 },
    uSirenR: { value: 0 }, uSirenB: { value: 0 }, uDamage: { value: 0 },
  };
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_RAMP });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMat;\nvarying float vMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMat;\nuniform vec3 uPaint;\nuniform float uHead, uBrake, uRev, uSirenR, uSirenB, uDamage;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float mt = floor(vMat + 0.5);
        if (mt == 1.0) diffuseColor.rgb *= mix(uPaint, uPaint * 0.2 + vec3(0.02, 0.012, 0.03), uDamage);
        if (mt == 2.0) diffuseColor.rgb = mix(vec3(0.16, 0.5, 0.82), vec3(0.03, 0.02, 0.05), uDamage);
        if (mt == 3.0 || mt == 4.0) diffuseColor.rgb *= 0.75;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (mt == 3.0) totalEmissiveRadiance += vec3(1.0, 0.94, 0.7) * (0.06 + uHead * 2.0);
        if (mt == 4.0) totalEmissiveRadiance += vec3(1.0, 0.1, 0.05) * (0.08 + uHead * 0.6 + uBrake * 2.0) + vec3(1.0) * uRev * 1.2;
        if (mt == 5.0) totalEmissiveRadiance += vec3(1.0, 0.1, 0.06) * (0.1 + uSirenR * 4.0);
        if (mt == 6.0) totalEmissiveRadiance += vec3(0.1, 0.3, 1.0) * (0.1 + uSirenB * 4.0);`);
  };
  mat.customProgramCacheKey = () => 'vehicle';
  mat.userData.u = u;
  return mat;
}
