// Small geometry builders for the toy look: chamfered ("soft") boxes and octagonal prisms, returned as
// plain arrays so callers can merge many of them with extra per-vertex attributes.

// winding so the polygon faces along n (front faces are counter-clockwise from outside)
function facing(pts, n) {
  const [a, b, c] = pts;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? pts : pts.slice().reverse();
}

// collects flat-shaded polygons (fans) into position/normal/index arrays
export class PolyBuf {
  constructor() { this.pos = []; this.nrm = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  poly(pts, n) {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn = [n[0] / l, n[1] / l, n[2] / l];
    const p = facing(pts, nn), base = this.count;
    for (const q of p) { this.pos.push(q[0], q[1], q[2]); this.nrm.push(nn[0], nn[1], nn[2]); }
    for (let i = 1; i < p.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }
}

// box sx*sy*sz centred at (x, y, z) with every edge cut at 45 degrees by r (r = 0 gives a plain
// box). Flat normals: the cut faces pick up the middle toon shade, so edges read as rounded.
export function bevelBox(buf, x, y, z, sx, sy, sz, r = 0) {
  const h = [sx / 2, sy / 2, sz / 2];
  r = Math.max(0, Math.min(r, h[0] * 0.9, h[1] * 0.9, h[2] * 0.9));
  const o = [x, y, z];
  const P = (v) => [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
  const ax = (k, s, j, sj, l, sl, rk = 0, rj = r, rl = r) => {
    const v = [0, 0, 0];
    v[k] = s * (h[k] - rk); v[j] = sj * (h[j] - rj); v[l] = sl * (h[l] - rl);
    return P(v);
  };
  const others = (k) => [(k + 1) % 3, (k + 2) % 3];
  // faces
  for (let k = 0; k < 3; k++) for (const s of [1, -1]) {
    const [j, l] = others(k);
    const n = [0, 0, 0]; n[k] = s;
    buf.poly([ax(k, s, j, -1, l, -1), ax(k, s, j, 1, l, -1), ax(k, s, j, 1, l, 1), ax(k, s, j, -1, l, 1)], n);
  }
  if (r <= 0) return buf;
  // edges between face k (sign s) and face j (sign sj), running along axis l
  for (let k = 0; k < 3; k++) {
    const j = (k + 1) % 3, l = (k + 2) % 3;
    for (const s of [1, -1]) for (const sj of [1, -1]) {
      const n = [0, 0, 0]; n[k] = s; n[j] = sj;
      const A = (sl) => { const v = [0, 0, 0]; v[k] = s * h[k]; v[j] = sj * (h[j] - r); v[l] = sl * (h[l] - r); return P(v); };
      const B = (sl) => { const v = [0, 0, 0]; v[k] = s * (h[k] - r); v[j] = sj * h[j]; v[l] = sl * (h[l] - r); return P(v); };
      buf.poly([A(-1), A(1), B(1), B(-1)], n);
    }
  }
  // corner facets
  for (const sx2 of [1, -1]) for (const sy2 of [1, -1]) for (const sz2 of [1, -1]) {
    const s3 = [sx2, sy2, sz2];
    const c = (k) => { const v = [0, 0, 0]; for (let i = 0; i < 3; i++) v[i] = s3[i] * (i === k ? h[i] : h[i] - r); return P(v); };
    buf.poly([c(0), c(1), c(2)], s3);
  }
  return buf;
}

// vertical prism with a regular n-gon cross-section (n = 8: octagon), flat sides, capped
export function prism(buf, x, y0, z, r0, r1, height, n = 8, rot = Math.PI / 8, caps = true) {
  const ring = (r, y) => Array.from({ length: n }, (_, i) => { const a = rot + (i / n) * Math.PI * 2; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; });
  const lo = ring(r0, y0), hi = ring(r1, y0 + height);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = rot + ((i + 0.5) / n) * Math.PI * 2;
    const slope = (r0 - r1) / Math.max(height, 1e-6);
    buf.poly([lo[i], lo[j], hi[j], hi[i]], [Math.cos(a), slope, Math.sin(a)]);
  }
  if (caps) { buf.poly(hi, [0, 1, 0]); if (r0 > 0.001) buf.poly(lo, [0, -1, 0]); }
  return buf;
}
