// Mission framework: missions are async scripts using awaitable helpers.
import { Marker } from '../entities/pickups.js';
import { STORY } from './story.js';
import { Passenger } from './npcs.js';
import { randomLook } from '../entities/humans.js';
import { formatMoney, rand, choice } from '../util/math.js';

export class MissionFailed extends Error { constructor(reason) { super(reason); this.reason = reason; } }

class MissionRun {
  constructor(sys, def) {
    this.sys = sys; this.game = sys.game; this.def = def;
    this.waits = [];
    this.failReason = null;
    this.checks = [];
    this.markers = [];
    this.blipList = [];
    this.vehicles = [];
    this.people = [];
    this.timerEnd = null; this.timerReason = '';
    this.meterFn = null;
    this.frameFns = [];
    this.over = false;
  }
  onFrame(fn) { this.frameFns.push(fn); return () => { this.frameFns = this.frameFns.filter((f) => f !== fn); }; }
  get t() { return this.game.time; }
  // ------------------------------------------------ awaitables
  waitFor(pred, timeout = Infinity, reason = 'You ran out of time') {
    return new Promise((resolve, reject) => {
      if (this.failReason) { reject(new MissionFailed(this.failReason)); return; }
      this.waits.push({ pred, resolve, reject, until: this.t + timeout, reason });
    });
  }
  wait(sec) { const end = this.t + sec; return this.waitFor(() => this.t >= end); }
  // ------------------------------------------------ helpers
  say(who, text, sec = 4.5) { this.game.hud.subtitle(who, text, sec); return this.wait(Math.min(sec, 3.6)); }
  objective(html, sec = 8) { this.game.hud.objective(html, sec); }
  help(html, sec = 8) { this.game.hud.help(html, sec); }
  marker(x, z, kind = 'objective', r = 2.4) {
    const m = new Marker(this.game, x, z, kind, r, kind === 'race' ? 6 : 1.6);
    this.markers.push(m);
    const b = { x, z, kind: kind === 'race' ? 'race' : 'target', marker: m };
    this.blipList.push(b);
    m.remove = () => { m.dispose(); this.markers = this.markers.filter((q) => q !== m); this.blipList = this.blipList.filter((q) => q !== b); };
    return m;
  }
  blip(obj, kind = 'target') { const b = { obj, kind }; this.blipList.push(b); return { remove: () => { this.blipList = this.blipList.filter((q) => q !== b); } }; }
  failIf(pred, reason) { this.checks.push({ pred, reason }); return () => { this.checks = this.checks.filter((c) => c.pred !== pred); }; }
  timer(sec, reason = 'You ran out of time') { this.timerEnd = this.t + sec; this.timerReason = reason; }
  stopTimer() { this.timerEnd = null; this.game.hud.timer(null); }
  meter(fn) { this.meterFn = fn; if (!fn) this.game.hud.meter(null); }
  gps(x, z) { this.game.setWaypoint(x, z, true); }
  spawnVehicle(type, x, z, heading, opts = {}) {
    const v = this.game.vehicles.spawn(type, x, z, heading, { persistent: true, mission: this, ...opts });
    if (v) this.vehicles.push(v);
    return v;
  }
  addPerson(h) { this.people.push(h); this.game.missionNPCs.push(h); return h; }
  removePerson(h) { this.people = this.people.filter((q) => q !== h); this.game.missionNPCs = this.game.missionNPCs.filter((q) => q !== h); }
  // drive or walk to a point; resolves on arrival
  async goTo(x, z, { text, radius = 3.5, vehicle = null, needVehicle = false, stop = false, kind = 'objective', gps = true } = {}) {
    const m = this.marker(x, z, kind, radius);
    if (text) this.objective(text);
    if (gps) this.gps(x, z);
    const p = this.game.player;
    await this.waitFor(() => {
      if (vehicle && p.vehicle !== vehicle) return false;
      if (needVehicle && !p.vehicle) return false;
      if (stop && p.vehicle && p.vehicle.speed > 3) return false;
      const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
      return Math.hypot(px - x, pz - z) < radius + (p.vehicle ? 1.5 : 0);
    });
    m.remove();
    this.game.setWaypoint(null);
  }
  // ------------------------------------------------ per frame
  tick(dt) {
    if (this.over) return;
    const g = this.game;
    if (g.player.dead || g.bustedActive) { this.fail(g.player.dead ? 'You were wasted' : 'You were busted'); }
    if (!this.failReason) for (const f of this.frameFns) f(dt);
    for (const c of this.checks) if (!this.failReason && c.pred()) this.fail(c.reason);
    if (this.timerEnd !== null && !this.failReason) {
      const left = this.timerEnd - this.t;
      g.hud.timer(left);
      if (left <= 0) this.fail(this.timerReason);
    }
    if (this.meterFn) { const [label, v] = this.meterFn(); g.hud.meter(label, v); }
    const pending = this.waits;
    this.waits = [];
    for (const w of pending) {
      if (this.failReason) { w.reject(new MissionFailed(this.failReason)); continue; }
      let ok = false;
      try { ok = w.pred(); } catch (e) { console.error(e); }
      if (ok) w.resolve();
      else if (this.t > w.until) { this.fail(w.reason); w.reject(new MissionFailed(w.reason)); }
      else this.waits.push(w);
    }
    for (const m of this.markers) m.update();
  }
  fail(reason) {
    if (this.failReason) return;
    this.failReason = reason;
    for (const w of this.waits) w.reject(new MissionFailed(reason));
    this.waits = [];
  }
  blips() {
    const out = [];
    for (const b of this.blipList) {
      if (b.obj) {
        const o = b.obj;
        if (o.dead || o.boarded || o.removed || (o.destroyed && b.kind !== 'vehicleTarget')) continue;
        if (o.inVehicle) continue;
        out.push({ x: o.x, z: o.z, kind: b.kind });
      } else out.push({ x: b.x, z: b.z, kind: b.kind });
    }
    return out;
  }
  dispose(keepVehicles = []) {
    this.over = true;
    const g = this.game;
    for (const m of [...this.markers]) m.dispose();
    this.markers = [];
    this.blipList = [];
    g.hud.timer(null);
    g.hud.meter(null);
    for (const h of this.people) g.missionNPCs = g.missionNPCs.filter((q) => q !== h);
    for (const v of this.vehicles) {
      v.mission = null;
      if (keepVehicles.includes(v) || v === g.player.vehicle) continue;
      v.persistent = false;
      if (v.driver && v.driver !== 'player' && !g.traffic.drivers.includes(v.driver)) v.driver = null;
    }
  }
}

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.startMarker = null;
    this.cooldown = 0;
    this.storyCount = STORY.length;
    this.taxi = null;
  }
  get spots() { return this.game.spots; }
  nextStory() { return STORY.find((m) => !this.game.save.done.includes(m.id)); }

  refreshStartMarker() {
    this.startMarker?.dispose();
    this.startMarker = null;
    const def = this.nextStory();
    if (!def || def.autoStart) return;
    const s = def.start(this.game);
    this.startMarker = new Marker(this.game, s.x, s.z, 'mission', 1.4, 1.6);
    this.startMarker.def = def;
  }

  blips() {
    const out = [];
    if (this.active) out.push(...this.active.blips());
    else if (this.startMarker) out.push({ x: this.startMarker.x, z: this.startMarker.z, kind: 'mission' });
    if (this.taxi) out.push(...this.taxi.blips());
    return out;
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.cooldown -= dt;
    if (this.active) { this.active.tick(dt); return; }
    if (this.taxi) this.taxi.update(dt);
    if (this.startMarker) {
      this.startMarker.update();
      if (!p.dead && this.cooldown <= 0 && !p.vehicle && this.startMarker.near(p.x, p.z, 0.3)) {
        if (g.police.level > 0) { g.hud.hint('Lose your wanted level before starting a mission'); return; }
        this.start(this.startMarker.def);
      }
    }
    // side jobs
    if (!this.taxi && p.vehicle && (p.vehicle.typeId === 'taxi' || p.vehicle.typeId === 'damas') && g.input.was('job')) this.startTaxi();
    else if (this.taxi && g.input.was('job')) this.stopTaxi('Job ended');
  }

  async start(def) {
    const g = this.game;
    if (this.taxi) this.stopTaxi();
    this.startMarker?.dispose();
    this.startMarker = null;
    const run = (this.active = new MissionRun(this, def));
    g.hud.big(def.title, def.subtitle || '', 3.5, '');
    let passed = false, reason = '';
    try {
      const keep = await def.script(run, g);
      passed = true;
      run.keep = keep || [];
    } catch (e) {
      if (e instanceof MissionFailed) reason = e.reason;
      else { console.error(e); reason = 'Something went wrong'; }
    }
    run.dispose(run.keep || []);
    this.active = null;
    this.cooldown = 4;
    if (passed) {
      g.save.done.push(def.id);
      g.addMoney(def.reward);
      g.hud.big('MISSION PASSED!', `+${formatMoney(def.reward)} so‘m`, 5, '');
      g.audio.missionPassed();
      if (def.after) def.after(g);
      g.saveGame();
    } else if (!g.player.dead && !g.bustedActive) {
      g.hud.big('MISSION FAILED!', reason, 4, 'red');
      g.audio.missionFailed();
    } else {
      setTimeout(() => g.hud.subtitle('', `Mission failed: ${reason}`, 4), 5500);
    }
    this.refreshStartMarker();
  }

  // ------------------------------------------------ taxi / marshrutka side job
  startTaxi() {
    const g = this.game;
    this.taxi = new TaxiJob(this);
    g.hud.big(g.player.vehicle.typeId === 'damas' ? 'MARSHRUTKA' : 'TAKSI', 'Pick up passengers. Press T to stop.', 3, '');
  }
  stopTaxi(msg) { if (!this.taxi) return; this.taxi.dispose(); this.taxi = null; if (msg) this.game.hud.notify(msg); }
}

