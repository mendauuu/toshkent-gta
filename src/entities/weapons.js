// Weapons and hitscan combat shared by the player, police and gangs.
import * as THREE from 'three';
import { rand } from '../util/math.js';

export const WEAPONS = {
  fist: { id: 'fist', name: 'Fist', melee: true, damage: 15, rate: 2.6, range: 1.8 },
  pistol: { id: 'pistol', name: 'Pistol', damage: 27, rate: 4.2, clip: 12, spread: 0.011, range: 110, pellets: 1, reload: 1.3, auto: false, sound: 'pistol' },
  smg: { id: 'smg', name: 'Micro SMG', damage: 15, rate: 11, clip: 32, spread: 0.034, range: 80, pellets: 1, reload: 1.8, auto: true, sound: 'smg' },
  shotgun: { id: 'shotgun', name: 'Shotgun', damage: 13, rate: 1.15, clip: 7, spread: 0.075, range: 42, pellets: 9, reload: 2.4, auto: false, sound: 'shotgun' },
  ak: { id: 'ak', name: 'AK-47', damage: 31, rate: 8.5, clip: 30, spread: 0.02, range: 140, pellets: 1, reload: 2.2, auto: true, sound: 'ak' },
};
export const WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun', 'ak'];

// [height, radius, damage multiplier]. The head sphere matches the big chibi head (1.26-1.78 m plus
// hair); the old upper-chest sphere at 1.45 m was dropped because it now sat inside the head and
// would have turned face shots into body shots
const SPHERES = [[0.5, 0.26, 1], [1.12, 0.3, 1], [1.52, 0.27, 2.6]];

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz;
  const b = fx * dx + fy * dy + fz * dz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.camDir = new THREE.Vector3();
  }

  // gather everyone who can be shot
  targets(exclude) {
    const g = this.game;
    const list = [];
    if (g.player !== exclude && !g.player.dead) list.push(g.player);
    for (const h of g.allNPCs()) if (h !== exclude && !h.inVehicle) list.push(h);
    return list;
  }

  // hitscan: returns nearest hit {t, kind, obj, mult, x,y,z, nx, nz}
  trace(ox, oy, oz, dx, dy, dz, range, exclude, excludeVehicle, minT = 0) {
    const g = this.game;
    let best = { t: range, kind: 'none' };
    // walls
    const wt = g.collision.raycast(ox, oz, ox + dx * range, oz + dz * range, oy, oy + dy * range, g.collision.out, true);
    if (wt < 1) best = { t: wt * range, kind: g.collision.out.kind === 2 ? 'tree' : 'wall', nx: g.collision.out.nx, nz: g.collision.out.nz };
    // ground
    if (dy < -1e-4) { const tg = -oy / dy; if (tg > minT && tg < best.t) best = { t: tg, kind: 'ground' }; }
    // people
    for (const h of this.targets(exclude)) {
      const ddx = h.x - ox, ddz = h.z - oz;
      if (ddx * ddx + ddz * ddz > (best.t + 2) * (best.t + 2)) continue;
      if (h.lie > 0.5) {
        const t = raySphere(ox, oy, oz, dx, dy, dz, h.x, h.y + 0.25, h.z, 0.75);
        if (t > minT && t < best.t) best = { t, kind: 'human', obj: h, mult: 1 };
        continue;
      }
      for (const [hy, r, mult] of SPHERES) {
        const t = raySphere(ox, oy, oz, dx, dy, dz, h.x, h.y + hy, h.z, r);
        if (t > minT && t < best.t) best = { t, kind: 'human', obj: h, mult };
      }
    }
    // vehicles (oriented boxes)
    for (const v of g.vehicles.list) {
      if (v === excludeVehicle) continue;
      const ddx = v.x - ox, ddz = v.z - oz;
      if (ddx * ddx + ddz * ddz > (best.t + 7) * (best.t + 7)) continue;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const lox = (ox - v.x) * fz - (oz - v.z) * fx, loz = (ox - v.x) * fx + (oz - v.z) * fz, loy = oy - v.y;
      const ldx = dx * fz - dz * fx, ldz = dx * fx + dz * fz, ldy = dy;
      const T = v.type;
      let t0 = minT, t1 = best.t;
      const slab = (o, d, mn, mx) => {
        if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
        let a = (mn - o) / d, b = (mx - o) / d;
        if (a > b) { const tmp = a; a = b; b = tmp; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        return t0 <= t1;
      };
      if (slab(lox, ldx, -T.W / 2, T.W / 2) && slab(loy, ldy, 0.25, T.H) && slab(loz, ldz, -T.L / 2, T.L / 2) && t0 < best.t) best = { t: t0, kind: 'vehicle', obj: v, mult: 1 };
    }
    best.x = ox + dx * best.t; best.y = oy + dy * best.t; best.z = oz + dz * best.t;
    return best;
  }

  // shared bullet logic
  fire(shooter, weapon, ox, oy, oz, aimX, aimY, aimZ, opts = {}) {
    const g = this.game, def = WEAPONS[weapon];
    let hitAny = null;
    for (let p = 0; p < def.pellets; p++) {
      let dx = aimX - ox, dy = aimY - oy, dz = aimZ - oz;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      const sp = def.spread * (opts.spreadMul ?? 1);
      dx += rand(-sp, sp); dy += rand(-sp, sp) * 0.7; dz += rand(-sp, sp);
      const l2 = Math.hypot(dx, dy, dz);
      dx /= l2; dy /= l2; dz /= l2;
      const hit = this.trace(ox, oy, oz, dx, dy, dz, def.range, shooter, opts.vehicle, 0.3);
      this.applyHit(hit, def, shooter, dx, dz);
      if (p === 0 || (hit.kind === 'human' && !hitAny)) hitAny = hit;
      g.fx.tracer(ox, oy, oz, hit.x, hit.y, hit.z);
    }
    g.fx.muzzle(ox, oy, oz);
    g.audio?.gunshot(ox, oz, def.sound);
    // noise alerts people nearby
    g.onGunshot(shooter, ox, oz);
    return hitAny;
  }

  applyHit(hit, def, shooter, dx, dz) {
    const g = this.game;
    const fx = g.fx;
    if (hit.kind === 'human') {
      const h = hit.obj;
      // NPC bullets hurt the player less so firefights and chases stay fun
      const mul = h === g.player && shooter !== g.player ? 0.32 : 1;
      g.damageHuman(h, def.damage * hit.mult * mul, shooter, 'bullet', dx, dz);
      fx.burst('blood', hit.x, hit.y, hit.z, 5);
    } else if (hit.kind === 'vehicle') {
      hit.obj.damage(def.damage * 1.4, shooter === g.player ? 'player' : shooter);
      hit.obj.lastHitBy = shooter === g.player ? 'player' : hit.obj.lastHitBy;
      fx.burst('spark', hit.x, hit.y, hit.z, 5);
      if (hit.obj.driver && hit.obj.driver !== 'player' && hit.obj.driver.onShot) hit.obj.driver.onShot(shooter);
      if (hit.obj.driver === 'player' && shooter !== g.player) g.damageHuman(g.player, def.damage * 0.25, shooter, 'bullet');
    } else if (hit.kind === 'wall' || hit.kind === 'tree') {
      fx.burst('dust', hit.x, hit.y, hit.z, 4);
      fx.burst('spark', hit.x, hit.y, hit.z, 2);
    } else if (hit.kind === 'ground') {
      fx.burst('dust', hit.x, 0.05, hit.z, 4);
    }
  }

  // player shoots along the camera ray (free aim)
  playerShoot(weapon, inVehicle) {
    const g = this.game, p = g.player, cam = g.camera;
    const dir = this.camDir.copy(g.cameraRig.lookDir);
    const def = WEAPONS[weapon];
    // aim point: first thing the camera ray hits beyond the player
    const camToPlayer = Math.hypot(cam.position.x - p.x, cam.position.z - p.z) + 0.6;
    const aim = this.trace(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, def.range + camToPlayer, p, p.vehicle, camToPlayer);
    let ox, oy, oz;
    if (inVehicle) {
      const v = p.vehicle;
      ox = v.x + dir.x * 1.2; oy = v.y + v.type.H * 0.8; oz = v.z + dir.z * 1.2;
    } else {
      const rx = -Math.cos(p.heading), rz = Math.sin(p.heading);
      ox = p.x + Math.sin(p.heading) * 0.55 + rx * 0.27; oy = p.y + 1.42; oz = p.z + Math.cos(p.heading) * 0.55 + rz * 0.27;
    }
    this.fire(p, weapon, ox, oy, oz, aim.x, aim.y, aim.z, { vehicle: p.vehicle, spreadMul: p.aiming ? 0.6 : inVehicle ? 1.6 : 1.1 });
    g.cameraRig.shake(def.pellets > 1 ? 0.18 : 0.04);
  }

  // NPC shoots at a target position with accuracy falling off with distance
  npcShoot(npc, weapon, target, accuracy = 0.6) {
    const ox = npc.x + Math.sin(npc.heading) * 0.5, oy = npc.y + 1.42, oz = npc.z + Math.cos(npc.heading) * 0.5;
    const d = Math.hypot(target.x - npc.x, target.z - npc.z);
    const tv = target.vehicle || null;
    const moving = tv ? tv.speed : Math.hypot(target.vx || 0, target.vz || 0);
    const err = (1 - accuracy) * 0.12 * d + moving * 0.1 + 0.5;
    const ty = (tv ? 0.9 : target.y + 1.2) + rand(-err, err) * 0.5;
    this.fire(npc, weapon, ox, oy, oz, target.x + rand(-err, err), ty, target.z + rand(-err, err), { spreadMul: 1.0, vehicle: npc.vehicle || null });
  }

  melee(attacker, def) {
    const g = this.game;
    const fx = Math.sin(attacker.heading), fz = Math.cos(attacker.heading);
    let best = null, bd = def.range;
    for (const h of this.targets(attacker)) {
      if (h.dead || h.inVehicle) continue;
      const dx = h.x - attacker.x, dz = h.z - attacker.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < 0.45) continue;
      bd = d; best = h;
    }
    g.audio?.whoosh();
    if (!best) return;
    g.damageHuman(best, def.damage, attacker, 'melee', fx, fz);
    g.audio?.punch();
    if (!best.dead && best !== g.player && Math.random() < 0.35) { best.ragdoll = 1.1; best.vx = fx * 3; best.vz = fz * 3; }
  }
}
