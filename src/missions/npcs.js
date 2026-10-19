// Mission AI: drivers that follow a path (racers, thieves) and armed/fleeing people.
import { Human, randomLook, POSE } from '../entities/humans.js';
import { moveHuman, updateRagdoll } from '../entities/peds.js';
import { clamp, rand, dampAngle } from '../util/math.js';

// follows a polyline [x,z,...]; used by racers and the fleeing thief
export class PathDriver {
  constructor(game, vehicle, path, opts = {}) {
    this.game = game; this.vehicle = vehicle;
    this.kind = opts.kind || 'mission';
    this.look = opts.look || randomLook('ped');
    this.setPath(path);
    this.speedMul = opts.speedMul ?? 1;
    this.maxSpeed = opts.maxSpeed ?? vehicle.type.maxSpeed * 0.9;
    this.avoid = opts.avoid ?? true;
    this.stuckT = 0; this.reverseT = 0;
    this.onEnd = opts.onEnd || null;
    this.done = false;
    this.bias = 0;
  }
  setPath(path) { this.path = path; this.idx = 0; this.done = false; }
  remaining() {
    const P = this.path; if (!P) return 0;
    let d = Math.hypot(P[this.idx * 2] - this.vehicle.x, P[this.idx * 2 + 1] - this.vehicle.z);
    for (let i = this.idx; i < P.length / 2 - 1; i++) d += Math.hypot(P[i * 2 + 2] - P[i * 2], P[i * 2 + 3] - P[i * 2 + 1]);
    return d;
  }
  update(dt) {
    const v = this.vehicle, P = this.path;
    if (v.destroyed || !P) { v.ctrl.throttle = 0; return; }
    const n = P.length / 2;
    const la = 6 + v.speed * 0.5;
    while (this.idx < n - 1 && Math.hypot(P[this.idx * 2] - v.x, P[this.idx * 2 + 1] - v.z) < la) this.idx++;
    if (this.idx >= n - 1 && Math.hypot(P[(n - 1) * 2] - v.x, P[(n - 1) * 2 + 1] - v.z) < 8) {
      if (!this.done) { this.done = true; this.onEnd?.(this); }
      if (this.done && !this.path) return;
    }
    let ax = P[this.idx * 2], az = P[this.idx * 2 + 1];
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    // overtake slower traffic by shifting the aim point
    let block = Infinity;
    if (this.avoid) {
      for (const o of this.game.vehicles.list) {
        if (o === v) continue;
        const dx = o.x - v.x, dz = o.z - v.z;
        if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
        const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
        if (lz > 0 && lz < 22 && Math.abs(lx) < 2.4) block = Math.min(block, lz);
      }
    }
    this.bias = clamp(this.bias + (block < 22 ? dt * 2.5 : -dt * 1.5), 0, 1);
    ax += fz * this.bias * 3.2; az -= fx * this.bias * 3.2;
    const dx = ax - v.x, dz = az - v.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    const curv = (2 * lx) / Math.max(1, lx * lx + lz * lz);
    const steer = clamp((-Math.atan(curv * v.wheelbase) / v.type.steer) * (1 + v.speed * 0.02), -1, 1);
    // speed from upcoming corner sharpness
    let want = this.maxSpeed * this.speedMul;
    const j = Math.min(n - 1, this.idx + 2);
    if (j > this.idx) {
      const bx = P[j * 2] - ax, bz = P[j * 2 + 1] - az;
      const a1 = Math.atan2(dx, dz), a2 = Math.atan2(bx, bz);
      let turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = Math.PI * 2 - turn;
      if (turn > 0.4) want = Math.min(want, clamp(30 - turn * 16, 8, want));
    }
    const ang = Math.abs(Math.atan2(lx, lz));
    if (ang > 0.6) want = Math.min(want, clamp(26 - ang * 14, 6, want));
    if (block < 10) want = Math.min(want, Math.max(4, block));
    if (this.done) want = 0;
    if (this.reverseT > 0) { this.reverseT -= dt; v.ctrl.throttle = -0.8; v.ctrl.steer = -steer; v.ctrl.handbrake = false; return; }
    if (want > 3 && v.speed < 0.7) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 2) { this.stuckT = 0; this.reverseT = 1.1; }
    v.ctrl.throttle = clamp((want - v.speedF) * 0.5, -1, 1);
    v.ctrl.steer = steer;
    v.ctrl.handbrake = want < 0.3 && v.speed < 1.5;
  }
}

