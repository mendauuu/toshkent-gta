// People: one instanced mesh for everyone, chibi toy proportions (big soft head with a pixel face,
// short round body), limbs animated in the vertex shader, toon-shaded in the cute pixel palette.
import * as THREE from 'three';
import { choice, chance, mulberry32 } from '../util/math.js';
import { radialTexture, ORDER } from '../world/city.js';
import { toon } from '../world/materials.js';
import { PAL, cute } from '../world/palette.js';
import { PolyBuf, bevelBox } from '../util/shapes.js';

// clothing colours set elsewhere (the player, mission characters) snap to the palette too
const cuteCache = new Map();
const cuteCloth = (hex) => { let c = cuteCache.get(hex); if (c === undefined) { c = cute(hex); cuteCache.set(hex, c); } return c; };

// parts: 0 body, 1 left arm, 2 right arm, 3 left leg, 4 right leg
// slots: 0 shirt, 1 pants, 2 skin, 3 hair, 4 shoes, 5 extra (hat/scarf/dress), 6 black, 7 white, 8 gun, 9 gold
// variant bits: 1 doppi, 2 police cap, 4 headscarf, 8 dress, 16 gun, 32 hair, 64 beard, 128 jacket tails
export const VAR = { DOPPI: 1, CAP: 2, SCARF: 4, DRESS: 8, GUN: 16, HAIR: 32, BEARD: 64, COAT: 128 };
const POSE = { WALK: 0, AIM: 1, HANDSUP: 2, PUNCH: 3, PANIC: 4, DRIVE: 5 };
export { POSE };
// faces in the atlas and hair styles (hair parts are tagged with their style)
export const FACE = { HAPPY: 0, NEUTRAL: 1, SLEEPY: 2, STERN: 3, SHADES: 4 };
const HAIR_STYLE = { SHORT: 1, BUN: 2, PONYTAIL: 3, CURLY: 4 };

// body measurements (metres): total height stays 1.9 m like before; animation pivots sit where the
// short limbs now join the body
const HIP_Y = 0.6, HIP_X = 0.11, SHOULDER_Y = 1.14, SHOULDER_X = 0.3;
const HEAD = { y: 1.52, w: 0.52, h: 0.52, d: 0.48, r: 0.07 }; // ~2x the old head: 1.26-1.78 m

// ------------------------------------------------------------------ pixel faces (16x16 each)
// k ink, w white, p blush, g lens glint; '.' shows the skin colour
const FACES = [
  ['', '', '', '', '', '', '...kkk....kkk...', '...wkk....wkk...', '...kkk....kkk...', '...kkk....kkk...', '', '.pp..........pp.', '.pp...k..k...pp.', '.......kk.......', '', ''],
  ['', '', '', '', '', '', '', '...kk......kk...', '...wk......wk...', '...kk......kk...', '', '.pp..........pp.', '.pp...kkkk...pp.', '', '', ''],
  ['', '', '', '', '', '', '', '', '..k...k..k...k..', '...kkk....kkk...', '', '.pp..........pp.', '.pp....kk....pp.', '.......kk.......', '', ''],
  ['', '', '', '', '', '..kk........kk..', '....kk....kk....', '...kkk....kkk...', '...kwk....kwk...', '...kkk....kkk...', '', '', '......kkkk......', '.....k....k.....', '', ''],
  ['', '', '', '', '', '', '..kkkkkkkkkkkk..', '..kgkkk..kgkkk..', '..kkkkk..kkkkk..', '...kkk....kkk...', '', '', '.........kk.....', '......kkk.......', '', ''],
];
const FACE_COLORS = { k: '#2b1d3a', w: '#ffffff', p: '#ff9fb2', g: '#9be3ff' };
let faceTex = null;
function faceTexture() {
  if (faceTex) return faceTex;
  const c = document.createElement('canvas');
  c.width = 16 * FACES.length; c.height = 16;
  const g = c.getContext('2d');
  FACES.forEach((rows, f) => rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!FACE_COLORS[ch]) return;
    g.fillStyle = FACE_COLORS[ch];
    g.fillRect(f * 16 + x, y, 1, 1);
  })));
  faceTex = new THREE.CanvasTexture(c);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.magFilter = THREE.NearestFilter;
  faceTex.minFilter = THREE.NearestMipmapNearestFilter; // far faces fade to skin instead of sparkling
  faceTex.generateMipmaps = true;
  return faceTex;
}