// Taxi: pick up a waving passenger, drive them to a named place before the time runs out.
class TaxiJob {
  constructor(sys) {
    this.sys = sys; this.game = sys.game;
    this.state = 'find';
    this.passenger = null; this.dest = null; this.marker = null;
    this.timer = 0; this.streak = 0;
    this.vehicle = this.game.player.vehicle;
    this.spawnPassenger();
  }
  spawnPassenger() {
    const g = this.game, p = g.player;
    const spot = g.graph.randomSpot(p.x, p.z, 120, 380, (e) => e.cls <= 1);
    if (!spot) { this.retry = 1; return; }
    const pt = g.graph.pointAt(spot.ei, spot.s, 1, {});
    const off = g.graph.sidewalkOffset(spot.ei);
    const [x, z] = g.collision.findFree(spot.x - pt.tz * off, spot.z + pt.tx * off, 0.4, 10);
    this.passenger = new Passenger(g, x, z, randomLook('ped'));
    g.missionNPCs.push(this.passenger);
    this.state = 'find';
    this.game.hud.objective('Pick up the <b>passenger</b>.', 5);
  }
  blips() {
    const out = [];
    if (this.passenger && !this.passenger.boarded && !this.passenger.dead) out.push({ x: this.passenger.x, z: this.passenger.z, kind: 'friend' });
    if (this.dest) out.push({ x: this.dest.x, z: this.dest.z, kind: 'target' });
    return out;
  }
  update(dt) {
    const g = this.game, p = g.player, v = p.vehicle;
    if (this.retry > 0) { this.retry -= dt; if (this.retry <= 0) { this.retry = 0; this.spawnPassenger(); } return; }
    if (!v || v !== this.vehicle) { this.sys.stopTaxi('You left the vehicle'); return; }
    if (v.destroyed) { this.sys.stopTaxi('Vehicle destroyed'); return; }
    if (g.police.level > 0) { this.sys.stopTaxi('Passengers don’t ride with wanted drivers'); return; }
    const P = this.passenger;
    if (this.state === 'find') {
      if (!P || P.dead) { this.sys.stopTaxi('The passenger was hurt'); return; }
      const d = Math.hypot(P.x - v.x, P.z - v.z);
      if (d < 9 && v.speed < 2) { P.target = v; P.waving = false; this.state = 'boarding'; }
    } else if (this.state === 'boarding') {
      if (P.dead) { this.sys.stopTaxi('The passenger was hurt'); return; }
      if (v.speed > 4) { P.target = null; P.waving = true; this.state = 'find'; }
      if (P.boarded) {
        g.missionNPCs = g.missionNPCs.filter((q) => q !== P);
        // destination: a landmark or neighbourhood 600-2200 m away
        const cands = [...g.map.landmarks, ...g.map.places.filter((pl) => pl.rank >= 1)].filter((c) => { const d = Math.hypot(c.x - v.x, c.z - v.z); return d > 600 && d < 2200; });
        const c = choice(cands.length ? cands : g.map.landmarks);
        const n = g.graph.nearest(c.x, c.z, 200);
        this.dest = { x: n ? n.x : c.x, z: n ? n.z : c.z, name: c.name };
        this.dist = Math.hypot(this.dest.x - v.x, this.dest.z - v.z);
        this.timer = 25 + this.dist / 9;
        this.marker = new Marker(g, this.dest.x, this.dest.z, 'objective', 4, 1.6);
        g.setWaypoint(this.dest.x, this.dest.z, true);
        g.hud.objective(`Take the passenger to <b>${this.dest.name}</b>.`, 6);
        g.hud.subtitle('Passenger', choice(['Assalomu alaykum! ', 'Salom aka, ', 'Iltimos, tezroq! ', 'Rahmat, ']) + `${this.dest.name}, please.`, 4);
        this.state = 'drive';
      }
    } else if (this.state === 'drive') {
      this.timer -= dt;
      g.hud.timer(this.timer);
      this.marker.update();
      if (this.timer <= 0) { g.hud.big('TOO SLOW!', 'The passenger left without paying', 3, 'red'); this.finishRide(false); return; }
      if (Math.hypot(this.dest.x - v.x, this.dest.z - v.z) < 7 && v.speed < 3) this.finishRide(true);
    }
  }
  finishRide(paid) {
    const g = this.game;
    g.hud.timer(null);
    this.marker?.dispose(); this.marker = null;
    g.setWaypoint(null);
    if (paid) {
      this.streak++;
      const fare = Math.round((6000 + this.dist * 18 + Math.max(0, this.timer) * 300 + this.streak * 2000) / 500) * 500;
      g.addMoney(fare);
      g.save.stats.taxiFares++;
      g.hud.notify(`Fare +${formatMoney(fare)} so‘m`, 'money');
      g.audio.cash();
      // passenger gets out
      const door = this.vehicle.doorPos(1);
      const P = this.passenger;
      P.boarded = false; P.visible = true; P.x = door.x; P.z = door.z; P.target = null; P.waving = false;
      const ped = P;
      setTimeout(() => { g.missionNPCs = g.missionNPCs.filter((q) => q !== ped); }, 4000);
      g.missionNPCs.push(P);
    } else this.streak = 0;
    this.passenger = null; this.dest = null;
    this.retry = rand(1.5, 3);
  }
  dispose() {
    const g = this.game;
    g.hud.timer(null);
    this.marker?.dispose();
    if (this.passenger) g.missionNPCs = g.missionNPCs.filter((q) => q !== this.passenger);
    g.setWaypoint(null);
  }
}
