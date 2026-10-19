// The player character: on-foot controller, weapons, entering/stealing and driving vehicles.
import { Human, POSE, VAR } from './humans.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { clamp, damp, dampAngle } from '../util/math.js';

const out = { x: 0, z: 0, nx: 0, nz: 0 };

export class Player extends Human {
  constructor(game) {
    super({ shirt: 0x2c4f7a, pants: 0x262b35, skin: 0xcf9c74, extra: 0x161210, bits: VAR.HAIR | VAR.BEARD });
    this.game = game;
    this.isPlayer = true;
    this.money = 0;
    this.maxHealth = 100;
    this.vehicle = null;
    this.weapons = { fist: { ammo: Infinity, clip: Infinity }, pistol: { ammo: 36, clip: 12 } };
    this.current = 'fist';
    this.aiming = false;
    this.fireCooldown = 0;
    this.reloadT = 0;
    this.stamina = 1;
    this.entering = null;
    this.exitCooldown = 0;
    this.radius = 0.34;
  }

  get weapon() { return WEAPONS[this.current]; }
  get ammoInfo() { const w = this.weapons[this.current]; return w ? w : { ammo: 0, clip: 0 }; }

  giveWeapon(id, ammo) {
    const def = WEAPONS[id];
    if (!this.weapons[id]) this.weapons[id] = { ammo: 0, clip: 0 };
    const w = this.weapons[id];
    w.ammo += ammo;
    if (w.clip <= 0) { const take = Math.min(def.clip, w.ammo); w.clip = take; w.ammo -= take; }
    if (this.current === 'fist') this.current = id;
  }

  removeWeapons(keepPistol = false) {
    const p = this.weapons.pistol;
    this.weapons = { fist: { ammo: Infinity, clip: Infinity } };
    if (keepPistol) this.weapons.pistol = p && p.clip + p.ammo > 0 ? p : { ammo: 24, clip: 12 };
    this.current = keepPistol ? 'pistol' : 'fist';
  }

  cycleWeapon(dir) {
    const owned = WEAPON_ORDER.filter((id) => this.weapons[id] && (id === 'fist' || this.weapons[id].clip + this.weapons[id].ammo > 0));
    const i = owned.indexOf(this.current);
    this.current = owned[(i + dir + owned.length) % owned.length];
    this.reloadT = 0;
  }

