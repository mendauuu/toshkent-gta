// Hand-built models for Tashkent landmarks placed at their real OSM coordinates, toon-shaded in the
// cute pixel palette.
import * as THREE from 'three';
import { makeFarFogMaterial, toon } from './materials.js';
import { cuteGeometry } from './palette.js';
import { ringCentroid, ringArea, pointInRing } from '../util/math.js';

const C = (hex) => new THREE.Color(hex);

function colorize(geo, fn) {
  const p = geo.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), c); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}
const solid = (geo, hex) => colorize(geo, (x, y, z, c) => c.set(hex));

function lathe(profile, seg = 24) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

// cylinder from point a to point b
function beam(a, b, r0, r1, seg = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

function box(x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx || ry || rz) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function merge(geos) {
  const pos = [], nrm = [], col = [], idx = [];
  for (let g of geos) {
    if (!g.index) g = g.toNonIndexed ? indexify(g) : g;
    const base = pos.length / 3;
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.color.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nrm.push(n[i]); col.push(c[i]); }
    for (const i of g.index.array) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
function indexify(g) {
  const n = g.attributes.position.count;
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

// ------------------------------------------------------------------ Tashkent TV Tower (375 m)
function tvTower() {
  const parts = [];
  const body = lathe([
    [0.01, 0], [4.6, 0], [4.3, 60], [4.0, 92], [6.5, 95], [15.5, 99], [17, 103], [17, 107], [15.5, 110], [9, 113],
    [4.0, 116], [3.6, 218], [7.8, 222], [8.2, 226], [8.2, 233], [6.5, 236], [3.0, 239], [2.2, 252], [1.7, 300], [1.1, 340], [0.55, 372], [0.01, 375],
  ], 28);
  colorize(body, (x, y, z, c) => {
    if (y > 102.5 && y < 108) c.set(0x2c3b4a);
    else if (y > 223 && y < 232) c.set(0x334455);
    else if (y > 239 && Math.floor((y - 239) / 17) % 2 === 0) c.set(0xc8352c);
    else if (y > 95 && y < 113) c.set(0xe4e6ea);
    else c.set(0xd3d9df);
  });
  parts.push(body);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3;
    const base = new THREE.Vector3(Math.cos(a) * 30, 0, Math.sin(a) * 30);
    const top = new THREE.Vector3(Math.cos(a) * 4.6, 97, Math.sin(a) * 4.6);
    parts.push(solid(beam(base, top, 2.4, 1.3, 8), 0xc9d0d8));
    // cross bracing between legs
    const b2 = (k + 1) / 3 * Math.PI * 2 + 0.3;
    for (const h of [25, 55]) {
      const f = h / 97;
      const p1 = base.clone().lerp(top, f);
      const p2 = new THREE.Vector3(Math.cos(b2) * 30, 0, Math.sin(b2) * 30).lerp(new THREE.Vector3(Math.cos(b2) * 4.6, 97, Math.sin(b2) * 4.6), f);
      parts.push(solid(beam(p1, p2, 0.7, 0.7, 6), 0xb7c0ca));
    }
    // base pavilion block
    parts.push(solid(box(Math.cos(a) * 30, 3, Math.sin(a) * 30, 7, 6, 7), 0xa9b0b6));
  }
  parts.push(solid(box(0, 4, 0, 16, 8, 16), 0xbac1c8));
  return merge(parts);
}

// ------------------------------------------------------------------ Amir Temur equestrian monument
function temurStatue() {
  const granite = 0x6e4d45, bronze = 0x5a4a2c;
  const parts = [
    solid(box(0, 0.4, 0, 11, 0.8, 11), 0x8a7c72),
    solid(box(0, 1.2, 0, 8.5, 0.8, 8.5), 0x7a6a62),
    solid(box(0, 4.3, 0, 4.2, 5.4, 6.2), granite),
    solid(box(0, 7.15, 0, 4.6, 0.35, 6.6), 0x5c3f38),
  ];
  const y0 = 7.3, S = 1.55;
  const P = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => parts.push(solid(box(x * S, y0 + y * S, z * S, sx * S, sy * S, sz * S, rx, ry, rz), bronze));
  P(0, 1.55, 0, 0.75, 0.8, 2.1);           // horse body
  P(0, 2.15, 1.05, 0.42, 0.95, 0.45, -0.75); // neck
  P(0, 2.55, 1.55, 0.32, 0.36, 0.75, -0.35); // head
  P(0.22, 0.6, 0.75, 0.16, 1.2, 0.18);     // legs
  P(-0.22, 1.0, 1.05, 0.16, 1.0, 0.18, -1.0); // raised front leg
  P(0.22, 0.6, -0.75, 0.16, 1.2, 0.18, 0.12);
  P(-0.22, 0.6, -0.8, 0.16, 1.2, 0.18, -0.1);
  P(0, 1.5, -1.25, 0.14, 0.8, 0.14, 0.5);  // tail
  P(0, 2.55, -0.05, 0.55, 0.85, 0.4);      // rider torso
  P(0, 3.15, 0.0, 0.3, 0.32, 0.3);         // head
  P(0, 3.38, 0.0, 0.36, 0.14, 0.36);       // helmet
  P(0.36, 3.0, 0.3, 0.13, 0.13, 0.75, -0.5); // raised right arm
  P(-0.34, 2.45, 0.1, 0.12, 0.6, 0.13, 0.2);
  P(0, 2.2, -0.35, 0.9, 1.1, 0.12, 0.25);  // cloak
  P(0.3, 1.75, 0.05, 0.12, 0.6, 0.14, 0, 0, 0.25); // legs over the horse
  P(-0.3, 1.75, 0.05, 0.12, 0.6, 0.14, 0, 0, -0.25);
  return merge(parts);
}

// ------------------------------------------------------------------ Independence globe
function globe() {
  const parts = [
    solid(box(0, 0.3, 0, 8, 0.6, 8), 0x9b9286),
    solid(lathe([[0.01, 0.6], [3.2, 0.6], [2.6, 1.6], [2.2, 5.6], [2.8, 6.2], [0.01, 6.2]], 20), 0x7b5f55),
  ];
  const s = new THREE.SphereGeometry(3.3, 28, 18);
  s.translate(0, 9.6, 0);
  colorize(s, (x, y, z, c) => {
    const lat = (y - 9.6) / 3.3;
    const lon = Math.atan2(z, x);
    const land = Math.sin(lon * 3.0 + lat * 2.0) + Math.sin(lon * 5.0 - lat * 4.0) * 0.6 > 0.7;
    c.set(land ? 0xe8c04a : 0xc79a2e);
  });
  parts.push(s);
  return merge(parts);
}

// ------------------------------------------------------------------ minaret
function minaret(h = 48, r = 2.3) {
  const B = 0xc49762, T = 0x2a8fb0, S = 0xd9c39a, D = 0x2f9fb5;
  // [radius, height, colour]; repeated heights give crisp tile bands
  const prof = [
    [0.01, 0, B], [r * 1.25, 0, B], [r * 1.25, 3.2, B], [r, 3.6, B],
    [r * 0.95, h * 0.3, B], [r * 0.95, h * 0.3, T], [r * 0.94, h * 0.33, T], [r * 0.94, h * 0.33, B],
    [r * 0.9, h * 0.55, B], [r * 0.9, h * 0.55, T], [r * 0.89, h * 0.58, T], [r * 0.89, h * 0.58, B],
    [r * 0.84, h * 0.74, B], [r * 0.84, h * 0.74, T], [r * 0.82, h * 0.78, T],
    [r * 1.3, h * 0.8, S], [r * 1.3, h * 0.83, S], [r * 0.75, h * 0.84, S],
    [r * 0.75, h * 0.84, B], [r * 0.75, h * 0.93, B], [r * 0.82, h * 0.935, D], [r * 0.6, h * 0.97, D], [r * 0.25, h * 0.995, D], [0.01, h, D],
  ];
  const g = lathe(prof.map(([pr, py]) => [pr, py]), 16);
  const n = prof.length, col = new Float32Array(g.attributes.position.count * 3), c = new THREE.Color();
  for (let i = 0; i < g.attributes.position.count; i++) { c.set(prof[i % n][2]); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------------ plov kazans
function kazan() {
  const parts = [
    solid(box(0, 0.6, 0, 3.8, 1.2, 3.8), 0x9c5a3c),
    solid(lathe([[0.01, 0.7], [0.9, 0.75], [1.5, 1.0], [1.75, 1.45], [1.8, 1.6], [1.6, 1.62], [0.01, 1.4]], 18), 0x262422),
  ];
  return merge(parts);
}

// the building that contains the point (the mosque itself), else the nearest large one
function nearestBuilding(map, x, z, maxD = 80) {
  let best = null, bd = maxD;
  for (const b of map.buildings) {
    const r = b.ring;
    if (Math.abs(r[0] - x) > maxD + 200 || Math.abs(r[1] - z) > maxD + 200) continue;
    const area = Math.abs(ringArea(r));
    if (area < 150) continue;
    const [cx, cz] = ringCentroid(r);
    if (pointInRing(x, z, r)) return { b, cx, cz };
    const d = Math.hypot(cx - x, cz - z);
    if (d < bd) { bd = d; best = { b, cx, cz }; }
  }
  return best;
}

function obbCorners(ring) {
  let best = null;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ang = Math.atan2(ring[j * 2 + 1] - ring[i * 2 + 1], ring[j * 2] - ring[i * 2]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let a = Infinity, b = -Infinity, d = Infinity, e = -Infinity;
    for (let k = 0; k < n; k++) { const u = ring[k * 2] * c + ring[k * 2 + 1] * s, v = -ring[k * 2] * s + ring[k * 2 + 1] * c; a = Math.min(a, u); b = Math.max(b, u); d = Math.min(d, v); e = Math.max(e, v); }
    const area = (b - a) * (e - d);
    if (!best || area < best.area) best = { area, c, s, a, b, d, e };
  }
  const { c, s, a, b, d, e } = best;
  const P = (u, v) => [u * c - v * s, u * s + v * c];
  return [P(a, d), P(b, d), P(b, e), P(a, e)];
}

export function buildLandmarks(game) {
  const { scene, map, collision } = game;
  const L = Object.fromEntries(map.landmarks.map((l) => [l.id, l]));
  const farMat = makeFarFogMaterial({ vertexColors: true });
  const nearMat = toon({ vertexColors: true });
  const group = new THREE.Group();
  const add = (geo, x, z, rot = 0, far = false) => {
    const m = new THREE.Mesh(cuteGeometry(geo), far ? farMat : nearMat);
    m.position.set(x, 0, z);
    m.rotation.y = rot;
    m.castShadow = true;
    m.receiveShadow = true;
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  };
  const lights = [];
  if (L.tvtower) {
    const { x, z } = L.tvtower;
    add(tvTower(), x, z, 0, true);
    collision.addCircle(x, z, 8.5, 400);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.3; collision.addCircle(x + Math.cos(a) * 30, z + Math.sin(a) * 30, 4.6, 12); }
    for (const y of [375.5, 300, 236, 114]) lights.push([x, y, z]);
  }
  if (L.temur) {
    add(temurStatue(), L.temur.x, L.temur.z, -2.2);
    collision.addCircle(L.temur.x, L.temur.z, 6.2, 18);
  }
  if (L.globe) {
    add(globe(), L.globe.x, L.globe.z, 0.4);
    collision.addCircle(L.globe.x, L.globe.z, 3.6, 13);
  }
  // minarets beside the big mosques
  const mosque = (id, count, height, radius) => {
    const l = L[id];
    if (!l) return;
    const nb = l.ring ? { b: { ring: l.ring }, cx: ringCentroid(l.ring)[0], cz: ringCentroid(l.ring)[1] } : nearestBuilding(map, l.x, l.z, 70);
    let corners;
    if (nb) {
      corners = obbCorners(nb.b.ring);
      // push corners slightly outwards from the centre so the tower stands at the corner
      corners = corners.map(([cx, cz]) => { const dx = cx - nb.cx, dz = cz - nb.cz, d = Math.hypot(dx, dz) || 1; return [cx + (dx / d) * radius * 0.6, cz + (dz / d) * radius * 0.6]; });
    } else corners = [[l.x - 15, l.z], [l.x + 15, l.z]];
    for (let i = 0; i < count; i++) {
      const [mx, mz] = corners[i];
      add(minaret(height, radius), mx, mz, 0, true);
      collision.addCircle(mx, mz, radius * 1.3, height);
    }
  };
  mosque('hazratimam', 2, 54, 2.4);
  mosque('minor', 2, 46, 2.2);
  mosque('kukeldash', 2, 24, 2.6);
  if (L.beshqozon) {
    const { x, z } = L.beshqozon;
    game.kazans = [];
    for (let i = 0; i < 3; i++) {
      const [kx, kz] = collision.findOutside(x + 9 + i * 5.5, z + 6, 25);
      add(kazan(), kx, kz, 0);
      collision.addCircle(kx, kz, 2.2, 2);
      game.kazans.push([kx, kz]);
    }
  }
  // aviation lights on the tallest buildings
  for (const b of map.buildings) {
    if (b.h < 85 || !b.render) continue;
    const [cx, cz] = ringCentroid(b.ring);
    lights.push([cx, b.h + b.roofH + 1, cz]);
  }
  const lightGeo = new THREE.SphereGeometry(1.1, 8, 6);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xff2010, fog: false });
  const lightMesh = new THREE.InstancedMesh(lightGeo, lightMat, Math.max(1, lights.length));
  const m4 = new THREE.Matrix4();
  lights.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); lightMesh.setMatrixAt(i, m4); });
  lightMesh.count = lights.length;
  lightMesh.frustumCulled = false;
  group.add(lightMesh);
  scene.add(group);
  let t = 0;
  return {
    group,
    update(dt, night) {
      t += dt;
      const blink = (Math.sin(t * 3.2) > 0.2 ? 1 : 0.15) * night;
      lightMesh.visible = night > 0.05;
      lightMat.color.setRGB(2.2 * blink + 0.05, 0.25 * blink, 0.1 * blink);
    },
  };
}
