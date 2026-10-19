export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
export const dampAngle = (a, b, k, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-k * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

export function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// closest point on segment AB to P; writes out.x, out.z, out.t and returns squared distance
export function closestOnSeg(px, pz, ax, az, bx, bz, out) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t, z = az + dz * t;
  out.x = x; out.z = z; out.t = t;
  return (px - x) * (px - x) + (pz - z) * (pz - z);
}

// ring: flat array [x0, z0, x1, z1, ...]
export function pointInRing(x, z, ring) {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

export function ringArea(ring) {
  let s = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return s / 2;
}

export function ringCentroid(ring) {
  let a = 0, cx = 0, cz = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const f = ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    a += f; cx += (ring[i * 2] + ring[j * 2]) * f; cz += (ring[i * 2 + 1] + ring[j * 2 + 1]) * f;
  }
  if (Math.abs(a) < 1e-6) {
    let x = 0, z = 0;
    for (let i = 0; i < n; i++) { x += ring[i * 2]; z += ring[i * 2 + 1]; }
    return [x / n, z / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function formatMoney(n) {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (n < 0 ? '-' : '') + s;
}

export function formatTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// a growable typed-array helper used by the geometry builders
export class FloatBuf {
  constructor(n = 1024) { this.a = new Float32Array(n); this.n = 0; }
  ensure(k) { if (this.n + k > this.a.length) { let m = this.a.length * 2; while (m < this.n + k) m *= 2; const b = new Float32Array(m); b.set(this.a); this.a = b; } }
  push1(x) { this.ensure(1); this.a[this.n++] = x; }
  push2(x, y) { this.ensure(2); this.a[this.n++] = x; this.a[this.n++] = y; }
  push3(x, y, z) { this.ensure(3); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; }
  array() { return this.a.slice(0, this.n); }
}
export class IndexBuf {
  constructor(n = 1024) { this.a = new Uint32Array(n); this.n = 0; }
  ensure(k) { if (this.n + k > this.a.length) { let m = this.a.length * 2; while (m < this.n + k) m *= 2; const b = new Uint32Array(m); b.set(this.a); this.a = b; } }
  push3(a, b, c) { this.ensure(3); const x = this.a; x[this.n++] = a; x[this.n++] = b; x[this.n++] = c; }
  array() { return this.a.slice(0, this.n); }
}
