// Pedestrians walking the sidewalks of the real street network.
import { Human, randomLook, POSE } from './humans.js';
import { clamp, rand, chance, dampAngle, choice } from '../util/math.js';

const out = { x: 0, z: 0, nx: 0, nz: 0 };
const pt = { x: 0, z: 0, tx: 0, tz: 0 };

// shared movement helpers for any NPC on foot
export function moveHuman(game, h, dt, tx, tz, speed, turn = 10) {
  const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
  if (d > 0.05) {
    h.heading = dampAngle(h.heading, Math.atan2(dx, dz), turn, dt);
    const sp = Math.min(speed, d / Math.max(dt, 1e-3));
    h.vx = (dx / d) * sp; h.vz = (dz / d) * sp;
  } else { h.vx = 0; h.vz = 0; }
  h.x += h.vx * dt; h.z += h.vz * dt;
  if (game.collision.collideCircle(h.x, h.z, h.radius, out)) { h.x = out.x; h.z = out.z; }
  game.collision.clampToBounds(h, 1);
  h.animate(dt, Math.hypot(h.vx, h.vz));
  return d;
}

// knock-down / ragdoll and getting back up; returns true while busy
export function updateRagdoll(game, h, dt) {
  if (h.ragdoll > 0) {
    h.ragdoll -= dt;
    h.vy -= 20 * dt;
    h.x += h.vx * dt; h.z += h.vz * dt; h.y += h.vy * dt;
    if (h.y <= 0) { h.y = 0; h.vy = 0; const k = Math.exp(-6 * dt); h.vx *= k; h.vz *= k; }
    h.spin += (h.spinRate || 0) * dt;
    h.lie = Math.min(1, h.lie + dt * 5);
    if (game.collision.collideCircle(h.x, h.z, h.radius, out)) { h.x = out.x; h.z = out.z; h.vx *= -0.3; h.vz *= -0.3; }
    game.collision.clampToBounds(h, 1);
    h.animAmp = 0;
    return true;
  }
  if (!h.dead && h.lie > 0) {
    h.lie = Math.max(0, h.lie - dt * 2.2);
    h.heading += h.spin; h.spin = 0;
    return h.lie > 0.05;
  }
  return false;
}

export class Ped extends Human {
  constructor(game, look, x, z) {
    super(look, x, z);
    this.game = game;
    this.kind = 'ped';
    this.state = 'walk';
    this.walkSpeed = rand(1.15, 1.6);
    this.route = null;
    this.stateT = 0;
    this.threatX = 0; this.threatZ = 0;
    this.lastMoveT = 0; this.lastX = x; this.lastZ = z;
    this.attackT = 0;
    this.brave = !look.female && chance(0.22);
  }

  snapToSidewalk() {
    const G = this.game.graph;
    const n = G.nearest(this.x, this.z, 80);
    if (!n) return false;
    const e = G.edges[n.ei];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const s = dir > 0 ? n.s : e.len - n.s;
    G.pointAt(n.ei, s, dir, pt);
    const rx = -pt.tz, rz = pt.tx;
    const side = (this.x - n.x) * rx + (this.z - n.z) * rz >= 0 ? 1 : -1;
    this.route = { ei: n.ei, dir, s, side };
    return true;
  }

  sidewalkPoint(r, s, outp) {
    const G = this.game.graph;
    G.pointAt(r.ei, s, r.dir, outp);
    const off = G.sidewalkOffset(r.ei) * r.side;
    outp.x += -outp.tz * off;
    outp.z += outp.tx * off;
    return outp;
  }

  nextEdge() {
    const G = this.game.graph, r = this.route;
    const n = G.endNode(r.ei, r.dir);
    const opts = G.exits(n, r.ei, false);
    const o = choice(opts);
    if (!o) { r.dir = -r.dir; r.s = 0; r.side = -r.side; return; }
    const nr = { ei: o.ei, dir: o.dir, s: 0, side: 1 };
    const a = this.sidewalkPoint(nr, 0.5, {});
    nr.side = -1;
    const b = this.sidewalkPoint(nr, 0.5, {});
    nr.side = Math.hypot(a.x - this.x, a.z - this.z) <= Math.hypot(b.x - this.x, b.z - this.z) ? 1 : -1;
    this.route = nr;
  }

  react(type, x, z, by) {
    if (this.dead || this.state === 'scripted') return;
    this.threatX = x; this.threatZ = z;
    if (type === 'gunshot' || type === 'explosion') {
      if (this.state === 'flee' || this.state === 'cower') { this.stateT = Math.max(this.stateT, 5); return; }
      if (chance(type === 'explosion' ? 0.05 : 0.3) && Math.hypot(x - this.x, z - this.z) < 18) { this.state = 'cower'; this.stateT = rand(3, 6); }
      else { this.state = 'flee'; this.stateT = rand(7, 12); }
    } else if (type === 'attacked') {
      if (this.brave && by === this.game.player && !this.game.player.vehicle) { this.state = 'fight'; this.stateT = 15; }
      else { this.state = 'flee'; this.stateT = rand(8, 13); }
    } else if (type === 'aimed') {
      if (this.state === 'walk' || this.state === 'idle') { this.state = chance(0.6) ? 'cower' : 'flee'; this.stateT = rand(4, 7); }
    } else if (type === 'fear') {
      if (this.state === 'walk' || this.state === 'idle') { this.state = 'flee'; this.stateT = rand(4, 8); }
    }
  }

