// Experimental HD-2D look for the player: a 24x32 pixel-art sprite on a camera-facing billboard
// (4 directions x 3 walk frames), drawn in code from the player's colours. Debug toggle only
// (URL ?sprite=1, cheat SPRAYT, or game.setPlayerSprite(true)); the 3D chibi is the default.
import * as THREE from 'three';
import { toon } from '../world/materials.js';
import { PAL, cute } from '../world/palette.js';
import { radialTexture, ORDER } from '../world/city.js';

const FW = 24, FH = 32, COLS = 3, ROWS = 4; // frames: stand, step A, step B; rows: front, back, left, right
const DIR = { FRONT: 0, BACK: 1, LEFT: 2, RIGHT: 3 };

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }

// one frame at (ox, oy); step 0 stands, 1 and 2 are the two walking poses
function drawFrame(g, ox, oy, dir, step, C) {
  const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(ox + x, oy + y, w, h); };
  const lift = step ? -1 : 0; // the body hops up a pixel on each step
  const side = dir === DIR.LEFT;
  if (!side) {
    // legs and shoes
    const la = step === 1 ? -1 : 0, ra = step === 2 ? -1 : 0;
    px(8, 24 + la, 3, 5, C.pants); px(13, 24 + ra, 3, 5, C.pants);
    px(7, 29 + la, 4, 2, C.shoe); px(13, 29 + ra, 4, 2, C.shoe);
    // round body
    px(7, 16 + lift, 10, 9, C.shirt); px(8, 15 + lift, 8, 1, C.shirt);
    // arms with little hands, swinging a pixel
    const sa = step === 1 ? 1 : step === 2 ? -1 : 0;
    px(5, 17 + lift + sa, 2, 5, C.shirt); px(5, 22 + lift + sa, 2, 2, C.skin);
    px(17, 17 + lift - sa, 2, 5, C.shirt); px(17, 22 + lift - sa, 2, 2, C.skin);
    // big head
    px(5, 3 + lift, 14, 12, C.skin); px(6, 2 + lift, 12, 1, C.skin); px(6, 15 + lift, 12, 1, C.skin);
    if (dir === DIR.FRONT) {
      px(5, 1 + lift, 14, 4, C.hair); px(6, 0 + lift, 12, 1, C.hair);
      px(5, 5 + lift, 1, 4, C.hair); px(18, 5 + lift, 1, 4, C.hair);
      px(7, 5 + lift, 3, 1, C.hair); px(13, 5 + lift, 4, 1, C.hair);
      px(8, 8 + lift, 2, 3, C.ink); px(14, 8 + lift, 2, 3, C.ink);
      px(8, 8 + lift, 1, 1, C.white); px(14, 8 + lift, 1, 1, C.white);
      px(6, 11 + lift, 2, 1, C.blush); px(16, 11 + lift, 2, 1, C.blush);
      px(10, 12 + lift, 1, 1, C.ink); px(13, 12 + lift, 1, 1, C.ink); px(11, 13 + lift, 2, 1, C.ink);
      px(8, 14 + lift, 8, 2, C.hair);
    } else {
      px(5, 0 + lift, 14, 15, C.hair); px(6, 15 + lift, 12, 1, C.hair);
      px(7, 2 + lift, 4, 1, C.hairHi);
    }
  } else {
    // facing left: profile with one eye, the far arm hidden
    const fwd = step === 1 ? -2 : step === 2 ? 2 : 0;
    px(10 + fwd, 24, 3, 5, C.pants); px(11 - fwd, 24, 3, 5, C.pantsDk);
    px(9 + fwd, 29, 4, 2, C.shoe); px(10 - fwd, 29, 4, 2, C.shoe);
    px(8, 16 + lift, 8, 9, C.shirt); px(9, 15 + lift, 6, 1, C.shirt);
    px(11 - fwd / 2, 17 + lift, 3, 5, C.shirtDk); px(11 - fwd / 2, 22 + lift, 2, 2, C.skin);
    px(5, 3 + lift, 13, 12, C.skin); px(6, 2 + lift, 11, 1, C.skin); px(6, 15 + lift, 11, 1, C.skin);
    px(6, 0 + lift, 12, 4, C.hair); px(11, 4 + lift, 7, 8, C.hair); px(16, 12 + lift, 2, 2, C.hair);
    px(6, 4 + lift, 2, 1, C.hair);
    px(7, 8 + lift, 2, 3, C.ink); px(7, 8 + lift, 1, 1, C.white);
    px(5, 11 + lift, 2, 1, C.blush);
    px(5, 13 + lift, 1, 1, C.ink);
    px(5, 14 + lift, 6, 2, C.hair);
  }
}

