// Pickups (health, armour, weapons, money, golden non) and interactive places
// (Moyka car washes, metro stations, the safehouse) plus GTA-style glowing markers.
import * as THREE from 'three';
import { mulberry32, ringCentroid, ringArea, choice } from '../util/math.js';
import { WEAPONS } from './weapons.js';
import { VTYPES } from './vehicleModels.js';

const MARKER_VERT = /* glsl */ `
varying float vH;
void main() { vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const MARKER_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform float uOpacity;
varying float vH;
void main() {
  float a = (1.0 - vH) * (0.55 + 0.15 * sin(uTime * 4.0)) * uOpacity;
  gl_FragColor = vec4(uColor * 1.4, a);
  #include <colorspace_fragment>
}`;

const markerGeo = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true); g.translate(0, 0.5, 0); return g; })();
const markerMats = new Map();
function markerMaterial(hex) {
  if (!markerMats.has(hex)) {
    markerMats.set(hex, new THREE.ShaderMaterial({
      vertexShader: MARKER_VERT, fragmentShader: MARKER_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(hex) }, uTime: { value: 0 }, uOpacity: { value: 1 } },
    }));
  }
  return markerMats.get(hex);
}

export const MARKER_COLORS = { mission: 0xf4c542, objective: 0xffd23f, wash: 0xff5fc8, metro: 0x3d8bff, home: 0x5fe07a, race: 0xff8a2a };

export class Marker {
  constructor(game, x, z, kind = 'objective', radius = 1.6, height = 1.4) {
    this.game = game; this.x = x; this.z = z; this.kind = kind; this.radius = radius;
    this.mesh = new THREE.Mesh(markerGeo, markerMaterial(MARKER_COLORS[kind] ?? MARKER_COLORS.objective));
    this.mesh.position.set(x, 0.02, z);
    this.mesh.scale.set(radius, height, radius);
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    game.scene.add(this.mesh);
  }
  setPos(x, z) { this.x = x; this.z = z; this.mesh.position.set(x, 0.02, z); }
  near(px, pz, extra = 0) { return Math.hypot(px - this.x, pz - this.z) < this.radius + extra; }
  update() { this.mesh.visible = Math.hypot(this.game.camera.position.x - this.x, this.game.camera.position.z - this.z) < 600; }
  dispose() { this.game.scene.remove(this.mesh); }
}

// ------------------------------------------------------------------ pickup models
function buildPickupGeometries() {
  const mk = (parts) => {
    const geos = parts.map(([x, y, z, sx, sy, sz, hex, shape]) => {
      const g = shape === 'cyl' ? new THREE.CylinderGeometry(sx, sx, sy, 20) : new THREE.BoxGeometry(sx, sy, sz);
      g.translate(x, y, z);
      const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    });
    const pos = [], nrm = [], col = [], idx = [];
    for (const g of geos) {
      const base = pos.length / 3;
      pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); col.push(...g.attributes.color.array);
      for (const i of g.index.array) idx.push(base + i);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.setIndex(idx);
    return out;
  };
  return {
    health: mk([[0, 0, 0, 0.6, 0.2, 0.2, 0x3ddc5a], [0, 0, 0, 0.2, 0.6, 0.2, 0x3ddc5a]]),
    armor: mk([[0, 0, 0, 0.55, 0.65, 0.18, 0x2f6fd8], [0, 0.32, 0, 0.3, 0.1, 0.19, 0x1d4a9a]]),
    weapon: mk([[0, 0, 0, 0.1, 0.18, 0.55, 0x1c1c1e], [0, -0.14, -0.15, 0.09, 0.22, 0.1, 0x2c2c2e], [0, -0.05, 0.18, 0.06, 0.06, 0.4, 0x3a3a3c]]),
    money: mk([[0, 0, 0, 0.42, 0.14, 0.24, 0x4c9a4c], [0, 0.0, 0, 0.44, 0.06, 0.1, 0xe8e2c0]]),
    non: mk([[0, 0, 0, 0.36, 0.14, 0, 0xe2b13c, 'cyl'], [0, 0.07, 0, 0.18, 0.03, 0, 0xf6d36a, 'cyl']]),
    item: mk([[0, 0, 0, 0.5, 0.5, 0.5, 0xf4c542]]),
  };
}