// ------------------------------------------------------------------ geometry
function buildHumanGeometry() {
  const pos = [], nrm = [], part = [], slot = [], vari = [], hair = [], uv = [], idx = [];
  // r: bevel size (soft edges); face: map the pixel face onto the flat front of this box
  const add = (cx, cy, cz, sx, sy, sz, p, s, v = 0, hs = 0, r = 0, face = false) => {
    const b = bevelBox(new PolyBuf(), cx, cy, cz, sx, sy, sz, r);
    const base = pos.length / 3;
    const fw = sx / 2 - r, fh = sy / 2 - r;
    for (let i = 0; i < b.count; i++) {
      const x = b.pos[i * 3], y = b.pos[i * 3 + 1], z = b.pos[i * 3 + 2];
      pos.push(x, y, z); nrm.push(b.nrm[i * 3], b.nrm[i * 3 + 1], b.nrm[i * 3 + 2]);
      part.push(p); slot.push(s); vari.push(v); hair.push(hs);
      const front = face && b.nrm[i * 3 + 2] > 0.99;
      uv.push(front ? (x - cx + fw) / (2 * fw) : -1, front ? (y - cy + fh) / (2 * fh) : -1);
    }
    for (const i of b.idx) idx.push(base + i);
  };
  // short legs (pivot at the hip) and big shoes
  for (const [p, x] of [[3, HIP_X], [4, -HIP_X]]) {
    add(x, 0.34, 0, 0.17, 0.52, 0.19, p, 1, 0, 0, 0.05);
    add(x, 0.065, 0.04, 0.2, 0.13, 0.3, p, 4, 0, 0, 0.05);
  }
  add(0, 0.63, 0, 0.4, 0.14, 0.27, 0, 1, 0, 0, 0.05);             // pelvis
  add(0, 0.93, 0, 0.48, 0.66, 0.34, 0, 0, 0, 0, 0.12);            // round tummy
  add(0, 0.56, 0, 0.54, 0.52, 0.4, 0, 5, 4, 0, 0.11);             // dress
  add(0, 0.76, -0.18, 0.44, 0.34, 0.06, 0, 0, 8, 0, 0.02);        // jacket tails
  // arms (pivot at the shoulder) with small hands
  for (const [p, x] of [[1, SHOULDER_X], [2, -SHOULDER_X]]) {
    add(x, 1.02, 0, 0.13, 0.28, 0.15, p, 0, 0, 0, 0.045);
    add(x, 0.82, 0, 0.12, 0.12, 0.12, p, 2, 0, 0, 0.035);
  }
  add(-SHOULDER_X, 0.78, 0.09, 0.06, 0.1, 0.22, 2, 8, 5);         // pistol in the right hand
  // big head with the pixel face
  add(0, HEAD.y, 0, HEAD.w, HEAD.h, HEAD.d, 0, 2, 0, 0, HEAD.r, true);
  add(0, 1.31, 0.235, 0.34, 0.1, 0.05, 0, 3, 7, 0, 0.02);         // little beard on the chin
  // hair styles
  for (const hs of [HAIR_STYLE.SHORT, HAIR_STYLE.BUN, HAIR_STYLE.PONYTAIL]) {
    add(0, 1.74, -0.02, 0.55, 0.15, 0.53, 0, 3, 6, hs, 0.06);     // top
    add(0, 1.54, -0.22, 0.55, 0.42, 0.08, 0, 3, 6, hs, 0.03);     // back
    add(0, 1.72, 0.24, 0.52, 0.09, 0.05, 0, 3, 6, hs, 0.02);      // fringe
  }
  add(0, 1.88, -0.1, 0.2, 0.17, 0.2, 0, 3, 6, HAIR_STYLE.BUN, 0.06);
  add(0, 1.46, -0.3, 0.13, 0.36, 0.1, 0, 3, 6, HAIR_STYLE.PONYTAIL, 0.04);
  add(0, 1.76, -0.02, 0.6, 0.22, 0.57, 0, 3, 6, HAIR_STYLE.CURLY, 0.11);
  add(0, 1.56, -0.23, 0.57, 0.38, 0.1, 0, 3, 6, HAIR_STYLE.CURLY, 0.05);
  for (const x of [-0.16, 0, 0.16]) add(x, 1.71, 0.25, 0.15, 0.1, 0.06, 0, 3, 6, HAIR_STYLE.CURLY, 0.03);
  // doppi (black with white motifs) sitting on top of the head
  add(0, 1.81, -0.01, 0.48, 0.1, 0.48, 0, 6, 1, 0, 0.02);
  for (const [x, z, sx, sz] of [[0, 0.242, 0.09, 0.006], [0, -0.242, 0.09, 0.006], [0.242, 0, 0.006, 0.09], [-0.242, 0, 0.006, 0.09]]) add(x, 1.81, z, sx, 0.05, sz, 0, 7, 1);
  // police cap with visor and badge
  add(0, 1.8, -0.01, 0.56, 0.14, 0.56, 0, 5, 2, 0, 0.03);
  add(0, 1.75, 0.31, 0.44, 0.035, 0.14, 0, 6, 2);
  add(0, 1.81, 0.285, 0.09, 0.07, 0.01, 0, 9, 2);
  // headscarf framing the face
  add(0, 1.56, -0.03, 0.58, 0.5, 0.53, 0, 5, 3, 0, 0.11);
  add(0, 1.77, 0.21, 0.54, 0.09, 0.08, 0, 5, 3, 0, 0.03);
  add(0, 1.32, -0.23, 0.34, 0.22, 0.06, 0, 5, 3, 0, 0.02);
  // packed to stay well under the 16 vertex attributes WebGL guarantees (the instance matrix takes 4)
  const info = new Float32Array(part.length * 4);
  for (let i = 0; i < part.length; i++) { info[i * 4] = part[i]; info[i * 4 + 1] = slot[i]; info[i * 4 + 2] = vari[i]; info[i * 4 + 3] = hair[i]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const HUMAN_VERT_PARS = /* glsl */ `
attribute vec4 aInfo; attribute vec2 aUV; // aInfo = (part, slot, variant, hair style)
attribute vec3 iColA; attribute vec3 iColB; attribute vec3 iColC; attribute vec3 iColD; attribute vec4 iAnim; // iAnim.w = bits + face * 256 + hair * 2048
varying vec3 vHumanColor; varying vec2 vFaceUV; varying float vFace;
#define aPart aInfo.x
#define aSlot aInfo.y
#define aVar aInfo.z
#define aHair aInfo.w
mat3 hRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 hRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
`;
const HUMAN_ANIM = /* glsl */ `
  mat3 hR = mat3(1.0); vec3 hPivot = vec3(0.0); float hVis = 1.0;
  float hBob = 0.0; mat3 hRoll = mat3(1.0);
  float hFace = mod(floor(iAnim.w / 256.0), 8.0), hHair = floor(iAnim.w / 2048.0);
  {
    float phase = iAnim.x, amp = iAnim.y, pose = iAnim.z, bits = mod(iAnim.w, 256.0);
    float var = aVar;
    // variant visibility: 1 doppi,2 cap,3 scarf,4 dress,5 gun,6 hair,7 beard,8 coat; hair also needs its style
    if (var > 0.5) {
      hVis = mod(floor(bits / exp2(var - 1.0)), 2.0);
      if (var > 5.5 && var < 6.5) hVis *= (1.0 - mod(floor(bits / 4.0), 2.0)) * step(abs(aHair - hHair), 0.5);
    }
    float sw = sin(phase) * amp;
    float swB = sin(phase * 2.0) * amp;
    // cute walk: a little hop on every step, a soft waddle and only a tiny arm swing
    hBob = abs(sin(phase)) * amp * 0.07;
    hRoll = hRotZ(sin(phase) * amp * 0.06);
    if (aPart > 0.5 && aPart < 1.5) { hPivot = vec3(${SHOULDER_X}, ${SHOULDER_Y}, 0.0); float a = -sw * 0.5;
      if (pose > 1.5 && pose < 2.5) a = -2.9; else if (pose > 3.5 && pose < 4.5) a = -2.4 + swB * 0.6; else if (pose > 4.5) a = -0.9;
      hR = hRotX(a) * hRotZ(pose > 1.5 && pose < 2.5 ? -0.25 : (pose > 0.5 && pose < 1.5 ? -0.1 : 0.0)); }
    else if (aPart > 1.5 && aPart < 2.5) { hPivot = vec3(-${SHOULDER_X}, ${SHOULDER_Y}, 0.0); float a = sw * 0.5;
      if (pose > 0.5 && pose < 1.5) a = -1.5; else if (pose > 1.5 && pose < 2.5) a = -2.9; else if (pose > 2.5 && pose < 3.5) a = -1.55 * amp; else if (pose > 3.5 && pose < 4.5) a = -2.4 - swB * 0.6; else if (pose > 4.5) a = -0.9;
      hR = hRotX(a) * hRotZ(pose > 1.5 && pose < 2.5 ? 0.25 : 0.0); }
    else if (aPart > 2.5 && aPart < 3.5) { hPivot = vec3(${HIP_X}, ${HIP_Y}, 0.0); hR = hRotX(pose > 4.5 ? -1.4 : sw); }
    else if (aPart > 3.5) { hPivot = vec3(-${HIP_X}, ${HIP_Y}, 0.0); hR = hRotX(pose > 4.5 ? -1.4 : -sw); }
  }
`;
const HUMAN_COLOR = /* glsl */ `
  {
    float s = aSlot;
    vec3 c = iColA;
    if (s > 0.5 && s < 1.5) c = iColB; else if (s > 1.5 && s < 2.5) c = iColC; else if (s > 2.5 && s < 3.5) c = mix(vec3(0.04, 0.018, 0.04), vec3(0.2, 0.08, 0.05), iColD.r * 0.5);
    else if (s > 3.5 && s < 4.5) c = vec3(0.06, 0.03, 0.09); else if (s > 4.5 && s < 5.5) c = iColD; else if (s > 5.5 && s < 6.5) c = vec3(0.024, 0.012, 0.042);
    else if (s > 6.5 && s < 7.5) c = vec3(1.0); else if (s > 7.5 && s < 8.5) c = vec3(0.06, 0.03, 0.09); else if (s > 8.5) c = vec3(0.9, 0.47, 0.02);
    vHumanColor = c;
    vFaceUV = aUV;
    vFace = hFace;
  }
`;

function makeHumanMaterial() {
  const mat = toon({ color: 0xffffff });
  const faces = faceTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFaces = { value: faces };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + HUMAN_VERT_PARS)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + HUMAN_ANIM + '\nobjectNormal = hRoll * (hR * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = hRoll * (hPivot + hR * (transformed - hPivot));\ntransformed.y += hBob;\nif (hVis < 0.5) transformed = vec3(0.0, 1.2, 0.0);\n' + HUMAN_COLOR);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vHumanColor; varying vec2 vFaceUV; varying float vFace;\nuniform sampler2D uFaces;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= vHumanColor;
        if (vFaceUV.x >= 0.0) {
          vec4 f = texture2D(uFaces, vec2((clamp(vFaceUV.x, 0.0, 0.999) + floor(vFace + 0.5)) / ${FACES.length}.0, clamp(vFaceUV.y, 0.0, 0.999)));
          diffuseColor.rgb = mix(diffuseColor.rgb, f.rgb, f.a);
        }`);
  };
  mat.customProgramCacheKey = () => 'human-chibi';
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
    look.gang = true; // the Qora Ko'zoynak ("black glasses") gang wear shades
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

// face and hair style per look, from a separate seeded stream so the game's own random draws stay
// exactly as before: the player smiles, police look stern, the gang wear shades
const styleRng = mulberry32(5150);
function lookStyle(h) {
  const L = h.look;
  if (L._face === undefined) {
    const a = styleRng(), b = styleRng();
    L._face = h.isPlayer ? FACE.HAPPY : (L.bits & VAR.CAP) || h.kind === 'cop' ? FACE.STERN : L.gang || h.kind === 'enemy' ? FACE.SHADES : Math.floor(a * 3);
    L._hair = h.isPlayer ? HAIR_STYLE.SHORT : L.female ? [HAIR_STYLE.BUN, HAIR_STYLE.PONYTAIL, HAIR_STYLE.SHORT][Math.floor(b * 3)] : b < 0.7 ? HAIR_STYLE.SHORT : HAIR_STYLE.CURLY;
  }
  return L;
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
    const L = lookStyle(h);
    const put = (attr, hex) => { this.c.set(hex); attr.array[i * 3] = this.c.r; attr.array[i * 3 + 1] = this.c.g; attr.array[i * 3 + 2] = this.c.b; };
    put(this.attrs.iColA, cuteCloth(L.shirt));
    put(this.attrs.iColB, cuteCloth(L.pants));
    put(this.attrs.iColC, L.skin);
    put(this.attrs.iColD, cuteCloth(L.extra));
    const an = this.attrs.iAnim.array;
    let bits = L.bits;
    if (h.showGun === false) bits &= ~VAR.GUN;
    if (h.showGun === true) bits |= VAR.GUN;
    an[i * 4] = h.animPhase; an[i * 4 + 1] = h.lie > 0.5 ? 0 : h.animAmp; an[i * 4 + 2] = h.pose; an[i * 4 + 3] = (bits & 255) + L._face * 256 + L._hair * 2048;
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
