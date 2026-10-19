// Vehicle physics (arcade bicycle model), collisions, damage and the vehicle manager.
import * as THREE from 'three';
import { VTYPES, vehicleGeometry, wheelGeometry, makeVehicleMaterial } from './vehicleModels.js';
import { clamp, choice, rand } from '../util/math.js';

const MAX_VEHICLES = 90;
const SUBSTEPS = 2;
const tmpOut = { x: 0, z: 0, nx: 0, nz: 0 };
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qs = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), e3 = new THREE.Euler();

let nextId = 1;

export class Vehicle {
  constructor(game, typeId, x, z, heading, opts = {}) {
    this.id = nextId++;
    this.game = game;
    this.typeId = typeId;
    const T = (this.type = VTYPES[typeId]);
    this.x = x; this.z = z; this.y = 0; this.vy = 0; this.heading = heading;
    this.vx = 0; this.vz = 0; this.angVel = 0; this.speedF = 0; this.accelF = 0; this.latAcc = 0;
    this.steer = 0;
    this.ctrl = { throttle: 0, steer: 0, handbrake: false };
    this.maxHealth = T.health;
    this.health = T.health;
    this.burnTime = 0;
    this.destroyed = false;
    this.deadTime = 0;
    this.driver = null; // 'player' or an AI controller
    this.passenger = null;
    this.paint = opts.paint ?? choice(T.colors);
    this.sirenOn = false;
    this.horn = false;
    this.lastHitBy = null;
    this.mission = opts.mission || null;
    this.persistent = !!opts.persistent;
    this.wheelSpin = 0;
    this.pitch = 0; this.roll = 0;
    this.smokeT = 0;
    this.skid = 0;
    this.material = makeVehicleMaterial();
    this.material.userData.u.uPaint.value.set(this.paint);
    this.mesh = new THREE.Mesh(vehicleGeometry(typeId), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    game.scene.add(this.mesh);
    // collision circles along the length
    this.radius = T.W / 2;
    const n = T.L > 6 ? 5 : 3;
    this.offsets = [];
    for (let i = 0; i < n; i++) this.offsets.push(-T.L / 2 + this.radius + ((T.L - 2 * this.radius) * i) / (n - 1));
    const wz = T.L > 6 ? T.L / 2 - 2.0 : T.L / 2 - 0.78;
    const rz = T.L > 6 ? -T.L / 2 + 2.4 : -T.L / 2 + 0.8;
    this.wheels = [[-(T.W / 2 - 0.17), wz, 1], [T.W / 2 - 0.17, wz, 1], [-(T.W / 2 - 0.17), rz, 0], [T.W / 2 - 0.17, rz, 0]];
    this.wheelbase = wz - rz;
    this.invMass = 1 / T.mass;
    this.invI = 12 / (T.mass * (T.L * T.L + T.W * T.W));
    this.syncMesh();
  }

  get fx() { return Math.sin(this.heading); }
  get fz() { return Math.cos(this.heading); }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get kmh() { return Math.abs(this.speedF) * 3.6; }

  step(dt) {
    const T = this.type, c = this.ctrl;
    let fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let rx = fz, rz = -fx;
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;
    const alive = !this.destroyed && this.health > 0;
    const thr = alive ? c.throttle : 0;
    let acc = 0;
    if (thr > 0.01) {
      if (vF < -0.4) acc = T.brake * thr;
      else acc = T.accel * thr * Math.max(0, 1 - (vF / T.maxSpeed) ** 2) * (vF < 6 ? 1.3 : 1);
    } else if (thr < -0.01) {
      if (vF > 0.4) acc = -T.brake * -thr;
      else acc = -T.accel * 0.6 * -thr * Math.max(0, 1 - (-vF / (T.maxSpeed * 0.32)) ** 2);
    }
    vF += acc * dt;
    if (c.handbrake || !alive) { const hb = Math.min(Math.abs(vF), (alive ? 7 : 4) * dt); vF -= Math.sign(vF) * hb; }
    vF -= vF * (0.045 + 0.0007 * Math.abs(vF)) * dt;
    if (Math.abs(vF) < 0.04 && Math.abs(thr) < 0.01) vF = 0;
    this.accelF = acc;
    // steering
    const st = alive ? c.steer : this.steer * 0.98;
    const rate = Math.abs(st) > Math.abs(this.steer) ? 5.5 : 8;
    this.steer += (st - this.steer) * Math.min(1, dt * rate);
    const ang = -this.steer * T.steer / (1 + Math.abs(vF) * 0.018);
    let yawT = (vF * Math.tan(ang)) / this.wheelbase;
    const maxLat = c.handbrake ? 26 : 15;
    const cap = maxLat / Math.max(3, Math.abs(vF));
    yawT = clamp(yawT, -cap, cap);
    if (c.handbrake && Math.abs(vF) > 4) yawT *= 1.4;
    this.angVel += (yawT - this.angVel) * Math.min(1, dt * (c.handbrake ? 3.5 : 9));
    // recompose, rotate heading and velocity
    let vx = fx * vF + rx * vR, vz = fz * vF + rz * vR;
    const dh = this.angVel * dt;
    this.heading += dh;
    const follow = c.handbrake ? 0.3 : 0.88;
    const r = dh * follow, cs = Math.cos(r), sn = Math.sin(r);
    const nvx = vx * cs + vz * sn, nvz = -vx * sn + vz * cs;
    fx = Math.sin(this.heading); fz = Math.cos(this.heading); rx = fz; rz = -fx;
    vF = nvx * fx + nvz * fz;
    vR = nvx * rx + nvz * rz;
    const grip = T.grip * (c.handbrake ? 0.22 : 1) * (alive ? 1 : 0.7);
    const before = vR;
    vR *= Math.exp(-grip * dt);
    this.latAcc = (before - vR) / dt;
    this.skid = Math.abs(before) > 3.2 || (c.handbrake && Math.abs(vF) > 6) || (thr < -0.5 && vF > 12) ? 1 : 0;
    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.speedF = vF;
    this.collideWorld();
  }

  collideWorld() {
    const cw = this.game.collision, T = this.type;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let impact = 0, ix = 0, iz = 0;
    for (const off of this.offsets) {
      const cx = this.x + fx * off, cz = this.z + fz * off;
      if (!cw.collideCircle(cx, cz, this.radius, tmpOut)) continue;
      this.x += tmpOut.x - cx;
      this.z += tmpOut.z - cz;
      const nx = tmpOut.nx, nz = tmpOut.nz;
      const rpx = fz * off, rpz = -fx * off;
      const pvx = this.vx + this.angVel * rpx, pvz = this.vz + this.angVel * rpz;
      const vn = pvx * nx + pvz * nz;
      if (vn < 0) {
        const rn = rpx * nx + rpz * nz;
        const j = (-(1 + 0.22) * vn) / (this.invMass + rn * rn * this.invI);
        this.vx += j * this.invMass * nx;
        this.vz += j * this.invMass * nz;
        this.angVel += j * rn * this.invI * 0.8;
        // scrape friction along the wall
        const tx = -nz, tz = nx, vt = this.vx * tx + this.vz * tz;
        this.vx -= tx * vt * 0.08; this.vz -= tz * vt * 0.08;
        if (-vn > impact) { impact = -vn; ix = tmpOut.x - nx * this.radius; iz = tmpOut.z - nz * this.radius; }
      }
    }
    if (this.game.collision.clampToBounds(this, 3)) { this.vx *= -0.3; this.vz *= -0.3; impact = Math.max(impact, 3); }
    if (impact > 3.5) this.onImpact(impact, ix, iz, null);
  }

  onImpact(speed, x, z, other) {
    const dmg = (speed - 3.5) * (other ? 16 : 20) * (this.type.mass > 5000 ? 0.4 : 1);
    if (dmg > 0) this.damage(dmg, other ? other.driver === 'player' ? 'player' : null : null);
    const g = this.game;
    if (speed > 5) {
      g.audio?.crash(x, z, Math.min(1, speed / 25));
      g.fx?.burst('spark', x, 0.7, z, Math.min(18, speed));
      if (this.driver === 'player') g.cameraRig?.shake(Math.min(0.6, speed / 40));
    }
  }

  damage(amount, by) {
    if (this.destroyed) return;
    this.health -= amount;
    if (by) this.lastHitBy = by;
    if (this.driver && this.driver.onDamaged) this.driver.onDamaged(amount, by);
    if (this.health <= 0) this.health = 0;
  }

  explode() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.health = 0;
    this.vy = 5.5;
    this.angVel += rand(-1.5, 1.5);
    this.material.userData.u.uDamage.value = 1;
    this.material.userData.u.uHead.value = 0;
    this.sirenOn = false;
    this.game.explosion(this.x, 1.0, this.z, 8.5, this.lastHitBy, this);
  }

