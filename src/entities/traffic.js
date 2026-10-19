// AI traffic: lane following on the OSM street network with traffic lights and car following.
import { TRAFFIC_MIX } from './vehicleModels.js';
import { randomLook } from './humans.js';
import { clamp, rand, chance } from '../util/math.js';

function weightedPick(list) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of list) { r -= w; if (r <= 0) return id; }
  return list[0][0];
}

const pt = { x: 0, z: 0, tx: 0, tz: 0 };

// Follows a route of (edge, dir) segments; used by traffic and as a base for other drivers.
export class RouteDriver {
  constructor(game, vehicle, ei, dir, s, lane) {
    this.game = game;
    this.vehicle = vehicle;
    this.ei = ei; this.dir = dir; this.s = s; this.lane = lane;
    this.next = null;
    this.look = randomLook('ped');
    this.personality = rand(0.85, 1.12);
    this.stuckT = 0; this.reverseT = 0; this.blockedT = 0; this.hornT = 0;
    this.panic = 0;
    this.ignoreLights = false;
    this.speedMul = 1;
    this.alive = true;
  }

  get graph() { return this.game.graph; }

  chooseNext() {
    const G = this.graph;
    const n = G.endNode(this.ei, this.dir);
    const opts = G.exits(n, this.ei, true).filter((o) => G.main[G.endNode(o.ei, o.dir)] || G.main[n]);
    if (!opts.length) return { ei: this.ei, dir: -this.dir };
    let best = null, total = 0;
    const scored = opts.map((o) => {
      const ang = Math.abs(G.turnAngle(this.ei, this.dir, o.ei, o.dir));
      const e = G.edges[o.ei];
      let w = 1 / (0.35 + ang) + (e.major ? 0.6 : 0) + (e.cls <= 1 ? 0.3 : -0.3);
      if (ang > 2.6) w *= 0.05; // avoid U-turns
      total += w;
      return [o, w];
    });
    let r = Math.random() * total;
    for (const [o, w] of scored) { r -= w; if (r <= 0) { best = o; break; } }
    return best || opts[0];
  }

  // project the vehicle onto the current edge to refresh s
  project() {
    const G = this.graph, e = G.edges[this.ei], v = this.vehicle;
    let bestD = Infinity, bestS = this.s;
    for (let i = 0; i < e.cum.length - 1; i++) {
      const ax = e.pts[i * 2], az = e.pts[i * 2 + 1], bx = e.pts[i * 2 + 2], bz = e.pts[i * 2 + 3];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((v.x - ax) * dx + (v.z - az) * dz) / l2 : 0;
      t = clamp(t, 0, 1);
      const px = ax + dx * t, pz = az + dz * t, d = (v.x - px) ** 2 + (v.z - pz) ** 2;
      if (d < bestD) { bestD = d; bestS = e.cum[i] + t * (e.cum[i + 1] - e.cum[i]); }
    }
    this.s = this.dir > 0 ? bestS : e.len - bestS;
    return Math.sqrt(bestD);
  }

  // lane target point `ahead` metres beyond the current position
  targetPoint(ahead, out) {
    const G = this.graph;
    let ei = this.ei, dir = this.dir, s = this.s + ahead;
    const len = G.edges[ei].len;
    let lane = this.lane;
    if (s > len) {
      if (!this.next) this.next = this.chooseNext();
      s -= len; ei = this.next.ei; dir = this.next.dir;
      lane = Math.min(lane, G.lanes(ei, dir) - 1);
      s = Math.min(s, G.edges[ei].len);
    }
    return G.lanePoint(ei, s, dir, lane, out);
  }

  advanceEdge() {
    const G = this.graph;
    if (!this.next) this.next = this.chooseNext();
    this.s -= G.edges[this.ei].len;
    this.ei = this.next.ei; this.dir = this.next.dir;
    this.lane = Math.min(this.lane, G.lanes(this.ei, this.dir) - 1);
    this.next = null;
    this.onEdgeChange?.();
  }