export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.geos = buildPickupGeometries();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x222222 });
    this.goldMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.25, emissive: 0x3a2a00 });
    this.places = [];
    this.t = 0;
  }

  add(type, x, z, opts = {}) {
    const geo = this.geos[type === 'non' ? 'non' : type.startsWith('weapon') ? 'weapon' : type] || this.geos.item;
    const mesh = new THREE.Mesh(geo, type === 'non' ? this.goldMat : this.mat);
    mesh.position.set(x, 0.8, z);
    if (type === 'non') mesh.rotation.x = Math.PI / 2;
    this.game.scene.add(mesh);
    const p = { type, x, z, mesh, active: true, respawn: opts.respawn ?? 0, timer: 0, value: opts.value || 0, id: opts.id, onPick: opts.onPick, phase: Math.random() * 6 };
    if (opts.beacon) { p.marker = new Marker(this.game, x, z, opts.beacon, 0.9, 2.5); }
    this.list.push(p);
    return p;
  }

  remove(p) {
    p.removed = true;
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    this.game.scene.remove(p.mesh);
    p.marker?.dispose();
  }

  spawnMoney(x, z, amount) { this.add('money', x + (Math.random() - 0.5), z + (Math.random() - 0.5), { value: amount, respawn: 0 }).ttl = 60; }

  // sidewalk spot near a point
  spotNear(x, z) {
    const G = this.game.graph;
    const n = G.nearest(x, z, 120);
    if (!n) return this.game.collision.findFree(x, z, 0.5, 30);
    const pt = G.pointAt(n.ei, n.s, 1, {});
    const off = G.sidewalkOffset(n.ei);
    const side = (x - n.x) * -pt.tz + (z - n.z) * pt.tx >= 0 ? 1 : -1;
    const px = n.x - pt.tz * off * side, pz = n.z + pt.tx * off * side;
    return this.game.collision.findFree(px, pz, 0.6, 20);
  }

  setupWorld(save) {
    const g = this.game, m = g.map;
    const L = Object.fromEntries(m.landmarks.map((l) => [l.id, l]));
    // health at hospitals, armour at police stations
    m.hospitals.slice(0, 8).forEach((h) => { const [x, z] = this.spotNear(h.x, h.z); this.add('health', x, z, { respawn: 90 }); });
    m.police.slice(0, 4).forEach((h) => { const [x, z] = this.spotNear(h.x, h.z); this.add('armor', x, z, { respawn: 120 }); });
    const weaponSpots = [['weapon:smg', 'chorsu', 30, 25], ['weapon:shotgun', 'tvtower', 45, -30], ['weapon:ak', 'tashkentcity', -40, 30], ['weapon:pistol', 'mustaqillik', 20, 0],
      ['weapon:smg', 'magiccity', 0, 40], ['weapon:pistol', 'hazratimam', 40, 0], ['armor', 'hoteluz', -30, 20], ['health', 'temur', 30, -30]];
    for (const [type, lid, dx, dz] of weaponSpots) {
      const l = L[lid];
      if (!l) continue;
      const [x, z] = this.spotNear(l.x + dx, l.z + dz);
      this.add(type, x, z, { respawn: 150 });
    }
    // golden non collectibles in parks and quiet streets
    const rnd = mulberry32(2026);
    const spots = [];
    const parks = m.greens.filter((gr) => gr.kind === 0 && Math.abs(ringArea(gr.ring)) > 1500);
    let guard = 0;
    while (spots.length < 20 && guard++ < 4000) {
      let x, z;
      if (rnd() < 0.55 && parks.length) {
        const pk = parks[Math.floor(rnd() * parks.length)];
        [x, z] = ringCentroid(pk.ring);
        x += (rnd() - 0.5) * 20; z += (rnd() - 0.5) * 20;
      } else {
        const b = m.bounds;
        x = b.minX + 150 + rnd() * (b.maxX - b.minX - 300); z = b.minZ + 150 + rnd() * (b.maxZ - b.minZ - 300);
        [x, z] = this.spotNear(x, z);
      }
      if (x < m.bounds.minX + 60 || x > m.bounds.maxX - 60 || z < m.bounds.minZ + 60 || z > m.bounds.maxZ - 60) continue;
      if (!g.collision.isFree(x, z, 0.6)) continue;
      if (spots.some(([a, c]) => Math.hypot(a - x, c - z) < 420)) continue;
      spots.push([x, z]);
    }
    this.nonTotal = spots.length;
    spots.forEach(([x, z], i) => { if (!save.non.includes(i)) this.add('non', x, z, { id: i }); });
    // places
    m.carWashes.forEach((w) => {
      const n = g.graph.nearest(w.x, w.z, 80);
      const x = n ? (w.x * 0.5 + n.x * 0.5) : w.x, z = n ? (w.z * 0.5 + n.z * 0.5) : w.z;
      const [fx, fz] = g.collision.findFree(x, z, 1.6, 25);
      this.places.push({ type: 'wash', name: 'Moyka', x: fx, z: fz, marker: new Marker(g, fx, fz, 'wash', 3.2, 1.2), cool: 0 });
    });
    for (const s of g.city.metroSigns || []) {
      if (this.places.some((p) => p.type === 'metro' && p.name === s.name && Math.hypot(p.x - s.x, p.z - s.z) < 60)) continue;
      this.places.push({ type: 'metro', name: s.name, x: s.x, z: s.z, marker: new Marker(g, s.x, s.z, 'metro', 1.0, 1.0) });
    }
    const home = g.safehouse;
    this.places.push({ type: 'home', name: 'Safehouse', x: home.x, z: home.z, marker: new Marker(g, home.x, home.z, 'home', 1.1, 1.2) });
  }

  collect(p) {
    const g = this.game, pl = g.player;
    const t = p.type;
    if (t === 'health') { if (pl.health >= pl.maxHealth) return false; pl.health = pl.maxHealth; g.hud.notify('+ Health', 'money'); }
    else if (t === 'armor') { if (pl.armor >= 100) return false; pl.armor = 100; g.hud.notify('+ Armour', 'money'); }
    else if (t.startsWith('weapon:')) {
      const id = t.split(':')[1];
      const def = WEAPONS[id];
      pl.giveWeapon(id, def.clip * (id === 'pistol' ? 3 : 2));
      g.hud.notify(`${def.name} +${def.clip * (id === 'pistol' ? 3 : 2)}`);
    } else if (t === 'money') { g.addMoney(p.value); g.fx.burst('money', p.x, 1, p.z, 6); }
    else if (t === 'non') {
      g.save.non.push(p.id);
      const n = g.save.non.length;
      g.addMoney(50000);
      g.hud.big(`OLTIN NON ${n}/${this.nonTotal}`, 'Golden bread found!', 2.5, '');
      if (n === this.nonTotal) { g.addMoney(1000000); g.hud.notify('All golden non found! +1 000 000 so‘m', 'money'); }
      g.saveGame();
    } else if (p.onPick) p.onPick();
    g.audio?.pickup();
    return true;
  }

  update(dt) {
    const g = this.game, pl = g.player;
    this.t += dt;
    for (const m of markerMats.values()) m.uniforms.uTime.value = this.t;
    const px = pl.x, pz = pl.z;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.ttl !== undefined) { p.ttl -= dt; if (p.ttl <= 0) { this.remove(p); continue; } }
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) { p.active = true; p.mesh.visible = true; }
        continue;
      }
      const near = Math.hypot(p.x - g.camera.position.x, p.z - g.camera.position.z) < 220;
      p.mesh.visible = near;
      if (near) {
        p.mesh.position.y = 0.85 + Math.sin(this.t * 2.5 + p.phase) * 0.12;
        if (p.type === 'non') p.mesh.rotation.z += dt * 2; else p.mesh.rotation.y += dt * 2;
      }
      p.marker?.update();
      if (pl.dead) continue;
      const reach = pl.vehicle ? 2.6 : 1.3;
      const allowVehicle = p.type === 'money' || p.type === 'non' || p.type === 'health';
      if ((!pl.vehicle || allowVehicle) && Math.hypot(p.x - px, p.z - pz) < reach) {
        if (!this.collect(p)) continue;
        if (p.respawn > 0) { p.active = false; p.timer = p.respawn; p.mesh.visible = false; }
        else this.remove(p);
      }
    }
    this.updatePlaces(dt);
  }

  updatePlaces(dt) {
    const g = this.game, pl = g.player;
    let hint = null;
    for (const pc of this.places) {
      pc.marker.update();
      if (pc.cool > 0) pc.cool -= dt;
      const d = Math.hypot(pc.x - pl.x, pc.z - pl.z);
      if (pc.type === 'wash' && pl.vehicle && d < 4 && pc.cool <= 0) {
        pc.cool = 6;
        g.respray(pl.vehicle);
      } else if (pc.type === 'metro' && !pl.vehicle && d < 2.2) {
        hint = `Press <kbd>E</kbd> to ride the metro from ${pc.name}`;
        if (g.input.was('use')) g.menu.openMetro(pc);
      } else if (pc.type === 'home' && !pl.vehicle && d < 2) {
        hint = 'Press <kbd>E</kbd> to save the game';
        if (g.input.was('use')) { g.saveGame(true); g.hud.notify('Game saved', 'money'); }
      }
    }
    g.hud.hint(hint);
  }

  // nearest metro stations for the fast-travel menu
  metroStations() { return this.places.filter((p) => p.type === 'metro'); }

  randomPaint(v) {
    const T = VTYPES[v.typeId];
    let c = choice(T.colors.length > 1 ? T.colors : [0xd81f26, 0x2f73c9, 0x1c1e21, 0xf1f1ee, 0x355e3b]);
    if (c === v.paint) c = 0x6a1e24;
    return c;
  }
}