// armed NPC that attacks the player (gangsters)
export class Hostile extends Human {
  constructor(game, x, z, weapon = 'pistol', look = randomLook('gang')) {
    super(look, x, z);
    this.game = game;
    this.kind = 'enemy';
    this.weapon = weapon;
    this.health = 100;
    this.alerted = false;
    this.fireT = rand(0.6, 1.5);
    this.persistent = true;
    this.showGun = true;
    this.homeX = x; this.homeZ = z;
    this.accuracy = 0.55;
  }
  update(dt) {
    const g = this.game, p = g.player;
    if (this.dead) { this.deadTime += dt; updateRagdoll(g, this, dt); this.lie = Math.min(1, this.lie + dt * 4); return; }
    if (updateRagdoll(g, this, dt)) return;
    const t = p.vehicle || p;
    const d = Math.hypot(t.x - this.x, t.z - this.z);
    const los = d < 70 && g.collision.lineOfSight(this.x, this.z, 1.5, t.x, t.z, 1.2);
    if (!this.alerted && ((los && d < 38) || this.health < 100)) this.alerted = true;
    this.pose = POSE.WALK;
    if (!this.alerted || p.dead) { this.animate(dt, 0); this.vx = this.vz = 0; return; }
    if (los && d < 45) {
      this.pose = POSE.AIM;
      if (d > 16) moveHuman(g, this, dt, t.x, t.z, 3.5, 12);
      else { this.vx = this.vz = 0; this.animate(dt, 0); }
      this.heading = dampAngle(this.heading, Math.atan2(t.x - this.x, t.z - this.z), 12, dt);
      this.fireT -= dt;
      if (this.fireT <= 0) {
        const auto = this.weapon === 'smg' || this.weapon === 'ak';
        this.fireT = auto ? rand(0.12, 0.2) : rand(0.6, 1.1);
        if (auto && Math.random() < 0.12) this.fireT = rand(0.8, 1.4);
        g.combat.npcShoot(this, this.weapon, p.vehicle ? { x: t.x, z: t.z, y: 0, vehicle: t } : p, this.accuracy);
      }
    } else {
      moveHuman(g, this, dt, t.x, t.z, 4.8, 10);
    }
  }
}

// runs away from the player; used for the thief
export class Runner extends Human {
  constructor(game, x, z, look) {
    super(look || randomLook('ped'), x, z);
    this.game = game; this.kind = 'mission'; this.persistent = true; this.health = 60;
  }
  update(dt) {
    const g = this.game, p = g.player;
    if (this.dead) { this.deadTime += dt; updateRagdoll(g, this, dt); this.lie = Math.min(1, this.lie + dt * 4); return; }
    if (updateRagdoll(g, this, dt)) return;
    const dx = this.x - p.x, dz = this.z - p.z, d = Math.hypot(dx, dz) || 1;
    const tx = this.x + (dx / d) * 6 + Math.sin(g.time * 0.9) * 2, tz = this.z + (dz / d) * 6 + Math.cos(g.time * 0.7) * 2;
    moveHuman(g, this, dt, tx, tz, 5.8, 8);
    this.pose = POSE.PANIC;
  }
}

// walks to a vehicle door and boards it
export class Passenger extends Human {
  constructor(game, x, z, look) {
    super(look || randomLook('ped'), x, z);
    this.game = game; this.kind = 'mission'; this.persistent = true;
    this.target = null; this.boarded = false; this.waving = true;
  }
  update(dt) {
    const g = this.game;
    if (this.dead) { this.deadTime += dt; updateRagdoll(g, this, dt); this.lie = Math.min(1, this.lie + dt * 4); return; }
    if (updateRagdoll(g, this, dt)) return;
    if (this.target && !this.boarded) {
      const door = this.target.doorPos(1);
      const d = moveHuman(g, this, dt, door.x, door.z, 2.6, 8);
      this.pose = POSE.WALK;
      this.walkT = (this.walkT || 0) + dt;
      // board from either side; squeeze in if a wall or tree blocks the door
      const center = Math.hypot(this.target.x - this.x, this.target.z - this.z);
      if (d < 1.2 || center < this.target.type.W / 2 + 1.3 || this.walkT > 12) { this.boarded = true; this.visible = false; }
    } else if (!this.boarded) {
      this.vx = this.vz = 0;
      this.animate(dt, 0);
      this.pose = this.waving ? POSE.HANDSUP : POSE.WALK;
      const p = g.player;
      this.heading = dampAngle(this.heading, Math.atan2(p.x - this.x, p.z - this.z), 3, dt);
    }
  }
}
