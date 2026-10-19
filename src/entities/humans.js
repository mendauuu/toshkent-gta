// People: one instanced mesh for everyone, limbs animated in the vertex shader, toon-shaded in the
// cute pixel palette.
import * as THREE from 'three';
import { choice, chance, rand } from '../util/math.js';
import { radialTexture, ORDER } from '../world/city.js';
import { toon } from '../world/materials.js';
import { PAL, cute } from '../world/palette.js';

// clothing colours set elsewhere (the player, mission characters) snap to the palette too
const cuteCache = new Map();
const cuteCloth = (hex) => { let c = cuteCache.get(hex); if (c === undefined) { c = cute(hex); cuteCache.set(hex, c); } return c; };

// parts: 0 body, 1 left arm, 2 right arm, 3 left leg, 4 right leg
// slots: 0 shirt, 1 pants, 2 skin, 3 hair, 4 shoes, 5 extra (hat/scarf/dress), 6 black, 7 white, 8 gun
// variant bits: 1 doppi, 2 police cap, 4 headscarf, 8 dress, 16 gun, 32 hair, 64 beard, 128 jacket tails
export const VAR = { DOPPI: 1, CAP: 2, SCARF: 4, DRESS: 8, GUN: 16, HAIR: 32, BEARD: 64, COAT: 128 };
const POSE = { WALK: 0, AIM: 1, HANDSUP: 2, PUNCH: 3, PANIC: 4, DRIVE: 5 };
export { POSE };

