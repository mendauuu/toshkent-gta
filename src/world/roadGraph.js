// Drivable street network from OpenStreetMap: lanes, traffic signals, nearest-road queries, A* routing.
import { clamp } from '../util/math.js';

export const SIGNAL_CYCLE = 34;
const GCELL = 40;

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < k.length && k[l] < mk) { m = l; mk = k[l]; }
        if (r < k.length && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export class RoadGraph {
  constructor(g, names) {
    const N = g.nodes.length / 2;
    this.nNodes = N;
    this.nx = new Float32Array(N);
    this.nz = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.nx[i] = g.nodes[i * 2] / 10; this.nz[i] = g.nodes[i * 2 + 1] / 10; }
    this.main = Uint8Array.from(g.main);
    this.names = names;
    this.edges = g.edges.map(([a, b, o, lf, lb, w, s, c, n, major, , p]) => {
      const pts = new Float32Array(p.length);
      for (let i = 0; i < p.length; i++) pts[i] = p[i] / 10;
      const cum = new Float32Array(pts.length / 2);
      for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      return { a, b, oneway: o, lf: Math.max(1, lf), lb, w: w / 10, speed: s, cls: c, name: n, major, len: cum[cum.length - 1], pts, cum };
    });
    this.nodeEdges = Array.from({ length: N }, () => []);
    this.edges.forEach((e, i) => { this.nodeEdges[e.a].push(i); this.nodeEdges[e.b].push(i); });

    // traffic signals grouped per junction
    this.signal = new Int32Array(N).fill(-1);
    const groups = new Map();
    for (const [n, c] of g.signals) { this.signal[n] = c; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(n); }
    this.clusters = [];
    this.signalNodes = g.signals.map(([n]) => n);
    for (const [c, nodes] of groups) {
      let best = null;
      for (const n of nodes) for (const ei of this.nodeEdges[n]) {
        const e = this.edges[ei];
        const score = e.major * 100 + e.w + e.len * 0.01;
        if (!best || score > best.score) best = { score, ei, n };
      }
      this.clusters[c] = { axis: this.edgeAngleAtNode(best.ei, best.n), offset: (c * 7.37) % SIGNAL_CYCLE, nodes };
    }

    // spatial index of edge segments
    this.grid = new Map();
    this.edges.forEach((e, ei) => {
      for (let si = 0; si < e.cum.length - 1; si++) {
        const ax = e.pts[si * 2], az = e.pts[si * 2 + 1], bx = e.pts[si * 2 + 2], bz = e.pts[si * 2 + 3];
        for (let ix = Math.floor(Math.min(ax, bx) / GCELL); ix <= Math.floor(Math.max(ax, bx) / GCELL); ix++)
          for (let iz = Math.floor(Math.min(az, bz) / GCELL); iz <= Math.floor(Math.max(az, bz) / GCELL); iz++) {
            const k = ix * 100003 + iz;
            let arr = this.grid.get(k); if (!arr) this.grid.set(k, (arr = []));
            arr.push(ei, si);
          }
      }
    });
    this.spawnEdges = [];
    this.edges.forEach((e, i) => { if (this.main[e.a] && this.main[e.b] && e.len > 25 && e.cls <= 1) this.spawnEdges.push(i); });
  }

  degree(n) { return this.nodeEdges[n].length; }
  other(ei, n) { const e = this.edges[ei]; return e.a === n ? e.b : e.a; }
  canTravel(ei, dir) { return !this.edges[ei].oneway || dir > 0; }
  lanes(ei, dir) { const e = this.edges[ei]; return e.oneway ? e.lf : dir > 0 ? e.lf : Math.max(1, e.lb); }
  laneOffset(ei, dir, lane) {
    const e = this.edges[ei];
    if (e.oneway) { const lw = e.w / e.lf; return -e.w / 2 + lw * (lane + 0.5); }
    const lw = Math.min(3.7, e.w / Math.max(2, e.lf + e.lb));
    return lw * (lane + 0.5);
  }
  sidewalkOffset(ei) { return this.edges[ei].w / 2 + 1.7; }
  // distance before node n where traffic arriving on edge ei stops (clear of the crossing street)
  stopDist(n, ei) {
    let m = 0;
    for (const ej of this.nodeEdges[n]) if (ej !== ei) m = Math.max(m, this.edges[ej].w / 2);
    return Math.min(Math.max(4, m + 2.5), Math.max(2, this.edges[ei].len - 2));
  }
  endNode(ei, dir) { const e = this.edges[ei]; return dir > 0 ? e.b : e.a; }
  startNode(ei, dir) { const e = this.edges[ei]; return dir > 0 ? e.a : e.b; }
  nameOf(ei) { const n = this.edges[ei].name; return n >= 0 ? this.names[n] : ''; }

  // direction (radians, atan2(dz,dx)) of the edge leaving node n
  edgeAngleAtNode(ei, n) {
    const e = this.edges[ei], p = e.pts, m = p.length / 2;
    if (e.a === n) return Math.atan2(p[3] - p[1], p[2] - p[0]);
    return Math.atan2(p[(m - 2) * 2 + 1] - p[(m - 1) * 2 + 1], p[(m - 2) * 2] - p[(m - 1) * 2]);
  }

  // 0 = green, 1 = yellow, 2 = red for traffic arriving at node n along edge ei
  signalState(n, ei, time) {
    const c = this.signal[n];
    if (c < 0) return 0;
    const cl = this.clusters[c];
    const alongA = Math.abs(Math.cos(this.edgeAngleAtNode(ei, n) - cl.axis)) > 0.6;
    const t = (((time + cl.offset) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
    if (alongA) return t < 13 ? 0 : t < 16 ? 1 : 2;
    return t >= 17 && t < 30 ? 0 : t >= 30 && t < 33 ? 1 : 2;
  }

  // position and travel tangent at arc length s (measured in travel direction)
  pointAt(ei, s, dir, out) {
    const e = this.edges[ei];
    const d = clamp(dir > 0 ? s : e.len - s, 0, e.len);
    const cum = e.cum;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const sl = cum[hi] - cum[lo];
    const f = sl > 0 ? (d - cum[lo]) / sl : 0;
    const ax = e.pts[lo * 2], az = e.pts[lo * 2 + 1], bx = e.pts[hi * 2], bz = e.pts[hi * 2 + 1];
    out.x = ax + (bx - ax) * f;
    out.z = az + (bz - az) * f;
    let tx = bx - ax, tz = bz - az;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    if (dir < 0) { tx = -tx; tz = -tz; }
    out.tx = tx; out.tz = tz;
    return out;
  }

  // lane centre point: right-hand traffic, right = (-tz, tx)
  lanePoint(ei, s, dir, lane, out) {
    this.pointAt(ei, s, dir, out);
    const off = this.laneOffset(ei, dir, lane);
    out.x += -out.tz * off;
    out.z += out.tx * off;
    return out;
  }

  // edges a vehicle may take after arriving at node n via edge fromEi
  exits(n, fromEi, forVehicle = true) {
    const out = [];
    for (const ei of this.nodeEdges[n]) {
      if (ei === fromEi) continue;
      const dir = this.edges[ei].a === n ? 1 : -1;
      if (forVehicle && !this.canTravel(ei, dir)) continue;
      out.push({ ei, dir });
    }
    if (!out.length && fromEi >= 0) {
      const dir = this.edges[fromEi].a === n ? 1 : -1;
      if (!forVehicle || this.canTravel(fromEi, dir)) out.push({ ei: fromEi, dir });
    }
    return out;
  }

  // turn angle (radians, signed) when going from (ei,dir) into (ej,dj)
  turnAngle(ei, dir, ej, dj) {
    const n = this.endNode(ei, dir);
    const inAng = this.edgeAngleAtNode(ei, n) + Math.PI;
    const outAng = this.edgeAngleAtNode(ej, n);
    let d = outAng - inAng;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  nearest(x, z, maxDist = 60, filter = null) {
    let best = null, bestD2 = maxDist * maxDist;
    const r = Math.ceil(maxDist / GCELL);
    const cx = Math.floor(x / GCELL), cz = Math.floor(z / GCELL);
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const arr = this.grid.get(ix * 100003 + iz);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const ei = arr[k], si = arr[k + 1], e = this.edges[ei];
        if (filter && !filter(e, ei)) continue;
        const ax = e.pts[si * 2], az = e.pts[si * 2 + 1], bx = e.pts[si * 2 + 2], bz = e.pts[si * 2 + 3];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t, pz = az + dz * t, d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
        if (d2 < bestD2) { bestD2 = d2; best = { ei, si, t, x: px, z: pz }; }
      }
    }
    if (!best) return null;
    const e = this.edges[best.ei];
    best.s = e.cum[best.si] + best.t * (e.cum[best.si + 1] - e.cum[best.si]);
    best.dist = Math.sqrt(bestD2);
    return best;
  }

  // up to `limit` different edges near (x,z), nearest first: [{ei, s, x, z, dist}]
  nearestEdges(x, z, maxDist = 100, filter = null, limit = 8) {
    const best = new Map();
    const r = Math.ceil(maxDist / GCELL);
    const cx = Math.floor(x / GCELL), cz = Math.floor(z / GCELL);
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const arr = this.grid.get(ix * 100003 + iz);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const ei = arr[k], si = arr[k + 1], e = this.edges[ei];
        if (filter && !filter(e, ei)) continue;
        const ax = e.pts[si * 2], az = e.pts[si * 2 + 1], bx = e.pts[si * 2 + 2], bz = e.pts[si * 2 + 3];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d > maxDist) continue;
        const prev = best.get(ei);
        if (!prev || d < prev.dist) best.set(ei, { ei, x: px, z: pz, dist: d, s: e.cum[si] + t * (e.cum[si + 1] - e.cum[si]) });
      }
    }
    return [...best.values()].sort((a, b) => a.dist - b.dist).slice(0, limit);
  }

  // distance from (x,z) to the centre line of edge ei
  distToEdge(ei, x, z) {
    const e = this.edges[ei];
    let best = Infinity;
    for (let i = 0; i < e.cum.length - 1; i++) {
      const ax = e.pts[i * 2], az = e.pts[i * 2 + 1], bx = e.pts[i * 2 + 2], bz = e.pts[i * 2 + 3];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
    return best;
  }

  nameAt(x, z) {
    const n = this.nearest(x, z, 30);
    return n ? this.nameOf(n.ei) : '';
  }

  // A* over the network; returns a flat [x,z,...] polyline from start to target or null
  findPath(sx, sz, tx, tz, vehicle = true) {
    const A = this.nearest(sx, sz, 250), B = this.nearest(tx, tz, 250);
    if (!A || !B) return null;
    const ea = this.edges[A.ei], eb = this.edges[B.ei];
    if (A.ei === B.ei && (!ea.oneway || !vehicle || B.s >= A.s)) return [A.x, A.z, B.x, B.z];
    const N = this.nNodes;
    const g = new Float64Array(N).fill(Infinity);
    const prevNode = new Int32Array(N).fill(-1), prevEdge = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const h = (n) => Math.hypot(this.nx[n] - B.x, this.nz[n] - B.z);
    const seed = (n, cost) => { if (cost < g[n]) { g[n] = cost; prevNode[n] = -2; prevEdge[n] = A.ei; heap.push(cost + h(n), n); } };
    if (!vehicle || !ea.oneway) seed(ea.a, A.s);
    seed(ea.b, ea.len - A.s);
    // goal: reach one end of edge B (respecting its direction) then drive along it
    const goalCost = (n) => {
      if (n === eb.a) return B.s;
      if (n === eb.b && (!vehicle || !eb.oneway)) return eb.len - B.s;
      return Infinity;
    };
    let bestGoal = -1, bestTotal = Infinity;
    let iter = 0;
    while (heap.size && iter++ < 60000) {
      const n = heap.pop();
      if (closed[n]) continue;
      closed[n] = 1;
      if (g[n] >= bestTotal) break;
      const gc = goalCost(n);
      if (g[n] + gc < bestTotal) { bestTotal = g[n] + gc; bestGoal = n; }
      for (const ei of this.nodeEdges[n]) {
        const e = this.edges[ei];
        const dir = e.a === n ? 1 : -1;
        if (vehicle && e.oneway && dir < 0) continue;
        const m = dir > 0 ? e.b : e.a;
        if (closed[m]) continue;
        const w = e.len * (e.major ? 0.85 : e.cls >= 2 ? 1.7 : 1.15);
        const ng = g[n] + w;
        if (ng < g[m]) { g[m] = ng; prevNode[m] = n; prevEdge[m] = ei; heap.push(ng + h(m), m); }
      }
    }
    if (bestGoal < 0) return null;
    // rebuild node chain
    const chain = [];
    for (let n = bestGoal; n >= 0; n = prevNode[n]) { chain.push(n); if (prevNode[n] === -2) break; }
    chain.reverse();
    const out = [A.x, A.z];
    const appendEdge = (ei, fromNode, s0, s1) => {
      // append points of edge ei between arc lengths s0..s1 measured from node a
      const e = this.edges[ei];
      const forward = s1 >= s0;
      const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
      const idx = [];
      for (let i = 0; i < e.cum.length; i++) if (e.cum[i] > lo && e.cum[i] < hi) idx.push(i);
      if (!forward) idx.reverse();
      for (const i of idx) out.push(e.pts[i * 2], e.pts[i * 2 + 1]);
    };
    // first partial edge
    const first = chain[0];
    appendEdge(A.ei, first, A.s, first === ea.a ? 0 : ea.len);
    out.push(this.nx[first], this.nz[first]);
    for (let i = 1; i < chain.length; i++) {
      const n = chain[i], ei = prevEdge[n], e = this.edges[ei];
      const from = chain[i - 1];
      appendEdge(ei, from, from === e.a ? 0 : e.len, from === e.a ? e.len : 0);
      out.push(this.nx[n], this.nz[n]);
    }
    appendEdge(B.ei, bestGoal, bestGoal === eb.a ? 0 : eb.len, B.s);
    out.push(B.x, B.z);
    return out;
  }

  // random spawn location on a main-network edge between minD and maxD from (x,z)
  randomSpot(x, z, minD, maxD, filter = null, tries = 24) {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, r = minD + Math.random() * (maxD - minD);
      const n = this.nearest(x + Math.cos(a) * r, z + Math.sin(a) * r, 45, filter);
      if (!n) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < minD || d > maxD) continue;
      const e = this.edges[n.ei];
      if (!this.main[e.a] || !this.main[e.b]) continue;
      return n;
    }
    return null;
  }
}
