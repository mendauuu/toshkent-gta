// Particles (smoke, fire, sparks...), bullet tracers, skid marks and explosion flashes.
import * as THREE from 'three';
import { rand } from '../util/math.js';
import { ORDER } from '../world/city.js';

const VERT = /* glsl */ `
attribute vec4 aColor; attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 400.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.25, d) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <colorspace_fragment>
}`;

class Pool {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 } };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
    this.geo = g;
    // particle state
    this.p = [];
  }
  emit(o) { if (this.p.length >= this.max) this.p.shift(); this.p.push(o); }
  update(dt) {
    const P = this.p;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.t += dt;
      if (q.t >= q.life) continue;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vy = q.vy * k - q.grav * dt; q.vz *= k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.02 && q.grav > 0) { q.y = 0.02; q.vy = 0; q.vx *= 0.5; q.vz *= 0.5; }
      P[w++] = q;
    }
    P.length = w;
    const n = Math.min(w, this.max);
    for (let i = 0; i < n; i++) {
      const q = P[i], f = q.t / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.col[i * 4] = q.r; this.col[i * 4 + 1] = q.g; this.col[i * 4 + 2] = q.b;
      this.col[i * 4 + 3] = q.a * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85);
      this.size[i] = q.s0 + (q.s1 - q.s0) * f;
    }
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'aColor', 'aSize']) this.geo.attributes[a].needsUpdate = true;
  }
}

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.alpha = new Pool(scene, 2600, false);
    this.add = new Pool(scene, 1800, true);
    // tracers
    this.maxTracers = 80;
    const tg = new THREE.BufferGeometry();
    this.tpos = new Float32Array(this.maxTracers * 6);
    this.tcol = new Float32Array(this.maxTracers * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tpos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tcol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo = tg;
    this.tracers = [];
    const lines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = false;
    scene.add(lines);
    // skid marks ring buffer
    this.maxSkid = 900;
    const sg = new THREE.BufferGeometry();
    this.spos = new Float32Array(this.maxSkid * 4 * 3);
    const idx = new Uint32Array(this.maxSkid * 6);
    for (let i = 0; i < this.maxSkid; i++) { idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6); }
    sg.setAttribute('position', new THREE.BufferAttribute(this.spos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.skidGeo = sg;
    this.skidHead = 0;
    const skid = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    skid.frustumCulled = false;
    skid.renderOrder = ORDER.decal;
    scene.add(skid);
    this.lastSkid = new Map();
    // explosion flash light: only on High quality, created up front so materials never recompile
    if (game.settings.quality === 'high') {
      this.flash = new THREE.PointLight(0xffa040, 0, 45, 1.6);
      scene.add(this.flash);
    } else this.flash = { intensity: 0, position: new THREE.Vector3() };
    this.flashT = 0;
  }

  setScale(height, fovDeg) {
    const s = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.alpha.uniforms.uScale.value = s;
    this.add.uniforms.uScale.value = s;
  }

  spawn(type, x, y, z, o = {}) {
    const P = (pool, props) => pool.emit({ t: 0, x, y, z, vx: 0, vy: 0, vz: 0, drag: 0, grav: 0, ...props });
    switch (type) {
      case 'smoke': P(this.alpha, { vx: rand(-0.4, 0.4), vy: rand(1, 1.7), vz: rand(-0.4, 0.4), life: rand(1.8, 2.8), s0: 0.6, s1: 3.2, r: 0.72, g: 0.72, b: 0.72, a: 0.42, drag: 0.5 }); break;
      case 'blacksmoke': P(this.alpha, { vx: rand(-0.5, 0.5), vy: rand(1.6, 2.4), vz: rand(-0.5, 0.5), life: rand(2.4, 3.6), s0: 0.9, s1: 4.6, r: 0.09, g: 0.09, b: 0.09, a: 0.55, drag: 0.45 }); break;
      case 'steam': P(this.alpha, { vx: rand(-0.2, 0.2), vy: rand(0.8, 1.3), vz: rand(-0.2, 0.2), life: rand(2.2, 3.2), s0: 0.5, s1: 2.6, r: 0.96, g: 0.96, b: 0.96, a: 0.28, drag: 0.4 }); break;
      case 'exhaust': P(this.alpha, { vx: (o.vx || 0) + rand(-0.2, 0.2), vy: rand(0.2, 0.5), vz: (o.vz || 0) + rand(-0.2, 0.2), life: 0.9, s0: 0.15, s1: 0.8, r: 0.6, g: 0.6, b: 0.62, a: 0.22, drag: 1.5 }); break;
      case 'fire': P(this.add, { x: x + rand(-0.3, 0.3), z: z + rand(-0.3, 0.3), vx: rand(-0.3, 0.3), vy: rand(1.8, 3.2), vz: rand(-0.3, 0.3), life: rand(0.35, 0.7), s0: rand(1.0, 1.6), s1: 0.25, r: 1, g: rand(0.38, 0.6), b: 0.12, a: 0.9, drag: 0.8 }); break;
      case 'spark': P(this.add, { vx: rand(-5, 5), vy: rand(1, 5), vz: rand(-5, 5), life: rand(0.18, 0.4), s0: 0.11, s1: 0.05, r: 1, g: 0.82, b: 0.45, a: 1, drag: 1, grav: 12 }); break;
      case 'dust': P(this.alpha, { vx: rand(-0.8, 0.8), vy: rand(0.3, 1.2), vz: rand(-0.8, 0.8), life: rand(0.5, 0.9), s0: 0.2, s1: 0.9, r: 0.72, g: 0.66, b: 0.56, a: 0.5, drag: 2 }); break;
      case 'blood': P(this.alpha, { vx: rand(-1.6, 1.6), vy: rand(0.5, 2.2), vz: rand(-1.6, 1.6), life: rand(0.35, 0.6), s0: 0.1, s1: 0.2, r: 0.42, g: 0.02, b: 0.02, a: 0.85, drag: 0.5, grav: 9 }); break;
      case 'splash': P(this.alpha, { vx: rand(-2, 2), vy: rand(2, 4), vz: rand(-2, 2), life: 0.7, s0: 0.3, s1: 0.8, r: 0.85, g: 0.92, b: 1, a: 0.6, drag: 0.5, grav: 9 }); break;
      case 'money': P(this.add, { vx: rand(-1, 1), vy: rand(2, 3.5), vz: rand(-1, 1), life: 0.8, s0: 0.3, s1: 0.1, r: 0.4, g: 1, b: 0.4, a: 1, drag: 1, grav: 6 }); break;
      case 'flash': P(this.add, { life: 0.12, s0: o.size || 1.2, s1: (o.size || 1.2) * 1.4, r: 1, g: 0.85, b: 0.55, a: 1 }); break;
      default: break;
    }
  }

  burst(type, x, y, z, n) { for (let i = 0; i < n; i++) this.spawn(type, x, y, z); }

  muzzle(x, y, z) { this.spawn('flash', x, y, z, { size: 0.55 }); }

  explosion(x, y, z, size = 1) {
    this.spawn('flash', x, y + 1, z, { size: 14 * size });
    for (let i = 0; i < 40 * size; i++) this.add.emit({ t: 0, x: x + rand(-1, 1), y: y + rand(0, 1.5), z: z + rand(-1, 1), vx: rand(-7, 7), vy: rand(2, 9), vz: rand(-7, 7), drag: 2.2, grav: -1, life: rand(0.5, 1.1), s0: rand(2, 3.5) * size, s1: 0.5, r: 1, g: rand(0.35, 0.65), b: 0.1, a: 1 });
    for (let i = 0; i < 26 * size; i++) this.alpha.emit({ t: 0, x: x + rand(-2, 2), y: y + rand(0.5, 3), z: z + rand(-2, 2), vx: rand(-2.5, 2.5), vy: rand(1.5, 4.5), vz: rand(-2.5, 2.5), drag: 0.8, grav: 0, life: rand(2.5, 4.5), s0: 2.5 * size, s1: 7 * size, r: 0.12, g: 0.11, b: 0.1, a: 0.6 });
    this.burst('spark', x, y + 0.5, z, 30);
    this.flash.position.set(x, y + 2, z);
    this.flashT = 0.6;
  }

  tracer(x0, y0, z0, x1, y1, z1) {
    if (this.tracers.length >= this.maxTracers) this.tracers.shift();
    this.tracers.push({ x0, y0, z0, x1, y1, z1, t: 0 });
  }

  // continuous skid mark per wheel key
  skid(key, x, z, active, width = 0.22) {
    const last = this.lastSkid.get(key);
    if (!active) { this.lastSkid.delete(key); return; }
    if (last && Math.hypot(x - last.x, z - last.z) < 0.35) return;
    if (last && Math.hypot(x - last.x, z - last.z) < 3) {
      const dx = x - last.x, dz = z - last.z, l = Math.hypot(dx, dz);
      const nx = (-dz / l) * width / 2, nz = (dx / l) * width / 2;
      const i = this.skidHead;
      this.skidHead = (this.skidHead + 1) % this.maxSkid;
      const p = this.spos, o = i * 12, y = 0.025;
      p[o] = last.x - nx; p[o + 1] = y; p[o + 2] = last.z - nz;
      p[o + 3] = last.x + nx; p[o + 4] = y; p[o + 5] = last.z + nz;
      p[o + 6] = x - nx; p[o + 7] = y; p[o + 8] = z - nz;
      p[o + 9] = x + nx; p[o + 10] = y; p[o + 11] = z + nz;
      this.skidGeo.attributes.position.needsUpdate = true;
    }
    this.lastSkid.set(key, { x, z });
  }

  update(dt) {
    this.alpha.update(dt);
    this.add.update(dt);
    // tracers
    let w = 0;
    for (const t of this.tracers) { t.t += dt; if (t.t < 0.07) this.tracers[w++] = t; }
    this.tracers.length = w;
    for (let i = 0; i < this.maxTracers; i++) {
      const t = this.tracers[i];
      const o = i * 6;
      if (!t) { this.tpos.fill(0, o, o + 6); continue; }
      // short bright segment travelling along the shot
      const f0 = Math.min(1, t.t / 0.07), f1 = Math.min(1, f0 + 0.35);
      this.tpos[o] = t.x0 + (t.x1 - t.x0) * f0; this.tpos[o + 1] = t.y0 + (t.y1 - t.y0) * f0; this.tpos[o + 2] = t.z0 + (t.z1 - t.z0) * f0;
      this.tpos[o + 3] = t.x0 + (t.x1 - t.x0) * f1; this.tpos[o + 4] = t.y0 + (t.y1 - t.y0) * f1; this.tpos[o + 5] = t.z0 + (t.z1 - t.z0) * f1;
      for (let k = 0; k < 2; k++) { this.tcol[o + k * 3] = 1; this.tcol[o + k * 3 + 1] = 0.85; this.tcol[o + k * 3 + 2] = 0.5; }
    }
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = Math.max(0, this.flashT) * 900; } else this.flash.intensity = 0;
  }
}
