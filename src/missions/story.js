// Story missions set at real places in Tashkent.
import { PathDriver, Hostile, Runner, Passenger } from './npcs.js';
import { randomLook } from '../entities/humans.js';
import { formatMoney, rand, choice } from '../util/math.js';

// ------------------------------------------------------------------ mission locations
// A spot on a street near (x, z) where a whole car fits on the asphalt, clear of poles, trees
// and walls, and away from junctions. mode 'curb' parks against the right-hand curb; mode
// 'lane' puts the car in the inner driving lane (for cars that drive off straight away).
export function streetSpot(g, x, z, opts = {}) {
  const G = g.graph, pt = {};
  const L = opts.length ?? 4.7, W = opts.width ?? 1.9;
  const maxCls = opts.maxCls ?? 1, minLanes = opts.minLanes ?? 1, maxDist = opts.maxDist ?? 300;
  for (const c of G.nearestEdges(x, z, maxDist, (e) => e.cls <= maxCls && e.len >= 32, 10)) {
    const e = G.edges[c.ei];
    let dir = 1;
    if (!e.oneway) {
      // use the side of a two-way street that faces the target point
      G.pointAt(c.ei, c.s, 1, pt);
      if ((x - c.x) * -pt.tz + (z - c.z) * pt.tx < 0) dir = -1;
    }
    if (G.lanes(c.ei, dir) < minLanes) continue;
    const lateral = opts.mode === 'lane' ? G.laneOffset(c.ei, dir, 0) : e.w / 2 - W / 2 - 0.3;
    if (opts.mode !== 'lane' && !e.oneway && lateral < W / 2 + 0.2) continue; // street too narrow to park
    const s0 = dir > 0 ? c.s : e.len - c.s;
    for (let k = 0; k < 30; k++) {
      const s = s0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 5;
      if (s < 15 || s > e.len - 15) continue;
      G.pointAt(c.ei, s, dir, pt);
      const rx = -pt.tz, rz = pt.tx;
      const cx = pt.x + rx * lateral, cz = pt.z + rz * lateral;
      // every corner of the car must be on this street's asphalt (also on curved streets)
      let ok = true;
      for (const [a, b] of [[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, W / 2], [-L / 2, -W / 2], [0, W / 2], [0, -W / 2]]) {
        if (G.distToEdge(c.ei, cx + pt.tx * a + rx * b, cz + pt.tz * a + rz * b) > e.w / 2 - 0.1) { ok = false; break; }
      }
      for (let i = 0; ok && i < 3; i++) {
        const a = (i - 1) * (L / 2 - W / 2);
        if (!g.collision.isFree(cx + pt.tx * a, cz + pt.tz * a, W / 2 + 0.25)) ok = false;
      }
      if (ok) return { x: cx, z: cz, h: Math.atan2(pt.tx, pt.tz) };
    }
  }
  // fallback: the middle of the nearest street
  const n = G.nearest(x, z, maxDist);
  if (!n) return { x, z, h: 0 };
  G.pointAt(n.ei, n.s, 1, pt);
  return { x: n.x, z: n.z, h: Math.atan2(pt.tx, pt.tz) };
}