  update(dt) {
    const sub = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) this.step(sub);
    // vertical bounce after explosion
    if (this.y > 0 || this.vy !== 0) {
      this.vy -= 18 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = Math.abs(this.vy) > 2 ? -this.vy * 0.25 : 0; }
    }
    const T = this.type;
    // damage effects
    const fx = this.game.fx;
    if (!this.destroyed) {
      if (this.health < this.maxHealth * 0.1) {
        this.burnTime += dt;
        this.health -= 0; // keep burning for a few seconds then explode
        if (this.burnTime > 5) this.explode();
      }
      this.smokeT -= dt;
      if (this.smokeT <= 0 && fx) {
        const hx = this.x + this.fx * (T.L / 2 - 0.6), hz = this.z + this.fz * (T.L / 2 - 0.6);
        if (this.burnTime > 0) { fx.spawn('fire', hx, T.H * 0.7, hz); fx.spawn('blacksmoke', hx, T.H, hz); this.smokeT = 0.05; }
        else if (this.health < this.maxHealth * 0.25) { fx.spawn('blacksmoke', hx, T.H * 0.8, hz); this.smokeT = 0.09; }
        else if (this.health < this.maxHealth * 0.45) { fx.spawn('smoke', hx, T.H * 0.8, hz); this.smokeT = 0.16; }
        else this.smokeT = 0.3;
      }
    } else {
      this.deadTime += dt;
      this.smokeT -= dt;
      if (fx && this.smokeT <= 0 && this.deadTime < 25) { fx.spawn(this.deadTime < 8 ? 'fire' : 'blacksmoke', this.x + rand(-1, 1), 1, this.z + rand(-1, 1)); this.smokeT = 0.12; }
    }
    // body lean
    this.pitch += (clamp(-this.accelF * 0.006, -0.05, 0.05) - this.pitch) * Math.min(1, dt * 6);
    this.roll += (clamp(this.latAcc * 0.0025, -0.07, 0.07) - this.roll) * Math.min(1, dt * 6);
    this.wheelSpin += (this.speedF / T.wheelR) * dt;
    const u = this.material.userData.u;
    if (!this.destroyed) {
      u.uDamage.value = clamp((1 - this.health / this.maxHealth) * 0.55, 0, 0.55);
      u.uHead.value = this.game.env.night > 0.4 && (this.driver || this.typeId === 'police') ? 1 : 0;
      u.uBrake.value = (this.ctrl.throttle < -0.1 && this.speedF > 0.5) || this.ctrl.handbrake ? 1 : 0;
      u.uRev.value = this.speedF < -0.5 ? 1 : 0;
      if (this.sirenOn) {
        const t = this.game.time * 7;
        u.uSirenR.value = Math.sin(t) > 0 ? 1 : 0;
        u.uSirenB.value = Math.sin(t) > 0 ? 0 : 1;
      } else { u.uSirenR.value = 0; u.uSirenB.value = 0; }
    }
    this.syncMesh();
  }

  syncMesh() {
    e3.set(this.pitch, this.heading, this.roll, 'YXZ');
    q.setFromEuler(e3);
    m4.compose(v3.set(this.x, this.y, this.z), q, s3.set(1, 1, 1));
    this.mesh.matrix.copy(m4);
    this.mesh.matrixWorldNeedsUpdate = true;
  }

  // world position of a local point (x right-ish, z forward)
  local(lx, lz, out = {}) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    out.x = this.x + fx * lz + fz * lx;
    out.z = this.z + fz * lz - fx * lx;
    return out;
  }

  // driver door position (left side, Uzbekistan drives on the right)
  doorPos(side = -1, out = {}) {
    return this.local(-side * (this.type.W / 2 + 0.75), this.type.L > 6 ? this.type.L / 2 - 1.5 : 0.25, out);
  }

  // point in local frame -> overlap test with expanded box
  containsXZ(px, pz, pad = 0) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const dx = px - this.x, dz = pz - this.z;
    const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
    return Math.abs(lz) <= this.type.L / 2 + pad && Math.abs(lx) <= this.type.W / 2 + pad;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.material.dispose();
  }
}

