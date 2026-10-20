// Pixel-art facade atlas drawn in code (256x128 texels, 16 texels per window bay): windows with
// frames, sills, AC units, flower pots and balconies, mahalla gates and courtyard walls, ganch and
// blue-tile ornament, dome tiles, 8 shop fronts with awnings and invented pixel signs, and 4 Tashkent
// mosaic murals. A second texture marks what glows at night (window glass, neon, shop windows).
import * as THREE from 'three';

const AW = 256, AH = 128;
// pixel kinds: wall pixels take the building's colour (rgb = shade), the rest are fixed colours
const WALL = 0, FIX = 1, GLASS = 2, NEON = 3, SHOP = 4;

// tile positions in 16-texel units (x, y from the top-left), shared with the building shader
export const TILE = {
  plain: [0, 0], pipe: [1, 0], hWin: [2, 0], hWinCurtain: [3, 0], hGate: [4, 0], hDuval: [5, 0], hDuvalVine: [6, 0], hDoor: [7, 0],
  sWin: [0, 1], sWinAC: [1, 1], sWinPot: [2, 1], sBalc: [3, 1], sBalcLaundry: [4, 1], sBalcPlants: [5, 1], sEntr: [6, 1], sParapet: [7, 1],
  oWin: [0, 2], oWinGanch: [1, 2], oTile: [2, 2], oGanch: [3, 2], oDoor: [4, 2], garage: [5, 2], iWin: [6, 2],
  domeTile: [0, 3], domeRib: [1, 3],
  shop0: [0, 4], // 8 shops, each 2x1 tiles, along row 4
  mural0: [0, 5], // 4 murals, each 2x3 tiles, along rows 5-7
};

const P = {
  ink: 0x2b1d3a, plum: 0x45305e, slate: 0x5d5b85, slateLt: 0x7b7aa6, lilac: 0xb9b4d6, cloud: 0xf4ede0, white: 0xffffff,
  cream: 0xffe7b3, apricotLt: 0xffd08a, apricot: 0xffb367, orange: 0xff8a4c, coral: 0xe8574a, berry: 0xc23b4a, pink: 0xff9fb2,
  pinkLt: 0xffc8d3, brown: 0xb8693e, brownDk: 0x7d4430, yellow: 0xffe24d, gold: 0xf4b726, lime: 0xc9f06b, grass: 0x8ad44f,
  leaf: 0x4fae4a, forest: 0x2f7f4f, mint: 0xa8e6a1, skyLt: 0x9be3ff, sky: 0x5cc3f0, blue: 0x3a8fe0, navy: 0x2c5fb8,
  teal: 0x26c0b9, tealDk: 0x1b8a8f, lavender: 0xb388eb, purple: 0x7f5fc2, glass: 0x5aa1e3, glassDk: 0x3f7fc8,
};

const col = new Uint8Array(AW * AH * 4), emi = new Uint8Array(AW * AH * 4);
let ox = 0, oy = 0; // current tile origin in texels
function put(x, y, hex, kind = FIX) {
  x += ox; y += oy;
  if (x < 0 || y < 0 || x >= AW || y >= AH) return;
  const i = ((AH - 1 - y) * AW + x) * 4; // stored bottom-up (v = 0 at the bottom)
  col[i] = (hex >> 16) & 255; col[i + 1] = (hex >> 8) & 255; col[i + 2] = hex & 255; col[i + 3] = kind === WALL ? 0 : 255;
  emi[i] = kind === GLASS ? 255 : 0; emi[i + 1] = kind === NEON ? 255 : 0; emi[i + 2] = kind === SHOP ? 255 : 0; emi[i + 3] = 255;
}
const rect = (x, y, w, h, hex, kind) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, hex, kind); };
const at = (tx, ty) => { ox = tx * 16; oy = ty * 16; };
const wall = (w = 16, h = 16, shade = 0xffffff) => rect(0, 0, w, h, shade, WALL);
const disc = (cx, cy, r, hex, kind) => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, hex, kind); };

// a window: frame, glass with a highlight, optional cross bars, sill and its shadow
function windowAt(x, y, w, h, frame, opts = {}) {
  rect(x, y, w, h, frame);
  rect(x + 1, y + 1, w - 2, h - 2, P.glass, GLASS);
  rect(x + 1, y + 1, w - 2, 1, P.glassDk, GLASS);
  put(x + 1, y + 2, P.skyLt, GLASS); put(x + 2, y + 2, P.skyLt, GLASS); put(x + 1, y + 3, P.skyLt, GLASS);
  if (opts.cross !== false) { rect(x + (w >> 1), y + 1, 1, h - 2, frame); rect(x + 1, y + Math.floor(h * 0.38), w - 2, 1, frame); }
  if (opts.sill !== false) { rect(x - 1, y + h, w + 2, 1, opts.sill || P.lilac); rect(x, y + h + 1, w, 1, 0xd2d2d2, WALL); }
}

