// Player camera: orbit on foot, over-the-shoulder aiming, chase camera in vehicles, and a
// first-person view (player's eyes on foot, driver's seat in vehicles).
import * as THREE from 'three';
import { clamp, damp, dampAngle } from './util/math.js';

const ZOOMS = [0.72, 1, 1.45];
const FIRST_PERSON = ZOOMS.length; // the camera mode after the chase distances

export class CameraRig {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;
    this.yaw = 0;
    this.pitch = 0.2;
    this.shakeAmt = 0;
    this.zoom = 1;
    this.lastManual = -10;
    this.aimBlend = 0;
    this.fov = 62;
    this.target = new THREE.Vector3();
    this.cinematic = 0;
    this.lookDir = new THREE.Vector3(0, 0, 1);
    this.smoothDist = 4.5;
    this.dir = new THREE.Vector3();
    this.seat = { x: 0, z: 0 };
    this.bob = 0;
  }

  get firstPerson() { return this.zoom === FIRST_PERSON; }
  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }
  // in vehicles: close, normal, far, first person
  cycleZoom() { this.setZoom((this.zoom + 1) % (ZOOMS.length + 1)); }
  toggleFirstPerson() { this.setZoom(this.firstPerson ? 1 : FIRST_PERSON); }
  setZoom(z) {
    const was = this.firstPerson;
    this.zoom = z;
    if (was !== this.firstPerson) this.game.hud.notify(this.firstPerson ? 'First-person view' : 'Third-person view');
  }
  snapBehind(heading) { this.yaw = heading; this.pitch = 0.2; }

  update(dt, input, settings) {
    const g = this.game, p = g.player;
    const now = g.time;
    const [mdx, mdy] = input.takeMouse();
    const sens = settings.mouseSens * 0.0022;
    let manual = false;
    if (mdx || mdy) {
      this.yaw -= mdx * sens;
      this.pitch += mdy * sens * (settings.invertY ? -1 : 1);
      manual = true;
    }
    const P = input.pad;
    if (P.rx || P.ry) { this.yaw -= P.rx * 2.6 * dt; this.pitch += P.ry * 1.8 * dt; manual = true; }
    const edge = input.edgeTurn();
    if (edge) { this.yaw -= edge * 2.4 * settings.mouseSens * dt; manual = true; }
    if (manual) this.lastManual = now;
    const v = p.vehicle;
    const aiming = !v && p.aiming && !p.dead;
    this.aimBlend = damp(this.aimBlend, aiming ? 1 : 0, 12, dt);
    if (this.firstPerson && !p.dead && this.cinematic <= 0) { this.updateFirstPerson(dt, input, now); return; }
    let dist, height;
    if (p.dead || this.cinematic > 0) {
      // slow orbit around the player
      this.yaw += dt * 0.25;
      this.pitch = damp(this.pitch, 0.45, 2, dt);
      this.target.set(p.x, 0.8, p.z);
      dist = 9;
    } else if (v) {
      const T = v.type;
      const fwdYaw = Math.atan2(v.vx, v.vz);
      const sp = v.speed;
      const idle = now - this.lastManual > 1.3;
      if (idle) {
        let want = v.heading;
        if (sp > 4 && v.speedF > 0) want = fwdYaw;
        if (input.is('lookBack')) want = v.heading + Math.PI;
        this.yaw = dampAngle(this.yaw, want, sp > 2 ? 3.2 : 1.2, dt);
        this.pitch = damp(this.pitch, 0.17, 2, dt);
      }
      this.pitch = clamp(this.pitch, -0.25, 1.1);
      dist = (T.L * 1.02 + 3.7) * ZOOMS[this.zoom] + Math.min(sp * 0.04, 1.5);
      this.target.set(v.x, v.y + 1.15 + T.H * 0.35, v.z);
      this.fov = damp(this.fov, 62 + clamp((sp - 8) * 0.45, 0, 16), 3, dt);
    } else {
      const sp = Math.hypot(p.vx, p.vz);
      if (!manual && now - this.lastManual > 1.6 && sp > 1.5 && !aiming) this.yaw = dampAngle(this.yaw, p.heading, 1.2, dt);
      this.pitch = clamp(this.pitch, -0.7, 1.15);
      dist = damp(this.smoothDist, 4.4 - this.aimBlend * 2.2, 10, dt);
      this.smoothDist = dist;
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      const sh = 0.42 + this.aimBlend * 0.2;
      const ly = p.lie > 0.5 ? 0.6 : 1.62;
      this.target.set(p.x + rx * sh, p.y + ly - this.aimBlend * 0.05, p.z + rz * sh);
      this.fov = damp(this.fov, 62 - this.aimBlend * 14, 8, dt);
    }
    const cp = Math.cos(this.pitch), spch = Math.sin(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, -spch, Math.cos(this.yaw) * cp);
    let cx = this.target.x - this.dir.x * dist, cy = this.target.y - this.dir.y * dist, cz = this.target.z - this.dir.z * dist;
    // keep the camera out of buildings
    const t = g.collision.raycast(this.target.x, this.target.z, cx, cz, this.target.y, cy, undefined, false);
    if (t < 1) {
      const tt = Math.max(0.08, t - 0.35 / dist);
      cx = this.target.x + (cx - this.target.x) * tt;
      cy = this.target.y + (cy - this.target.y) * tt;
      cz = this.target.z + (cz - this.target.z) * tt;
    }
    if (cy < 0.35) cy = 0.35;
    // shake
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.35;
      cx += (Math.random() - 0.5) * s; cy += (Math.random() - 0.5) * s; cz += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    }
    const cam = this.camera;
    cam.position.set(cx, cy, cz);
    cam.lookAt(this.target.x, this.target.y, this.target.z);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.lookDir.set(this.target.x - cx, this.target.y - cy, this.target.z - cz).normalize();
  }

  updateFirstPerson(dt, input, now) {
    const p = this.game.player, v = p.vehicle, cam = this.camera;
    p.visible = false; // don't render our own body from inside the head
    let ex, ey, ez, fov = 72;
    if (v) {
      const T = v.type;
      if (now - this.lastManual > 1.3) {
        this.yaw = dampAngle(this.yaw, input.is('lookBack') ? v.heading + Math.PI : v.heading, v.speed > 2 ? 5 : 2, dt);
        this.pitch = damp(this.pitch, 0.06, 2, dt);
      }
      // driver's seat: left side, buses sit the driver right behind the windscreen
      const seat = v.local(T.W * 0.22, T.L > 6 ? T.L / 2 - 1.6 : -T.L * 0.04, this.seat);
      ex = seat.x; ey = v.y + T.H * 0.8; ez = seat.z;
      fov += clamp((v.speed - 8) * 0.3, 0, 10);
    } else {
      const sp = Math.hypot(p.vx, p.vz);
      if (p.onGround) this.bob += dt * sp * 1.9;
      ex = p.x; ez = p.z;
      ey = p.y + (p.lie > 0.5 ? 0.6 : 1.62) + Math.sin(this.bob) * 0.035 * Math.min(1, sp / 4);
      fov -= this.aimBlend * 22;
    }
    this.pitch = clamp(this.pitch, -1.35, 1.35);
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.12;
      ex += (Math.random() - 0.5) * s; ey += (Math.random() - 0.5) * s; ez += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    }
    cam.position.set(ex, ey, ez);
    cam.lookAt(ex + this.dir.x, ey + this.dir.y, ez + this.dir.z);
    this.fov = damp(this.fov, fov, 8, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.lookDir.copy(this.dir);
  }
}
