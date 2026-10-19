// Wanted level, police cars chasing the player, officers on foot and the helicopter.
import * as THREE from 'three';
import { Human, randomLook, POSE } from './humans.js';
import { moveHuman, updateRagdoll } from './peds.js';
import { TrafficDriver } from './traffic.js';
import { clamp, rand, chance, dampAngle } from '../util/math.js';
import { mergeBoxes } from '../world/city.js';

const HEAT = [0, 1, 4, 9, 16, 26];
const pt = { x: 0, z: 0, tx: 0, tz: 0 };

// drives toward the player using A* paths or direct pursuit when in sight
export class ChaseDriver {
  constructor(game, vehicle, unit) {
    this.game = game; this.vehicle = vehicle; this.unit = unit;
    this.kind = 'police';
    this.path = null; this.pathIdx = 0; this.pathT = 0;
    this.stuckT = 0; this.reverseT = 0;
    this.look = randomLook('police');
    this.mode = 'chase';
  }
  onDamaged(amount, by) { if (by === 'player') this.game.police.crime('assaultcop', this.vehicle.x, this.vehicle.z, true); }
  onShot(by) { if (by === this.game.player) this.game.police.crime('assaultcop', this.vehicle.x, this.vehicle.z, true); }
  targetPos() {
    const p = this.game.player;
    return p.vehicle ? p.vehicle : p;
  }
  update(dt) {
    const g = this.game, v = this.vehicle;
    if (v.destroyed) { v.ctrl.throttle = 0; return; }
    v.sirenOn = true;
    const t = this.targetPos();
    const tx = t.x, tz = t.z;
    const d = Math.hypot(tx - v.x, tz - v.z);
    this.pathT -= dt;
    const los = d < 80 && g.collision.lineOfSight(v.x, v.z, 1.0, tx, tz, 1.0);
    let ax = tx, az = tz;
    if (los) {
      const lead = Math.min(1.1, d / 35);
      ax = tx + (t.vx || 0) * lead; az = tz + (t.vz || 0) * lead;
      this.path = null;
    } else {
      if (!this.path || this.pathT <= 0) {
        this.path = g.graph.findPath(v.x, v.z, tx, tz, false);
        this.pathIdx = 0;
        this.pathT = 1.8;
      }
      if (this.path) {
        const P = this.path, la = 7 + v.speed * 0.45;
        while (this.pathIdx < P.length / 2 - 1 && Math.hypot(P[this.pathIdx * 2] - v.x, P[this.pathIdx * 2 + 1] - v.z) < la) this.pathIdx++;
        ax = P[this.pathIdx * 2]; az = P[this.pathIdx * 2 + 1];
      }
    }
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const dx = ax - v.x, dz = az - v.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    const ang = Math.atan2(lx, lz);
    const curv = (2 * lx) / Math.max(1, lx * lx + lz * lz);
    let steer = clamp((-Math.atan(curv * v.wheelbase) / v.type.steer) * (1 + v.speed * 0.02), -1, 1);
    let want = v.type.maxSpeed * 0.82;
    if (Math.abs(ang) > 0.5) want = Math.min(want, clamp(28 - Math.abs(ang) * 18, 7, want));
    const pv = g.player.vehicle;
    // brake in time for a suspect on foot instead of running them over
    if (!pv) want = Math.min(want, Math.sqrt(2 * 8 * Math.max(0, d - 11)));
    const deploy = d < 17 && (!pv || pv.speed < 2.5);
    if (deploy) want = 0;
    // reverse when the target is behind and close
    if (lz < -2 && d < 18 && !deploy) { v.ctrl.throttle = -0.8; v.ctrl.steer = -Math.sign(lx || 1); v.ctrl.handbrake = false; return; }
    if (this.reverseT > 0) { this.reverseT -= dt; v.ctrl.throttle = -0.8; v.ctrl.steer = -steer; v.ctrl.handbrake = false; return; }
    if (want > 3 && v.speed < 0.6) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 2.2) { this.stuckT = 0; this.reverseT = 1.2; this.path = null; }
    const err = want - v.speedF;
    v.ctrl.throttle = clamp(err * 0.5, -1, 1);
    v.ctrl.handbrake = want < 0.5 && v.speed < 1.5;
    v.ctrl.steer = steer;
    if (deploy && v.speed < 3 && this.unit) this.unit.deploy();
  }
}