// ------------------------------------------------------------------ houses (mahalla)
at(...TILE.plain); wall();
at(...TILE.pipe); wall(); rect(1, 0, 2, 16, P.lilac); rect(1, 0, 1, 16, P.slateLt); rect(0, 5, 4, 1, P.slateLt); rect(0, 12, 4, 1, P.slateLt);
at(...TILE.hWin); wall(); windowAt(3, 3, 10, 9, P.teal, { sill: P.cream }); rect(5, 10, 2, 2, P.coral); put(5, 9, P.pink); put(6, 9, P.leaf); put(4, 9, P.leaf);
at(...TILE.hWinCurtain); wall(); windowAt(3, 3, 10, 9, P.brown, { cross: false, sill: P.cream }); rect(4, 4, 2, 7, P.pink); rect(10, 4, 2, 7, P.pink); rect(4, 4, 8, 1, P.berry);
// darvoza: carved double wooden gate under a little tiled eave
at(...TILE.hGate); wall(16, 16, 0xe8e8e8);
rect(1, 1, 14, 2, P.teal); rect(1, 3, 14, 1, P.tealDk);
rect(2, 4, 12, 12, P.brownDk); rect(3, 4, 10, 12, P.brown); rect(7, 4, 2, 12, P.brownDk);
for (const lx of [4, 10]) { put(lx + 1, 7, P.gold); put(lx, 8, P.gold); put(lx + 2, 8, P.gold); put(lx + 1, 9, P.gold); put(lx + 1, 8, P.apricot); rect(lx, 12, 3, 1, P.brownDk); }
put(6, 10, P.gold); put(9, 10, P.gold);
// duval: courtyard wall with a vent, a plinth and a tiled top
at(...TILE.hDuval); wall(); rect(0, 0, 16, 1, P.lilac); rect(0, 13, 16, 3, 0xcacaca, WALL); rect(6, 4, 4, 2, P.plum); rect(6, 4, 4, 1, P.slate);
at(...TILE.hDuvalVine); wall(); rect(0, 0, 16, 1, P.lilac); rect(0, 13, 16, 3, 0xcacaca, WALL);
for (const [x, y] of [[2, 12], [3, 11], [2, 10], [3, 9], [4, 8], [3, 7], [5, 6], [4, 5], [6, 4], [7, 3], [5, 3], [8, 2], [10, 3], [9, 4]]) { put(x, y, P.leaf); put(x + 1, y, P.grass); }
put(5, 5, P.berry); put(9, 3, P.purple); put(4, 9, P.berry);
at(...TILE.hDoor); wall(); rect(4, 3, 8, 12, P.cloud); rect(5, 4, 6, 11, P.teal); rect(6, 5, 4, 4, P.glass, GLASS); put(9, 10, P.gold); rect(3, 15, 10, 1, P.lilac);

