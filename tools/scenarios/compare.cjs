// Before/after comparison scenario for tools/harness.cjs: a seeded, deterministic world, pinned
// cameras at fixed spots, day (12:00) and night (22:00) screenshots, and a render-cost benchmark
// (median ms per frame() with a GPU sync). Run it once per branch and quality, e.g.:
//   HARNESS_SIZE=1920x1080 GAME_QUERY="?quality=medium" electron tools/harness.cjs tools/scenarios/compare.cjs screenshots/after
// SHOTS=0 skips screenshots and BENCH=0 skips the benchmark. Results go to <outDir>/bench.json.
const fs = require('node:fs');
const path = require('node:path');

const VIEWS = /* js */ `
  const L = Object.fromEntries(game.map.landmarks.map((l) => [l.id, l]));
  const G = game.graph, pt = {};
  // a camera on a big road near (x, z): 'back' metres behind the road point, looking 'ahead'
  const road = (x, z, back, up, ahead, side = 0, flip = false) => {
    const n = G.nearest(x, z, 400, (e) => e.cls <= 1);
    G.pointAt(n.ei, n.s, 1, pt);
    let tx = pt.tx, tz = pt.tz;
    if (flip) { tx = -tx; tz = -tz; }
    const rx = -tz, rz = tx;
    return { x: n.x - tx * back + rx * side, y: up, z: n.z - tz * back + rz * side, tx: n.x + tx * ahead, ty: Math.min(up, 3), tz: n.z + tz * ahead, px: n.x + rx * 9, pz: n.z + rz * 9 };
  };
  const t = L.temur, sp = game.spots.spawn;
  const views = {
    street: road(sp.x, sp.z, 10, 2.6, 40, 3.5),
    temur: { x: t.x + 17, y: 21, z: t.z + 20, tx: t.x, ty: 7, tz: t.z, px: t.x + 30, pz: t.z + 34 },
    aerial: { x: t.x + 260, y: 120, z: t.z + 330, tx: t.x - 40, ty: 0, tz: t.z - 60, px: t.x + 120, pz: t.z + 140 },
    close: null,
  };
  const c = views.street;
  views.close = { x: c.px - 3.2, y: 1.7, z: c.pz + 3.6, tx: c.px, ty: 1.0, tz: c.pz, px: c.px, pz: c.pz, car: true };
`;

module.exports = async ({ run, wait, shot, log }) => {
  const outDir = process.argv.slice(-1)[0];
  const doShots = process.env.SHOTS !== '0', doBench = process.env.BENCH !== '0';
  for (let i = 0; i < 400; i++) { if ((await run(`return window.game && game.state`)) === 'title') break; await wait(250); }
  const env = await run(`
    // deterministic world: seeded Math.random and no free-running loop (the scenario drives time)
    let s = 20261019;
    Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    game.loop = () => {};
    game.startGame(false);
    const st = document.createElement('style');
    st.textContent = '#hud-help, #click-to-play { display: none !important; }';
    document.head.appendChild(st);
    const gl = game.renderer.getContext(), d = gl.getExtension('WEBGL_debug_renderer_info');
    return { inner: innerWidth + 'x' + innerHeight, dpr: devicePixelRatio, buffer: gl.drawingBufferWidth + 'x' + gl.drawingBufferHeight, quality: game.settings.quality, gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a' };
  `);
  log('env', JSON.stringify(env));
  const results = { env, bench: {} };
  for (const name of ['street', 'temur', 'aerial', 'close']) {
    await run(`${VIEWS}
      const v = views['${name}'];
      game.debugCam = v;
      game.frame(0, 1 / 60);
      game.teleportPlayer(v.px, v.pz);
      if (v.car) {
        // close-up: camera a few metres from the player, a Neksiya and a Damas beside them
        const p = game.player;
        Object.assign(v, { x: p.x - 3.2, z: p.z + 3.6, tx: p.x, tz: p.z });
        const h = Math.atan2(v.tx - v.x, v.tz - v.z), rx = Math.cos(h), rz = -Math.sin(h);
        game.vehicles.spawn('neksiya', p.x + rx * 3.0, p.z + rz * 3.0, h + Math.PI / 2, { paint: 0xf1f1ee });
        game.vehicles.spawn('damas', p.x - rx * 3.2, p.z - rz * 3.2, h - Math.PI / 2, { paint: 0xf1f1ee });
      }
      game.env.time = 12 * 60;
      game.tick(4, true);
    `);
    for (const [label, hours] of [['day', 12], ['night', 22]]) {
      const b = await run(`
        game.env.time = ${hours} * 60; game.env.envTimer = 0;
        game.tick(0.5, true);
        game.env.time = ${hours} * 60; game.env.envTimer = 0;
        game.frame(0, 1 / 60);
        if (!${doBench && (name === 'street' || name === 'aerial')}) return null;
        const gl = game.renderer.getContext(), px = new Uint8Array(4);
        const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (let i = 0; i < 15; i++) { game.frame(0, 1 / 60); sync(); }
        const runs = [];
        for (let r = 0; r < 5; r++) {
          const t0 = performance.now();
          for (let i = 0; i < 40; i++) { game.frame(0, 1 / 60); sync(); }
          runs.push((performance.now() - t0) / 40);
        }
        runs.sort((a, b) => a - b);
        const ri = game.renderer.info.render;
        return { ms: +runs[2].toFixed(2), min: +runs[0].toFixed(2), max: +runs[4].toFixed(2), fps: Math.round(1000 / runs[2]), buffer: gl.drawingBufferWidth + 'x' + gl.drawingBufferHeight, calls: ri.calls, tris: ri.triangles };
      `);
      if (b) { results.bench[`${name}-${label}`] = b; log('bench', name, label, JSON.stringify(b)); }
      if (doShots) { await run(`game.frame(0, 1 / 60);`); await shot(`${name}-${label}`); }
    }
  }
  fs.writeFileSync(path.join(outDir, 'bench.json'), JSON.stringify(results, null, 2));
};
