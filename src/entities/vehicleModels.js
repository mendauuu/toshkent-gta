// Procedural toy cars typical for Tashkent streets: soft chamfered bodies, bubbly cabins, big
// wheels and headlight "eyes", one merged geometry per type, in the cute pixel palette. Physics
// sizes (L, W, H, clearance, wheel radius) are unchanged; only the drawing is toy-like.
// aMat: 0 fixed colour, 1 paint, 2 glass, 3 headlight, 4 taillight, 5 siren red, 6 siren blue, 7 chrome/trim
import * as THREE from 'three';
import { PAL } from '../world/palette.js';
import { TOON_RAMP } from '../world/materials.js';
import { PolyBuf, bevelBox } from '../util/shapes.js';

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

// drawn wheels are this much bigger than the physics wheel radius (toy look); see vehicle.js
export const TOY_WHEEL = 1.28;

class VB {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.mat = []; this.idx = []; this.c = new THREE.Color(); }
  // append a PolyBuf; colour and material can depend on the face normal (e.g. glass sides, painted roof)
  add(P, color, mat) {
    const base = this.pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      const n = [P.nrm[i * 3], P.nrm[i * 3 + 1], P.nrm[i * 3 + 2]];
      this.c.set(typeof color === 'function' ? color(n) : color);
      this.pos.push(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]); this.nrm.push(n[0], n[1], n[2]);
      this.col.push(this.c.r, this.c.g, this.c.b); this.mat.push(typeof mat === 'function' ? mat(n) : mat);
    }
    for (const i of P.idx) this.idx.push(base + i);
  }
  // soft (chamfered) box; opt.top / opt.topZ taper the upper half, opt.shift slides it along z
  soft(x, y, z, sx, sy, sz, r, color, mat, opt = {}) {
    const P = bevelBox(new PolyBuf(), x, y, z, sx, sy, sz, r);
    if (opt.top !== undefined || opt.shift) {
      const kx = opt.top ?? 1, kz = opt.topZ ?? kx;
      for (let i = 0; i < P.count; i++) {
        if (P.pos[i * 3 + 1] <= y) continue;
        const f = (P.pos[i * 3 + 1] - y) / (sy / 2);
        P.pos[i * 3] = x + (P.pos[i * 3] - x) * (1 + (kx - 1) * f);
        P.pos[i * 3 + 2] = z + (P.pos[i * 3 + 2] - z) * (1 + (kz - 1) * f) + (opt.shift || 0) * f;
      }
    }
    const roof = (n) => n[1] > 0.6;
    this.add(P, opt.roofColor !== undefined ? (n) => (roof(n) ? opt.roofColor : color) : color, opt.roofMat !== undefined ? (n) => (roof(n) ? opt.roofMat : mat) : mat);
  }
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

const TRIM = PAL.plum, PLATE = PAL.white, INK = PAL.ink;

// headlight "eyes" (white with a dark pupil looking slightly inward) above a little smile
function face(b, L, W, y, eye = 0.3, smileY = null) {
  for (const s of [-1, 1]) {
    const ex = s * (W / 2 - eye * 0.85);
    b.soft(ex, y, L / 2 - 0.02, eye, eye * 0.78, 0.07, 0.05, 0xffffff, 3);
    b.soft(ex - s * eye * 0.12, y - eye * 0.04, L / 2 + 0.018, eye * 0.42, eye * 0.46, 0.02, 0, INK, 0);
  }
  const sy = smileY ?? y - eye * 0.75;
  b.soft(0, sy, L / 2 + 0.005, W * 0.24, 0.05, 0.03, 0, INK, 0);
  for (const s of [-1, 1]) b.soft(s * W * 0.14, sy + 0.035, L / 2 + 0.005, 0.05, 0.06, 0.03, 0, INK, 0);
}

function tail(b, L, W, y, w = 0.3) {
  for (const s of [-1, 1]) b.soft(s * (W / 2 - w * 0.8), y, -L / 2 + 0.02, w, w * 0.6, 0.06, 0.04, PAL.coral, 4);
  b.soft(0, y - 0.12, -L / 2 - 0.01, 0.48, 0.12, 0.02, 0, PLATE, 0);
}

function bumpers(b, L, W, y) {
  b.soft(0, y, L / 2 - 0.04, W - 0.04, 0.2, 0.16, 0.07, TRIM, 7);
  b.soft(0, y, -L / 2 + 0.04, W - 0.04, 0.2, 0.16, 0.07, TRIM, 7);
}

