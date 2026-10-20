// Hand-built models for Tashkent landmarks placed at their real OSM coordinates, toon-shaded in the
// cute pixel palette.
import * as THREE from 'three';
import { makeFarFogMaterial, toon } from './materials.js';
import { cuteGeometry } from './palette.js';
import { PolyBuf, bevelBox, prism } from '../util/shapes.js';
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

// ------------------------------------------------------------------ voxel-style parts
// [PolyBuf, colour] list -> one flat-shaded geometry with vertex colours
function voxel(list) {
  const pos = [], nrm = [], col = [], idx = [], c = new THREE.Color();
  for (const [P, hex] of list) {
    const base = pos.length / 3;
    c.set(hex);
    for (let i = 0; i < P.count; i++) { pos.push(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]); nrm.push(P.nrm[i * 3], P.nrm[i * 3 + 1], P.nrm[i * 3 + 2]); col.push(c.r, c.g, c.b); }
    for (const i of P.idx) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
// soft box rotated by rx about x (around its own centre)
function sbox(x, y, z, sx, sy, sz, r = 0, rx = 0) {
  const P = bevelBox(new PolyBuf(), 0, 0, 0, sx, sy, sz, r);
  const c = Math.cos(rx), s = Math.sin(rx);
  for (const a of [P.pos, P.nrm]) for (let i = 0; i < a.length; i += 3) { const yy = a[i + 1], zz = a[i + 2]; a[i + 1] = yy * c - zz * s; a[i + 2] = yy * s + zz * c; }
  for (let i = 0; i < P.pos.length; i += 3) { P.pos[i] += x; P.pos[i + 1] += y; P.pos[i + 2] += z; }
  return P;
}
// square beam from a to b (4-sided, chunky)
function sbeam(a, b, r, hex, list) {
  const g = beam(a, b, r, r * 0.8, 4);
  const P = new PolyBuf(), p = g.attributes.position, idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const v = [idx[i], idx[i + 1], idx[i + 2]].map((k) => [p.getX(k), p.getY(k), p.getZ(k)]);
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2], wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    P.poly(v, [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]);
  }
  list.push([P, hex]);
}

// ------------------------------------------------------------------ Tashkent TV Tower (375 m), voxel style
function tvTower() {
  const parts = [];
  const ring = (y0, h, r0, r1, hex, n = 8) => parts.push([prism(new PolyBuf(), 0, y0, 0, r0, r1, h, n), hex]);
  // shaft in chunky steps with alternating bands
  for (let k = 0; k < 6; k++) ring(k * 16, 16, 4.6 - k * 0.1, 4.6 - k * 0.1, k % 2 ? 0xf4ede0 : 0xffffff);
  // lower observation pod
  ring(95, 4, 6.5, 15.5, 0xb9b4d6); ring(99, 4, 15.5, 17, 0xf4ede0); ring(103, 5, 17, 17, 0x5cc3f0); ring(108, 3, 17, 15.5, 0xf4ede0);
  ring(111, 2, 15.5, 9, 0xb9b4d6); ring(113, 3, 9, 4, 0xf4ede0);
  for (let k = 0; k < 6; k++) ring(116 + k * 17, 17, 4.0 - k * 0.07, 4.0 - k * 0.07, k % 2 ? 0xf4ede0 : 0xffffff);
  // upper pod
  ring(218, 4, 3.6, 7.8, 0xb9b4d6); ring(222, 4, 7.8, 8.2, 0xf4ede0); ring(226, 7, 8.2, 8.2, 0x5cc3f0); ring(233, 3, 8.2, 6.5, 0xf4ede0); ring(236, 3, 6.5, 3, 0xb9b4d6);
  // antenna: square sections in red and white
  for (let k = 0; k < 8; k++) { const r0 = 2.2 - k * 0.2; ring(239 + k * 17, 17, r0, r0 - 0.2, k % 2 ? 0xffffff : 0xe8574a, 4); }
  // three splayed legs with braces and little pavilions at their feet
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3, b2 = ((k + 1) / 3) * Math.PI * 2 + 0.3;
    const base = new THREE.Vector3(Math.cos(a) * 30, 0, Math.sin(a) * 30), top = new THREE.Vector3(Math.cos(a) * 4.6, 97, Math.sin(a) * 4.6);
    sbeam(base, top, 2.4, 0xf4ede0, parts);
    for (const h of [25, 55]) {
      const f = h / 97;
      sbeam(base.clone().lerp(top, f), new THREE.Vector3(Math.cos(b2) * 30, 0, Math.sin(b2) * 30).lerp(new THREE.Vector3(Math.cos(b2) * 4.6, 97, Math.sin(b2) * 4.6), f), 0.8, 0xb9b4d6, parts);
    }
    parts.push([bevelBox(new PolyBuf(), Math.cos(a) * 30, 3, Math.sin(a) * 30, 7, 6, 7, 0.5), 0xb9b4d6]);
    parts.push([bevelBox(new PolyBuf(), Math.cos(a) * 30, 6.4, Math.sin(a) * 30, 7.6, 0.8, 7.6, 0.2), 0x3a8fe0]);
  }
  parts.push([bevelBox(new PolyBuf(), 0, 4, 0, 16, 8, 16, 0.6), 0xb9b4d6]);
  return voxel(parts);
}

