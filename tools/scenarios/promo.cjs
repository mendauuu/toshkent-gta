// Promo screenshots for announcing the game, for tools/harness.cjs: staged scenes rendered by the game
// itself on real settings (High quality, 480x270 pixels, denser traffic and people, long draw
// distance) with a free camera, the HUD hidden except on the chase. Each scene gets a freshly loaded
// game and its own seed, so it comes out the same however the scenes are run, and the run never
// writes the save game or settings. Run e.g.:
//   HARNESS_SIZE=1920x1080 GAME_QUERY="?quality=high" electron tools/harness.cjs tools/scenarios/promo.cjs screenshots/promo
// ONLY=05,06 shoots just those scenes; VARIANT=1, 2, ... re-rolls the people and traffic.
module.exports = async ({ run, wait, shot, log }) => {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null, variant = Number(process.env.VARIANT) || 0;
  const setupCode = `
    // never touch the player's save game or settings
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('gta-toshkent')) return; return setItem.call(this, k, v); };
    const seed = (n) => { let s = n | 0; Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    seed(20261020);
    game.loop = () => {}; game.frameNo = 1;
    Object.assign(game.settings, { peds: 1.8, traffic: 1.5, drawDistance: 1100 });
    game.startGame(false);
    game.missions.active?.fail('promo');
    game.tick(0.5, false);
    const st = document.createElement('style'); document.head.appendChild(st);
    const { randomLook } = await import('./src/entities/humans.js');
    const { Ped } = await import('./src/entities/peds.js');
    const { ChaseDriver } = await import('./src/entities/police.js');
    const G = game.graph, L = Object.fromEntries(game.map.landmarks.map((l) => [l.id, l])), pt = {};
    const cen = (r) => { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [x * 2 / r.length, z * 2 / r.length]; };
    // the game only spawns people and cars outside the camera's view; between scenes the camera
    // still shows the previous scene, so spawn anywhere instead to keep scenes independent
    game.isVisible = () => false;
    // a face and hair style from the scene's seed, for a look that has none yet (the game picks them
    // from its own sequence the first time a look is drawn, which depends on what was drawn before)
    const style = (h) => {
      const k = h.look; if (k._face !== undefined) return;
      k._face = (k.bits & 2) || h.kind === 'cop' ? 3 : k.gang || h.kind === 'enemy' ? 4 : Math.floor(Math.random() * 3);
      k._hair = k.female ? [2, 3, 1][Math.floor(Math.random() * 3)] : Math.random() < 0.7 ? 1 : 4;
    };
    const PR = window.PR = {
      L, G, seed, ChaseDriver,
      hud(on) { st.textContent = on ? '#hud-help, #hud-bottom, #hud-notify, #hud-hint, #hud-big, #hud-location, #hud-radio { display: none !important; }' : '#hud { display: none !important; }'; },
      // move the player (also the shadow focus), set the clock and let the city populate. Every
      // scene starts from empty streets and the same sim clock, so scenes don't depend on each other
      at(x, z, hours, secs = 2) {
        const p = game.player;
        if (p.vehicle) p.exitVehicle(true);
        game.input.down.clear();
        game.police.resetAll();
        game.missionNPCs.length = 0;
        for (const d of [...game.traffic.drivers]) game.traffic.remove(d);
        for (const v of [...game.vehicles.list]) game.vehicles.remove(v);
        game.peds.list.length = 0;
        game.peds.spawnT = 0; game.traffic.spawnT = 0; game.autoSaveT = 0;
        Object.assign(game.police, { spawnT: 0, checkT: 0, seen: false, unseenT: 0 });
        p.heading = 0; p.animPhase = 0; p.animAmp = 0;
        game.time = 600;
        game.camera.fov = 62; game.camera.updateProjectionMatrix();
        game.teleportPlayer(x, z);
        game.env.time = hours * 60;
        if (secs) game.tick(secs, false);
        game.env.time = hours * 60;
      },
      // pedestrians on the sidewalks around a point (the game itself only spawns them out of view)
      walkers(cx, cz, n, r = 50, cls = 2) {
        let k = 0;
        for (let i = 0; i < n * 8 && k < n; i++) {
          const spot = G.randomSpot(cx, cz, 0, r, (e) => e.cls <= cls);
          if (!spot) continue;
          const e = G.edges[spot.ei], side = Math.random() < 0.5 ? 1 : -1;
          G.pointAt(spot.ei, spot.s, 1, pt);
          const off = G.sidewalkOffset(spot.ei) * side;
          const x = pt.x - pt.tz * off, z = pt.z + pt.tx * off;
          if (!game.collision.isFree(x, z, 0.4)) continue;
          const ped = new Ped(game, randomLook('ped'), x, z);
          style(ped);
          const dir = Math.random() < 0.5 ? 1 : -1;
          ped.route = { ei: spot.ei, dir, s: dir > 0 ? spot.s : e.len - spot.s, side: dir > 0 ? side : -side };
          ped.heading = Math.atan2(pt.tx * dir, pt.tz * dir);
          game.peds.list.push(ped); k++;
        }
        return k;
      },
      traffic(cx, cz, n) { let k = 0; for (let i = 0; i < n * 5 && k < n; i++) if (game.traffic.trySpawn({ x: cx, z: cz })) k++; return k; },
      // a staged person who stands or walks in place for a still frame. A look that sets _face must
      // also set _hair: lookStyle() only fills both when _face is missing
      person(look, x, z, heading, walk = 0, kind = 'mission') {
        game.missionNPCs.push({ look, kind, x, y: 0, z, heading, lie: 0, spin: 0, animPhase: 1 + Math.random() * 4, animAmp: walk, pose: 0, visible: true, inVehicle: null, dead: false, radius: 0.34, health: 100, update() {} });
      },
      cam(x, y, z, tx, ty, tz) { game.debugCam = { x, y, z, tx, ty, tz }; },
      draw() {
        for (const list of [game.peds.list, game.police.cops, game.missionNPCs]) for (const h of list) style(h);
        game.signalT = 0; // traffic lights show the current sim time
        game.frame(0, 1 / 60); game.frame(0, 1 / 60);
      },
    };
    // ground-floor walls by kind (aStyle.z = kind + 4 * bays; 1 = shops, 3 = mahalla gate wall)
    const walls = (kind, minLen) => {
      const out = [];
      for (const c of game.city.chunkList) {
        const m = c.buildingMesh; if (!m) continue;
        const S = m.geometry.attributes.aStyle, P = m.geometry.attributes.position, N = m.geometry.attributes.normal;
        for (let i = 0; i < S.count - 1; i++) {
          if (Math.round(S.getZ(i)) % 4 !== kind || P.getY(i) > 0.5 || P.getY(i + 1) > 0.5 || S.getZ(i + 1) !== S.getZ(i)) continue;
          const len = Math.hypot(P.getX(i + 1) - P.getX(i), P.getZ(i + 1) - P.getZ(i));
          if (len < minLen) continue;
          const x = (P.getX(i) + P.getX(i + 1)) / 2, z = (P.getZ(i) + P.getZ(i + 1)) / 2;
          out.push({ x, z, nx: N.getX(i), nz: N.getZ(i), ux: (P.getX(i + 1) - P.getX(i)) / len, uz: (P.getZ(i + 1) - P.getZ(i)) / len, len, d: Math.hypot(x - L.temur.x, z - L.temur.z) });
        }
      }
      return out;
    };
    // the longest shop row with no street trees in front of it and a road outside
    const T = game.map.trees, grid = new Map();
    for (let k = 0; k < T.length; k += 4) { const kk = Math.floor(T[k] / 50) + ',' + Math.floor(T[k + 1] / 50); let a = grid.get(kk); if (!a) grid.set(kk, a = []); a.push(T[k], T[k + 1]); }
    const near = (x, z, r, fn) => { for (let gx = Math.floor((x - r) / 50); gx <= Math.floor((x + r) / 50); gx++) for (let gz = Math.floor((z - r) / 50); gz <= Math.floor((z + r) / 50); gz++) { const a = grid.get(gx + ',' + gz); if (a) for (let i = 0; i < a.length; i += 2) fn(a[i], a[i + 1]); } };
    const shops = walls(1, 20).filter((w) => w.d < 3500);
    for (const w of shops) {
      let t = 0;
      near(w.x, w.z, 30 + w.len / 2, (x, z) => { const dx = x - w.x, dz = z - w.z, n = dx * w.nx + dz * w.nz, u = dx * w.ux + dz * w.uz; if (n > 0 && n < 24 && Math.abs(u) < w.len / 2 + 6) t++; });
      w.trees = t; w.road = !!G.nearest(w.x + w.nx * 12, w.z + w.nz * 12, 16, (e) => e.cls <= 1);
    }
    PR.shop = shops.filter((w) => w.road).sort((a, b) => a.trees - b.trees || b.len - a.len)[0];
    // a lane lined with mahalla gates: the third densest cluster, away from the first two
    const gates = walls(3, 6);
    for (const w of gates) w.n = gates.filter((o) => Math.hypot(o.x - w.x, o.z - w.z) < 40).length;
    gates.sort((a, b) => b.n - a.n);
    const picks = [];
    for (const w of gates) if (picks.length < 3 && picks.every((o) => Math.hypot(o.x - w.x, o.z - w.z) > 150)) picks.push(w);
    PR.gate = picks[2] || picks[0];
    // the great tiled dome of Chorsu bazaar
    for (const b of game.map.buildings) if (b.roof === 3) { const [x, z] = cen(b.ring), d = Math.hypot(x - L.chorsu.x, z - L.chorsu.z); if (d < 90 && (!PR.dome || d < PR.dome.d)) PR.dome = { x, z, d }; }
    PR.hud(false);
    const r = (w) => w && [Math.round(w.x), Math.round(w.z)];
    return { shop: r(PR.shop), gate: r(PR.gate), dome: r(PR.dome) };`;
  // load the game afresh for every scene (the first one uses the page the harness opened)
  let fresh = true;
  const boot = async () => {
    if (!fresh) { await run(`setTimeout(() => location.reload(), 0);`); await wait(1000); }
    fresh = false;
    for (let i = 0; i < 400; i++) { if ((await run(`return window.game && game.state`).catch(() => null)) === 'title') break; await wait(250); }
    return run(setupCode);
  };

  // seed = the name the scene's people and traffic are seeded from (kept when a scene is renamed),
  // pick = which roll of them was chosen
  const scene = async (name, code, { seed = name, pick = 0 } = {}) => {
    if (only && !only.some((o) => name.startsWith(o))) return;
    log('setup', name, JSON.stringify(await boot()));
    const ok = await run(`PR.seed(${[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) + (variant + pick) * 7919});\n${code}`);
    if (ok === false) { log('skip', name); return; }
    await shot(name);
    log('shot', name);
  };
  const wallFrame = `const W = PR.shop; if (!W) return false; const P = (n, u) => [W.x + W.nx * n + W.ux * u, W.z + W.nz * n + W.uz * u];`;

  // key art: the game's own title logo over Chorsu bazaar (menu buttons hidden, a light shade behind the logo)
  await scene('01-keyart', `
    const D = PR.dome; if (!D) return false;
    const a = Math.PI + 0.4;
    PR.at(D.x + Math.cos(a) * 45, D.z + Math.sin(a) * 45, 12);
    PR.walkers(D.x, D.z, 40, 110); PR.traffic(D.x, D.z, 8);
    game.tick(3, false); game.env.time = 12 * 60;
    PR.cam(D.x + Math.cos(a) * 90, 12, D.z + Math.sin(a) * 90, D.x, 34, D.z);
    document.getElementById('title').classList.remove('hidden');
    const k = document.createElement('style'); k.id = 'keyart-style'; document.head.appendChild(k);
    k.textContent = '#title .menu { display: none !important; } #title { justify-content: flex-start; padding-top: 6vh; background: linear-gradient(180deg, rgba(8,12,28,0.5), rgba(8,12,28,0) 45%) !important; } #title .logo { transform: scale(1.15); transform-origin: top center; }';
    PR.draw();`);

  // a Soviet block's shop row on a busy street
  await scene('02-street', `${wallFrame}
    const [px, pz] = P(5, 4); PR.at(px, pz, 10.5);
    const [wx, wz] = P(9, 0); PR.walkers(wx, wz, 30, 60); PR.traffic(wx, wz, 10);
    game.tick(4, false); game.env.time = 10.5 * 60;
    const [cx, cz] = P(20, -14), [tx, tz] = P(2, 14);
    PR.cam(cx, 2.0, cz, tx, 4, tz); PR.draw();`, { seed: '03-street' });

  // chibi people in front of the shops
  await scene('03-people', `${wallFrame}
    const [px, pz] = P(4.2, 0);
    PR.at(px, pz, 16.4);
    const [wx, wz] = P(9, 0); PR.walkers(wx, wz, 16, 50);
    game.tick(2, false); game.env.time = 16.4 * 60;
    const [cx, cz] = P(7.4, 0.6);
    const face = (x, z) => Math.atan2(cx - x, cz - z), along = (s) => Math.atan2(W.ux * s, W.uz * s);
    const V = { DOPPI: 1, CAP: 2, SCARF: 4, DRESS: 8, GUN: 16, HAIR: 32, BEARD: 64, COAT: 128 };
    const group = [
      [{ shirt: 0xf4ede0, pants: 0x2c5fb8, skin: 0xdb9a6b, extra: 0x3a2430, bits: V.DOPPI | V.HAIR | V.BEARD, _face: 0, _hair: 1 }, 3.4, -2.3, 'cam', 0],
      [{ shirt: 0xc23b4a, pants: 0x45305e, skin: 0xffd2a8, extra: 0x5cc3f0, bits: V.SCARF | V.DRESS, female: true, extra2: 0xc23b4a, _face: 0, _hair: 1 }, 3.0, 2.0, 'cam', 0],
      [{ shirt: 0xff9fb2, pants: 0x2c5fb8, skin: 0xffe0c2, extra: 0x5a3424, bits: V.HAIR, female: true, _face: 0, _hair: 2 }, 2.1, -4.6, 1, 0.8],
      [{ shirt: 0x26c0b9, pants: 0x45305e, skin: 0xf2b98c, extra: 0x7d4430, bits: V.HAIR | V.DRESS, female: true, extra2: 0x26c0b9, _face: 2, _hair: 3 }, 1.8, 4.4, -1, 0.7],
      [{ shirt: 0x2c5fb8, pants: 0x45305e, skin: 0xf2b98c, extra: 0x2c5fb8, bits: V.CAP }, 1.5, -0.9, 'cam', 0, 'cop'],
      [{ shirt: 0xf4b726, pants: 0x45305e, skin: 0xc9845a, extra: 0x2b1d3a, bits: V.HAIR, _face: 0, _hair: 4 }, 1.4, 1.3, -1, 0.75],
    ];
    for (const [look, n, u, h, walk, kind] of group) { const [x, z] = P(n, u); PR.person(look, x, z, h === 'cam' ? face(x, z) : along(h), walk, kind); }
    game.player.heading = face(px, pz);
    const [tx, tz] = P(2.4, -0.4);
    PR.cam(cx, 1.4, cz, tx, 1.5, tz); PR.draw();`, { seed: '04-people' });

  // a police chase seen from the roadside, with the gameplay HUD: four stars and the helicopter
  await scene('04-chase', `
    const T = PR.L.temur;
    let best = null;
    for (let i = 0; i < PR.G.edges.length; i++) {
      const e = PR.G.edges[i]; if (e.cls > 0 || e.len < 170 || !PR.G.canTravel(i, 1) || PR.G.lanes(i, 1) < 2) continue;
      const m = {}; PR.G.pointAt(i, e.len / 2, 1, m);
      const d = Math.hypot(m.x - T.x, m.z - T.z);
      if (d < 900 && (!best || e.len > best.len)) best = { ei: i, len: e.len };
    }
    if (!best) return false;
    const ei = best.ei, e = PR.G.edges[ei], q = {};
    PR.G.lanePoint(ei, e.len * 0.5, 1, 0, q);
    PR.at(q.x, q.z, 13.2);
    for (const d of [...game.traffic.drivers]) if (Math.hypot(d.vehicle.x - q.x, d.vehicle.z - q.z) < 80) { game.traffic.remove(d); game.vehicles.remove(d.vehicle); }
    const car = game.vehicles.spawn('sport', q.x, q.z, Math.atan2(q.tx, q.tz), { paint: 0xff7a5c });
    game.player.enterVehicle(car);
    const speed = 19;
    car.vx = q.tx * speed; car.vz = q.tz * speed;
    for (const [back, lane] of [[7, 1], [15, 0]]) {
      const c = {}; PR.G.lanePoint(ei, e.len * 0.5 - back, 1, lane, c);
      const v = game.vehicles.spawn('police', c.x, c.z, Math.atan2(c.tx, c.tz), { persistent: true });
      v.vx = c.tx * speed; v.vz = c.tz * speed;
      const u = { vehicle: v, cops: [], state: 'driving', update(dt) { if (v.driver === this.driver) this.driver.update(dt); }, deploy() {}, board() {} };
      u.driver = new PR.ChaseDriver(game, v, null); v.driver = u.driver; v.persistent = true; v.sirenOn = true;
      game.police.units.push(u);
    }
    game.police.setWanted(4);
    game.input.down.add('KeyW');
    game.tick(1.0, false);
    const H = game.police.heli, fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = -fz, rz = fx, sd = -1;
    const mx = car.x - fx * 7, mz = car.z - fz * 7;
    if (H) { H.x = mx - fx * 5 - rx * sd * 8; H.y = 8; H.z = mz - fz * 5 - rz * sd * 8; H.heading = car.heading; }
    game.tick(1 / 60, false);
    game.env.time = 13.2 * 60;
    game.camera.fov = 55; game.camera.updateProjectionMatrix();
    PR.cam(mx + rx * sd * 14, 1.15, mz + rz * sd * 14, mx, 2.2, mz);
    PR.hud(true); PR.draw();
    // settle the stars' pop-in animation from the new wanted level, then draw the HUD again
    document.getElementById('hud-stars').getAnimations().forEach((a) => a.finish());
    PR.draw();`, { seed: '05-chase' });

  // the shop row at night: lit signs and windows, pools of lamplight
  await scene('05-night', `${wallFrame}
    const [px, pz] = P(5, 4); PR.at(px, pz, 22);
    const [wx, wz] = P(9, 0); PR.walkers(wx, wz, 30, 60); PR.traffic(wx, wz, 10);
    game.tick(4, false); game.env.time = 22 * 60;
    const [cx, cz] = P(16, -12), [tx, tz] = P(2, 12);
    PR.cam(cx, 1.9, cz, tx, 3.5, tz); PR.draw();`, { seed: '06-night', pick: 5 });

  // a drone over the same mahalla: pitched rooftops, courtyard trees, people in the lanes
  await scene('06-rooftops', `
    const W = PR.gate; if (!W) return false;
    const P = (n, u) => [W.x + W.nx * n + W.ux * u, W.z + W.nz * n + W.uz * u];
    const [fx, fz] = P(0, -5);
    PR.at(fx, fz, 16);
    PR.walkers(fx, fz, 30, 70, 3); PR.traffic(fx, fz, 10);
    game.tick(4, false); game.env.time = 16 * 60;
    const [cx, cz] = P(30, -40), [tx, tz] = P(-30, 30);
    PR.cam(cx, 35, cz, tx, 0, tz); PR.draw();`, { seed: '02-oldcity' });

  // a mahalla lane: courtyard walls, carved wooden gates, vines
  await scene('07-mahalla', `
    const W = PR.gate; if (!W) return false;
    const P = (n, u) => [W.x + W.nx * n + W.ux * u, W.z + W.nz * n + W.uz * u];
    const [px, pz] = P(2.5, 3); PR.at(px, pz, 15.6);
    PR.walkers(W.x, W.z, 14, 45, 3);
    game.tick(3, false); game.env.time = 15.6 * 60;
    const [cx, cz] = P(4.5, -13), [tx, tz] = P(1, 10);
    PR.cam(cx, 1.8, cz, tx, 2.4, tz); PR.draw();`, { seed: '08-mahalla', pick: 1 });

  // Minor mosque by the Anhor canal
  await scene('08-minor', `
    const M = PR.L.minor, a = Math.PI / 2 + 0.4;
    PR.at(M.x + Math.cos(a) * 40, M.z + Math.sin(a) * 40, 15.2);
    PR.walkers(M.x, M.z, 20, 90);
    game.tick(3, false); game.env.time = 15.2 * 60;
    PR.cam(M.x + Math.cos(a) * 130, 25, M.z + Math.sin(a) * 130, M.x, 18, M.z); PR.draw();`, { seed: '07-minor' });

  // the voxel Amir Temur on his horse, seen over the treetops of the square
  await scene('09-temur', `
    // the statue is turned by -2.2 rad, so the horse faces (sin -2.2, cos -2.2)
    const T = PR.L.temur, f = Math.atan2(Math.cos(-2.2), Math.sin(-2.2)) + 0.5, ox = Math.cos(f), oz = Math.sin(f);
    PR.at(T.x + ox * 12, T.z + oz * 12, 11.2);
    PR.walkers(T.x, T.z, 16, 80);
    game.tick(3, false); game.env.time = 11.2 * 60;
    PR.cam(T.x + ox * 20, 11, T.z + oz * 20, T.x, 8, T.z); PR.draw();`, { seed: '10-temur' });

  // the TV Tower against the sunset, the canal leading to it
  await scene('10-tvtower', `
    const T = PR.L.tvtower, a = 75 * Math.PI / 180, ox = Math.sin(a), oz = -Math.cos(a);
    PR.at(T.x + ox * 120, T.z + oz * 120, 18.0);
    PR.traffic(T.x + ox * 200, T.z + oz * 200, 6);
    game.tick(2, false); game.env.time = 18.0 * 60;
    PR.cam(T.x + ox * 480, 40, T.z + oz * 480, T.x, 150, T.z); PR.draw();`, { seed: '09-tvtower' });
  log('done');
};