function buildBody(t) {
  const b = new VB();
  const { L, W, H } = t;
  const c = t.clear + 0.06; // sits a little higher over the bigger toy wheels
  const BW = W - 0.12; // body slightly narrower so the chunky wheels show at the sides
  switch (t.body) {
    case 'sedan':
    case 'sedan_old':
    case 'sedan_big': {
      const belt = c + (t.body === 'sedan_old' ? 0.56 : 0.6);
      b.soft(0, (c + belt) / 2, 0, BW, belt - c, L - 0.06, 0.16, 0xffffff, 1);
      const cabL = L * (t.body === 'sedan_big' ? 0.5 : 0.54);
      b.soft(0, (belt + H) / 2 - 0.01, -L * 0.07, BW - 0.12, H - belt + 0.02, cabL, 0.13, 0xffffff, 2, { top: 0.84, topZ: 0.72, roofColor: 0xffffff, roofMat: 1 });
      bumpers(b, L, BW, c + 0.1);
      face(b, L, BW, belt - 0.17);
      tail(b, L, BW, belt - 0.16);
      for (const s of [-1, 1]) b.soft(s * (BW / 2 + 0.05), belt + 0.08, -L * 0.07 + cabL / 2 - 0.1, 0.1, 0.09, 0.14, 0.02, 0xffffff, 1);
      break;
    }
    case 'hatch':
    case 'hatch_small': {
      const belt = c + 0.58;
      b.soft(0, (c + belt) / 2, 0, BW, belt - c, L - 0.06, 0.16, 0xffffff, 1);
      b.soft(0, (belt + H) / 2 - 0.01, -L * 0.1, BW - 0.1, H - belt + 0.02, L * 0.66, 0.14, 0xffffff, 2, { top: 0.84, topZ: 0.8, shift: -0.06, roofColor: 0xffffff, roofMat: 1 });
      bumpers(b, L, BW, c + 0.1);
      face(b, L, BW, belt - 0.16, 0.28);
      tail(b, L, BW, belt - 0.14, 0.26);
      break;
    }
    case 'suv': {
      const belt = c + 0.66;
      b.soft(0, (c + belt) / 2, 0, BW, belt - c, L - 0.06, 0.15, 0xffffff, 1);
      b.soft(0, (belt + H) / 2, -L * 0.08, BW - 0.1, H - belt, L * 0.66, 0.12, 0xffffff, 2, { top: 0.9, topZ: 0.86, roofColor: 0xffffff, roofMat: 1 });
      for (const s of [-1, 1]) b.soft(s * (BW / 2 - 0.12), H + 0.04, -L * 0.1, 0.07, 0.06, L * 0.45, 0.02, TRIM, 7);
      bumpers(b, L, BW, c + 0.12);
      face(b, L, BW, belt - 0.18, 0.32);
      tail(b, L, BW, belt - 0.16);
      break;
    }
    case 'van': {
      // Damas: a tall one-box marshrutka with a big friendly face
      const belt = c + 0.7;
      b.soft(0, (c + belt) / 2, 0, BW, belt - c, L - 0.04, 0.15, 0xffffff, 1);
      b.soft(0, (belt + H) / 2, -0.04, BW - 0.04, H - belt, L - 0.12, 0.15, 0xffffff, 2, { top: 0.94, topZ: 0.86, roofColor: 0xffffff, roofMat: 1 });
      for (const z of [-0.85, 0.25]) for (const s of [-1, 1]) b.soft(s * (BW / 2 - 0.01), (belt + H) / 2 - 0.04, z, 0.04, H - belt - 0.2, 0.12, 0, 0xffffff, 1);
      bumpers(b, L, BW, c + 0.08);
      face(b, L, BW, c + 0.48, 0.26, c + 0.24);
      tail(b, L, BW, c + 0.45, 0.24);
      break;
    }
    case 'pickup': {
      const belt = c + 0.72;
      b.soft(0, (c + belt) / 2, 0, BW, belt - c, L - 0.04, 0.15, 0xffffff, 1);
      const cabZ = L / 2 - 0.66;
      b.soft(0, (belt + H) / 2, cabZ, BW - 0.04, H - belt, 1.2, 0.13, 0xffffff, 2, { top: 0.92, topZ: 0.78, roofColor: 0xffffff, roofMat: 1 });
      const bedL = L - 1.36, bz = -L / 2 + bedL / 2 + 0.02;
      for (const s of [-1, 1]) b.soft(s * (BW / 2 - 0.04), belt + 0.18, bz, 0.08, 0.36, bedL, 0.03, 0xffffff, 1);
      b.soft(0, belt + 0.18, -L / 2 + 0.06, BW, 0.36, 0.08, 0.03, 0xffffff, 1);
      b.soft(0, belt + 0.01, bz, BW - 0.12, 0.04, bedL, 0, PAL.slate, 0);
      bumpers(b, L, BW, c + 0.08);
      face(b, L, BW, c + 0.46, 0.26, c + 0.24);
      tail(b, L, BW, c + 0.44, 0.24);
      break;
    }
    case 'bus': {
      const belt = c + 0.8;
      b.soft(0, (c + belt) / 2, 0, BW, belt - c, L - 0.04, 0.2, 0xffffff, 1);
      b.soft(0, belt + 0.72, 0, BW - 0.02, 1.44, L - 0.1, 0.12, 0xffffff, 2);
      b.soft(0, (belt + 1.44 + H) / 2, 0, BW - 0.06, H - belt - 1.44, L - 0.24, 0.16, PAL.cloud, 0);
      for (let z = -L / 2 + 1.5; z < L / 2 - 1; z += 1.6) for (const s of [-1, 1]) b.soft(s * (BW / 2 - 0.01), belt + 0.72, z, 0.05, 1.4, 0.14, 0, PAL.cloud, 0);
      b.soft(0, belt + 1.62, L / 2 + 0.01, BW * 0.7, 0.24, 0.04, 0, INK, 0);
      bumpers(b, L, BW, c + 0.14);
      face(b, L, BW, c + 0.52, 0.34, c + 0.26);
      tail(b, L, BW, c + 0.5);
      break;
    }
    case 'sport': {
      const belt = c + 0.46;
      b.soft(0, (c + belt) / 2, 0, BW, belt - c, L - 0.08, 0.15, 0xffffff, 1);
      b.soft(0, (belt + H) / 2, -0.3, BW - 0.34, H - belt + 0.02, L * 0.42, 0.12, 0xffffff, 2, { top: 0.78, topZ: 0.62, shift: -0.1, roofColor: 0xffffff, roofMat: 1 });
      b.soft(0, belt + 0.2, -L / 2 + 0.18, BW - 0.2, 0.06, 0.32, 0.02, INK, 7); // spoiler
      for (const s of [-1, 1]) b.soft(s * (BW / 2 - 0.32), belt + 0.08, -L / 2 + 0.22, 0.07, 0.18, 0.07, 0, INK, 7);
      bumpers(b, L, BW, c + 0.08);
      face(b, L, BW, belt - 0.12, 0.3, c + 0.16);
      tail(b, L, BW, belt - 0.1);
      break;
    }
  }
  // liveries
  if (t.livery === 'police') {
    const roofY = t.H + 0.03;
    b.soft(-0.3, roofY + 0.08, -L * 0.1, 0.58, 0.15, 0.28, 0.05, PAL.coral, 5);
    b.soft(0.3, roofY + 0.08, -L * 0.1, 0.58, 0.15, 0.28, 0.05, PAL.blue, 6);
    for (const s of [-1, 1]) b.soft(s * (BW / 2 + 0.005), c + 0.36, 0, 0.02, 0.18, L * 0.8, 0, PAL.blue, 0);
  } else if (t.livery === 'taxi') {
    b.soft(0, t.H + 0.12, -L * 0.1, 0.62, 0.2, 0.26, 0.05, PAL.yellow, 3);
    for (const s of [-1, 1]) for (let k = 0; k < 10; k++) b.soft(s * (BW / 2 + 0.005), c + 0.4 + (k % 2) * 0.09, -L * 0.36 + k * L * 0.08, 0.02, 0.09, L * 0.08, 0, k % 2 ? INK : PAL.white, 0);
  }
  return b.build();
}

const geoCache = new Map();
export function vehicleGeometry(typeId) {
  if (!geoCache.has(typeId)) geoCache.set(typeId, buildBody(VTYPES[typeId]));
  return geoCache.get(typeId);
}

// unit wheel (radius 1, width 1 along x): chunky tyre, big hubcap with a white centre
export function wheelGeometry() {
  const parts = [[new THREE.CylinderGeometry(1, 1, 1, 10, 1), INK], [new THREE.CylinderGeometry(0.62, 0.62, 1.06, 8, 1), PAL.lilac], [new THREE.CylinderGeometry(0.26, 0.26, 1.1, 6, 1), PAL.white]];
  const pos = [], nrm = [], col = [], idx = [];
  const c = new THREE.Color();
  for (const [g, hex] of parts) {
    g.rotateZ(Math.PI / 2);
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
        if (mt == 3.0 || mt == 4.0) diffuseColor.rgb *= 0.8;`)
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