  // returns desired speed limited by traffic ahead (m/s)
  obstacleSpeed(maxLook) {
    const g = this.game, v = this.vehicle;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let minGap = Infinity, blockedByPlayer = false;
    for (const o of g.vehicles.list) {
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (Math.abs(dx) > maxLook || Math.abs(dz) > maxLook) continue;
      const lz = dx * fx + dz * fz;
      if (lz <= 0 || lz > maxLook) continue;
      const lx = dx * fz - dz * fx;
      if (Math.abs(lx) > 1.7 + lz * 0.04) continue;
      const gap = lz - (v.type.L + o.type.L) / 2;
      if (gap < minGap) { minGap = gap; blockedByPlayer = o.driver === 'player'; }
    }
    for (const h of g.humansForCollision()) {
      if (h.inVehicle || h.dead) continue;
      const dx = h.x - v.x, dz = h.z - v.z;
      if (Math.abs(dx) > 18 || Math.abs(dz) > 18) continue;
      const lz = dx * fx + dz * fz;
      if (lz <= 0 || lz > 16) continue;
      const lx = dx * fz - dz * fx;
      if (Math.abs(lx) > v.type.W / 2 + 0.9) continue;
      const gap = lz - v.type.L / 2 - 0.5;
      if (gap < minGap) { minGap = gap; blockedByPlayer = h === g.player; }
    }
    this.blockedByPlayer = blockedByPlayer && minGap < 6;
    if (minGap === Infinity) return Infinity;
    return Math.max(0, (minGap - 2.2) * 0.85);
  }

  drive(dt, cruise) {
    const g = this.game, G = this.graph, v = this.vehicle;
    if (v.destroyed) { v.ctrl.throttle = 0; return; }
    const off = this.project();
    if (this.s >= G.edges[this.ei].len - 0.3) this.advanceEdge();
    const sp = Math.max(0, v.speedF);
    const ahead = 4.5 + sp * 0.55 + v.type.L * 0.3;
    this.targetPoint(ahead, pt);
    // pure pursuit steering
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const dx = pt.x - v.x, dz = pt.z - v.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    const d2 = lx * lx + lz * lz;
    const curv = (2 * lx) / Math.max(1, d2);
    const steerAng = Math.atan(curv * v.wheelbase);
    let steer = clamp((-steerAng / v.type.steer) * (1 + sp * 0.018), -1, 1);
    // speed planning
    const e = G.edges[this.ei];
    let want = cruise;
    const remain = e.len - this.s;
    if (!this.next && remain < 45) this.next = this.chooseNext();
    if (this.next && remain < 45) {
      const ang = Math.abs(G.turnAngle(this.ei, this.dir, this.next.ei, this.next.dir));
      if (ang > 0.35) {
        const vt = clamp(15 - ang * 7.5, 4.5, 15);
        want = Math.min(want, Math.sqrt(vt * vt + 2 * 3.5 * Math.max(0, remain - 6)));
      }
    }
    // traffic lights
    const node = G.endNode(this.ei, this.dir);
    if (!this.ignoreLights && G.signal[node] >= 0) {
      const state = G.signalState(node, this.ei, g.time);
      const dStop = remain - G.stopDist(node, this.ei);
      if (state !== 0 && dStop > -1.5) {
        const canStop = sp * sp / (2 * 6) < dStop + 1 || state === 2;
        if (canStop) want = Math.min(want, dStop < 0.6 ? 0 : Math.sqrt(2 * 3.2 * Math.max(0, dStop - 0.6)));
      }
    }
    want = Math.min(want, this.obstacleSpeed(28 + sp));
    if (off > 6) want = Math.min(want, 6);
    // stuck handling
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      v.ctrl.throttle = -0.7; v.ctrl.steer = -steer; v.ctrl.handbrake = false;
      return;
    }
    if (want > 2 && sp < 0.4) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 3.5) { this.stuckT = 0; this.reverseT = 1.4; }
    // horn when the player blocks the road
    if (this.blockedByPlayer && sp < 1) { this.blockedT += dt; if (this.blockedT > 2.5 && this.hornT <= 0) { g.audio?.horn(v.x, v.z, v.type.L > 6); this.hornT = rand(1.5, 3); } }
    else this.blockedT = 0;
    this.hornT -= dt;
    const err = want - v.speedF;
    let thr = clamp(err * 0.45, -1, 1);
    if (want < 0.3 && Math.abs(v.speedF) < 1.2) { thr = 0; v.ctrl.handbrake = true; } else v.ctrl.handbrake = false;
    v.ctrl.throttle = thr;
    v.ctrl.steer = steer;
  }
}