  update(dt) {
    const g = this.game;
    if (this.dead) { this.deadTime += dt; updateRagdoll(g, this, dt); this.lie = Math.min(1, this.lie + dt * 4); return; }
    if (updateRagdoll(g, this, dt)) return;
    this.pose = POSE.WALK;
    this.stateT -= dt;
    switch (this.state) {
      case 'walk': {
        if (!this.route && !this.snapToSidewalk()) { this.state = 'idle'; this.stateT = 5; break; }
        const r = this.route, e = g.graph.edges[r.ei];
        r.s += this.walkSpeed * dt;
        if (r.s >= e.len) { this.nextEdge(); break; }
        this.sidewalkPoint(r, Math.min(e.len, r.s + 1.2), pt);
        moveHuman(g, this, dt, pt.x, pt.z, this.walkSpeed * 1.25, 6);
        // stuck against something: turn around
        if (g.time - this.lastMoveT > 3) {
          if (Math.hypot(this.x - this.lastX, this.z - this.lastZ) < 0.6) { r.dir = -r.dir; r.s = e.len - r.s; r.side = -r.side; }
          this.lastMoveT = g.time; this.lastX = this.x; this.lastZ = this.z;
        }
        if (chance(dt * 0.025)) { this.state = 'idle'; this.stateT = rand(2, 7); }
        break;
      }
      case 'idle':
        this.vx = this.vz = 0;
        this.animate(dt, 0);
        if (this.stateT <= 0) this.state = 'walk';
        break;
      case 'flee': {
        const dx = this.x - this.threatX, dz = this.z - this.threatZ, d = Math.hypot(dx, dz) || 1;
        const tx = this.x + (dx / d) * 5 + Math.sin(g.time + this.animPhase) * 1.5, tz = this.z + (dz / d) * 5 + Math.cos(g.time * 0.7 + this.animPhase) * 1.5;
        moveHuman(g, this, dt, tx, tz, 6.2, 8);
        this.pose = POSE.PANIC;
        if (this.stateT <= 0) { this.state = 'walk'; this.route = null; }
        break;
      }
      case 'cower':
        this.vx = this.vz = 0;
        this.pose = POSE.HANDSUP;
        this.animate(dt, 0);
        this.heading = dampAngle(this.heading, Math.atan2(this.threatX - this.x, this.threatZ - this.z), 5, dt);
        if (this.stateT <= 0) { this.state = 'flee'; this.stateT = rand(5, 9); }
        break;
      case 'fight': {
        const p = g.player;
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (p.dead || p.vehicle || d > 25 || this.stateT <= 0) { this.state = 'walk'; this.route = null; break; }
        if (d > 1.15) moveHuman(g, this, dt, p.x, p.z, 4.8, 10);
        else {
          this.vx = this.vz = 0; this.animate(dt, 0);
          this.heading = dampAngle(this.heading, Math.atan2(p.x - this.x, p.z - this.z), 10, dt);
          this.attackT -= dt;
          if (this.attackT <= 0) { this.attackT = 1.1; this.punchT = 0.3; g.damageHuman(p, rand(4, 8), this, 'melee'); g.audio?.punch(); }
        }
        if (this.punchT > 0) { this.pose = POSE.PUNCH; this.animAmp = 1 - this.punchT / 0.3; }
        break;
      }
      case 'scripted':
        if (this.script) this.script(dt);
        break;
    }
  }
}

export class PedManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.spawnT = 0;
  }
  get target() {
    const s = this.game.settings;
    return Math.round((s.quality === 'low' ? 18 : s.quality === 'medium' ? 30 : 42) * s.peds);
  }
  update(dt) {
    const g = this.game, p = g.player;
    for (const h of this.list) h.update(dt);
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 0.3;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      if (h.persistent) continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if ((d > 160 && !g.isVisible(h.x, 1, h.z, 2)) || d > 260 || (h.dead && h.deadTime > 40 && !g.isVisible(h.x, 0.5, h.z, 2))) this.list.splice(i, 1);
    }
    let tries = 2;
    while (this.list.length < this.target && tries-- > 0) this.trySpawn();
  }
  trySpawn() {
    const g = this.game, G = g.graph, p = g.player;
    const spot = G.randomSpot(p.x, p.z, 45, 120, (e) => e.cls <= 1 || e.cls === 2);
    if (!spot) return null;
    const e = G.edges[spot.ei];
    const side = Math.random() < 0.5 ? 1 : -1;
    G.pointAt(spot.ei, spot.s, 1, pt);
    const off = G.sidewalkOffset(spot.ei) * side;
    const x = pt.x - pt.tz * off, z = pt.z + pt.tx * off;
    if (g.isVisible(x, 1, z, 1) && Math.hypot(x - p.x, z - p.z) < 90) return null;
    if (!g.collision.isFree(x, z, 0.4)) return null;
    const ped = new Ped(g, randomLook('ped'), x, z);
    const dir = Math.random() < 0.5 ? 1 : -1;
    ped.route = { ei: spot.ei, dir, s: dir > 0 ? spot.s : e.len - spot.s, side: dir > 0 ? side : -side };
    ped.heading = Math.atan2(pt.tx * dir, pt.tz * dir);
    this.list.push(ped);
    return ped;
  }
  add(ped) { this.list.push(ped); return ped; }
  remove(ped) { const i = this.list.indexOf(ped); if (i >= 0) this.list.splice(i, 1); }
}