function buildHumanGeometry() {
  const pos = [], nrm = [], part = [], slot = [], vari = [], idx = [];
  const add = (cx, cy, cz, sx, sy, sz, p, s, v = 0) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(cx, cy, cz);
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    const n = g.attributes.position.count;
    for (let i = 0; i < n; i++) { part.push(p); slot.push(s); vari.push(v); }
    for (const i of g.index.array) idx.push(base + i);
  };
  // legs (pivot at hip y=0.92, x=±0.1)
  for (const [p, x] of [[3, 0.1], [4, -0.1]]) {
    add(x, 0.52, 0, 0.15, 0.8, 0.17, p, 1);
    add(x, 0.05, 0.04, 0.16, 0.1, 0.27, p, 4);
  }
  add(0, 0.97, 0, 0.36, 0.16, 0.22, 0, 1);              // pelvis
  add(0, 1.27, 0, 0.42, 0.5, 0.24, 0, 0);               // torso
  add(0, 1.55, 0, 0.14, 0.08, 0.14, 0, 2);              // neck
  add(0, 1.71, 0.01, 0.22, 0.26, 0.24, 0, 2);           // head
  add(0, 1.86, -0.02, 0.235, 0.07, 0.25, 0, 3, 6);      // hair top
  add(0, 1.75, -0.11, 0.235, 0.18, 0.04, 0, 3, 6);      // hair back
  add(0, 1.62, 0.12, 0.2, 0.09, 0.04, 0, 3, 7);         // beard
  add(0, 1.88, 0, 0.245, 0.08, 0.245, 0, 6, 1);         // doppi (black)
  for (const [x, z, sx, sz] of [[0, 0.124, 0.06, 0.005], [0, -0.124, 0.06, 0.005], [0.124, 0, 0.005, 0.06], [-0.124, 0, 0.005, 0.06]])
    add(x, 1.885, z, sx || 0.006, 0.035, sz || 0.006, 0, 7, 1); // doppi motifs
  add(0, 1.88, 0, 0.26, 0.07, 0.27, 0, 5, 2);           // police cap
  add(0, 1.85, 0.16, 0.22, 0.02, 0.1, 0, 6, 2);         // cap visor
  add(0, 1.78, -0.02, 0.26, 0.24, 0.28, 0, 5, 3);       // headscarf
  add(0, 1.58, -0.1, 0.24, 0.22, 0.06, 0, 5, 3);        // scarf tail
  add(0, 0.72, 0, 0.44, 0.62, 0.3, 0, 5, 4);            // dress
  add(0, 1.0, -0.13, 0.4, 0.5, 0.05, 0, 0, 8);          // coat tails
  // arms (pivot at shoulder y=1.48, x=±0.27)
  for (const [p, x] of [[1, 0.27], [2, -0.27]]) {
    add(x, 1.32, 0, 0.12, 0.34, 0.13, p, 0);
    add(x, 1.0, 0, 0.11, 0.32, 0.12, p, 2);
  }
  add(-0.27, 0.86, 0.08, 0.06, 0.12, 0.22, 2, 8, 5);    // pistol in right hand
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aSlot', new THREE.Float32BufferAttribute(slot, 1));
  g.setAttribute('aVar', new THREE.Float32BufferAttribute(vari, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const HUMAN_VERT_PARS = /* glsl */ `
attribute float aPart; attribute float aSlot; attribute float aVar;
attribute vec3 iColA; attribute vec3 iColB; attribute vec3 iColC; attribute vec3 iColD; attribute vec4 iAnim;
varying vec3 vHumanColor;
mat3 hRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 hRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
`;
const HUMAN_ANIM = /* glsl */ `
  mat3 hR = mat3(1.0); vec3 hPivot = vec3(0.0); float hVis = 1.0;
  {
    float phase = iAnim.x, amp = iAnim.y, pose = iAnim.z, bits = iAnim.w;
    float var = aVar;
    // variant visibility: 1 doppi,2 cap,3 scarf,4 dress,5 gun,6 hair,7 beard,8 coat
    if (var > 0.5) {
      float bit = exp2(var - 1.0);
      if (var > 5.5 && var < 6.5) hVis = 1.0 - mod(floor(bits / 4.0), 2.0) * 1.0; // hair hidden by scarf
      if (var > 5.5 && var < 6.5) hVis *= mod(floor(bits / 32.0), 2.0);
      else hVis = mod(floor(bits / bit), 2.0);
    }
    float sw = sin(phase) * amp;
    float swB = sin(phase * 2.0) * amp;
    if (aPart > 0.5 && aPart < 1.5) { hPivot = vec3(0.27, 1.48, 0.0); float a = -sw * 0.85;
      if (pose > 1.5 && pose < 2.5) a = -2.9; else if (pose > 3.5 && pose < 4.5) a = -2.4 + swB * 0.6; else if (pose > 4.5) a = -0.9;
      hR = hRotX(a) * hRotZ(pose > 1.5 && pose < 2.5 ? -0.25 : (pose > 0.5 && pose < 1.5 ? -0.1 : 0.0)); }
    else if (aPart > 1.5 && aPart < 2.5) { hPivot = vec3(-0.27, 1.48, 0.0); float a = sw * 0.85;
      if (pose > 0.5 && pose < 1.5) a = -1.5; else if (pose > 1.5 && pose < 2.5) a = -2.9; else if (pose > 2.5 && pose < 3.5) a = -1.55 * amp; else if (pose > 3.5 && pose < 4.5) a = -2.4 - swB * 0.6; else if (pose > 4.5) a = -0.9;
      hR = hRotX(a) * hRotZ(pose > 1.5 && pose < 2.5 ? 0.25 : 0.0); }
    else if (aPart > 2.5 && aPart < 3.5) { hPivot = vec3(0.1, 0.92, 0.0); hR = hRotX(pose > 4.5 ? -1.4 : sw); }
    else if (aPart > 3.5) { hPivot = vec3(-0.1, 0.92, 0.0); hR = hRotX(pose > 4.5 ? -1.4 : -sw); }
  }
`;
const HUMAN_COLOR = /* glsl */ `
  {
    float s = aSlot;
    vec3 c = iColA;
    if (s > 0.5 && s < 1.5) c = iColB; else if (s > 1.5 && s < 2.5) c = iColC; else if (s > 2.5 && s < 3.5) c = mix(vec3(0.04, 0.018, 0.04), vec3(0.2, 0.08, 0.05), iColD.r * 0.5);
    else if (s > 3.5 && s < 4.5) c = vec3(0.06, 0.03, 0.09); else if (s > 4.5 && s < 5.5) c = iColD; else if (s > 5.5 && s < 6.5) c = vec3(0.024, 0.012, 0.042);
    else if (s > 6.5 && s < 7.5) c = vec3(1.0); else if (s > 7.5) c = vec3(0.06, 0.03, 0.09);
    vHumanColor = c;
  }
`;

function makeHumanMaterial() {
  const mat = toon({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + HUMAN_VERT_PARS)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + HUMAN_ANIM + '\nobjectNormal = hR * objectNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = hPivot + hR * (transformed - hPivot);\nif (hVis < 0.5) transformed = vec3(0.0, 1.2, 0.0);\n' + HUMAN_COLOR);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHumanColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vHumanColor;');
  };
  mat.customProgramCacheKey = () => 'human';
  return mat;
}

// cute palette versions; each list keeps its old length so looks are drawn with the same random calls
const SKINS = [0xffd2a8, 0xf2b98c, 0xdb9a6b, 0xc9845a, 0xffe0c2, 0xb06f48];
const SHIRTS = [PAL.white, PAL.cloud, PAL.blue, PAL.plum, PAL.sky, PAL.coral, PAL.leaf, PAL.cream, PAL.navy, PAL.lilac, PAL.orange, PAL.teal, PAL.berry];
const PANTS = [PAL.plum, PAL.navy, PAL.slate, PAL.brownDk, PAL.ink, PAL.slateLt, PAL.blue];
const DRESSES = [PAL.berry, PAL.blue, PAL.teal, PAL.pink, PAL.purple, PAL.gold, PAL.plum, PAL.orange];
const SCARVES = [PAL.cloud, PAL.sky, PAL.pink, PAL.plum, PAL.lime, PAL.yellow];
const HAIRS = [0x3a2430, PAL.brownDk, 0x5a3424, PAL.lilac, PAL.ink];

export function randomLook(kind = 'ped') {
  const look = { shirt: choice(SHIRTS), pants: choice(PANTS), skin: choice(SKINS), extra: choice(HAIRS), bits: VAR.HAIR };
  if (kind === 'police') {
    look.shirt = PAL.navy; look.pants = PAL.plum; look.extra = PAL.navy; look.bits = VAR.CAP | VAR.GUN;
    return look;
  }
  if (kind === 'gang') {
    look.shirt = PAL.ink; look.pants = PAL.plum; look.extra = PAL.ink; look.bits = VAR.HAIR | VAR.GUN | VAR.COAT | (chance(0.4) ? VAR.BEARD : 0);
    return look;
  }
  if (chance(0.45)) {
    // woman
    look.female = true;
    if (chance(0.55)) { look.extra = choice(SCARVES); look.bits = VAR.SCARF; } else { look.extra = choice(HAIRS); look.bits = VAR.HAIR; }
    if (chance(0.6)) { look.bits |= VAR.DRESS; look.extra2 = choice(DRESSES); look.shirt = look.extra2; if (!(look.bits & VAR.SCARF)) look.extra = look.extra2; }
  } else {
    if (chance(0.22)) { look.bits = VAR.DOPPI | VAR.HAIR; }
    if (chance(0.18)) look.bits |= VAR.BEARD;
    if (chance(0.15)) look.bits |= VAR.COAT;
  }
  return look;
}

export class Human {
  constructor(look, x = 0, z = 0) {
    this.look = look;
    this.x = x; this.y = 0; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.heading = 0;
    this.radius = 0.34;
    this.health = 100;
    this.armor = 0;
    this.dead = false;
    this.deadTime = 0;
    this.ragdoll = 0; // seconds remaining of knock-down
    this.lie = 0; // 0 standing .. 1 lying
    this.spin = 0;
    this.animPhase = Math.random() * 6;
    this.animAmp = 0;
    this.pose = POSE.WALK;
    this.punchT = 0;
    this.inVehicle = null;
    this.visible = true;
    this.onGround = true;
  }
  setLook(look) { this.look = look; }
  get alive() { return !this.dead; }
  // advance walking animation from the current horizontal speed
  animate(dt, speed) {
    this.animAmp += ((speed > 0.2 ? Math.min(0.85, 0.32 + speed * 0.1) : 0) - this.animAmp) * Math.min(1, dt * 8);
    this.animPhase += dt * (2.2 + speed * 1.55);
    if (this.punchT > 0) this.punchT -= dt;
  }
}

const MAX_HUMANS = 260;
export class HumanRenderer {
  constructor(scene) {
    const geo = buildHumanGeometry();
    this.attrs = {
      iColA: new THREE.InstancedBufferAttribute(new Float32Array(MAX_HUMANS * 3), 3),
      iColB: new THREE.InstancedBufferAttribute(new Float32Array(MAX_HUMANS * 3), 3),
      iColC: new THREE.InstancedBufferAttribute(new Float32Array(MAX_HUMANS * 3), 3),
      iColD: new THREE.InstancedBufferAttribute(new Float32Array(MAX_HUMANS * 3), 3),
      iAnim: new THREE.InstancedBufferAttribute(new Float32Array(MAX_HUMANS * 4), 4),
    };
    for (const [k, a] of Object.entries(this.attrs)) { a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); }
    this.mesh = new THREE.InstancedMesh(geo, makeHumanMaterial(), MAX_HUMANS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    // blob shadows
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.4, depthWrite: false, map: radialTexture() }), MAX_HUMANS);
    this.shadow.renderOrder = ORDER.shadow;
    this.shadow.count = 0;
    this.shadow.frustumCulled = false;
    scene.add(this.shadow);
    this.n = 0;
    this.c = new THREE.Color();
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
  }
  begin() { this.n = 0; }
  push(h) {
    if (this.n >= MAX_HUMANS || !h.visible || h.inVehicle) return;
    const i = this.n++;
    const L = h.look;
    const put = (attr, hex) => { this.c.set(hex); attr.array[i * 3] = this.c.r; attr.array[i * 3 + 1] = this.c.g; attr.array[i * 3 + 2] = this.c.b; };
    put(this.attrs.iColA, cuteCloth(L.shirt));
    put(this.attrs.iColB, cuteCloth(L.pants));
    put(this.attrs.iColC, L.skin);
    put(this.attrs.iColD, cuteCloth(L.extra));
    const an = this.attrs.iAnim.array;
    let bits = L.bits;
    if (h.showGun === false) bits &= ~VAR.GUN;
    if (h.showGun === true) bits |= VAR.GUN;
    an[i * 4] = h.animPhase; an[i * 4 + 1] = h.lie > 0.5 ? 0 : h.animAmp; an[i * 4 + 2] = h.pose; an[i * 4 + 3] = bits;
    // lying down: rotate around X so the body lies along the ground
    this.e.set(-Math.PI / 2 * h.lie, h.heading + h.spin, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(h.x, h.y + h.lie * 0.14, h.z);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    // shadow
    const sh = 0.9 + h.lie * 0.9;
    this.m.compose(this.v.set(h.x, 0.03, h.z), this.q.setFromAxisAngle(this.v2 || (this.v2 = new THREE.Vector3(0, 1, 0)), h.heading), this.s.set(sh * (1 - h.lie * 0.4), 1, sh));
    this.shadow.setMatrixAt(i, this.m);
    this.s.set(1, 1, 1);
  }
  end() {
    this.mesh.count = this.n;
    this.shadow.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shadow.instanceMatrix.needsUpdate = true;
    for (const a of Object.values(this.attrs)) a.needsUpdate = true;
  }
}