// transparent pixels touching the character become ink: the classic sprite outline
function outline(g, w, h, ink) {
  const img = g.getImageData(0, 0, w, h), d = img.data, out = new Uint8ClampedArray(d);
  const r = parseInt(ink.slice(1, 3), 16), gg = parseInt(ink.slice(3, 5), 16), b = parseInt(ink.slice(5, 7), 16);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3] > 0) continue;
    const solid = (xx, yy) => xx >= 0 && yy >= 0 && xx < w && yy < h && d[(yy * w + xx) * 4 + 3] > 0 && (Math.floor(xx / FW) === Math.floor(x / FW)) && (Math.floor(yy / FH) === Math.floor(y / FH));
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) { out[i] = r; out[i + 1] = gg; out[i + 2] = b; out[i + 3] = 255; }
  }
  g.putImageData(new ImageData(out, w, h), 0, 0);
}

function buildSheet(look) {
  const c = document.createElement('canvas');
  c.width = FW * COLS; c.height = FH * ROWS;
  const g = c.getContext('2d');
  const col = (v) => hex(cute(v));
  const C = {
    skin: hex(look.skin), hair: '#3a2430', hairHi: '#5a3a44', shirt: col(look.shirt), shirtDk: '#2c5fb8', pants: col(look.pants), pantsDk: '#2b1d3a',
    shoe: '#2b1d3a', ink: hex(PAL.ink), white: '#ffffff', blush: hex(PAL.pink),
  };
  for (let row = 0; row < 3; row++) for (let f = 0; f < COLS; f++) drawFrame(g, f * FW, row * FH, row, f, C);
  outline(g, c.width, c.height, C.ink);
  // facing right = facing left, mirrored
  g.save(); g.translate(c.width, 0); g.scale(-1, 1);
  g.drawImage(c, 0, DIR.LEFT * FH, c.width, FH, 0, DIR.RIGHT * FH, c.width, FH);
  g.restore();
  // the mirrored copy also flipped the frame order: put the frames back in stand, A, B order
  const strip = g.getImageData(0, DIR.RIGHT * FH, c.width, FH);
  const fixed = g.createImageData(c.width, FH);
  for (let f = 0; f < COLS; f++) for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const src = ((y * c.width) + (COLS - 1 - f) * FW + x) * 4, dst = ((y * c.width) + f * FW + x) * 4;
    for (let k = 0; k < 4; k++) fixed.data[dst + k] = strip.data[src + k];
  }
  g.putImageData(fixed, 0, DIR.RIGHT * FH);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.repeat.set(1 / COLS, 1 / ROWS);
  return tex;
}

export class PlayerSprite {
  constructor(game) {
    this.game = game;
    this.tex = buildSheet(game.player.look);
    const H = 1.9, W = H * FW / FH;
    const geo = new THREE.PlaneGeometry(W, H);
    geo.translate(0, H / 2, 0);
    const n = geo.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); // lit like the ground, whatever the view angle
    this.mesh = new THREE.Mesh(geo, toon({ map: this.tex, alphaTest: 0.5 }));
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    const sg = new THREE.PlaneGeometry(0.9, 0.9);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.4, depthWrite: false, map: radialTexture() }));
    this.shadow.renderOrder = ORDER.shadow;
    this.shadow.visible = false;
    game.scene.add(this.mesh, this.shadow);
  }

  set active(on) { this.on = on; this.mesh.visible = this.shadow.visible = false; }
  get active() { return !!this.on; }

  // place the billboard at the player, pick the direction row from the heading vs the camera
  // (shown = false hides it, e.g. behind the title menu)
  update(p, camera, shown = true) {
    const show = shown && this.on && p.visible && !p.inVehicle;
    this.mesh.visible = this.shadow.visible = show;
    if (!show) return;
    let fx = p.x - camera.position.x, fz = p.z - camera.position.z;
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const dx = Math.sin(p.heading), dz = Math.cos(p.heading);
    const away = dx * fx + dz * fz, right = dx * -fz + dz * fx;
    const dir = Math.abs(away) > Math.abs(right) ? (away > 0 ? DIR.BACK : DIR.FRONT) : (right > 0 ? DIR.RIGHT : DIR.LEFT);
    const frame = p.animAmp > 0.2 ? 1 + (Math.floor(p.animPhase / Math.PI) & 1) : 0;
    this.tex.offset.set(frame / COLS, 1 - (dir + 1) / ROWS);
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.rotation.set(-p.lie * Math.PI / 2, Math.atan2(-fx, -fz), 0, 'YXZ');
    this.shadow.position.set(p.x, 0.03, p.z);
  }
}