// ------------------------------------------------------------------ Soviet panel blocks
at(...TILE.sWin); wall(); windowAt(3, 3, 10, 9, P.cloud); rect(15, 0, 1, 16, 0xdedede, WALL); rect(0, 15, 16, 1, 0xdedede, WALL);
at(...TILE.sWinAC); wall(); windowAt(3, 2, 10, 9, P.cloud); rect(9, 12, 6, 4, P.cloud); rect(9, 12, 6, 1, P.white); rect(10, 13, 4, 1, P.slateLt); rect(10, 14, 4, 1, P.slateLt); put(15, 15, P.slateLt);
at(...TILE.sWinPot); wall(); windowAt(3, 3, 10, 9, P.cloud); rect(4, 11, 2, 2, P.coral); rect(9, 11, 2, 2, P.brown); put(4, 10, P.pink); put(5, 10, P.leaf); put(9, 10, P.yellow); put(10, 10, P.leaf); put(5, 9, P.pink); put(10, 9, P.yellow);
// glazed balcony: windows on top of a slatted panjara railing
at(...TILE.sBalc); wall(); rect(1, 2, 14, 7, P.cloud); for (const x of [2, 6, 10]) rect(x, 3, 3, 5, P.glass, GLASS); put(2, 3, P.skyLt, GLASS); put(6, 3, P.skyLt, GLASS);
rect(0, 9, 16, 1, P.white); rect(1, 10, 14, 6, P.teal); for (let x = 2; x < 15; x += 2) rect(x, 10, 1, 6, P.tealDk);
// open balcony with laundry on a line
at(...TILE.sBalcLaundry); wall(); rect(1, 2, 14, 8, P.plum); rect(1, 2, 14, 1, P.slate); rect(2, 4, 12, 1, P.white);
rect(3, 5, 2, 3, P.pink); rect(6, 5, 3, 2, P.yellow); rect(10, 5, 2, 4, P.sky); put(7, 7, P.yellow); rect(12, 5, 1, 2, P.white);
rect(0, 10, 16, 1, P.white); rect(1, 11, 14, 5, P.cream); for (let x = 2; x < 15; x += 3) rect(x, 11, 1, 5, P.apricot);
at(...TILE.sBalcPlants); wall(); rect(1, 2, 14, 7, P.cloud); for (const x of [2, 6, 10]) rect(x, 3, 3, 5, P.glass, GLASS);
rect(0, 9, 16, 1, P.white); rect(1, 10, 14, 6, P.pinkLt); for (let x = 2; x < 15; x += 2) rect(x, 10, 1, 6, P.pink);
for (const x of [2, 5, 8, 11, 13]) { put(x, 8, P.leaf); put(x + 1, 8, P.grass); put(x, 7, P.leaf); } put(3, 7, P.berry); put(9, 7, P.yellow); put(12, 7, P.berry);
// podyezd entrance: door under a canopy with a little lamp and steps
at(...TILE.sEntr); wall(); rect(3, 5, 10, 2, P.slateLt); rect(3, 4, 10, 1, P.lilac); rect(7, 3, 2, 1, P.yellow, NEON);
rect(5, 7, 6, 8, P.brownDk); rect(6, 8, 4, 3, P.glass, GLASS); put(9, 12, P.gold); rect(3, 15, 10, 1, P.lilac); rect(4, 14, 8, 1, 0xdedede, WALL);
at(...TILE.sParapet); wall(); rect(0, 13, 16, 1, 0xd0d0d0, WALL); rect(0, 14, 16, 2, P.lilac);

// ------------------------------------------------------------------ civic: arches, ganch, blue tiles
at(...TILE.oWin); wall(); rect(4, 3, 8, 12, P.cream); rect(5, 4, 6, 10, P.glass, GLASS); rect(6, 3, 4, 1, P.glass, GLASS); rect(7, 2, 2, 1, P.cream);
put(5, 5, P.skyLt, GLASS); rect(5, 9, 6, 1, P.cream); for (const x of [2, 13]) { put(x, 2, P.cream); put(x, 4, P.cream); put(x, 6, P.cream); } rect(3, 15, 10, 1, P.lilac);
at(...TILE.oWinGanch); wall(); rect(4, 2, 8, 8, P.cream); rect(5, 3, 6, 6, P.glass, GLASS); put(5, 4, P.skyLt, GLASS); rect(8, 3, 1, 6, P.cream);
rect(3, 11, 10, 4, P.cream); for (let x = 4; x < 12; x += 2) { put(x, 12, P.lilac); put(x + 1, 13, P.lilac); } rect(3, 15, 10, 1, P.lilac);
// majolica band: navy ground, white eight-point stars, turquoise diamonds
at(...TILE.oTile); rect(0, 0, 16, 16, P.navy); rect(0, 0, 16, 1, P.gold); rect(0, 15, 16, 1, P.gold);
for (const [cx, cy] of [[4, 8], [12, 8]]) { rect(cx - 1, cy - 3, 3, 7, P.white); rect(cx - 3, cy - 1, 7, 3, P.white); put(cx, cy, P.yellow); }
for (const cx of [0, 8, 16]) { put(cx, 4, P.teal); put(cx - 1, 5, P.teal); put(cx + 1, 5, P.teal); put(cx, 6, P.teal); put(cx, 10, P.teal); put(cx - 1, 11, P.teal); put(cx + 1, 11, P.teal); put(cx, 12, P.teal); }
// ganch: carved plaster lattice on the wall colour
at(...TILE.oGanch); wall(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const a = (x + y) % 8 === 0 || (x - y + 16) % 8 === 0; if (a) put(x, y, 0xd4d4d4, WALL); if ((x % 8 === 4) && (y % 8 === 4)) put(x, y, P.cream); }
at(...TILE.oDoor); wall(); rect(2, 2, 12, 14, P.cream); rect(4, 4, 8, 12, P.brownDk); rect(5, 5, 6, 11, P.brown); rect(7, 5, 2, 11, P.brownDk); rect(5, 2, 6, 2, P.navy); rect(6, 2, 4, 1, P.teal); rect(1, 15, 14, 1, P.lilac);
at(...TILE.garage); wall(); rect(1, 4, 14, 12, P.lilac); for (let y = 5; y < 16; y += 2) rect(1, y, 14, 1, P.slateLt); rect(1, 3, 14, 1, P.slate);
at(...TILE.iWin); wall(); rect(1, 3, 14, 8, P.cloud); for (let x = 2; x < 15; x += 3) rect(x, 4, 2, 6, P.glass, GLASS);
// dome tiles: turquoise ground (takes the dome colour) with blue diamonds and white dots
at(...TILE.domeTile); wall(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const dx = Math.abs(((x + 4) % 8) - 4), dy = Math.abs(((y + 4) % 8) - 4); if (dx + dy === 3) put(x, y, P.navy); if (dx + dy === 0) put(x, y, P.white); if (dx + dy === 1) put(x, y, P.skyLt); }
at(...TILE.domeRib); wall(); rect(7, 0, 2, 16, P.white); rect(0, 7, 16, 1, P.navy); for (let y = 1; y < 16; y += 4) { put(3, y, P.skyLt); put(12, y + 2, P.skyLt); }