  update(dt, input) {
    const g = this.game;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.exitCooldown = Math.max(0, this.exitCooldown - dt);
    if (this.dead) { this.animAmp = 0; return; }
    // weapon selection
    const wheel = input.takeWheel();
    if (wheel) this.cycleWeapon(wheel > 0 ? 1 : -1);
    ['w1', 'w2', 'w3', 'w4', 'w5'].forEach((k, i) => { if (input.was(k) && this.weapons[WEAPON_ORDER[i]]) { this.current = WEAPON_ORDER[i]; this.reloadT = 0; } });
    if (input.was('reload')) this.startReload();
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }
    if (this.vehicle) this.updateDriving(dt, input);
    else if (this.ragdoll > 0 || this.lie > 0.05) { this.animAmp = 0; }
    else if (this.entering) this.updateEntering(dt);
    else this.updateFoot(dt, input);
  }

  startReload() {
    const w = this.weapons[this.current], def = this.weapon;
    if (!w || def.melee || this.reloadT > 0 || w.ammo <= 0 || w.clip >= def.clip) return;
    this.reloadT = def.reload;
    this.game.audio?.reload();
  }
  finishReload() {
    const w = this.weapons[this.current], def = this.weapon;
    if (!w) return;
    const need = def.clip - w.clip, take = Math.min(need, w.ammo);
    w.clip += take; w.ammo -= take;
  }

  tryFire(input, inVehicle) {
    const def = this.weapon, w = this.weapons[this.current];
    if (!w || this.fireCooldown > 0 || this.reloadT > 0) return;
    const want = def.auto ? input.fire : input.firePressed;
    if (!want) return;
    if (def.melee) {
      if (inVehicle) return;
      this.fireCooldown = 1 / def.rate;
      this.punchT = 0.3;
      this.game.combat.melee(this, def);
      return;
    }
    if (w.clip <= 0) { if (w.ammo > 0) this.startReload(); else { this.game.audio?.click(); this.fireCooldown = 0.3; } return; }
    w.clip--;
    this.fireCooldown = 1 / def.rate;
    this.game.combat.playerShoot(this.current, inVehicle);
    if (w.clip <= 0 && w.ammo > 0) this.startReload();
  }

  updateFoot(dt, input) {
    const g = this.game, rig = g.cameraRig;
    if (input.was('camera')) rig.toggleFirstPerson();
    let mx = 0, mz = 0;
    if (input.is('forward')) mz += 1;
    if (input.is('back')) mz -= 1;
    if (input.is('left')) mx -= 1;
    if (input.is('right')) mx += 1;
    if (input.pad.lx || input.pad.ly) { mx = input.pad.lx; mz = -input.pad.ly; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const fx = Math.sin(rig.yaw), fz = Math.cos(rig.yaw), rx = -Math.cos(rig.yaw), rz = Math.sin(rig.yaw);
    const dx = fx * mz + rx * mx, dz = fz * mz + rz * mx;
    const moving = len > 0.1;
    this.aiming = input.aim && !this.weapon.melee;
    const sprint = input.is('sprint') && this.stamina > 0.04 && !this.aiming && moving;
    const speed = this.aiming ? 2.3 : sprint ? 7.6 : 4.7;
    const k = Math.min(1, len);
    this.vx = damp(this.vx, dx * speed * k, this.onGround ? 11 : 2, dt);
    this.vz = damp(this.vz, dz * speed * k, this.onGround ? 11 : 2, dt);
    this.stamina = clamp(this.stamina + (sprint ? -0.11 : 0.18) * dt, 0, 1);
    const shooting = !this.weapon.melee && (input.fire || this.fireCooldown > 0);
    if (this.aiming || shooting || rig.firstPerson) this.heading = dampAngle(this.heading, rig.yaw, 22, dt);
    else if (moving) this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 12, dt);
    if (this.onGround && input.was('jump')) { this.vy = 5.4; this.onGround = false; }
    this.vy -= 20 * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) { this.y = 0; this.vy = 0; this.onGround = true; }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (g.collision.collideCircle(this.x, this.z, this.radius, out)) { this.x = out.x; this.z = out.z; }
    g.collision.clampToBounds(this, 2);
    this.animate(dt, Math.hypot(this.vx, this.vz));
    this.pose = this.punchT > 0 ? POSE.PUNCH : (this.aiming || shooting) && !this.weapon.melee ? POSE.AIM : POSE.WALK;
    if (this.punchT > 0) this.animAmp = 1 - this.punchT / 0.3;
    this.showGun = !this.weapon.melee;
    this.tryFire(input, false);
    if (input.was('enter') && this.exitCooldown <= 0) this.tryEnterVehicle();
  }

  tryEnterVehicle() {
    const g = this.game;
    let best = null, bd = 4.2;
    for (const v of g.vehicles.list) {
      if (v.destroyed || v.type.L > 12) continue;
      const d = Math.hypot(v.x - this.x, v.z - this.z) - v.type.L * 0.35;
      if (d < bd && v.speed < 8) { bd = d; best = v; }
    }
    if (!best) return false;
    const door = best.doorPos(-1);
    this.entering = { v: best, t: 0, fx: this.x, fz: this.z, door };
    this.vx = this.vz = 0;
    return true;
  }

  updateEntering(dt) {
    const e = this.entering, v = e.v;
    e.t += dt;
    if (v.destroyed || v.speed > 9) { this.entering = null; return; }
    const door = v.doorPos(-1);
    const f = Math.min(1, e.t / 0.45);
    this.x = e.fx + (door.x - e.fx) * f;
    this.z = e.fz + (door.z - e.fz) * f;
    this.heading = dampAngle(this.heading, Math.atan2(v.x - this.x, v.z - this.z), 10, dt);
    this.animate(dt, f < 1 ? 3 : 0);
    if (e.t >= 0.45) {
      if (v.driver && v.driver !== 'player') this.game.ejectDriver(v, true);
      this.entering = null;
      this.enterVehicle(v);
    }
  }

  enterVehicle(v) {
    this.vehicle = v;
    this.inVehicle = v;
    v.driver = 'player';
    v.persistent = true;
    this.aiming = false;
    this.game.cameraRig.snapBehind(v.heading);
    this.game.onPlayerEnteredVehicle(v);
  }

  exitVehicle(force = false) {
    const g = this.game, v = this.vehicle;
    if (!v) return;
    const fast = v.speed > 7;
    if (fast && !force) {
      // bail out
      const side = v.doorPos(-1);
      this.x = side.x; this.z = side.z;
      this.vx = v.vx * 0.6; this.vz = v.vz * 0.6;
      this.ragdoll = 1.4;
      this.lie = 0;
      g.damageHuman(this, Math.min(25, v.speed * 0.8), null, 'fall');
    } else {
      let pos = v.doorPos(-1);
      if (!g.collision.isFree(pos.x, pos.z, 0.35)) pos = v.doorPos(1);
      if (!g.collision.isFree(pos.x, pos.z, 0.35)) { const f = g.collision.findFree(pos.x, pos.z, 0.35, 8); pos = { x: f[0], z: f[1] }; }
      this.x = pos.x; this.z = pos.z;
      this.vx = this.vz = 0;
    }
    this.heading = v.heading;
    v.driver = null;
    v.ctrl.throttle = 0; v.ctrl.steer = 0; v.ctrl.handbrake = !fast;
    v.horn = false;
    this.vehicle = null;
    this.inVehicle = null;
    this.exitCooldown = 0.5;
    g.onPlayerExitedVehicle(v);
  }

  updateDriving(dt, input) {
    const v = this.vehicle;
    if (v.destroyed) { this.exitVehicle(true); return; }
    let thr = 0, steer = 0;
    if (input.is('forward')) thr += 1;
    if (input.is('back')) thr -= 1;
    if (input.is('left')) steer -= 1;
    if (input.is('right')) steer += 1;
    const P = input.pad;
    if (P.rt || P.lt) thr = P.rt - P.lt;
    if (P.lx) steer = P.lx;
    v.ctrl.throttle = thr;
    v.ctrl.steer = steer;
    v.ctrl.handbrake = input.is('handbrake');
    v.horn = input.is('horn');
    if (v.typeId === 'police' && input.was('horn')) v.sirenOn = !v.sirenOn;
    this.x = v.x; this.z = v.z; this.y = 0;
    this.heading = v.heading;
    this.vx = v.vx; this.vz = v.vz;
    if (input.was('camera')) this.game.cameraRig.cycleZoom();
    if (input.was('radio')) this.game.audio?.nextStation();
    // drive-by with guns
    if (!this.weapon.melee && (input.buttons & 1)) this.tryFire(input, true);
    if (input.was('enter') && this.exitCooldown <= 0) this.exitVehicle();
  }
}