export function computeSpots(g) {
  const L = Object.fromEntries(g.map.landmarks.map((l) => [l.id, l]));
  const G = g.graph;
  const side = (x, z) => { const [a, b] = g.pickups.spotNear(x, z); return { x: a, z: b }; };
  const parked = (x, z, opts = {}) => streetSpot(g, x, z, opts);
  const road = (x, z) => { const n = G.nearest(x, z, 250, (e) => e.cls <= 1); return n ? { x: n.x, z: n.z } : { x, z }; };
  const policeHQ = g.map.police.find((p) => /ГУВД/.test(p.name)) || g.map.police[0] || L.temur;
  const S = {
    spawn: side(L.hoteluz.x - 70, L.hoteluz.z + 35),
    spawnCar: parked(L.hoteluz.x - 60, L.hoteluz.z + 50),
    choyxona: side(L.kukeldash.x + 75, L.kukeldash.z + 20),
    damas: parked(L.kukeldash.x + 85, L.kukeldash.z + 30),
    beshqozon: parked(L.beshqozon.x, L.beshqozon.z),
    wedding: parked(L.tashkentcity.x + 40, L.tashkentcity.z + 70),
    policeCar: parked(policeHQ.x, policeHQ.z),
    garage: parked(L.chorsu.x - 230, L.chorsu.z - 170, { maxCls: 2 }),
    hideout: side(L.chorsu.x - 210, L.chorsu.z + 330),
    raceStart: parked(L.tashkentcity.x - 20, L.tashkentcity.z + 110, { minLanes: 2 }),
    race: [road(L.mustaqillik.x, L.mustaqillik.z), road(L.navoitheatre.x, L.navoitheatre.z), road(L.temur.x, L.temur.z), road(L.minor.x, L.minor.z), road(L.tvtower.x, L.tvtower.z - 60)],
    thiefStart: parked(L.chorsu.x + 120, L.chorsu.z + 60),
    home: side(L.minor.x + 140, L.minor.z - 120),
  };
  // marshrutka stops: real bus stops between Chorsu and Amir Temur square
  const stops = g.city.busStops || [];
  const pickStop = (tx, tz, name) => {
    let best = null, bd = Infinity;
    for (const s of stops) { const d = Math.hypot(s.x - tx, s.z - tz); if (d < bd) { bd = d; best = s; } }
    if (!best || bd > 600) return { ...parked(tx, tz), name };
    const p = parked(best.x, best.z);
    return { ...p, name };
  };
  S.marshrutka = [
    pickStop(L.chorsu.x + 200, L.chorsu.z - 80, 'Chorsu'),
    pickStop(L.mustaqillik.x - 250, L.mustaqillik.z + 150, 'Navoiy ko‘chasi'),
    pickStop(L.mustaqillik.x + 80, L.mustaqillik.z + 120, 'Mustaqillik maydoni'),
    pickStop(L.temur.x - 120, L.temur.z + 80, 'Amir Temur xiyoboni'),
  ];
  return S;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const STORY = [
  {
    id: 'welcome', title: 'XUSH KELIBSIZ', subtitle: 'Welcome home, Jasur', reward: 100000, autoStart: true,
    start: (g) => g.spots.spawn,
    async script(m, g) {
      const S = g.spots;
      const car = m.spawnVehicle('kobalt', S.spawnCar.x, S.spawnCar.z, S.spawnCar.h, { paint: 0xf1f1ee });
      await m.wait(1.5);
      await m.say('Jasur', 'Toshkent... Five years in Moscow, and the city has changed so much.', 4.5);
      m.help('Move with <b>W A S D</b>, look around with the <b>mouse</b>, sprint with <b>Shift</b>.<br>Press <b>F</b> next to a car to get in. You can take <i>any</i> car you see.', 12);
      m.objective('Get in the white <b>Kobalt</b> parked nearby.');
      const b = m.blip(car, 'vehicleTarget');
      await m.waitFor(() => !!g.player.vehicle);
      b.remove();
      await m.say('Rustam aka (phone)', 'Jasur, jiyanim! Welcome back! Come to my choyxona near Chorsu bazaar.', 5);
      m.help('Follow the purple <b>GPS</b> line on the radar. Press <b>M</b> for the big map.<br><b>W/S</b> drive &amp; brake, <b>Space</b> handbrake, <b>Q</b> radio.', 10);
      await m.goTo(S.choyxona.x, S.choyxona.z, { text: 'Go to <b>Rustam aka’s choyxona</b> near Chorsu.', radius: 3.5, stop: true });
      await m.say('Rustam aka', 'Assalomu alaykum! Look at you, a real man now. Sit, drink some ko‘k choy.', 4.5);
      await m.say('Rustam aka', 'Business is hard, jiyan. But a man with quick hands and a fast car can earn good money here.', 5);
      await m.say('Rustam aka', 'Here is some pocket money. Come back when you are ready to work.', 4);
    },
  },
  {
    id: 'plov', title: 'ISSIQ PALOV', subtitle: 'Hot plov', reward: 300000,
    start: (g) => g.spots.choyxona,
    async script(m, g) {
      const S = g.spots;
      await m.say('Rustam aka', 'My friend’s son is getting married in Tashkent City tonight. Three hundred guests!', 4.5);
      await m.say('Rustam aka', 'Take my Damas, collect the plov at Besh Qozon by the TV tower and bring it HOT.', 5);
      const van = m.spawnVehicle('damas', S.damas.x, S.damas.z, S.damas.h, { paint: 0xf1f1ee });
      m.failIf(() => van.destroyed, 'The Damas was destroyed');
      const b = m.blip(van, 'vehicleTarget');
      m.objective('Get in the <b>Damas</b>.');
      await m.waitFor(() => g.player.vehicle === van);
      b.remove();
      await m.goTo(S.beshqozon.x, S.beshqozon.z, { text: 'Drive to <b>Besh Qozon</b> plov centre near the TV tower.', vehicle: van, stop: true, radius: 5 });
      m.objective('Loading the kazans of plov...', 3);
      for (let i = 0; i < 12; i++) { g.fx.spawn('steam', van.x + rand(-1, 1), 1.8, van.z + rand(-1, 1)); await m.wait(0.25); }
      let heat = 1, lastHealth = van.health, steamT = 0;
      m.meter(() => ['Plov temperature', heat]);
      m.timer(210, 'The guests went home hungry');
      m.onFrame((dt) => {
        heat -= dt * 0.0032;
        if (van.health < lastHealth - 4) { heat -= (lastHealth - van.health) / 700; lastHealth = van.health; g.hud.notify('The plov is spilling!', 'bad'); }
        steamT -= dt;
        if (steamT <= 0 && heat > 0.3) { steamT = 0.3; g.fx.spawn('steam', van.x, 2, van.z); }
      });
      m.failIf(() => heat <= 0, 'The plov went cold');
      m.help('Crashing spills the plov and the timer is running. Drive smoothly but fast!', 6);
      await m.goTo(S.wedding.x, S.wedding.z, { text: 'Deliver the plov to the <b>wedding</b> in Tashkent City.', vehicle: van, stop: true, radius: 6 });
      m.stopTimer();
      m.meter(null);
      const bonus = Math.round((heat * 250000) / 1000) * 1000;
      g.addMoney(bonus);
      g.hud.notify(`Hot plov bonus +${formatMoney(bonus)} so‘m`, 'money');
      await m.say('Kuyov', 'Rahmat, aka! The plov is perfect. Now the guests will dance until morning!', 4.5);
    },
  },
  {
    id: 'damas', title: 'MARSHRUTKA', subtitle: 'The Damas route', reward: 250000,
    start: (g) => g.spots.choyxona,
    async script(m, g) {
      const S = g.spots;
      await m.say('Rustam aka', 'My neighbour Bahodir broke his leg. Somebody has to drive his marshrutka today.', 4.5);
      await m.say('Rustam aka', 'Four stops, from Chorsu to Amir Temur square. People are waiting, go!', 4.5);
      const van = m.spawnVehicle('damas', S.damas.x, S.damas.z, S.damas.h, { paint: 0xf4f4f0 });
      m.failIf(() => van.destroyed, 'The marshrutka was destroyed');
      const b = m.blip(van, 'vehicleTarget');
      m.objective('Get in the <b>marshrutka</b>.');
      await m.waitFor(() => g.player.vehicle === van);
      b.remove();
      m.timer(330, 'The passengers took a taxi instead');
      let riders = [];
      let fares = 0;
      for (let i = 0; i < S.marshrutka.length; i++) {
        const st = S.marshrutka[i];
        await m.goTo(st.x, st.z, { text: `Stop ${i + 1}/${S.marshrutka.length}: <b>${st.name}</b>`, vehicle: van, stop: true, radius: 5 });
        // passengers walk over and board
        const n = 1 + Math.floor(Math.random() * 3);
        const group = [];
        for (let k = 0; k < n; k++) {
          const door = van.doorPos(1);
          const [x, z] = g.collision.findFree(door.x + rand(-4, 4), door.z + rand(-4, 4), 0.4, 8);
          const ps = m.addPerson(new Passenger(g, x, z, randomLook('ped')));
          ps.target = van; ps.waving = false;
          group.push(ps);
        }
        m.objective('Wait for the passengers to get in.', 6);
        await m.waitFor(() => group.every((ps) => ps.boarded || ps.dead) || van.speed > 6, 25, 'The passengers gave up');
        if (van.speed > 6) g.hud.notify('You drove off without some passengers!', 'bad');
        for (const ps of group) if (ps.boarded) { riders.push(ps); fares += 4000; g.hud.notify('+4 000 so‘m fare', 'money'); }
        if (i === S.marshrutka.length - 1) {
          for (const ps of riders) { const d = van.doorPos(1); ps.boarded = false; ps.visible = true; ps.target = null; ps.x = d.x + rand(-1, 1); ps.z = d.z + rand(-1, 1); }
        }
      }
      m.stopTimer();
      g.addMoney(fares);
      await m.say('Yo‘lovchi', 'Rahmat, haydovchi! Best marshrutka driver in Toshkent.', 3.5);
    },
  },
  {
    id: 'thief', title: 'CHORSU O‘G‘RISI', subtitle: 'The Chorsu thief', reward: 400000,
    start: (g) => g.spots.choyxona,
    async script(m, g) {
      const S = g.spots;
      await m.say('Rustam aka', 'Jasur! A thief grabbed my cash box at Chorsu bazaar!', 3.5);
      await m.say('Rustam aka', 'He jumped into a red Matiz. Don’t let him escape!', 3.5);
      // the getaway car appears in a driving lane on a street close to the player
      let start = S.thiefStart;
      const near = g.graph.randomSpot(g.player.x, g.player.z, 45, 90, (e) => e.cls <= 1 && e.len > 30, 40);
      if (near) start = streetSpot(g, near.x, near.z, { mode: 'lane', maxDist: 60, length: 3.6, width: 1.6 });
      const car = m.spawnVehicle('matiz', start.x, start.z, start.h, { paint: 0xd8262e });
      car.maxHealth = car.health = 900;
      const t0 = m.t;
      const far = () => { const b = g.map.bounds; return { x: b.minX + 300 + Math.random() * (b.maxX - b.minX - 600), z: b.minZ + 300 + Math.random() * (b.maxZ - b.minZ - 600) }; };
      const newPath = () => { const t = far(); return g.graph.findPath(car.x, car.z, t.x, t.z, false) || [car.x, car.z, t.x, t.z]; };
      const drv = new PathDriver(g, car, newPath(), { maxSpeed: 26, onEnd: (d) => d.setPath(newPath()) });
      car.driver = drv;
      m.onFrame((dt) => { if (car.driver === drv) drv.update(dt); });
      // nearby vehicle for the player
      const ride = m.spawnVehicle('lasetti', S.damas.x, S.damas.z, S.damas.h);
      const bc = m.blip(car, 'enemy');
      m.objective('Chase the <b>red Matiz</b> and ram it until it breaks down!');
      m.failIf(() => m.t - t0 > 10 && dist(car, g.player) > 480, 'The thief got away');
      await m.waitFor(() => car.health < car.maxHealth * 0.45 || car.destroyed);
      car.driver = null;
      car.ctrl.throttle = 0; car.ctrl.handbrake = true;
      m.checks = [];
      bc.remove();
      let bagX, bagZ;
      if (car.destroyed) { bagX = car.x + 2; bagZ = car.z + 2; }
      else {
        const door = car.doorPos(-1);
        const runner = m.addPerson(new Runner(g, door.x, door.z, randomLook('ped')));
        const br = m.blip(runner, 'enemy');
        m.objective('The thief is running! <b>Take him down</b> to get the cash box.');
        m.failIf(() => !runner.dead && runner.health >= 60 && dist(runner, g.player) > 220, 'The thief got away');
        await m.waitFor(() => runner.dead || runner.health < 60);
        br.remove();
        m.checks = [];
        bagX = runner.x; bagZ = runner.z;
        if (!runner.dead) { g.hud.subtitle('O‘g‘ri', 'Ayy! Take it, take it! I’m sorry!', 3); runner.ragdoll = 0.8; }
      }
      let got = false;
      const pick = g.pickups.add('item', bagX, bagZ, { onPick: () => { got = true; } });
      const bp = m.blip(pick, 'target');
      m.objective('Pick up the <b>cash box</b>.');
      await m.waitFor(() => got);
      bp.remove();
      await m.goTo(S.choyxona.x, S.choyxona.z, { text: 'Bring the cash box back to <b>Rustam aka</b>.', radius: 3.5, stop: true });
      await m.say('Rustam aka', 'Barakalla, jiyan! You have your grandfather’s spirit.', 4);
      return [ride];
    },
  },
  {
    id: 'copcar', title: 'POLITSIYA MASHINASI', subtitle: 'The police car', reward: 600000,
    start: (g) => g.spots.choyxona,
    async script(m, g) {
      const S = g.spots;
      await m.say('Rustam aka', 'A collector in the old city pays crazy money for a real police Malibu. Don’t ask me why.', 5);
      await m.say('Rustam aka', 'There is one parked by the city police headquarters. Bring it to his garage.', 4.5);
      const car = m.spawnVehicle('police', S.policeCar.x, S.policeCar.z, S.policeCar.h);
      m.failIf(() => car.destroyed, 'The police car was destroyed');
      const b = m.blip(car, 'vehicleTarget');
      await m.goTo(S.policeCar.x, S.policeCar.z, { text: 'Go to the <b>police headquarters</b>.', radius: 12, gps: true });
      m.objective('Steal the <b>police car</b>.');
      await m.waitFor(() => g.player.vehicle === car);
      b.remove();
      g.police.setWanted(2);
      m.objective('Lose the <b>police</b>! Stay out of their sight.');
      m.help('Break line of sight and wait for the flashing stars to go out. A <b>Moyka</b> car wash (pink $) also helps.', 8);
      await m.waitFor(() => g.police.level === 0);
      await m.goTo(S.garage.x, S.garage.z, { text: 'Deliver the car to the <b>garage</b> in the old city.', vehicle: car, stop: true, radius: 4 });
      await m.say('Kolleksioner', 'Ajoyib! A real one! Here is your money, now forget my face.', 4);
      g.player.exitVehicle(true);
      car.persistent = false;
    },
  },
  {
    id: 'race', title: 'TASHKENT CITY POYGASI', subtitle: 'Street race', reward: 1000000,
    start: (g) => g.spots.choyxona,
    async script(m, g) {
      const S = g.spots;
      await m.say('Rustam aka', 'The rich boys of Tashkent City race their cars at night. They laugh at us from Chorsu.', 5);
      await m.say('Rustam aka', 'I bet a million so‘m on you. Win it, jiyan.', 3.5);
      await m.goTo(S.raceStart.x, S.raceStart.z, { text: 'Go to the <b>race start</b> in Tashkent City.', radius: 6 });
      // grid
      const fx = Math.sin(S.raceStart.h), fz = Math.cos(S.raceStart.h);
      const slot = (row, col) => ({ x: S.raceStart.x - fx * row * 7 + fz * col * 3.2, z: S.raceStart.z - fz * row * 7 - fx * col * 3.2 });
      if (g.player.vehicle) g.player.exitVehicle(true);
      const p0 = slot(0, 0);
      const mine = m.spawnVehicle('sport', p0.x, p0.z, S.raceStart.h, { paint: 0xf2c230 });
      g.player.x = mine.x; g.player.z = mine.z;
      g.player.enterVehicle(mine);
      const rivalsDef = [['sport', 0xd81f26], ['malibu', 0x1c1e21], ['gentra', 0x2f73c9]];
      // race path through checkpoints
      const cps = S.race;
      let path = [];
      let from = { x: S.raceStart.x, z: S.raceStart.z };
      for (const cp of cps) { const seg = g.graph.findPath(from.x, from.z, cp.x, cp.z, false) || [from.x, from.z, cp.x, cp.z]; path = path.concat(seg); from = cp; }
      const rivals = rivalsDef.map(([type, paint], i) => {
        const p = slot(i === 0 ? 0 : 1, i === 0 ? 1 : i === 1 ? 0 : 1);
        const v = m.spawnVehicle(type, p.x, p.z, S.raceStart.h, { paint });
        const d = new PathDriver(g, v, path, { maxSpeed: v.type.maxSpeed * (0.8 - i * 0.03), avoid: true });
        v.driver = null;
        return { v, d, cp: 0, done: false };
      });
      for (const r of rivals) m.blip(r.v, 'enemy');
      // countdown
      mine.ctrl.handbrake = true;
      g.player.frozen = true;
      for (const n of ['3', '2', '1']) { g.hud.big(n, '', 0.9, ''); g.audio.tone({ freq: 440, dur: 0.2, gain: 0.25 }); await m.wait(1); }
      g.hud.big('GO!', '', 1, '');
      g.audio.tone({ freq: 880, dur: 0.4, gain: 0.3 });
      g.player.frozen = false;
      for (const r of rivals) r.v.driver = r.d;
      m.onFrame((dt) => {
        for (const r of rivals) {
          if (r.v.driver === r.d) r.d.update(dt);
          if (r.cp < cps.length && dist(r.v, cps[r.cp]) < 22) r.cp++;
          if (r.cp >= cps.length) r.done = true;
        }
      });
      let mineCp = 0;
      const rank = () => {
        const myNext = cps[Math.min(mineCp, cps.length - 1)];
        const myD = dist(g.player, myNext);
        let ahead = 0;
        for (const r of rivals) {
          if (r.cp > mineCp) ahead++;
          else if (r.cp === mineCp && dist(r.v, cps[Math.min(r.cp, cps.length - 1)]) < myD) ahead++;
        }
        return ahead + 1;
      };
      m.meter(() => [`Position ${rank()} / 4  ·  Checkpoint ${Math.min(mineCp + 1, cps.length)} / ${cps.length}`, 1 - (rank() - 1) / 3]);
      m.failIf(() => mine.destroyed, 'Your car was destroyed');
      m.failIf(() => rivals.some((r) => r.done), 'A rival won the race');
      for (let i = 0; i < cps.length; i++) {
        mineCp = i;
        const cp = cps[i];
        await m.goTo(cp.x, cp.z, { text: i === cps.length - 1 ? 'Race to the <b>finish</b> at the TV tower!' : `Checkpoint ${i + 1}`, radius: 9, kind: 'race', gps: true });
        g.audio.checkpoint();
      }
      mineCp = cps.length;
      g.hud.notify('You keep the Samarqand GT!', 'money');
      return [mine];
    },
  },
  {
    id: 'final', title: 'OXIRGI ISH', subtitle: 'The last job', reward: 2500000,
    start: (g) => g.spots.choyxona,
    async script(m, g) {
      const S = g.spots;
      await m.say('Rustam aka', 'The Qora Ko‘zoynak gang wants my choyxona. They gave me until tomorrow.', 4.5);
      await m.say('Rustam aka', 'Take this. An old friend from the army left it with me. And this vest.', 4);
      g.player.giveWeapon('ak', 150);
      g.player.armor = 100;
      g.player.current = 'ak';
      g.hud.notify('AK-47 +150, Armour', 'money');
      await m.goTo(S.hideout.x, S.hideout.z, { text: 'Go to the <b>gang hideout</b> in the old city.', radius: 30, gps: true });
      const enemies = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const [x, z] = g.collision.findFree(S.hideout.x + Math.cos(a) * rand(10, 22), S.hideout.z + Math.sin(a) * rand(10, 22), 0.4, 15);
        const h = m.addPerson(new Hostile(g, x, z, i === 0 ? 'ak' : i % 3 === 0 ? 'smg' : 'pistol'));
        h.alerted = false;
        if (i === 0) { h.health = 250; h.look = { ...h.look, shirt: 0x3a1010 }; }
        enemies.push(h);
        m.blip(h, 'enemy');
      }
      m.objective('Eliminate the <b>Qora Ko‘zoynak</b> gang.');
      await m.waitFor(() => enemies.every((h) => h.dead));
      g.police.setWanted(3);
      m.objective('The police are coming! <b>Lose them</b>.');
      await m.waitFor(() => g.police.level === 0);
      await m.goTo(S.choyxona.x, S.choyxona.z, { text: 'Return to the <b>choyxona</b>.', radius: 3.5, stop: true });
      await m.say('Rustam aka', 'Jasur... you saved the choyxona. The whole mahalla will remember this.', 4.5);
      await m.say('Rustam aka', 'Toshkent is yours now, jiyan. Just... park properly next time.', 4.5);
    },
    after(g) { setTimeout(() => g.hud.big('THE END', 'Free roam: find every golden non, drive taxis and marshrutkas, explore Toshkent.', 7, ''), 5500); },
  },
];
