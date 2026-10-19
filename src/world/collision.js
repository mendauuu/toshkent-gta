// Static collision world: building walls (segments with outward normals and heights) and round
// obstacles (tree trunks, poles) in a uniform grid stored in CSR form.
import { pointInRing } from '../util/math.js';

const CELL = 8;
const BCELL = 64;

export class CollisionWorld {
  constructor(bounds, playBounds = bounds, margin = 120) {
    this.bounds = playBounds;
    this.minX = bounds.minX - margin; this.minZ = bounds.minZ - margin;
    this.maxX = bounds.maxX + margin; this.maxZ = bounds.maxZ + margin;
    this.nx = Math.ceil((this.maxX - this.minX) / CELL);
    this.nz = Math.ceil((this.maxZ - this.minZ) / CELL);
    this._segs = [];
    this._circles = [];
    this.buildings = [];
    this.stamp = 0;
    this.out = { x: 0, z: 0, nx: 0, nz: 0, t: 1, kind: 0 };
  }

  addRing(ring, h) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      this._segs.push(ax, az, bx, bz, h, dz / len, -dx / len);
    }
  }

  addBuilding(ring, holes, h) {
    this.addRing(ring, h);
    for (const hole of holes) this.addRing(hole, h);
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { a = Math.min(a, ring[i]); b = Math.min(b, ring[i + 1]); c = Math.max(c, ring[i]); d = Math.max(d, ring[i + 1]); }
    this.buildings.push({ ring, holes, h, minX: a, minZ: b, maxX: c, maxZ: d });
    this.bgrid = null;
  }

  addCircle(x, z, r, h = 4) { this._circles.push(x, z, r, h); }

  _cells(minX, minZ, maxX, maxZ, fn) {
    const x0 = Math.max(0, Math.floor((minX - this.minX) / CELL)), x1 = Math.min(this.nx - 1, Math.floor((maxX - this.minX) / CELL));
    const z0 = Math.max(0, Math.floor((minZ - this.minZ) / CELL)), z1 = Math.min(this.nz - 1, Math.floor((maxZ - this.minZ) / CELL));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) fn(iz * this.nx + ix);
  }

  finalize() {
    const segs = (this.segs = new Float32Array(this._segs));
    const circ = (this.circles = new Float32Array(this._circles));
    this._segs = this._circles = null;
    const nS = (this.nSegs = segs.length / 7), nC = (this.nCircles = circ.length / 4);
    const nCells = this.nx * this.nz;
    const start = new Int32Array(nCells + 1);
    const segBox = (i, fn) => { const o = i * 7; this._cells(Math.min(segs[o], segs[o + 2]), Math.min(segs[o + 1], segs[o + 3]), Math.max(segs[o], segs[o + 2]), Math.max(segs[o + 1], segs[o + 3]), fn); };
    const cirBox = (i, fn) => { const o = i * 4; this._cells(circ[o] - circ[o + 2], circ[o + 1] - circ[o + 2], circ[o] + circ[o + 2], circ[o + 1] + circ[o + 2], fn); };
    for (let i = 0; i < nS; i++) segBox(i, (c) => start[c + 1]++);
    for (let i = 0; i < nC; i++) cirBox(i, (c) => start[c + 1]++);
    for (let c = 0; c < nCells; c++) start[c + 1] += start[c];
    const items = new Int32Array(start[nCells]);
    const fill = start.slice(0, nCells);
    for (let i = 0; i < nS; i++) segBox(i, (c) => { items[fill[c]++] = i; });
    for (let i = 0; i < nC; i++) cirBox(i, (c) => { items[fill[c]++] = -i - 1; });
    this.cellStart = start;
    this.cellItems = items;
    this.segStamp = new Int32Array(nS);
    this.circStamp = new Int32Array(nC);
    this._ensureBGrid();
  }

  // coarse grid of building footprints for inside tests (built lazily)
  _ensureBGrid() {
    if (this.bgrid) return;
    this.bnx = Math.ceil((this.maxX - this.minX) / BCELL);
    this.bnz = Math.ceil((this.maxZ - this.minZ) / BCELL);
    this.bgrid = new Map();
    this.buildings.forEach((b, i) => {
      for (let ix = Math.floor((b.minX - this.minX) / BCELL); ix <= Math.floor((b.maxX - this.minX) / BCELL); ix++)
        for (let iz = Math.floor((b.minZ - this.minZ) / BCELL); iz <= Math.floor((b.maxZ - this.minZ) / BCELL); iz++) {
          const k = iz * this.bnx + ix;
          let a = this.bgrid.get(k); if (!a) this.bgrid.set(k, (a = []));
          a.push(i);
        }
    });
  }

  // Push a circle out of walls and obstacles. Returns true on contact; out.x/out.z hold the
  // corrected position and out.nx/out.nz the averaged contact normal.
  collideCircle(x, z, r, out = this.out, withCircles = true) {
    const segs = this.segs, circ = this.circles, start = this.cellStart, items = this.cellItems;
    let px = x, pz = z, hit = false, anx = 0, anz = 0;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const s = ++this.stamp;
      const x0 = Math.max(0, Math.floor((px - r - this.minX) / CELL)), x1 = Math.min(this.nx - 1, Math.floor((px + r - this.minX) / CELL));
      const z0 = Math.max(0, Math.floor((pz - r - this.minZ) / CELL)), z1 = Math.min(this.nz - 1, Math.floor((pz + r - this.minZ) / CELL));
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const c = iz * this.nx + ix;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const it = items[k];
          if (it >= 0) {
            if (this.segStamp[it] === s) continue;
            this.segStamp[it] = s;
            const o = it * 7;
            const ax = segs[o], az = segs[o + 1], bx = segs[o + 2], bz = segs[o + 3], nx = segs[o + 5], nz = segs[o + 6];
            const dx = bx - ax, dz = bz - az;
            const t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz);
            if (t > 0 && t < 1) {
              const side = (px - ax) * nx + (pz - az) * nz;
              if (side < r && side > -0.7) {
                const push = r - side;
                px += nx * push; pz += nz * push; anx += nx; anz += nz; hit = moved = true;
              }
            } else if (t >= 1) {
              const ex = px - bx, ez = pz - bz, d2 = ex * ex + ez * ez;
              if (d2 < r * r && d2 > 1e-10) {
                const d = Math.sqrt(d2), push = r - d;
                px += (ex / d) * push; pz += (ez / d) * push; anx += ex / d; anz += ez / d; hit = moved = true;
              }
            }
          } else if (withCircles) {
            const ci = -it - 1;
            if (this.circStamp[ci] === s) continue;
            this.circStamp[ci] = s;
            const o = ci * 4;
            const ex = px - circ[o], ez = pz - circ[o + 1], rr = r + circ[o + 2], d2 = ex * ex + ez * ez;
            if (d2 < rr * rr) {
              const d = Math.sqrt(d2) || 1e-4, push = rr - d;
              const nx = d2 > 1e-10 ? ex / d : 1, nz = d2 > 1e-10 ? ez / d : 0;
              px += nx * push; pz += nz * push; anx += nx; anz += nz; hit = moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    const nl = Math.hypot(anx, anz) || 1;
    out.x = px; out.z = pz; out.nx = anx / nl; out.nz = anz / nl;
    return hit;
  }

  // First wall/obstacle hit along the segment (x0,z0)->(x1,z1) whose height at that point is
  // below the object height. Returns t in [0,1] (1 = clear); out.nx/out.nz = wall normal.
  raycast(x0, z0, x1, z1, y0 = 1.5, y1 = 1.5, out = this.out, withCircles = true) {
    const segs = this.segs, circ = this.circles, start = this.cellStart, items = this.cellItems;
    const dx = x1 - x0, dz = z1 - z0;
    let best = 1, bnx = 0, bnz = 0, kind = 0;
    const s = ++this.stamp;
    const gx = (x0 - this.minX) / CELL, gz = (z0 - this.minZ) / CELL;
    let ix = Math.floor(gx), iz = Math.floor(gz);
    const ex = Math.floor((x1 - this.minX) / CELL), ez = Math.floor((z1 - this.minZ) / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tDZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMX = dx !== 0 ? ((dx > 0 ? ix + 1 - gx : gx - ix) * CELL) / Math.abs(dx) : Infinity;
    let tMZ = dz !== 0 ? ((dz > 0 ? iz + 1 - gz : gz - iz) * CELL) / Math.abs(dz) : Infinity;
    for (let guard = 0; guard < 4000; guard++) {
      if (ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz) {
        const c = iz * this.nx + ix;
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          const it = items[k];
          if (it >= 0) {
            if (this.segStamp[it] === s) continue;
            this.segStamp[it] = s;
            const o = it * 7;
            const ax = segs[o], az = segs[o + 1], sx = segs[o + 2] - ax, sz = segs[o + 3] - az;
            const den = dx * sz - dz * sx;
            if (den > -1e-9 && den < 1e-9) continue;
            const qx = ax - x0, qz = az - z0;
            const t = (qx * sz - qz * sx) / den;
            if (t < 0 || t >= best) continue;
            const u = (qx * dz - qz * dx) / den;
            if (u < 0 || u > 1) continue;
            if (y0 + (y1 - y0) * t < segs[o + 4]) { best = t; bnx = segs[o + 5]; bnz = segs[o + 6]; kind = 1; }
          } else if (withCircles) {
            const ci = -it - 1;
            if (this.circStamp[ci] === s) continue;
            this.circStamp[ci] = s;
            const o = ci * 4;
            const fx = x0 - circ[o], fz = z0 - circ[o + 1], r = circ[o + 2];
            const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - r * r;
            const disc = b * b - 4 * a * cc;
            if (disc < 0 || a < 1e-12) continue;
            const t = (-b - Math.sqrt(disc)) / (2 * a);
            if (t >= 0 && t < best && y0 + (y1 - y0) * t < circ[o + 3]) {
              best = t; const hx = fx + dx * t, hz = fz + dz * t, l = Math.hypot(hx, hz) || 1; bnx = hx / l; bnz = hz / l; kind = 2;
            }
          }
        }
      }
      if (ix === ex && iz === ez) break;
      const tNext = Math.min(tMX, tMZ);
      if (best <= tNext || tNext > 1) break;
      if (tMX < tMZ) { tMX += tDX; ix += stepX; } else { tMZ += tDZ; iz += stepZ; }
    }
    out.t = best; out.nx = bnx; out.nz = bnz; out.kind = kind;
    return best;
  }

  lineOfSight(x0, z0, y0, x1, z1, y1) { return this.raycast(x0, z0, x1, z1, y0, y1, this.out, false) >= 0.999; }

  // nearest point that is not inside a building footprint (usable before finalize())
  findOutside(x, z, maxR = 20) {
    if (!this.insideBuilding(x, z)) return [x, z];
    for (let rad = 1; rad <= maxR; rad += 1) {
      const n = Math.ceil(rad * 6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
        if (!this.insideBuilding(px, pz)) return [px, pz];
      }
    }
    return [x, z];
  }

  insideBuilding(x, z) {
    this._ensureBGrid();
    const ix = Math.floor((x - this.minX) / BCELL), iz = Math.floor((z - this.minZ) / BCELL);
    const list = this.bgrid.get(iz * this.bnx + ix);
    if (!list) return false;
    for (const i of list) {
      const b = this.buildings[i];
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (pointInRing(x, z, b.ring) && !b.holes.some((h) => pointInRing(x, z, h))) return true;
    }
    return false;
  }

  // true if a circle at (x,z) is clear of walls, obstacles and building interiors
  isFree(x, z, r) {
    if (this.insideBuilding(x, z)) return false;
    return !this.collideCircle(x, z, r, { x: 0, z: 0, nx: 0, nz: 0 });
  }

  // nearest free spot by spiral search
  findFree(x, z, r, maxR = 30) {
    if (this.isFree(x, z, r)) return [x, z];
    for (let rad = 1.5; rad <= maxR; rad += 1.5) {
      const n = Math.ceil((rad * Math.PI * 2) / 1.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
        if (this.isFree(px, pz, r)) return [px, pz];
      }
    }
    return [x, z];
  }

  clampToBounds(p, r = 0) {
    const b = this.bounds;
    let hit = false;
    if (p.x < b.minX + r) { p.x = b.minX + r; hit = true; } else if (p.x > b.maxX - r) { p.x = b.maxX - r; hit = true; }
    if (p.z < b.minZ + r) { p.z = b.minZ + r; hit = true; } else if (p.z > b.maxZ - r) { p.z = b.maxZ - r; hit = true; }
    return hit;
  }
}