export class Cop extends Human {
  constructor(game, x, z, unit) {
    super(randomLook('police'), x, z);
    this.game = game;
    this.kind = 'cop';
    this.unit = unit;
    this.weapon = 'pistol';
    this.fireT = rand(0.5, 1.2);
    this.arrestT = 0;
    this.health = 100;
    this.persistent = true;
    this.showGun = true;
  }
  update(dt) {
    const g = this.game, p = g.player, pol = g.police;
    if (this.dead) { this.deadTime += dt; updateRagdoll(g, this, dt); this.lie = Math.min(1, this.lie + dt * 4); return; }
    if (updateRagdoll(g, this, dt)) return;
    const target = p.vehicle || p;
    const d = Math.hypot(target.x - this.x, target.z - this.z);
    this.pose = POSE.WALK;
    if (pol.level === 0 || p.dead || this.unit?.recall) {
      // go back to the car
      const v = this.unit?.vehicle;
      if (v && !v.destroyed) { const dd = moveHuman(g, this, dt, v.x, v.z, this.unit.recall ? 6 : 2.2); if (dd < 2.6) this.unit.board(this); }
      else this.animate(dt, 0);
      return;
    }
    const los = d < 60 && g.collision.lineOfSight(this.x, this.z, 1.5, target.x, target.z, 1.2);
    const pv = p.vehicle;
    const canArrest = (!pv && !p.entering) || (pv && pv.speed < 1);
    if (canArrest && d < (pv ? 2.6 : 1.5)) {
      this.vx = this.vz = 0; this.animate(dt, 0);
      this.heading = dampAngle(this.heading, Math.atan2(target.x - this.x, target.z - this.z), 8, dt);
      this.arrestT += dt;
      this.pose = POSE.AIM;
      if (this.arrestT > (pv ? 2.2 : 1.5)) g.bustPlayer();
      return;
    }
    this.arrestT = Math.max(0, this.arrestT - dt);
    const shootLevel = pol.level >= 2 || pv;
    if (shootLevel && los && d < 40 && pol.level >= 2) {
      this.pose = POSE.AIM;
      if (d > 11) moveHuman(g, this, dt, target.x, target.z, 3.2, 12);
      else { this.vx = this.vz = 0; this.animate(dt, 0); }
      this.heading = dampAngle(this.heading, Math.atan2(target.x - this.x, target.z - this.z), 12, dt);
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = rand(0.9, 1.7) / (0.85 + pol.level * 0.1);
        g.combat.npcShoot(this, this.weapon, target === p ? p : { x: pv.x, z: pv.z, y: 0, vehicle: pv }, 0.42 + pol.level * 0.05);
      }
    } else {
      moveHuman(g, this, dt, target.x, target.z, d > 30 ? 6.2 : 5.4, 10);
    }
  }
}