// ------------------------------------------------------------------ Amir Temur on his horse, chibi voxel style
function temurStatue() {
  const parts = [];
  const gold = 0xf4b726, bronze = 0xb8693e, cape = 0xc23b4a;
  // pedestal: stone steps, a raspberry granite block with a blue tile band and gold trim
  parts.push([bevelBox(new PolyBuf(), 0, 0.4, 0, 11, 0.8, 11, 0.2), 0xb9b4d6]);
  parts.push([bevelBox(new PolyBuf(), 0, 1.2, 0, 8.5, 0.8, 8.5, 0.2), 0x7b7aa6]);
  parts.push([bevelBox(new PolyBuf(), 0, 4.3, 0, 4.2, 5.4, 6.2, 0.25), 0xc23b4a]);
  parts.push([bevelBox(new PolyBuf(), 0, 6.2, 0, 4.32, 0.7, 6.32), 0x2c5fb8]);
  parts.push([bevelBox(new PolyBuf(), 0, 6.62, 0, 4.36, 0.14, 6.36), gold]);
  parts.push([bevelBox(new PolyBuf(), 0, 7.15, 0, 4.6, 0.35, 6.6, 0.1), 0x45305e]);
  const y0 = 7.3, S = 1.55;
  const B = (x, y, z, sx, sy, sz, hex, r = 0.06, rx = 0) => parts.push([sbox(x * S, y0 + y * S, z * S, sx * S, sy * S, sz * S, r * S, rx), hex]);
  // horse with a big friendly head, one front hoof raised
  B(0, 1.5, 0, 0.9, 0.85, 2.0, gold, 0.14);
  B(0, 2.2, 0.85, 0.44, 0.8, 0.46, gold, 0.08, -0.6);
  B(0, 2.7, 1.32, 0.5, 0.52, 0.78, gold, 0.1, -0.25);
  for (const s of [-1, 1]) { B(s * 0.15, 3.02, 1.12, 0.1, 0.2, 0.08, gold, 0.02); B(s * 0.25, 2.78, 1.4, 0.02, 0.1, 0.1, 0x2b1d3a, 0); }
  B(0, 2.45, 0.7, 0.14, 0.6, 0.62, bronze, 0.03, -0.6);
  B(0.24, 0.62, 0.72, 0.2, 1.14, 0.22, gold, 0.05);
  B(-0.24, 1.0, 1.02, 0.2, 0.95, 0.22, gold, 0.05, -1.0);
  B(0.24, 0.62, -0.72, 0.2, 1.14, 0.22, gold, 0.05, 0.12);
  B(-0.24, 0.62, -0.78, 0.2, 1.14, 0.22, gold, 0.05, -0.1);
  B(0, 1.5, -1.2, 0.16, 0.85, 0.16, bronze, 0.04, 0.5);
  // the rider: big head under a gold helmet, a flowing red cape, raised right arm
  B(0, 2.6, -0.05, 0.58, 0.78, 0.44, gold, 0.1);
  B(0, 3.3, 0.0, 0.5, 0.5, 0.48, gold, 0.08);
  B(0, 3.62, 0, 0.56, 0.2, 0.54, 0xffd08a, 0.05);
  B(0, 3.84, 0, 0.1, 0.26, 0.1, 0xffd08a, 0.02);
  B(0, 2.35, -0.38, 0.9, 1.1, 0.1, cape, 0.03, 0.25);
  B(0.38, 3.0, 0.32, 0.15, 0.15, 0.8, gold, 0.04, -0.5);
  B(-0.36, 2.48, 0.1, 0.14, 0.62, 0.15, gold, 0.04, 0.2);
  for (const s of [-1, 1]) B(s * 0.34, 1.8, 0.08, 0.14, 0.62, 0.16, gold, 0.04);
  return voxel(parts);
}

// small turquoise domes ringing the great dome of Chorsu bazaar (unit size, scaled by the caller)
function smallDome() {
  const parts = [];
  parts.push([prism(new PolyBuf(), 0, 0, 0, 1.0, 1.0, 0.45, 8), 0xffffff]);
  parts.push([prism(new PolyBuf(), 0, 0.45, 0, 1.0, 0.86, 0.35, 8), 0x26c0b9]);
  parts.push([prism(new PolyBuf(), 0, 0.8, 0, 0.86, 0.6, 0.32, 8), 0x26c0b9]);
  parts.push([prism(new PolyBuf(), 0, 1.12, 0, 0.6, 0.28, 0.28, 8), 0x5cc3f0]);
  parts.push([bevelBox(new PolyBuf(), 0, 1.5, 0, 0.12, 0.22, 0.12), 0xf4b726]);
  return voxel(parts);
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
  // Chorsu bazaar: a ring of small turquoise domes around the great tiled dome
  if (L.chorsu) {
    const nb = nearestBuilding(map, L.chorsu.x, L.chorsu.z, 60);
    if (nb && nb.b.roof === 3) {
      const R = Math.sqrt(Math.abs(ringArea(nb.b.ring)) / Math.PI) * 0.92, n = 10, rs = Math.max(2.5, R * 0.16);
      const dome = smallDome();
      dome.scale(rs, rs, rs);
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; add(dome.clone(), nb.cx + Math.cos(a) * R, nb.cz + Math.sin(a) * R, a).position.y = nb.b.h; }
      group.children.slice(-n).forEach((m) => m.updateMatrix());
    }
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
