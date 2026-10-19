// The game: owns every system, runs the simulation and renders the frame.
import * as THREE from 'three';
import { CollisionWorld } from './world/collision.js';
import { RoadGraph } from './world/roadGraph.js';
import { City, yieldFrame, radialTexture } from './world/city.js';
import { buildLandmarks } from './world/landmarks.js';
import { Environment } from './world/sky.js';
import { sharedUniforms } from './world/materials.js';
import { VehicleManager } from './entities/vehicle.js';
import { HumanRenderer, POSE } from './entities/humans.js';
import { Player } from './entities/player.js';
import { Ped, PedManager } from './entities/peds.js';
import { TrafficManager } from './entities/traffic.js';
import { PoliceManager, Cop } from './entities/police.js';
import { Combat, WEAPONS } from './entities/weapons.js';
import { Pickups } from './entities/pickups.js';
import { Effects } from './fx/effects.js';
import { PixelPipeline } from './fx/pixel.js';
import { cutePaint } from './world/palette.js';
import { Audio } from './audio/audio.js';
import { Hud } from './ui/hud.js';
import { MapRenderer } from './ui/minimap.js';
import { Menu } from './ui/menu.js';
import { MissionSystem } from './missions/missions.js';
import { computeSpots } from './missions/story.js';
import { Input } from './input.js';
import { CameraRig } from './cameraRig.js';
import { loadSettings, loadSave, writeSave, NEW_SAVE } from './settings.js';
import { rand, chance, clamp, formatMoney, choice } from './util/math.js';

const STEP = 1 / 60;