class Unit {
  constructor(manager, vehicle) {
    this.m = manager; this.game = manager.game;
    this.vehicle = vehicle;
    this.driver = new ChaseDriver(this.game, vehicle, this);
    vehicle.driver = this.driver;
    vehicle.persistent = true;
    this.cops = [];
    this.state = 'driving';
    this.deployT = 0;
  }
  deploy() {
    if (this.state !== 'driving') return;
    const v = this.vehicle, g = this.game;
    this.state = 'onfoot';
    v.driver = null;
    v.ctrl.throttle = 0; v.ctrl.handbrake = true;
    for (const side of [-1, 1]) {
      const pos = v.doorPos(side);
      const [x, z] = g.collision.findFree(pos.x, pos.z, 0.35, 6);
      const cop = new Cop(g, x, z, this);
      cop.heading = v.heading;
      this.cops.push(cop);
      this.m.cops.push(cop);
    }
  }
  board(cop) {
    cop.boarded = true;
    this.m.removeCop(cop);
    if (this.cops.every((c) => c.boarded || c.dead)) {
      this.cops = this.cops.filter((c) => c.dead);
      this.recall = false;
      if (!this.vehicle.destroyed && !this.vehicle.driver && this.m.level > 0) { this.vehicle.driver = this.driver; this.state = 'driving'; }
      else if (!this.vehicle.destroyed && !this.vehicle.driver) this.vehicle.persistent = false;
    }
  }
  update(dt) {
    const g = this.game, p = g.player, v = this.vehicle;
    if (this.state === 'onfoot') {
      const alive = this.cops.filter((c) => !c.dead && !c.boarded);
      const target = p.vehicle || p;
      // when the player gets away, the officers run back to their car and resume the chase
      this.recall = alive.length > 0 && !v.destroyed && !v.driver && this.m.level > 0 && alive.every((c) => Math.hypot(c.x - target.x, c.z - target.z) > 40);
    }
    if (v.driver === this.driver) this.driver.update(dt);
  }
}