export class TrafficDriver extends RouteDriver {
  constructor(game, vehicle, ei, dir, s, lane) {
    super(game, vehicle, ei, dir, s, lane);
    this.kind = 'traffic';
  }
  update(dt) {
    const G = this.graph;
    const e = G.edges[this.ei];
    let cruise = e.speed * this.personality * this.speedMul;
    if (this.panic > 0) { this.panic -= dt; cruise = Math.min(this.vehicle.type.maxSpeed * 0.8, cruise * 1.7); this.ignoreLights = true; }
    else this.ignoreLights = false;
    this.drive(dt, cruise);
  }
  onDamaged(amount, by) { if (by === 'player') { this.panic = 10; } }
  onShot(by) {
    if (by !== this.game.player) return;
    if (chance(0.45) && this.vehicle.speed < 6) this.game.ejectDriver(this.vehicle, true);
    else this.panic = 14;
  }
}

export class TrafficManager {
  constructor(game) {
    this.game = game;
    this.drivers = [];
    this.spawnT = 0;
  }

  get target() {
    const q = this.game.settings;
    return Math.round((q.quality === 'low' ? 18 : q.quality === 'medium' ? 26 : 34) * q.traffic);
  }

  update(dt) {
    const g = this.game, p = g.player;
    for (const d of this.drivers) if (d.alive && d.vehicle.driver === d) d.update(dt);
    // despawn
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 0.35;
    for (let i = this.drivers.length - 1; i >= 0; i--) {
      const d = this.drivers[i], v = d.vehicle;
      if (v.driver !== d) { this.drivers.splice(i, 1); continue; }
      const dist = Math.hypot(v.x - p.x, v.z - p.z);
      if ((dist > 300 && !g.isVisible(v.x, 1, v.z, 6)) || dist > 520 || (v.destroyed && dist > 120)) {
        this.drivers.splice(i, 1);
        if (!v.persistent) g.vehicles.remove(v);
        else v.driver = null;
      }
    }
    if (this.drivers.length < this.target) this.trySpawn();
  }

  trySpawn(near = null) {
    const g = this.game, G = g.graph, p = g.player;
    const cx = near ? near.x : p.x, cz = near ? near.z : p.z;
    const spot = G.randomSpot(cx, cz, near ? 30 : 120, near ? 120 : 260, (e) => e.cls <= 1 && e.len > 20);
    if (!spot) return null;
    const e = G.edges[spot.ei];
    let dir = Math.random() < 0.5 ? 1 : -1;
    if (!G.canTravel(spot.ei, dir)) dir = 1;
    const s = dir > 0 ? spot.s : e.len - spot.s;
    if (s < 8 || s > e.len - 8) return null;
    const lane = Math.floor(Math.random() * G.lanes(spot.ei, dir));
    G.lanePoint(spot.ei, s, dir, lane, pt);
    if (!near && g.isVisible(pt.x, 1, pt.z, 5) && Math.hypot(pt.x - p.x, pt.z - p.z) < 170) return null;
    for (const v of g.vehicles.list) if (Math.abs(v.x - pt.x) < 14 && Math.abs(v.z - pt.z) < 14) return null;
    if (!g.collision.isFree(pt.x, pt.z, 1.0)) return null;
    let type = weightedPick(TRAFFIC_MIX);
    if (e.major && Math.random() < 0.06) type = 'bus';
    const heading = Math.atan2(pt.tx, pt.tz);
    const v = g.vehicles.spawn(type, pt.x, pt.z, heading);
    if (!v) return null;
    const d = new TrafficDriver(g, v, spot.ei, dir, s, lane);
    v.driver = d;
    const sp = e.speed * 0.6;
    v.vx = pt.tx * sp; v.vz = pt.tz * sp;
    this.drivers.push(d);
    return d;
  }

  remove(driver) {
    const i = this.drivers.indexOf(driver);
    if (i >= 0) this.drivers.splice(i, 1);
    driver.alive = false;
  }
}