export class Game {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.map = map;
    this.settings = loadSettings();
    this.time = 0;
    this.state = 'loading';
    this.paused = false;
    this.missionNPCs = [];
    this.save = NEW_SAVE();
    this.gps = null;
    // pixel-art look: flat toon colours with no tone mapping, hard shadows, no anti-aliasing; the
    // scene renders at a low internal resolution with 1-pixel outlines (see fx/pixel.js)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.setClearColor(0x000000, 0); // alpha 0 marks "no normal" in the outline buffer
    this.renderer.info.autoReset = false; // a frame is several passes; frame() resets the counters
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 9000);
    this.pixel = new PixelPipeline(this.renderer, canvas);
    this.pixel.onDeviceResize = () => this.onResize();
    this.onResize();
    this.collision = new CollisionWorld(map.scenery, map.bounds);
    this.graph = new RoadGraph(map.graph, map.names);
    this.env = new Environment(this.scene, this.renderer, this.settings);
    this.city = new City(this);
    this.frustum = new THREE.Frustum();
    this.projScreen = new THREE.Matrix4();
    this.tmpSphere = new THREE.Sphere();
    addEventListener('resize', () => this.onResize());
  }

  async load(progress) {
    await this.city.build((f, msg) => progress(0.05 + f * 0.8, msg));
    progress(0.86, 'Building landmarks: TV tower, Amir Temur, Chorsu…');
    await yieldFrame();
    this.landmarks = buildLandmarks(this);
    this.collision.finalize();
    progress(0.9, 'Waking up the city…');
    await yieldFrame();
    this.input = new Input(this.canvas);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onLockError = () => this.onLockError();
    this.fx = new Effects(this);
    this.audio = new Audio(this);
    this.vehicles = new VehicleManager(this);
    this.humanRenderer = new HumanRenderer(this.scene);
    this.player = new Player(this);
    this.peds = new PedManager(this);
    this.traffic = new TrafficManager(this);
    this.police = new PoliceManager(this);
    this.combat = new Combat(this);
    this.cameraRig = new CameraRig(this.camera, this);
    this.pickups = new Pickups(this);
    this.hud = new Hud(this);
    this.missions = new MissionSystem(this);
    this.spots = computeSpots(this);
    this.safehouse = this.spots.home;
    this.mapRenderer = new MapRenderer(this);
    this.menu = new Menu(this);
    // Real spot lights cost every pixel of every lit material even when off, so they only exist on
    // High quality (created up front so shaders never recompile mid-game). Lower settings fake
    // the player's headlights with an additive glow on the road.
    const dummyLight = () => ({ intensity: 0, position: new THREE.Vector3(), target: new THREE.Object3D() });
    if (this.settings.quality === 'high') {
      this.headLight = new THREE.SpotLight(0xfff0d0, 0, 70, 0.5, 0.55, 1.4);
      this.heliLight = new THREE.SpotLight(0xffffff, 0, 160, 0.2, 0.5, 1.2);
      this.scene.add(this.headLight, this.headLight.target, this.heliLight, this.heliLight.target);
    } else {
      this.headLight = dummyLight();
      this.heliLight = dummyLight();
    }
    const glowGeo = new THREE.PlaneGeometry(7, 16);
    glowGeo.rotateX(-Math.PI / 2);
    this.headGlow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xffe9b8, map: radialTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.headGlow.renderOrder = -19;
    this.headGlow.visible = false;
    this.scene.add(this.headGlow);
    this.player.x = this.spots.spawn.x; this.player.z = this.spots.spawn.z;
    this.fx.setScale(this.pixel.height, this.camera.fov);
    progress(0.97, 'Compiling shaders…');
    this.pixel.compile(this.scene, this.camera);
    progress(1, 'Ready');
    this.state = 'title';
    this.titleT = 0;
    this.lastFrame = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------------ game flow
  startGame(continueSave) {
    this.audio.init();
    const loaded = continueSave ? loadSave() : null;
    this.save = loaded || NEW_SAVE();
    const p = this.player;
    // reset the world
    this.police.resetAll();
    for (const v of [...this.vehicles.list]) this.vehicles.remove(v);
    this.traffic.drivers = [];
    this.peds.list = [];
    this.missionNPCs = [];
    for (const pk of [...this.pickups.list]) this.pickups.remove(pk);
    for (const pc of this.pickups.places) pc.marker.dispose();
    this.pickups.places = [];
    this.pickups.setupWorld(this.save);
    p.dead = false; p.health = 100; p.armor = 0; p.vehicle = null; p.inVehicle = null; p.lie = 0; p.ragdoll = 0; p.entering = null;
    p.money = this.save.money;
    p.removeWeapons(false);
    if (this.save.weapons) { p.weapons = { fist: { ammo: Infinity, clip: Infinity }, ...this.save.weapons }; p.current = 'fist'; }
    else p.giveWeapon('pistol', 24);
    p.current = 'fist';
    this.env.time = this.save.time ?? 600;
    const start = loaded ? this.safehouse : this.spots.spawn;
    p.x = start.x; p.z = start.z; p.y = 0;
    p.heading = 0;
    this.cameraRig.snapBehind(Math.PI);
    this.hud.shownMoney = p.money;
    this.menu.hideTitle();
    this.hud.show();
    this.state = 'playing';
    this.setPaused(false);
    this.input.wantLock = true;
    this.input.requestLock();
    // populate the streets right away
    for (let i = 0; i < 12; i++) this.traffic.trySpawn({ x: p.x, z: p.z });
    for (let i = 0; i < 20; i++) this.peds.trySpawn();
    this.missions.refreshStartMarker();
    const next = this.missions.nextStory();
    if (next && next.autoStart) this.missions.start(next);
    else this.hud.objective(next ? 'Visit <b>Rustam aka</b> (yellow R on the map) for work.' : 'Free roam: explore Toshkent.', 6);
  }

  quitToTitle() {
    this.saveGame();
    if (this.missions.active) this.missions.active.fail('Quit');
    this.missions.stopTaxi();
    this.menu.hidePause();
    this.hud.hide();
    this.state = 'title';
    this.paused = false;
    this.input.wantLock = false;
    this.input.releaseLock();
    this.menu.showTitle(!!loadSave());
  }

  saveGame(manual = false) {
    const p = this.player;
    const weapons = {};
    for (const [k, w] of Object.entries(p.weapons)) if (k !== 'fist') weapons[k] = { ammo: w.ammo, clip: w.clip };
    this.save.money = p.money;
    this.save.weapons = weapons;
    this.save.time = this.env.time;
    writeSave(this.save);
    if (manual) this.audio.cash();
  }

  setPaused(p) {
    this.paused = p;
    this.audio.setPaused(p);
  }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.setPaused(true);
    this.menu.showPause();
    this.input.releaseLock();
  }
  resume() {
    this.menu.hidePause();
    document.getElementById('bigmap').classList.add('hidden');
    this.state = 'playing';
    this.setPaused(false);
    this.input.requestLock();
  }
  openMap() {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this.menu.hidePause();
    this.state = 'map';
    this.setPaused(true);
    this.input.releaseLock();
    document.getElementById('bigmap').classList.remove('hidden');
    this.mapRenderer.openBig();
  }
  setModal(on) {
    if (on) { this.state = 'modal'; this.setPaused(true); this.input.releaseLock(); }
    else { this.state = 'playing'; this.setPaused(false); this.input.requestLock(); }
  }
  // the window refused to lock the mouse: switch to free-cursor look and explain it once
  onLockError() {
    if (this.freeLookHintShown || this.state !== 'playing') return;
    this.freeLookHintShown = true;
    this.canvas.classList.add('freelook');
    const note = 'This window can’t lock the mouse, so the camera follows the cursor: <b>move the mouse</b> to look around and rest it at the <b>left or right edge</b> to keep turning. For full mouse control, play the desktop version (<b>Play.bat</b>).';
    this.hud.setNote(note, 40);
    this.hud.help(note, 12);
  }

  onLockChange(locked) {
    document.getElementById('click-to-play').classList.toggle('hidden', locked || this.state !== 'playing');
    if (!locked && this.state === 'playing' && this.lockLostPauses) this.pause();
    if (locked) this.lockLostPauses = true;
  }

  // ------------------------------------------------------------------ helpers used by systems
  isVisible(x, y, z, r = 1) {
    this.tmpSphere.center.set(x, y, z);
    this.tmpSphere.radius = r;
    return this.frustum.intersectsSphere(this.tmpSphere) && Math.hypot(x - this.camera.position.x, z - this.camera.position.z) < this.settings.drawDistance;
  }
  allNPCs() { return [...this.peds.list, ...this.police.cops, ...this.missionNPCs]; }
  humansForCollision() {
    if (this._hfcFrame === this.frameNo) return this._hfc;
    const list = this.allNPCs();
    if (!this.player.vehicle && !this.player.dead) list.push(this.player);
    this._hfc = list; this._hfcFrame = this.frameNo;
    return list;
  }
  areaName(x, z) {
    let best = null, bd = 900;
    for (const p of this.map.places) {
      if (p.rank < 1) continue;
      const d = Math.hypot(p.x - x, p.z - z) * (p.rank === 2 ? 1.6 : 1);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? best.name : 'Toshkent';
  }
  addMoney(n) {
    this.player.money = Math.max(0, Math.round(this.player.money + n));
    if (n > 0) this.audio?.cash();
  }
  setWaypoint(x, z, mission = false) {
    if (x === null || x === undefined) { this.gps = null; return; }
    const p = this.player.vehicle || this.player;
    const path = this.graph.findPath(p.x, p.z, x, z, true) || this.graph.findPath(p.x, p.z, x, z, false);
    this.gps = { x, z, path: path ? [p.x, p.z, ...path] : [p.x, p.z, x, z], mission, t: 0 };
    if (this.state === 'map') this.mapRenderer.drawBig();
  }
  updateGps(dt) {
    const g = this.gps;
    if (!g) return;
    g.t -= dt;
    const p = this.player.vehicle || this.player;
    if (!g.mission && Math.hypot(p.x - g.x, p.z - g.z) < 25) { this.gps = null; this.hud.notify('You have arrived'); return; }
    if (g.t <= 0) {
      g.t = 1.2;
      const path = this.graph.findPath(p.x, p.z, g.x, g.z, true) || this.graph.findPath(p.x, p.z, g.x, g.z, false);
      if (path) g.path = [p.x, p.z, ...path];
    }
  }

  teleportPlayer(x, z, onFoot = true, label = '') {
    const p = this.player;
    if (onFoot && p.vehicle) p.exitVehicle(true);
    const [fx, fz] = this.collision.findFree(x, z, 0.4, 20);
    p.x = fx; p.z = fz; p.y = 0; p.vx = p.vz = 0;
    this.cameraRig.snapBehind(p.heading);
    // let traffic and pedestrians repopulate around the new location
    for (const d of [...this.traffic.drivers]) if (Math.hypot(d.vehicle.x - fx, d.vehicle.z - fz) > 300 && !d.vehicle.persistent) { this.traffic.remove(d); this.vehicles.remove(d.vehicle); }
    this.peds.list = this.peds.list.filter((h) => h.persistent || Math.hypot(h.x - fx, h.z - fz) < 200);
    for (let i = 0; i < 10; i++) this.traffic.trySpawn({ x: fx, z: fz });
    if (label) this.hud.notify(label);
  }

  // ------------------------------------------------------------------ events
  damageHuman(h, amount, by, kind, dx = 0, dz = 0) {
    if (h.dead) return;
    const p = this.player;
    if (h === p) {
      if (this.godMode) return;
      const absorbed = Math.min(p.armor, amount * 0.75);
      p.armor -= absorbed;
      p.health -= amount - absorbed;
      this.cameraRig.shake(Math.min(0.4, amount / 60));
      this.hud.el.health.animate([{ filter: 'brightness(2)' }, { filter: 'none' }], { duration: 250 });
      if (p.health <= 0) this.playerDied();
      return;
    }
    h.health -= amount;
    if (kind === 'bullet') { h.x += dx * 0.05; h.z += dz * 0.05; }
    const byPlayer = by === p || by === 'player';
    if (h.health <= 0) {
      h.dead = true;
      h.deadTime = 0;
      h.ragdoll = Math.max(h.ragdoll, 0.9);
      h.vx += dx * 2.5; h.vz += dz * 2.5; h.vy = Math.max(h.vy, 1.2);
      h.spinRate = rand(-2, 2);
      if (byPlayer) {
        this.save.stats.kills++;
        if (h.kind === 'cop') { this.save.stats.copsKilled++; this.police.crime('killcop', h.x, h.z, true); }
        else if (h.kind === 'ped') this.police.crime('killped', h.x, h.z);
      }
      if (h.kind === 'ped' && chance(0.65)) this.pickups.spawnMoney(h.x, h.z, Math.round(rand(5, 60)) * 1000);
      if (h.kind === 'cop' && chance(0.5)) this.pickups.add('weapon:pistol', h.x + 0.5, h.z, { respawn: 0 }).ttl = 40;
      if (h.kind === 'enemy' && chance(0.7)) this.pickups.add(choice(['weapon:smg', 'weapon:pistol', 'armor']), h.x, h.z, { respawn: 0 }).ttl = 60;
      for (const o of this.peds.list) if (!o.dead && Math.hypot(o.x - h.x, o.z - h.z) < 20) o.react('fear', h.x, h.z);
      return;
    }
    if (byPlayer) {
      if (h.kind === 'cop') this.police.crime('assaultcop', h.x, h.z, true);
      else if (h.kind === 'ped') this.police.crime('attack', h.x, h.z);
      if (h.kind === 'enemy') h.alerted = true;
    }
    if (h.react) h.react('attacked', by && by.x !== undefined ? by.x : h.x, by && by.z !== undefined ? by.z : h.z, by);
  }

  hitHuman(h, v) {
    if (h.hitCooldown && this.time < h.hitCooldown) return;
    h.hitCooldown = this.time + 0.6;
    const sp = v.speed;
    const dmg = sp * sp * 0.42 + sp * 2;
    h.ragdoll = 1.4 + Math.min(1.2, sp * 0.05);
    h.vx = v.vx * 0.75 + rand(-1, 1); h.vz = v.vz * 0.75 + rand(-1, 1); h.vy = 2 + sp * 0.22;
    h.spinRate = rand(-7, 7);
    h.lie = 0.2;
    this.audio.crash(h.x, h.z, Math.min(0.6, sp / 30));
    this.fx.burst('blood', h.x, 1, h.z, Math.min(10, Math.round(sp)));
    const byPlayer = v.driver === 'player';
    if (h === this.player) { this.damageHuman(h, dmg * (v.typeId === 'police' ? 0.3 : 0.5), v, 'vehicle'); return; }
    const wasAlive = !h.dead;
    this.damageHuman(h, dmg, byPlayer ? this.player : null, 'vehicle', v.vx / (sp || 1), v.vz / (sp || 1));
    if (byPlayer && wasAlive && !h.dead && h.kind === 'ped') this.police.crime('hitped', h.x, h.z);
    v.vx *= 0.94; v.vz *= 0.94;
  }

  ejectDriver(v, carjack) {
    const d = v.driver;
    if (!d || d === 'player') return;
    const door = v.doorPos(-1);
    const [x, z] = this.collision.findFree(door.x, door.z, 0.35, 6);
    if (d.kind === 'traffic') this.traffic.remove(d);
    if (d.kind === 'police') {
      const cop = new Cop(this, x, z, d.unit);
      this.police.cops.push(cop);
      this.police.crime('copcar', v.x, v.z, true);
    } else {
      const ped = new Ped(this, d.look, x, z);
      ped.heading = v.heading + Math.PI / 2;
      ped.ragdoll = carjack ? 0.6 : 0; ped.vx = -Math.cos(v.heading) * 2; ped.vz = Math.sin(v.heading) * 2;
      ped.react(chance(0.15) && !d.look.female ? 'attacked' : 'fear', this.player.x, this.player.z, this.player);
      if (ped.state === 'flee') ped.stateT = 10;
      this.peds.add(ped);
    }
    v.driver = null;
    if (carjack) {
      this.save.stats.carsStolen++;
      this.police.crime('carjack', v.x, v.z);
    }
  }

  onPlayerEnteredVehicle(v) {
    if (v.typeId === 'police') this.police.crime('copcar', v.x, v.z, true);
    if (this.audio.ready) this.hud.radio(this.audio.radio.name);
    this.hud.notify(v.type.name);
    if (v.typeId === 'taxi' || v.typeId === 'damas') this.hud.help(`Press <b>T</b> to start the ${v.typeId === 'taxi' ? 'taxi' : 'marshrutka'} job.`, 5);
  }
  onPlayerExitedVehicle() {}
  onPlayerCarHit(other, impact) {
    if (other.typeId === 'police' && impact > 6) this.police.crime('assaultcop', other.x, other.z, true);
  }

  onGunshot(shooter, x, z) {
    for (const h of this.peds.list) if (!h.dead && Math.abs(h.x - x) < 45 && Math.abs(h.z - z) < 45) h.react('gunshot', x, z, shooter);
    for (const d of this.traffic.drivers) if (Math.abs(d.vehicle.x - x) < 40 && Math.abs(d.vehicle.z - z) < 40) d.panic = Math.max(d.panic, 6);
    if (shooter === this.player) this.police.crime('shots', x, z);
  }

  explosion(x, y, z, radius, by, source) {
    this.fx.explosion(x, y, z, radius / 8);
    this.audio.explosion(x, z);
    const cd = Math.hypot(this.camera.position.x - x, this.camera.position.z - z);
    this.cameraRig.shake(clamp(1.4 - cd / 60, 0, 1.2));
    const byPlayer = by === 'player' || by === this.player;
    for (const h of [...this.allNPCs(), this.player]) {
      if (h.dead || (h === this.player && this.player.vehicle && this.player.vehicle !== source)) continue;
      const d = Math.hypot(h.x - x, h.z - z);
      if (d > radius) continue;
      const f = 1 - d / radius;
      const nx = (h.x - x) / (d || 1), nz = (h.z - z) / (d || 1);
      if (h === this.player && this.player.vehicle === source) { this.player.exitVehicle(true); }
      h.ragdoll = 1.5; h.vx = nx * 9 * f; h.vz = nz * 9 * f; h.vy = 5 * f; h.spinRate = rand(-6, 6);
      this.damageHuman(h, 160 * f + 20, byPlayer ? this.player : null, 'explosion', nx, nz);
    }
    for (const v of this.vehicles.list) {
      if (v === source || v.destroyed) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d > radius * 1.2) continue;
      const f = 1 - d / (radius * 1.2);
      v.vx += ((v.x - x) / (d || 1)) * 8 * f; v.vz += ((v.z - z) / (d || 1)) * 8 * f;
      v.damage(900 * f, byPlayer ? 'player' : null);
    }
    if (this.police.heli && Math.hypot(this.police.heli.x - x, this.police.heli.z - z) < radius * 2) this.police.heli.health -= 400;
    for (const h of this.peds.list) if (!h.dead && Math.hypot(h.x - x, h.z - z) < 70) h.react('explosion', x, z);
    if (byPlayer) this.police.crime('explosion', x, z);
  }

  respray(v) {
    const cost = 100000;
    if (this.police.level > 0 && this.police.seen) { this.hud.notify('Not while the police are watching!', 'bad'); return; }
    if (this.player.money < cost) { this.hud.notify(`Moyka costs ${formatMoney(cost)} so‘m`, 'bad'); return; }
    this.addMoney(-cost);
    v.paint = this.pickups.randomPaint(v);
    v.material.userData.u.uPaint.value.set(cutePaint(v.paint));
    v.health = v.maxHealth; v.burnTime = 0;
    const had = this.police.level > 0;
    this.police.clear();
    this.hud.big('MOYKA', had ? 'New paint, new plates. The police lost you.' : 'Washed, repaired and repainted.', 3, '');
    this.audio.cash();
  }

  playerDied() {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    p.health = 0;
    if (p.vehicle) p.exitVehicle(true);
    p.ragdoll = Math.max(p.ragdoll, 1);
    this.save.stats.wasted++;
    this.canvas.classList.add('wasted');
    this.hud.big('WASTED', '', 5, 'red');
    this.audio.wasted();
    this.missions.stopTaxi();
    this.deathT = 5.5;
    this.deathKind = 'wasted';
  }

  bustPlayer() {
    const p = this.player;
    if (p.dead || this.bustedActive) return;
    this.bustedActive = true;
    if (p.vehicle) p.exitVehicle(true);
    p.vx = p.vz = 0;
    p.pose = POSE.HANDSUP;
    this.save.stats.busted++;
    this.canvas.classList.add('busted');
    this.hud.big('BUSTED', '', 5, 'blue');
    this.audio.missionFailed();
    this.missions.stopTaxi();
    this.deathT = 5.5;
    this.deathKind = 'busted';
  }

  respawn() {
    const p = this.player;
    const kind = this.deathKind;
    const list = kind === 'busted' ? this.map.police : this.map.hospitals;
    let best = list[0], bd = Infinity;
    for (const s of list) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; best = s; } }
    const [x, z] = this.pickups.spotNear(best.x, best.z);
    this.police.resetAll();
    this.police.maxLevelThisLife = 0;
    const fee = kind === 'busted' ? Math.min(p.money, Math.max(20000, Math.round(p.money * 0.06))) : Math.min(p.money, Math.max(15000, Math.round(p.money * 0.05)));
    p.money -= fee;
    if (kind === 'busted') p.removeWeapons(false); else p.removeWeapons(true);
    p.dead = false; p.health = 100; p.armor = 0; p.lie = 0; p.ragdoll = 0; p.spin = 0; p.vy = 0;
    this.bustedActive = false;
    this.canvas.classList.remove('wasted', 'busted');
    this.env.time = (this.env.time + 180) % 1440;
    this.teleportPlayer(x, z, true);
    this.hud.hideBig();
    this.hud.notify(`${kind === 'busted' ? 'Bail' : 'Hospital bill'}: -${formatMoney(fee)} so‘m`, 'bad');
    this.hud.subtitle('', kind === 'busted' ? `Released from ${best.name || 'the police station'}` : `Discharged from ${best.name || 'hospital'}`, 4);
    this.saveGame();
  }

  applyQuality() {
    const before = this.renderer.shadowMap.enabled;
    this.env.applyShadowSettings();
    if (before !== this.renderer.shadowMap.enabled) this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  }

  // internal pixel resolution from Settings, scaled up to the screen by a whole number
  onResize() {
    this.pixel.resize(this.settings.pixelRes);
    this.camera.aspect = this.pixel.width / this.pixel.height;
    this.camera.updateProjectionMatrix();
    this.fx?.setScale(this.pixel.height, this.camera.fov);
  }

  // ------------------------------------------------------------------ cheats (type them while playing)
  cheats() {
    const I = this.input, p = this.player;
    if (I.cheat('PULKERAK')) { this.addMoney(1000000); this.hud.notify('Cheat: +1 000 000 so‘m', 'money'); }
    else if (I.cheat('SALOMAT')) { p.health = 100; p.armor = 100; this.hud.notify('Cheat: health & armour'); }
    else if (I.cheat('QUROLLAR')) { for (const id of ['pistol', 'smg', 'shotgun', 'ak']) p.giveWeapon(id, WEAPONS[id].clip * 5); this.hud.notify('Cheat: weapons'); }
    else if (I.cheat('TINCHLIK')) { this.police.clear(); this.hud.notify('Cheat: wanted level cleared'); }
    else if (I.cheat('POLITSIYA')) { this.police.addHeat(5); this.hud.notify('Cheat: police!'); }
    else if (I.cheat('TUNGI')) { this.env.time = 22 * 60; this.hud.notify('Cheat: night'); }
    else if (I.cheat('KUNDUZ')) { this.env.time = 12 * 60; this.hud.notify('Cheat: midday'); }
    else if (I.cheat('MOSHINA')) {
      const t = p.vehicle || p;
      const h = t.heading;
      const x = t.x + Math.sin(h) * 6, z = t.z + Math.cos(h) * 6;
      if (this.collision.isFree(x, z, 1.1)) { this.vehicles.spawn('sport', x, z, h, { paint: 0xd81f26 }); this.hud.notify('Cheat: Samarqand GT'); }
    }
  }

  // advance the game manually (debugging/automation when the window is hidden)
  tick(seconds = 1, render = true) {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      this.input.pollPad();
      if (this.state === 'title') this.titleCamera(STEP);
      if (this.state === 'playing' || this.state === 'title') this.step(STEP);
      if (render && i % 6 === 5) this.frame(STEP * 6, STEP * 6);
      this.input.endFrame();
    }
    if (render) this.frame(STEP, STEP);
    this.lastFrame = performance.now();
  }

  // ------------------------------------------------------------------ main loop
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.frameNo = (this.frameNo || 0) + 1;
    if (this.state === 'title') this.titleCamera(dt);
    const simulate = this.state === 'playing' || this.state === 'title';
    this.input.pollPad();
    this.input.lookActive = this.state === 'playing';
    if (this.state === 'playing' || this.state === 'map' || this.state === 'paused') this.handleGlobalKeys();
    const t0 = performance.now();
    let steps = 0;
    if (simulate) {
      this.acc += dt;
      while (this.acc >= STEP && steps < 4) {
        this.step(STEP);
        // key presses/clicks are consumed by exactly one simulation step
        if (steps === 0) this.input.endFrame();
        this.acc -= STEP;
        steps++;
      }
      if (steps === 4) this.acc = 0;
    }
    const t1 = performance.now();
    this.frame(simulate ? dt : 0, dt);
    const t2 = performance.now();
    this.perf = this.perf || { sim: 0, frame: 0 };
    this.perf.sim += (t1 - t0 - this.perf.sim) * 0.05;
    this.perf.frame += (t2 - t1 - this.perf.frame) * 0.05;
    if (!simulate) this.input.endFrame();
  }

  handleGlobalKeys() {
    const I = this.input;
    if (this.state === 'map') {
      if (I.was('map') || I.pressed.has('Escape')) this.resume();
      return;
    }
    if (this.state === 'paused') {
      if (I.pressed.has('Escape') || I.pressed.has('KeyP')) this.resume();
      return;
    }
    if (I.was('pause')) { this.pause(); return; }
    if (I.was('map')) { this.openMap(); return; }
  }

  step(dt) {
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    const p = this.player;
    const playing = this.state === 'playing';
    this.input.enabled = playing && !p.dead && !this.bustedActive && !p.frozen;
    if (playing) {
      if (!p.dead && !this.bustedActive) p.update(dt, this.input);
      else if (p.dead) { const hold = p.ragdoll; if (hold > 0) { p.ragdoll -= dt; p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 0.95; p.vz *= 0.95; } p.lie = Math.min(1, p.lie + dt * 3); }
      if (p.frozen && p.vehicle) { p.vehicle.ctrl.throttle = 0; p.vehicle.ctrl.handbrake = true; }
      if (!p.vehicle && p.ragdoll > 0 && !p.dead) {
        p.ragdoll -= dt; p.vy -= 20 * dt; p.x += p.vx * dt; p.z += p.vz * dt; p.y = Math.max(0, p.y + p.vy * dt);
        p.vx *= Math.exp(-3 * dt); p.vz *= Math.exp(-3 * dt);
        p.lie = Math.min(1, p.lie + dt * 4);
        const o = { x: 0, z: 0, nx: 0, nz: 0 };
        if (this.collision.collideCircle(p.x, p.z, p.radius, o)) { p.x = o.x; p.z = o.z; }
      } else if (!p.dead && p.lie > 0 && !p.vehicle) p.lie = Math.max(0, p.lie - dt * 2.5);
    }
    this.traffic.update(dt);
    this.peds.update(dt);
    this.police.update(dt);
    for (const h of this.missionNPCs) h.update(dt);
    if (playing) this.missions.update(dt);
    this.vehicles.update(dt);
    if (playing) {
      this.pickups.update(dt);
      this.updateGps(dt);
      this.cheats();
      const st = this.save.stats;
      st.playTime += dt;
      if (p.vehicle) st.distance += p.vehicle.speed * dt;
      st.maxWanted = Math.max(st.maxWanted, this.police.level);
      if (this.deathT > 0) { this.deathT -= dt; if (this.deathT <= 0) this.respawn(); }
      this.autoSaveT = (this.autoSaveT || 0) + dt;
      if (this.autoSaveT > 60) { this.autoSaveT = 0; this.saveGame(); }
      // aiming a gun at people scares them
      if (p.aiming && !p.vehicle) {
        const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
        for (const h of this.peds.list) {
          const dx = h.x - p.x, dz = h.z - p.z, d = Math.hypot(dx, dz);
          if (d < 15 && (dx * fx + dz * fz) / (d || 1) > 0.9) h.react('aimed', p.x, p.z);
        }
      }
    }
  }

  titleCamera(dt) {
    this.titleT += dt;
    const L = this.map.landmarks.find((l) => l.id === 'temur');
    const a = this.titleT * 0.05;
    const r = 170;
    this.camera.position.set(L.x + Math.cos(a) * r, 55 + Math.sin(this.titleT * 0.1) * 10, L.z + Math.sin(a) * r);
    this.camera.lookAt(L.x, 12, L.z);
    this.player.x = L.x + 40; this.player.z = L.z + 40;
    this.player.visible = false;
  }

  frame(dt, realDt) {
    const p = this.player;
    this.renderer.info.reset();
    if (this.state !== 'title') {
      p.visible = true;
      if (this.debugCam) {
        const d = this.debugCam;
        this.camera.position.set(d.x, d.y, d.z);
        this.camera.lookAt(d.tx, d.ty, d.tz);
      } else this.cameraRig.update(realDt, this.input, this.settings);
    }
    this.camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const focus = p.vehicle ? new THREE.Vector3(p.vehicle.x, 0, p.vehicle.z) : new THREE.Vector3(p.x, 0, p.z);
    if (this.state === 'title') focus.set(this.camera.position.x, 0, this.camera.position.z);
    this.env.update(dt, focus);
    this.env.followCamera(this.camera);
    const night = this.env.night;
    this.city.update(realDt, this.camera, this.settings.drawDistance, night);
    this.signalT = (this.signalT || 0) - realDt;
    if (this.signalT <= 0) { this.signalT = 0.25; this.city.updateSignals(this.time); }
    this.landmarks.update(realDt, night);
    // people
    const R = this.humanRenderer;
    R.begin();
    if (this.state !== 'title') R.push(p);
    const cx = this.camera.position.x, cz = this.camera.position.z, maxD = Math.min(this.settings.drawDistance, 260);
    for (const list of [this.peds.list, this.police.cops, this.missionNPCs]) for (const h of list) if (Math.abs(h.x - cx) < maxD && Math.abs(h.z - cz) < maxD) R.push(h);
    R.end();
    // effects
    this.fx.update(dt);
    for (const v of this.vehicles.list) {
      if (!v.skid && !this.fx.lastSkid.has(v.id * 4)) continue;
      for (let k = 0; k < 2; k++) {
        const w = v.wheels[2 + k];
        const pos = v.local(w[0], w[1]);
        this.fx.skid(v.id * 4 + k, pos.x, pos.z, !!v.skid && v.speed > 4);
      }
    }
    if (this.kazans && Math.hypot(this.kazans[0][0] - p.x, this.kazans[0][1] - p.z) < 180 && Math.random() < dt * 6) {
      const k = choice(this.kazans);
      this.fx.spawn('steam', k[0] + rand(-0.5, 0.5), 1.7, k[1] + rand(-0.5, 0.5));
    }
    // player headlights at night
    const v = p.vehicle;
    if (v && night > 0.3 && !v.destroyed) {
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      this.headLight.position.set(v.x + fx * (v.type.L / 2), 0.9, v.z + fz * (v.type.L / 2));
      this.headLight.target.position.set(v.x + fx * 25, 0, v.z + fz * 25);
      this.headLight.target.updateMatrixWorld();
      this.headLight.intensity = 1600 * night;
      if (this.settings.quality !== 'high') {
        this.headGlow.visible = true;
        this.headGlow.position.set(v.x + fx * (v.type.L / 2 + 7.5), 0.04, v.z + fz * (v.type.L / 2 + 7.5));
        this.headGlow.rotation.y = v.heading;
        this.headGlow.material.opacity = 0.55 * night;
      }
    } else { this.headLight.intensity = 0; this.headGlow.visible = false; }
    if (this.state !== 'title') {
      this.hud.update(realDt);
      this.mapRenderer.updateMini(realDt);
    }
    this.audio.update(realDt);
    this.pixel.render(this.scene, this.camera);
  }
}