export class PoliceManager {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.level = 0;
    this.units = [];
    this.cops = [];
    this.seen = false;
    this.unseenT = 0;
    this.checkT = 0;
    this.spawnT = 0;
    this.reports = [];
    this.lastShotReport = -99;
    this.heli = null;
    this.maxLevelThisLife = 0;
  }

  get searchTime() { return 9 + this.level * 4.5; }
  get flashing() { return this.level > 0 && !this.seen; }

  setWanted(level) {
    this.heat = Math.max(this.heat, HEAT[clamp(level, 0, 5)]);
    this.refresh();
    this.seen = true; this.unseenT = 0;
  }
  clear() {
    const had = this.level > 0;
    this.heat = 0;
    this.refresh();
    if (had) this.release();
  }
  refresh() {
    let lv = 0;
    for (let i = 0; i < HEAT.length; i++) if (this.heat >= HEAT[i]) lv = i;
    if (this.heat > 0) lv = Math.max(1, lv);
    const prev = this.level;
    this.level = clamp(lv, 0, 5);
    if (this.level > prev) { this.seen = true; this.unseenT = 0; this.game.hud?.flashStars(); }
    this.maxLevelThisLife = Math.max(this.maxLevelThisLife, this.level);
  }
  addHeat(h) { this.heat = Math.min(HEAT[5] + 6, this.heat + h); this.refresh(); }

  copNear(x, z, r) {
    for (const u of this.units) { const v = u.vehicle; if (Math.hypot(v.x - x, v.z - z) < r && this.game.collision.lineOfSight(v.x, v.z, 1.3, x, z, 1.3)) return true; }
    for (const c of this.cops) if (!c.dead && Math.hypot(c.x - x, c.z - z) < r && this.game.collision.lineOfSight(c.x, c.z, 1.5, x, z, 1.3)) return true;
    return false;
  }

  // report a crime; witnessed crimes count immediately, others after civilians call it in
  crime(type, x, z, witnessed = false) {
    const g = this.game;
    const H = { carjack: 1, hitped: 1, killped: 2.2, shots: 1, assaultcop: 3, killcop: 5, vehicle: 2, copcar: 4, explosion: 2, attack: 1 }[type] || 1;
    if (type === 'shots') {
      if (g.time - this.lastShotReport < 8) return;
      this.lastShotReport = g.time;
    }
    if (witnessed || this.copNear(x, z, type === 'shots' ? 70 : 42) || this.level > 0) { this.addHeat(H); return; }
    // civilians nearby call the police
    let witnesses = 0;
    for (const h of g.peds.list) if (!h.dead && Math.hypot(h.x - x, h.z - z) < 30) witnesses++;
    if (witnesses && chance(type === 'carjack' ? 0.5 : 0.85)) this.reports.push({ t: g.time + rand(3, 7), heat: H });
  }

  release() {
    // units stop chasing and blend back into traffic
    const g = this.game;
    for (const u of this.units) {
      const v = u.vehicle;
      for (const c of u.cops) if (!c.dead) this.removeCop(c);
      if (v.destroyed) { v.persistent = false; continue; }
      const n = g.graph.nearest(v.x, v.z, 60);
      if (n) {
        const d = new TrafficDriver(g, v, n.ei, g.graph.canTravel(n.ei, -1) && chance(0.5) ? -1 : 1, 0, 0);
        d.s = d.dir > 0 ? n.s : g.graph.edges[n.ei].len - n.s;
        d.look = u.driver.look;
        v.driver = d; v.sirenOn = false; v.persistent = false;
        g.traffic.drivers.push(d);
      } else { v.driver = null; v.persistent = false; }
    }
    this.units = [];
    if (this.heli) this.heli.leaving = true;
  }

  removeCop(c) { const i = this.cops.indexOf(c); if (i >= 0) this.cops.splice(i, 1); }

  spawnUnit() {
    const g = this.game, p = g.player, G = g.graph;
    const spot = G.randomSpot(p.x, p.z, 90, 190, (e) => e.cls <= 1);
    if (!spot) return;
    const e = G.edges[spot.ei];
    // face roughly toward the player
    G.pointAt(spot.ei, spot.s, 1, pt);
    let heading = Math.atan2(pt.tx, pt.tz);
    if ((p.x - pt.x) * pt.tx + (p.z - pt.z) * pt.tz < 0) heading += Math.PI;
    if (!g.collision.isFree(pt.x, pt.z, 1.1)) return;
    for (const v of g.vehicles.list) if (Math.hypot(v.x - pt.x, v.z - pt.z) < 10) return;
    const v = g.vehicles.spawn('police', pt.x, pt.z, heading, { persistent: true });
    if (!v) return;
    v.vx = Math.sin(heading) * e.speed * 0.8; v.vz = Math.cos(heading) * e.speed * 0.8;
    this.units.push(new Unit(this, v));
  }

  update(dt) {
    const g = this.game, p = g.player;
    // delayed civilian reports
    for (let i = this.reports.length - 1; i >= 0; i--) if (g.time >= this.reports[i].t) { this.addHeat(this.reports[i].heat); this.reports.splice(i, 1); }
    // visibility check
    this.checkT -= dt;
    if (this.checkT <= 0 && this.level > 0) {
      this.checkT = 0.25;
      const t = p.vehicle || p;
      this.seen = this.copNear(t.x, t.z, 55) || (this.heli && !this.heli.leaving && Math.hypot(this.heli.x - t.x, this.heli.z - t.z) < 130);
    }
    if (this.level > 0) {
      if (this.seen) this.unseenT = 0;
      else {
        this.unseenT += dt;
        if (this.unseenT > this.searchTime) { this.clear(); g.hud?.notify('Lost the police', 'money'); }
      }
    }
    // spawn units
    const target = [0, 1, 2, 3, 4, 5][this.level];
    this.units = this.units.filter((u) => {
      const v = u.vehicle;
      const gone = !g.vehicles.list.includes(v);
      if (gone) { for (const c of u.cops) this.removeCop(c); return false; }
      const far = Math.hypot(v.x - p.x, v.z - p.z) > 420;
      if (far || (v.destroyed && Math.hypot(v.x - p.x, v.z - p.z) > 150)) {
        for (const c of u.cops) this.removeCop(c);
        g.vehicles.remove(v);
        return false;
      }
      return true;
    });
    const activeUnits = this.units.filter((u) => !u.vehicle.destroyed).length;
    this.spawnT -= dt;
    if (this.level > 0 && activeUnits < target && this.spawnT <= 0 && !p.dead) { this.spawnT = 2.5; this.spawnUnit(); }
    for (const u of this.units) u.update(dt);
    for (const c of this.cops) c.update(dt);
    // remove dead cops that are far away
    this.cops = this.cops.filter((c) => !(c.dead && c.deadTime > 30) && Math.hypot(c.x - p.x, c.z - p.z) < 300);
    // helicopter
    if (this.level >= 4 && !this.heli) this.heli = new Helicopter(g);
    if (this.heli) { if (this.heli.update(dt)) { this.heli.dispose(); this.heli = null; } }
  }

  resetAll() {
    const g = this.game;
    for (const u of this.units) g.vehicles.remove(u.vehicle);
    this.units = [];
    this.cops = [];
    this.heat = 0; this.level = 0; this.reports = [];
    if (this.heli) { this.heli.dispose(); this.heli = null; }
  }
}

