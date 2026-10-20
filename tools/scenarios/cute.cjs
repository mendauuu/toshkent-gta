// Close-up scenario for tools/harness.cjs: the player with a hand-picked group of pedestrians (doppi,
// headscarf, police, gang, hair styles) in daylight, plus the chibi 3D player vs the experimental
// sprite player from the same cameras. Seeded like compare.cjs. Run e.g.:
//   HARNESS_SIZE=1920x1080 GAME_QUERY="?quality=medium" electron tools/harness.cjs tools/scenarios/cute.cjs screenshots/cute
module.exports = async ({ run, wait, shot, log }) => {
  for (let i = 0; i < 400; i++) { if ((await run(`return window.game && game.state`)) === 'title') break; await wait(250); }
  await run(`
    let s = 20261019;
    Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    game.loop = () => {}; game.frameNo = 1;
    game.startGame(false);
    const st = document.createElement('style');
    st.textContent = '#hud-help, #click-to-play, #hud-big, #hud-bottom { display: none !important; }';
    document.head.appendChild(st);
    game.env.time = 12 * 60;
    game.tick(1, true);
  `);
  // stage: the player on the sidewalk facing a camera 3.6 m in front, a group of people around
  await run(`
    const p = game.player, h = p.heading;
    const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
    window.stage = { px: p.x, pz: p.z, h, fx, fz, rx, rz };
    const V = { DOPPI: 1, CAP: 2, SCARF: 4, DRESS: 8, GUN: 16, HAIR: 32, BEARD: 64, COAT: 128 };
    const people = [
      { look: { shirt: 0xf4ede0, pants: 0x2c5fb8, skin: 0xdb9a6b, extra: 0x3a2430, bits: V.DOPPI | V.HAIR | V.BEARD }, side: -1.25, back: 0.6, walk: 0 },
      { look: { shirt: 0xc23b4a, pants: 0x45305e, skin: 0xffd2a8, extra: 0x5cc3f0, bits: V.SCARF | V.DRESS, female: true, extra2: 0xc23b4a }, side: 1.2, back: 0.5, walk: 0.6 },
      { look: { shirt: 0x2c5fb8, pants: 0x45305e, skin: 0xf2b98c, extra: 0x2c5fb8, bits: V.CAP | V.GUN }, side: -2.3, back: 1.6, walk: 0, kind: 'cop' },
      { look: { shirt: 0x2b1d3a, pants: 0x45305e, skin: 0xc9845a, extra: 0x2b1d3a, bits: V.HAIR | V.GUN | V.COAT, gang: true }, side: 2.3, back: 1.7, walk: 0, kind: 'enemy' },
      { look: { shirt: 0xff9fb2, pants: 0x2c5fb8, skin: 0xffe0c2, extra: 0x5a3424, bits: V.HAIR, female: true, _face: 0, _hair: 2 }, side: -0.6, back: 2.6, walk: 0.7 },
      { look: { shirt: 0x26c0b9, pants: 0x45305e, skin: 0xf2b98c, extra: 0x7d4430, bits: V.HAIR | V.DRESS, female: true, extra2: 0x26c0b9, _face: 2, _hair: 3 }, side: 0.7, back: 2.7, walk: 0 },
    ];
    for (const q of people) game.missionNPCs.push({ look: q.look, kind: q.kind || 'mission', x: p.x + rx * q.side - fx * q.back, y: 0, z: p.z + rz * q.side - fz * q.back,
      heading: h + q.side * 0.12, lie: 0, spin: 0, animPhase: 1.3 + q.side, animAmp: q.walk, pose: 0, visible: true, inVehicle: null, dead: false, radius: 0.34, health: 100, update() {} });
    game.debugCam = { x: p.x + fx * 3.6 + rx * 0.4, y: 1.45, z: p.z + fz * 3.6 + rz * 0.4, tx: p.x - fx * 0.8, ty: 1.0, tz: p.z - fz * 0.8 };
    game.frame(0, 1 / 60);
  `);
  await shot('people-day');
  // player only: front and three-quarter views, chibi 3D and (if available) the sprite experiment
  await run(`game.missionNPCs.length = 0;`);
  const views = { front: [3.0, 0.0], side: [2.0, 2.4] };
  for (const [name, [f, sd]] of Object.entries(views)) {
    await run(`
      const S = window.stage, p = game.player;
      game.debugCam = { x: S.px + S.fx * ${f} + S.rx * ${sd}, y: 1.35, z: S.pz + S.fz * ${f} + S.rz * ${sd}, tx: S.px, ty: 0.95, tz: S.pz };
      if (game.setPlayerSprite) game.setPlayerSprite(false);
      game.frame(0, 1 / 60);`);
    await shot(`player-chibi-${name}`);
    const has = await run(`return !!game.setPlayerSprite`);
    if (has) {
      await run(`game.setPlayerSprite(true); game.frame(0, 1 / 60);`);
      await shot(`player-sprite-${name}`);
      await run(`game.setPlayerSprite(false);`);
    }
  }
  // buildings up close: a Soviet-block street with shops, a mahalla lane, and a panel block end wall,
  // found automatically near the spawn
  await run(`
    const G = game.graph, sp = game.spots.spawn, B = game.map.buildings;
    const cen = (r) => { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [x * 2 / r.length, z * 2 / r.length]; };
    const area = (r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.abs(a) / 2; };
    const longest = (r) => { let L = 0, k = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length, l = Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]); if (l > L) { L = l; k = i; } } return [L, k]; };
    let soviet = null, house = null, endw = null;
    for (const b of B) {
      const [cx, cz] = cen(b.ring), d0 = Math.hypot(cx - sp.x, cz - sp.z);
      if (d0 > 1800) continue;
      if (b.style === 2 && b.h > 13 && b.h < 32 && b.roof === 0) {
        const n = G.nearest(cx, cz, 34, (e) => e.cls <= 1);
        if (n && n.dist > 12 && (!soviet || d0 < soviet.d0)) soviet = { b, cx, cz, n, d0 };
        const [L, k] = longest(b.ring);
        if (L > 40 && b.ring.length === 8 && (!endw || d0 < endw.d0)) endw = { b, cx, cz, L, k, d0 };
      }
      if (b.style === 1 && b.h < 6.5 && area(b.ring) > 70 && area(b.ring) < 240) {
        const n = G.nearest(cx, cz, 14, (e) => e.cls === 2);
        if (n && n.dist > 5 && (!house || d0 < house.d0)) house = { b, cx, cz, n, d0 };
      }
    }
    const look = (from, at, y, ty) => ({ x: from[0], y, z: from[1], tx: at[0], ty, tz: at[1] });
    const views = {};
    if (soviet) { const { cx, cz, n } = soviet, pt = {}; G.pointAt(n.ei, n.s, 1, pt); const dx = n.x - cx, dz = n.z - cz, l = Math.hypot(dx, dz);
      const ox = n.x + dx / l * 7, oz = n.z + dz / l * 7; views.soviet = look([ox - pt.tx * 22, oz - pt.tz * 22], [cx + pt.tx * 6, cz + pt.tz * 6], 2.4, 7.5); }
    if (house) { const { cx, cz, n } = house, pt = {}; G.pointAt(n.ei, n.s, 1, pt); const dx = n.x - cx, dz = n.z - cz, l = Math.hypot(dx, dz);
      views.mahalla = look([n.x + dx / l * 4 - pt.tx * 13, n.z + dz / l * 4 - pt.tz * 13], [cx + pt.tx * 4, cz + pt.tz * 4], 2.2, 3.2); }
    if (endw) { const r = endw.b.ring, k = endw.k, j = (k + 2) % 8, m = (j + 2) % 8, n2 = (m + 2) % 8;
      const ex = (r[j] + r[m]) / 2, ez = (r[j + 1] + r[m + 1]) / 2, ux = (r[m] - r[j]), uz = (r[m + 1] - r[j + 1]), ul = Math.hypot(ux, uz);
      const ox = ex - (endw.cx - ex) / Math.hypot(endw.cx - ex, endw.cz - ez) * 30, oz = ez - (endw.cz - ez) / Math.hypot(endw.cx - ex, endw.cz - ez) * 30;
      views.mural = look([ox + ux / ul * 9, oz + uz / ul * 9], [ex, ez], 6, endw.b.h * 0.5); }
    // frame a real shop wall and a real mural wall: find them in the building geometry
    // (aStyle = style, seed, kind + 4 * bays) and look at them from across the street
    const findWall = (style, kind) => {
      let best = null;
      for (const c of game.city.chunkList) {
        const m = c.buildingMesh; if (!m) continue;
        const S = m.geometry.attributes.aStyle, P = m.geometry.attributes.position, N = m.geometry.attributes.normal;
        for (let i = 0; i < S.count - 1; i++) {
          if (Math.round(S.getX(i)) !== style || Math.round(S.getZ(i)) % 4 !== kind || P.getY(i) > 0.5 || P.getY(i + 1) > 0.5 || S.getZ(i + 1) !== S.getZ(i)) continue;
          const x = (P.getX(i) + P.getX(i + 1)) / 2, z = (P.getZ(i) + P.getZ(i + 1)) / 2, d = Math.hypot(x - sp.x, z - sp.z);
          const len = Math.hypot(P.getX(i + 1) - P.getX(i), P.getZ(i + 1) - P.getZ(i));
          if (len > 12 && (!best || d < best.d)) best = { x, z, nx: N.getX(i), nz: N.getZ(i), d, ux: (P.getX(i + 1) - P.getX(i)) / len, uz: (P.getZ(i + 1) - P.getZ(i)) / len };
        }
      }
      return best;
    };
    const shop = findWall(2, 1), mur = findWall(2, 2);
    if (shop) views.soviet = look([shop.x + shop.nx * 16 - shop.ux * 9, shop.z + shop.nz * 16 - shop.uz * 9], [shop.x + shop.ux * 3, shop.z + shop.uz * 3], 2.4, 5.5);
    if (mur) views.mural = look([mur.x + mur.nx * 34 + mur.ux * 6, mur.z + mur.nz * 34 + mur.uz * 6], [mur.x, mur.z], 3.5, 11);
    window.cuteViews = views;
    return Object.keys(views);
  `).then((v) => log('views', JSON.stringify(v)));
  for (const [name, hours] of [['soviet', 12], ['soviet', 22], ['mahalla', 12], ['mural', 12]]) {
    const ok = await run(`
      const v = window.cuteViews['${name}']; if (!v) return false;
      game.debugCam = v; game.frame(0, 1 / 60); game.teleportPlayer(v.x, v.z);
      game.env.time = ${hours} * 60; game.tick(1, true); game.env.time = ${hours} * 60; game.frame(0, 1 / 60); return true;`);
    if (ok) await shot(`${name}-${hours === 12 ? 'day' : 'night'}`);
  }
  log('done');
};
