// The cute pixel-art palette (32 warm, saturated colours) and helpers that turn the game's
// realistic OpenStreetMap-derived colours into palette colours.
import * as THREE from 'three';

export const PAL = {
  ink: 0x2b1d3a, plum: 0x45305e, slate: 0x5d5b85, slateLt: 0x7b7aa6, lilac: 0xb9b4d6, cloud: 0xf4ede0, white: 0xffffff,
  cream: 0xffe7b3, apricotLt: 0xffd08a, apricot: 0xffb367, orange: 0xff8a4c, coral: 0xe8574a, berry: 0xc23b4a,
  pink: 0xff9fb2, pinkLt: 0xffc8d3, brown: 0xb8693e, brownDk: 0x7d4430, yellow: 0xffe24d, gold: 0xf4b726,
  lime: 0xc9f06b, grass: 0x8ad44f, leaf: 0x4fae4a, forest: 0x2f7f4f, mint: 0xa8e6a1,
  skyLt: 0x9be3ff, sky: 0x5cc3f0, blue: 0x3a8fe0, navy: 0x2c5fb8, teal: 0x26c0b9, tealDk: 0x1b8a8f,
  lavender: 0xb388eb, purple: 0x7f5fc2,
};
export const PALETTE = Object.values(PAL);

// ------------------------------------------------------------------ OKLab (perceptual colour distance)
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function oklab(hex) {
  const r = lin(((hex >> 16) & 255) / 255), g = lin(((hex >> 8) & 255) / 255), b = lin((hex & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const PAL_LAB = PALETTE.map(oklab);
const PAL_SET = new Set(PALETTE);

function nearestLab(L, a, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < PAL_LAB.length; i++) {
    const p = PAL_LAB[i], d = (p[0] - L) ** 2 * 1.4 + (p[1] - a) ** 2 + (p[2] - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return PALETTE[best];
}

// any colour -> the palette colour it reads as once lifted and saturated (no grey or brown mud)
export function cute(hex) {
  if (PAL_SET.has(hex)) return hex;
  const [L, a, b] = oklab(hex);
  const k = 1.9;
  return nearestLab(0.3 + L * 0.72, a * k + Math.sign(a) * 0.006, b * k + Math.sign(b) * 0.006);
}

// car paint: palette colours stay, whites stay white, everything else snaps to its cute version
export function cutePaint(hex) {
  if (PAL_SET.has(hex)) return hex;
  const [L, a, b] = oklab(hex);
  if (L > 0.86 && Math.hypot(a, b) < 0.03) return PAL.white;
  return cute(hex);
}

// ------------------------------------------------------------------ buildings (seeded pastel variety)
const pick = (list, seed) => list[Math.floor(((seed * 7.31) % 1 + 1) % 1 * list.length)];
const WALL_COOL = [PAL.cloud, PAL.skyLt, PAL.lilac, PAL.cloud, PAL.mint, PAL.white, PAL.pinkLt];
const WALL_WARM = [PAL.cream, PAL.apricotLt, PAL.cloud, PAL.pinkLt, PAL.cream, PAL.mint, PAL.yellow];
const WALL_BRICK = [PAL.apricot, PAL.apricotLt, PAL.coral, PAL.pink];
const WALL_GLASS = [PAL.skyLt, PAL.sky, PAL.lilac];
const ROOF_FLAT = [PAL.lilac, PAL.slateLt, PAL.cloud, PAL.lilac, PAL.mint];
const ROOF_SLOPE = [PAL.coral, PAL.teal, PAL.berry, PAL.blue, PAL.tealDk, PAL.coral, PAL.orange];
const ROOF_DOME = [PAL.teal, PAL.sky, PAL.blue, PAL.teal];

export function wallColor(hex, seed) {
  const [L, a, b] = oklab(hex);
  const C = Math.hypot(a, b), hue = Math.atan2(b, a);
  if (C > 0.02 && hue < -1.2 && hue > -2.6) return pick(WALL_GLASS, seed); // blue-grey glass and panels
  if (C > 0.045 && L < 0.76) return pick(WALL_BRICK, seed); // brick and ochre
  return pick(C > 0.02 ? WALL_WARM : WALL_COOL, seed);
}

// roof kinds from the map: 0 flat, 1 hipped, 2 gabled, 3 dome, 4 pyramidal, 5 canopy
export function roofColor(hex, seed, kind) {
  if (kind === 3) return pick(ROOF_DOME, seed);
  if (kind === 0 || kind === 5) return pick(ROOF_FLAT, seed);
  return pick(ROOF_SLOPE, seed);
}

// recolour a geometry's vertex colours in place (landmarks, props)
export function cuteGeometry(geo) {
  const c = geo.attributes.color;
  if (!c) return geo;
  const tmp = new THREE.Color(), cache = new Map();
  for (let i = 0; i < c.count; i++) {
    tmp.setRGB(c.getX(i), c.getY(i), c.getZ(i));
    const hex = tmp.getHex();
    let out = cache.get(hex);
    if (out === undefined) { out = cute(hex); cache.set(hex, out); }
    tmp.set(out);
    c.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  c.needsUpdate = true;
  return geo;
}