// police helicopter: hovers over the player, spotlight at night, shoots at 5 stars
class Helicopter {
  constructor(game) {
    this.game = game;
    const p = game.player;
    const a = Math.random() * Math.PI * 2;
    this.x = p.x + Math.cos(a) * 260; this.z = p.z + Math.sin(a) * 260; this.y = 55;
    this.vx = 0; this.vz = 0; this.heading = 0;
    this.health = 700;
    this.leaving = false;
    this.fireT = 3;
    this.group = new THREE.Group();
    const body = new THREE.Mesh(mergeBoxes([
      [0, 1.2, 0, 2.2, 1.9, 4.2, 0x1f3f8a], [0, 1.0, 1.8, 1.9, 1.3, 1.0, 0x9fc3e0], [0, 1.6, -3.8, 0.4, 0.5, 4.2, 0x1f3f8a],
      [0, 2.2, -5.7, 0.15, 1.4, 0.8, 0x1f3f8a], [0, 2.35, 0, 0.3, 0.4, 0.3, 0x222222], [0.9, 0.1, 0, 0.1, 0.1, 3.2, 0x333333], [-0.9, 0.1, 0, 0.1, 0.1, 3.2, 0x333333],
      [0, 1.6, 0, 2.25, 0.25, 3.0, 0xf2f2f2],
    ]), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.35), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    this.rotor.position.y = 2.6;
    this.light = game.heliLight;
    this.group.add(body, this.rotor);
    body.castShadow = true;
    game.scene.add(this.group);
    this.isHeli = true;
  }
  update(dt) {
    const g = this.game, p = g.player;
    const t = p.vehicle || p;
    let tx, tz;
    if (this.leaving) { tx = this.x + (this.x - t.x); tz = this.z + (this.z - t.z); }
    else { tx = t.x + Math.cos(g.time * 0.3) * 25; tz = t.z + Math.sin(g.time * 0.3) * 25; }
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz) || 1;
    const sp = Math.min(32, d * 0.8);
    this.vx += ((dx / d) * sp - this.vx) * Math.min(1, dt * 1.2);
    this.vz += ((dz / d) * sp - this.vz) * Math.min(1, dt * 1.2);
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.heading = dampAngle(this.heading, Math.atan2(t.x - this.x, t.z - this.z), 1.5, dt);
    this.group.position.set(this.x, this.y + Math.sin(g.time * 1.3) * 0.6, this.z);
    this.group.rotation.set(clamp(this.vz * 0.01, -0.2, 0.2), this.heading, clamp(-this.vx * 0.01, -0.2, 0.2), 'YXZ');
    this.rotor.rotation.y += dt * 28;
    this.light.intensity = this.leaving ? 0 : g.env.night * 9000;
    this.light.position.set(this.x, this.y - 0.5, this.z);
    this.light.target.position.set(t.x, 0, t.z);
    this.light.target.updateMatrixWorld();
    if (!this.leaving && g.police.level >= 5 && d < 90) {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = rand(1.8, 3);
        g.combat.npcShoot({ x: this.x, y: this.y - 2.6, z: this.z, heading: this.heading, vehicle: null }, 'smg', p.vehicle ? { x: p.vehicle.x, z: p.vehicle.z, y: 0, vehicle: p.vehicle } : p, 0.35);
      }
    }
    g.audio?.heliAt(this.x, this.z);
    if (this.health <= 0) {
      g.fx.explosion(this.x, this.y, this.z, 1.5);
      g.audio?.explosion(this.x, this.z);
      g.police.addHeat(3);
      return true;
    }
    return this.leaving && Math.hypot(this.x - t.x, this.z - t.z) > 500;
  }
  dispose() { this.game.scene.remove(this.group); this.light.intensity = 0; }
}
