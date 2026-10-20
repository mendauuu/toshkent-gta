// Pixel-art sky (hard colour bands, crisp clouds, pixel sun, moon and stars), sun/moon light, fog
// and the day/night cycle (Tashkent in mid-October).
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../util/math.js';
import { sharedUniforms, NO_NORMAL_PARS, NO_NORMAL } from './materials.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
${NO_NORMAL_PARS}
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform vec3 uMountain; uniform float uNight; uniform float uTime; uniform float uCloud;
varying vec3 vDir;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float h2(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * n2(p); p *= 2.03; a *= 0.5; } return v / 0.875; }
float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
float ridge(float az, float seed) {
  float w = smoothstep(0.05, 0.75, cos(az - 0.95));   // mountains rise to the north-east (Chimgan, Chatkal)
  float hgt = n1(az * 9.0 + seed) * 0.6 + n1(az * 23.0 + seed * 2.0) * 0.4;
  return w * (0.022 + hgt * 0.05) - 0.004;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // four hard bands from the horizon up
  vec3 col = h > 0.32 ? uTop : h > 0.16 ? mix(uHorizon, uTop, 0.67) : h > 0.06 ? mix(uHorizon, uTop, 0.33) : uHorizon;
  if (h < 0.0) col = uBottom;
  // sun: a round pixel disc with one halo ring; the moon (opposite) is a pale disc with a crescent bite
  float sd = dot(d, uSunDir), md = dot(d, -uSunDir);
  if (sd > 0.99935) col = mix(vec3(1.0, 0.97, 0.82), uSunColor, 0.25);
  else if (sd > 0.9978) col = mix(col, uSunColor, 0.45);
  if (uNight > 0.3) {
    vec3 bite = normalize(-uSunDir + vec3(0.012, 0.004, 0.0));
    if (md > 0.99955 && dot(d, bite) < 0.99962) col = vec3(0.92, 0.94, 1.0);
    else if (md > 0.9983 && md <= 0.99955) col = mix(col, vec3(0.55, 0.6, 0.95), 0.35);
  }
  // stars: single pixels that blink on and off
  if (h > 0.05 && uNight > 0.25) {
    vec2 sp = floor(d.xz / (d.y + 0.35) * 62.0);
    float s = step(0.992, h2(sp));
    float on = step(0.25, fract(uTime * 0.5 + h2(sp + 7.0)));
    if (s * on > 0.5) col = vec3(1.0, 0.96, 0.82);
  }
  // clouds: crisp two-tone puffs (lit body, soft rim)
  if (h > 0.04) {
    vec2 cp = d.xz / (d.y + 0.12) * 1.15 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(cp * 1.6);
    float t = 0.62 - uCloud * 0.12;
    vec3 lit = mix(mix(vec3(1.0), uSunColor, 0.18), uHorizon * 1.6, uNight * 0.7);
    vec3 rim = mix(lit, mix(uHorizon, uTop, 0.5), 0.45);
    if (c > t + 0.06) col = lit; else if (c > t) col = rim;
  }
  // distant mountains on the horizon: flat silhouettes with a snow line
  float az = atan(d.x, -d.z);
  float r1 = ridge(az, 3.0), r2 = ridge(az, 11.0) * 0.72;
  if (h > 0.0 && h < r1) col = (h > r1 - 0.008 && r1 > 0.05) ? mix(vec3(1.0), uHorizon, 0.25 + uNight * 0.6) : mix(uMountain, uHorizon, 0.45);
  if (h > 0.0 && h < r2) col = mix(uMountain, uHorizon, 0.15);
  if (h > 0.0 && h < 0.006) col = uBottom;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  ${NO_NORMAL}
}`;

// key frames by sun elevation (degrees). Light intensities are tuned for the toon ramp with no tone
// mapping: in full sun a surface facing the sun shows its own palette colour, a side-lit one ~83% and
// a shadowed one ~70% (perceived brightness), so shadows stay bright and cute.
const KEYS = [
  { el: -18, top: 0x1d1b4f, hor: 0x3b3f8f, bot: 0x34397f, sun: 0x9fb3ff, sunI: 0.55, hemiSky: 0x4a5bb0, hemiGround: 0x3f4f9e, hemiI: 1.0, fog: 0x34397f, mount: 0x262a66 },
  { el: -6, top: 0x2e2a6e, hor: 0x8a5fb0, bot: 0x6b5aa8, sun: 0xb0a0ff, sunI: 0.6, hemiSky: 0x7d74c8, hemiGround: 0x6c63b0, hemiI: 1.1, fog: 0x6b5aa8, mount: 0x3c3478 },
  { el: -1, top: 0x4a5ac8, hor: 0xff9f6b, bot: 0xf08f7a, sun: 0xffb070, sunI: 0.95, hemiSky: 0xd2a0c0, hemiGround: 0xc090b0, hemiI: 1.25, fog: 0xf08f7a, mount: 0x7a4f8a },
  { el: 6, top: 0x5aa8f0, hor: 0xffd0a0, bot: 0xffc89a, sun: 0xffd9a0, sunI: 1.5, hemiSky: 0xe8d4d8, hemiGround: 0xdcc8cc, hemiI: 1.35, fog: 0xffc89a, mount: 0x9a7fa8 },
  { el: 18, top: 0x3aa0f0, hor: 0xbfe8ff, bot: 0xbfe8ff, sun: 0xfff2d8, sunI: 1.7, hemiSky: 0xeef2ff, hemiGround: 0xe2e6f4, hemiI: 1.45, fog: 0xbfe8ff, mount: 0x8f9fd8 },
  { el: 45, top: 0x2f97ee, hor: 0xb3e5ff, bot: 0xb3e5ff, sun: 0xfff6e8, sunI: 1.75, hemiSky: 0xf0f4ff, hemiGround: 0xe4e8f6, hemiI: 1.45, fog: 0xb3e5ff, mount: 0x8f9fd8 },
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

    this.sun = new THREE.DirectionalLight(0xffffff, 1.7);
    this.sun.target = new THREE.Object3D();
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xf0f4ff, 0xe4e8f6, 1.45);
    scene.add(this.hemi);
    this.fog = new THREE.Fog(0xb3e5ff, 300, 650);
    scene.fog = this.fog;
    this.sunDir = new THREE.Vector3();
    this.night = 0;
    this.applyShadowSettings();
    this.update(0, new THREE.Vector3());
  }

  // hard-edged pixel shadows (BasicShadowMap is set on the renderer); Low has none
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
    // offsets in world units (the shadow depth range is ~900 m): enough normal offset that walls almost
    // parallel to the sun don't shadow themselves in stripes, small enough that the ground's lookup
    // stays below car bodies (~0.3 m up) so they don't get striped acne underneath
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.15;
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
    // fog only in the far distance, in hard steps (see fog chunk in materials.js)
    this.fog.color.copy(L('fog'));
    const dd = this.settings.drawDistance;
    this.fog.near = dd * 0.5;
    this.fog.far = dd * 1.0;
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
  }

  followCamera(camera) { this.sky.position.copy(camera.position); }
}