// ------------------------------------------------------------------ shops: sign, awning, lit window, door
const FONT = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'], E: ['###', '#..', '##.', '#..', '###'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'], K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'], M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], R: ['##.', '#.#', '##.', '#.#', '#.#'], S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'], Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
};
function text(str, cx, y, hex) {
  const w = [...str].reduce((s, ch) => s + FONT[ch][0].length + 1, -1);
  let x = Math.round(cx - w / 2);
  for (const ch of str) { const g = FONT[ch]; g.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') put(x + i, y + j, hex, NEON); })); x += g[0].length + 1; }
}
// [sign, board, letters, awning, goods painter]
const SHOPS = [
  ['OSH', P.navy, P.yellow, P.coral, () => { disc(8, 12.5, 2, P.ink, SHOP); rect(5, 13, 7, 1, P.ink, SHOP); rect(13, 13, 3, 1, P.white, SHOP); rect(17, 13, 3, 1, P.white, SHOP); }],
  ['NON', P.brown, P.cream, P.orange, () => { for (const x of [5, 10, 15]) { disc(x, 12.5, 1.8, P.gold, SHOP); put(x, 12, P.apricotLt, SHOP); } }],
  ['CHOY', P.tealDk, P.white, P.leaf, () => { for (const x of [6, 13]) { rect(x - 2, 12, 4, 3, P.blue, SHOP); put(x + 2, 12, P.blue, SHOP); rect(x - 1, 11, 2, 1, P.navy, SHOP); } }],
  ['APTEKA', P.white, P.leaf, P.mint, () => { rect(8, 10, 2, 6, P.leaf, SHOP); rect(6, 12, 6, 2, P.leaf, SHOP); rect(14, 12, 4, 3, P.white, SHOP); }],
  ['MARKET', P.yellow, P.navy, P.blue, () => { for (const [x, c] of [[4, P.coral], [7, P.lime], [10, P.orange], [13, P.coral], [16, P.yellow]]) disc(x, 13, 1.2, c, SHOP); }],
  ['SOMSA', P.berry, P.white, P.pink, () => { for (const x of [5, 10, 15]) { rect(x - 2, 14, 5, 1, P.gold, SHOP); rect(x - 1, 13, 3, 1, P.gold, SHOP); put(x, 12, P.gold, SHOP); } }],
  ['GULLAR', P.purple, P.pinkLt, P.lavender, () => { for (const [x, c] of [[4, P.pink], [8, P.yellow], [12, P.berry], [16, P.pink]]) { rect(x, 13, 1, 3, P.leaf, SHOP); disc(x, 12, 1.1, c, SHOP); } }],
  ['KITOB', P.navy, P.apricotLt, P.yellow, () => { for (const [x, c] of [[4, P.coral], [6, P.blue], [8, P.leaf], [10, P.purple], [12, P.gold], [14, P.teal], [16, P.coral]]) rect(x, 11 + (x % 3 === 0 ? 1 : 0), 2, 4, c, SHOP); }],
];
SHOPS.forEach(([sign, board, ink, awning, goods], i) => {
  ox = TILE.shop0[0] * 16 + i * 32; oy = TILE.shop0[1] * 16;
  rect(0, 0, 32, 16, 0xffffff, WALL);
  rect(1, 0, 30, 6, board); rect(1, 0, 30, 1, P.plum); text(sign, 16, 1, ink);
  for (let x = 0; x < 32; x++) { const c = (x >> 1) % 2 ? P.white : awning; rect(x, 6, 1, 3, c); if (x % 2 === 0) put(x, 9, c); }
  rect(1, 10, 21, 5, P.yellow, SHOP); goods();
  rect(23, 9, 7, 6, P.cloud); rect(24, 10, 5, 5, P.glass, GLASS); put(27, 12, P.gold);
  rect(0, 15, 32, 1, P.lilac);
});

// ------------------------------------------------------------------ mosaic murals for panel-block end walls (32x48)
function mural(i, paint) { ox = TILE.mural0[0] * 16 + i * 32; oy = TILE.mural0[1] * 16; paint(); }
// Humo bird with spread golden wings under a sun
mural(0, () => {
  rect(0, 0, 32, 48, P.navy); rect(0, 24, 32, 24, P.blue); rect(0, 40, 32, 8, P.teal);
  disc(16, 9, 5, P.yellow); disc(16, 9, 3, P.white);
  for (let k = 0; k < 12; k++) { rect(4 + k, 22 - (k >> 1), 1, 3 + (k >> 2), P.gold); rect(27 - k, 22 - (k >> 1), 1, 3 + (k >> 2), P.gold); }
  rect(14, 20, 4, 12, P.apricot); disc(16, 19, 2.5, P.orange); put(15, 18, P.ink); rect(15, 32, 2, 5, P.gold); rect(13, 36, 6, 2, P.orange);
  for (let x = 2; x < 32; x += 5) { put(x, 44, P.white); put(x + 2, 46, P.skyLt); }
});
// sun over a cotton field
mural(1, () => {
  rect(0, 0, 32, 48, P.teal); rect(0, 30, 32, 18, P.leaf);
  disc(16, 12, 6, P.yellow); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; put(Math.round(16 + Math.cos(a) * 9), Math.round(12 + Math.sin(a) * 9), P.yellow); put(Math.round(16 + Math.cos(a) * 10), Math.round(12 + Math.sin(a) * 10), P.gold); }
  for (const [x, y] of [[5, 34], [12, 38], [20, 33], [27, 39], [8, 43], [17, 44], [25, 45]]) { rect(x, y + 2, 1, 4, P.brownDk); disc(x, y, 2, P.white); put(x - 1, y + 1, P.cloud); }
});
// pomegranates and leaves on cream with a blue border
mural(2, () => {
  rect(0, 0, 32, 48, P.blue); rect(2, 2, 28, 44, P.cream);
  for (const [x, y] of [[10, 12], [22, 20], [11, 31], [21, 39]]) { disc(x, y, 4, P.coral); disc(x - 1, y - 1, 2, P.berry); rect(x - 1, y - 6, 3, 2, P.berry); put(x + 1, y - 1, P.pinkLt); rect(x + 4, y - 4, 3, 2, P.leaf); }
  for (let y = 4; y < 46; y += 6) { put(4, y, P.gold); put(27, y + 3, P.gold); }
});
// eight-point star mosaic
mural(3, () => {
  rect(0, 0, 32, 48, P.white);
  for (const [cx, cy] of [[8, 8], [24, 8], [16, 20], [8, 32], [24, 32], [16, 44]]) {
    rect(cx - 2, cy - 6, 5, 13, P.navy); rect(cx - 6, cy - 2, 13, 5, P.navy);
    for (let d = -4; d <= 4; d++) { put(cx + d, cy + d, P.navy); put(cx + d, cy - d, P.navy); }
    rect(cx - 1, cy - 4, 3, 9, P.teal); rect(cx - 4, cy - 1, 9, 3, P.teal); put(cx, cy, P.gold);
  }
});

let atlas = null;
export function facadeTextures() {
  if (atlas) return atlas;
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapNearestFilter; // crisp up close, calm (no sparkle) far away
    t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  atlas = { color: mk(col, true), glow: mk(emi, false), size: [AW, AH] };
  return atlas;
}
