// Sky dome, sun/moon light, fog and the day/night cycle (Tashkent in mid-October).
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../util/math.js';
import { sharedUniforms } from './materials.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform vec3 uMountain; uniform float uNight; uniform float uTime; uniform float uCloud;
varying vec3 vDir;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float h2(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n2(p); p *= 2.03; a *= 0.5; } return v; }
float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
float ridge(float az, float seed) {
  float w = smoothstep(0.05, 0.75, cos(az - 0.95));   // mountains rise to the north-east (Chimgan, Chatkal)
  float hgt = n1(az * 9.0 + seed) * 0.55 + n1(az * 23.0 + seed * 2.0) * 0.3 + n1(az * 61.0 + seed) * 0.15;
  return w * (0.022 + hgt * 0.05) - 0.004;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.55, h), 0.75));
  // below the horizon the sky blends into the fogged ground
  if (h < 0.0) col = uBottom;
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 1400.0) * 9.0 + pow(sd, 18.0) * 0.18 + pow(sd, 3.0) * 0.06);
  // moon (opposite the sun)
  float md = max(dot(d, -uSunDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * (pow(md, 2600.0) * 5.0 + pow(md, 60.0) * 0.05) * uNight;
  // stars
  if (h > 0.0 && uNight > 0.01) {
    vec2 sp = d.xz / (d.y + 0.35) * 160.0;
    float s = step(0.9965, h2(floor(sp)));
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + h2(floor(sp)) * 40.0);
    col += vec3(s * tw) * uNight * smoothstep(0.02, 0.25, h);
  }
  // clouds
  if (h > 0.0) {
    vec2 cp = d.xz / (d.y + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = smoothstep(0.52 - uCloud * 0.12, 0.85, fbm(cp));
    vec3 cc = mix(uHorizon * 1.05, vec3(1.0), 0.6) * mix(1.0, 0.25, uNight) + uSunColor * pow(sd, 6.0) * 0.4;
    col = mix(col, cc, c * smoothstep(0.0, 0.18, h) * 0.85);
  }
  // distant mountains on the horizon
  float az = atan(d.x, -d.z);
  float r1 = ridge(az, 3.0), r2 = ridge(az, 11.0) * 0.72;
  if (h < r1 && h > 0.0) {
    float snow = smoothstep(r1 - 0.02, r1 - 0.004, h) * smoothstep(0.045, 0.065, r1);
    vec3 m = mix(uMountain, uHorizon, 0.55) + snow * vec3(0.12) * (1.0 - uNight);
    col = mix(col, m, 0.85 * smoothstep(0.0, 0.006, h));
  }
  if (h < r2 && h > 0.0) col = mix(col, mix(uMountain, uHorizon, 0.3), 0.8 * smoothstep(0.0, 0.006, h));
  // haze: the band just above the horizon fades into the fog colour
  col = mix(uBottom, col, smoothstep(-0.004, 0.035, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// key frames by sun elevation (degrees)
const KEYS = [
  { el: -18, top: 0x03060f, hor: 0x0b1222, bot: 0x05070c, sun: 0xa8bce8, sunI: 0.38, hemiSky: 0x4a5a88, hemiGround: 0x1c1a20, hemiI: 0.78, fog: 0x0c1324, mount: 0x0a0f1c },
  { el: -6, top: 0x0f1a36, hor: 0x2a2e48, bot: 0x0b0d14, sun: 0x8f9fd0, sunI: 0.35, hemiSky: 0x5b6a96, hemiGround: 0x25212a, hemiI: 0.82, fog: 0x232a40, mount: 0x1a1f33 },
  { el: -1, top: 0x2a3d6e, hor: 0xc77a52, bot: 0x2c2420, sun: 0xff8a4a, sunI: 0.5, hemiSky: 0x9a8fae, hemiGround: 0x3a2e28, hemiI: 0.85, fog: 0x7d6a6a, mount: 0x3d3346 },
  { el: 6, top: 0x4a74b0, hor: 0xf0b585, bot: 0x5a4b3e, sun: 0xffb375, sunI: 1.7, hemiSky: 0xc4c6cf, hemiGround: 0x6a5a48, hemiI: 1.0, fog: 0xd4b9a0, mount: 0x7d7690 },
  { el: 18, top: 0x3b78c6, hor: 0xb9d2ea, bot: 0x7c7466, sun: 0xffeccf, sunI: 2.6, hemiSky: 0xd2dbe4, hemiGround: 0x7b6d56, hemiI: 1.1, fog: 0xbcd0e2, mount: 0x8d9ab4 },
  { el: 45, top: 0x2f6fc4, hor: 0xb3d0ec, bot: 0x7c7466, sun: 0xfff6e8, sunI: 3.0, hemiSky: 0xd6dfe8, hemiGround: 0x83745c, hemiI: 1.15, fog: 0xbfd4e8, mount: 0x93a2bd },
];
const colorKeys = ['top', 'hor', 'bot', 'sun', 'hemiSky', 'hemiGround', 'fog', 'mount'];
KEYS.forEach((k) => colorKeys.forEach((c) => { k[c] = new THREE.Color(k[c]); }));

export class Environment {
  constructor(scene, renderer, settings) {
    this.scene = scene;
    this.renderer = renderer;
    this.settings = settings;
    this.time = 10 * 60; // minutes since midnight
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uMountain: { value: new THREE.Color() },
      uNight: sharedUniforms.uNight, uTime: sharedUniforms.uTime, uCloud: { value: 0.3 },
    };
    const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
    this.sky.scale.setScalar(4000);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.skyScene = new THREE.Scene();
    this.skyForEnv = new THREE.Mesh(this.sky.geometry, skyMat);
    this.skyForEnv.scale.setScalar(100);
    this.skyScene.add(this.skyForEnv);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = null;
    this.envTimer = 0;
    this.lastEnvTime = -999;

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.target = new THREE.Object3D();
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xc4dbf5, 0x7b6d56, 1.1);
    scene.add(this.hemi);
    this.fog = new THREE.Fog(0xbcd0e2, 150, 900);
    scene.fog = this.fog;
    this.sunDir = new THREE.Vector3();
    this.night = 0;
    this.applyShadowSettings();
    this.update(0, new THREE.Vector3());
  }

  applyShadowSettings() {
    const q = this.settings.quality;
    const enabled = q !== 'low';
    this.renderer.shadowMap.enabled = enabled;
    this.sun.castShadow = enabled;
    this.shadowRange = q === 'high' ? 95 : 65;
    const size = q === 'high' ? 2048 : 1024;
    const cam = this.sun.shadow.camera;
    cam.left = -this.shadowRange; cam.right = this.shadowRange; cam.top = this.shadowRange; cam.bottom = -this.shadowRange;
    cam.near = 1; cam.far = 900;
    cam.updateProjectionMatrix();
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
  }

  get hours() { return this.time / 60; }
  clockString() {
    const m = Math.floor(this.time) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  // sun elevation/azimuth for the current time (sunrise ~6:50, sunset ~18:05)
  sunAngles() {
    const h = this.hours;
    const rise = 6.85, set = 18.1;
    const t = (h - rise) / (set - rise);
    let el, az;
    if (t >= 0 && t <= 1) { el = Math.sin(Math.PI * t) * 41; az = 105 + t * 150; }
    else {
      const nt = t > 1 ? (h - set) / (24 - set + rise) : (h + 24 - set) / (24 - set + rise);
      el = -Math.sin(Math.PI * clamp(nt, 0, 1)) * 48 - 0.5;
      az = 255 + nt * 210;
    }
    return { el, az };
  }

  update(dt, focus, daySeconds = this.settings.dayLength * 60) {
    this.time = (this.time + (dt * 1440) / daySeconds) % 1440;
    const { el, az } = this.sunAngles();
    // interpolate key frames
    let i = 0;
    while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const f = clamp((el - a.el) / (b.el - a.el), 0, 1);
    const L = (k) => a[k].clone().lerp(b[k], f);
    const u = this.uniforms;
    u.uTop.value.copy(L('top'));
    u.uHorizon.value.copy(L('hor'));
    u.uBottom.value.copy(L('fog'));
    u.uSunColor.value.copy(L('sun'));
    u.uMountain.value.copy(L('mount'));
    this.night = 1 - smoothstep(-7, 3, el);
    sharedUniforms.uNight.value = this.night;
    const elr = (Math.max(el, -60) * Math.PI) / 180, azr = (az * Math.PI) / 180;
    this.sunDir.set(Math.sin(azr) * Math.cos(elr), Math.sin(elr), -Math.cos(azr) * Math.cos(elr)).normalize();
    u.uSunDir.value.copy(this.sunDir);
    // light comes from the sun by day and from the moon (opposite side) by night
    const lightDir = el > -2 ? this.sunDir.clone() : this.sunDir.clone().negate();
    if (lightDir.y < 0.12) lightDir.y = 0.12;
    lightDir.normalize();
    this.lightDir = lightDir;
    this.sun.color.copy(L('sun'));
    this.sun.intensity = lerp(a.sunI, b.sunI, f);
    this.hemi.color.copy(L('hemiSky'));
    this.hemi.groundColor.copy(L('hemiGround'));
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, f);
    this.fog.color.copy(L('fog'));
    const dd = this.settings.drawDistance;
    this.fog.near = dd * 0.22;
    this.fog.far = dd * 1.02;
    // shadow camera follows the focus point, snapped to texels to avoid shimmering
    const range = this.shadowRange;
    const texel = (2 * range) / this.sun.shadow.mapSize.x;
    const fwd = lightDir.clone().negate();
    const upW = Math.abs(fwd.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, upW).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const r = Math.round(focus.dot(right) / texel) * texel, uu = Math.round(focus.dot(up) / texel) * texel, ff = focus.dot(fwd);
    const snapped = right.multiplyScalar(r).add(up.multiplyScalar(uu)).add(fwd.clone().multiplyScalar(ff));
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(lightDir, 400);
    this.sun.target.updateMatrixWorld();
    // environment map for reflective materials, refreshed as the light changes
    this.envTimer -= dt;
    if (this.envTimer <= 0 && Math.abs(this.time - this.lastEnvTime) > 8) {
      this.envTimer = 2;
      this.lastEnvTime = this.time;
      const old = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.skyScene, 0, 0.1, 200);
      this.scene.environment = this.envTarget.texture;
      if (old) old.dispose();
    }
  }

  followCamera(camera) { this.sky.position.copy(camera.position); }
}