export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.wheelMesh = new THREE.InstancedMesh(wheelGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.2 }), MAX_VEHICLES * 4);
    this.wheelMesh.count = 0;
    this.wheelMesh.frustumCulled = false;
    this.wheelMesh.castShadow = false;
    game.scene.add(this.wheelMesh);
  }

  spawn(typeId, x, z, heading, opts) {
    if (this.list.length >= MAX_VEHICLES) {
      // recycle the farthest non-persistent vehicle
      const p = this.game.player;
      let worst = null, wd = -1;
      for (const v of this.list) { if (v.persistent || v.driver === 'player') continue; const d = Math.hypot(v.x - p.x, v.z - p.z); if (d > wd) { wd = d; worst = v; } }
      if (!worst) return null;
      this.remove(worst);
    }
    const v = new Vehicle(this.game, typeId, x, z, heading, opts);
    this.list.push(v);
    return v;
  }

  remove(v) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    if (v.driver && v.driver !== 'player' && v.driver.onVehicleRemoved) v.driver.onVehicleRemoved();
    v.dispose();
  }

  nearest(x, z, maxD, filter) {
    let best = null, bd = maxD;
    for (const v of this.list) {
      if (filter && !filter(v)) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  update(dt) {
    const L = this.list;
    for (const v of L) v.update(dt);
    // vehicle vs vehicle
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const reach = (a.type.L + b.type.L) / 2 + 0.5;
        if (dx * dx + dz * dz > reach * reach) continue;
        this.collidePair(a, b);
      }
    }
    // vehicles vs people
    const humans = this.game.humansForCollision();
    for (const v of L) {
      const sp = v.speed;
      for (const h of humans) {
        if (h.inVehicle || h.ragdoll > 0) continue;
        const dx = h.x - v.x, dz = h.z - v.z;
        const reach = v.type.L / 2 + 1;
        if (dx * dx + dz * dz > reach * reach) continue;
        if (!v.containsXZ(h.x, h.z, 0.32)) continue;
        if (sp > 3.2 && h.y < 1.2) {
          this.game.hitHuman(h, v);
        } else {
          // push the person out to the nearest side
          const fx = v.fx, fz = v.fz;
          const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
          const ox = v.type.W / 2 + 0.34 - Math.abs(lx), oz = v.type.L / 2 + 0.34 - Math.abs(lz);
          if (ox < oz) { const s = Math.sign(lx) || 1; h.x += fz * ox * s; h.z -= fx * ox * s; }
          else { const s = Math.sign(lz) || 1; h.x += fx * oz * s; h.z += fz * oz * s; }
        }
      }
    }
    // wheels
    let k = 0;
    const W = this.wheelMesh;
    for (const v of L) {
      const T = v.type;
      e3.set(v.pitch, v.heading, v.roll, 'YXZ');
      q.setFromEuler(e3);
      for (const [lx, lz, front] of v.wheels) {
        v3.set(lx, T.wheelR, lz).applyQuaternion(q);
        v3.x += v.x; v3.y += v.y; v3.z += v.z;
        const steerA = front ? -v.steer * T.steer * 0.8 : 0;
        e3.set(v.wheelSpin, v.heading + steerA, 0, 'YXZ');
        qs.setFromEuler(e3);
        m4.compose(v3, qs, s3.set(T.L > 6 ? 0.32 : 0.21, T.wheelR, T.wheelR));
        W.setMatrixAt(k++, m4);
      }
    }
    W.count = k;
    W.instanceMatrix.needsUpdate = true;
  }

  collidePair(a, b) {
    let best = null;
    const afx = a.fx, afz = a.fz, bfx = b.fx, bfz = b.fz;
    for (const oa of a.offsets) {
      const ax = a.x + afx * oa, az = a.z + afz * oa;
      for (const ob of b.offsets) {
        const bx = b.x + bfx * ob, bz = b.z + bfz * ob;
        const dx = ax - bx, dz = az - bz, d2 = dx * dx + dz * dz, rr = a.radius + b.radius;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.001;
        const pen = rr - d;
        if (!best || pen > best.pen) best = { pen, nx: dx / d, nz: dz / d, oa, ob, cx: (ax + bx) / 2, cz: (az + bz) / 2 };
      }
    }
    if (!best) return;
    const { pen, nx, nz, oa, ob } = best;
    const ima = a.destroyed && a.y > 0 ? 0 : a.invMass, imb = b.invMass;
    const tot = ima + imb || 1;
    a.x += nx * pen * (ima / tot); a.z += nz * pen * (ima / tot);
    b.x -= nx * pen * (imb / tot); b.z -= nz * pen * (imb / tot);
    const rax = afz * oa, raz = -afx * oa, rbx = bfz * ob, rbz = -bfx * ob;
    const pax = a.vx + a.angVel * rax, paz = a.vz + a.angVel * raz;
    const pbx = b.vx + b.angVel * rbx, pbz = b.vz + b.angVel * rbz;
    const vn = (pax - pbx) * nx + (paz - pbz) * nz;
    if (vn >= 0) return;
    const rna = rax * nx + raz * nz, rnb = rbx * nx + rbz * nz;
    const j = (-(1 + 0.3) * vn) / (ima + imb + rna * rna * a.invI + rnb * rnb * b.invI);
    a.vx += j * ima * nx; a.vz += j * ima * nz; a.angVel += j * rna * a.invI * 0.7;
    b.vx -= j * imb * nx; b.vz -= j * imb * nz; b.angVel -= j * rnb * b.invI * 0.7;
    const imp = -vn;
    if (imp > 3.5) {
      a.onImpact(imp * (b.type.mass / (a.type.mass + b.type.mass)) * 2, best.cx, best.cz, b);
      b.onImpact(imp * (a.type.mass / (a.type.mass + b.type.mass)) * 2, best.cx, best.cz, a);
      if (a.driver === 'player' || b.driver === 'player') this.game.onPlayerCarHit(a.driver === 'player' ? b : a, imp);
    }
  }
}
