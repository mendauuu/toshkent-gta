// Rotating radar minimap and the full-screen map with GPS waypoints.
import { formatMoney } from '../util/math.js';

const SCALE = 2.2; // metres per pixel of the pre-rendered map

export class MapRenderer {
  constructor(game) {
    this.game = game;
    const m = game.map, s = m.scenery;
    this.minX = s.minX; this.minZ = s.minZ;
    this.w = Math.ceil((s.maxX - s.minX) / SCALE);
    this.h = Math.ceil((s.maxZ - s.minZ) / SCALE);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.render();
    this.mini = document.getElementById('minimap');
    this.mctx = this.mini.getContext('2d');
    this.big = document.getElementById('bigmap-canvas');
    this.bctx = this.big.getContext('2d');
    this.view = { cx: 0, cz: 0, zoom: 0.35 };
    this.miniT = 0;
    this.setupBigMap();
  }

  px(x) { return (x - this.minX) / SCALE; }
  pz(z) { return (z - this.minZ) / SCALE; }

  render() {
    const g = this.canvas.getContext('2d'), m = this.game.map;
    g.fillStyle = '#28322d';
    g.fillRect(0, 0, this.w, this.h);
    const poly = (ring, holes = []) => {
      g.beginPath();
      for (const r of [ring, ...holes]) {
        for (let i = 0; i < r.length; i += 2) { const x = this.px(r[i]), y = this.pz(r[i + 1]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.closePath();
      }
      g.fill('evenodd');
    };
    const line = (pts) => { g.beginPath(); for (let i = 0; i < pts.length; i += 2) { const x = this.px(pts[i]), y = this.pz(pts[i + 1]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); };
    g.fillStyle = '#31503a';
    for (const gr of m.greens) poly(gr.ring, gr.holes);
    g.fillStyle = '#3a3e3d';
    for (const p of m.plazas) poly(p.ring, p.holes);
    g.fillStyle = '#2b6290';
    for (const w of m.water) poly(w.ring, w.holes);
    g.strokeStyle = '#2b6290'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const w of m.waterways) { g.lineWidth = Math.max(1, w.w / SCALE); line(w.pts); }
    g.fillStyle = '#4b5155';
    for (const b of m.buildings) if (b.render || b.solid) poly(b.ring, b.holes);
    const order = [4, 3, 2, 1, 0];
    const col = ['#e2cf8c', '#b9c0c3', '#80888b', '#6b6f6c', '#575d5a'];
    for (const cls of order) {
      g.strokeStyle = col[cls];
      for (const r of m.roads) {
        if (r.cls !== cls) continue;
        g.lineWidth = Math.max(cls >= 3 ? 0.8 : 1.4, r.w / SCALE);
        line(r.pts);
      }
    }
    g.strokeStyle = '#777'; g.setLineDash([3, 3]); g.lineWidth = 1.2;
    for (const r of m.rails) line(r.pts);
    g.setLineDash([]);
  }

  // ------------------------------------------------------------ blips
  blips() {
    const g = this.game, out = [];
    const ms = g.missions;
    for (const b of ms.blips()) out.push(b);
    for (const pc of g.pickups.places) out.push({ x: pc.x, z: pc.z, kind: pc.type, short: true });
    for (const p of g.pickups.list) if (p.type === 'non' && Math.hypot(p.x - g.player.x, p.z - g.player.z) < 90) out.push({ x: p.x, z: p.z, kind: 'non', short: true });
    for (const u of g.police.units) if (!u.vehicle.destroyed) out.push({ x: u.vehicle.x, z: u.vehicle.z, kind: 'cop' });
    for (const c of g.police.cops) if (!c.dead) out.push({ x: c.x, z: c.z, kind: 'copfoot' });
    if (g.police.heli) out.push({ x: g.police.heli.x, z: g.police.heli.z, kind: 'heli' });
    if (g.gps) out.push({ x: g.gps.x, z: g.gps.z, kind: 'waypoint' });
    return out;
  }

  drawBlip(c, kind, x, y, s = 1, t = 0) {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    c.lineWidth = 2;
    c.strokeStyle = '#000';
    const dot = (fill, r = 6) => { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); c.stroke(); };
    const letter = (fill, ch, r = 9) => { dot(fill, r); c.fillStyle = '#111'; c.font = 'bold 12px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, 0, 1); };
    switch (kind) {
      case 'mission': letter('#f4c542', 'R'); break;
      case 'target': dot('#ffd23f', 7); break;
      case 'enemy': dot('#e5413a', 5); break;
      case 'friend': dot('#4fb3ff', 5); break;
      case 'vehicleTarget': c.fillStyle = '#4fb3ff'; c.fillRect(-6, -6, 12, 12); c.strokeRect(-6, -6, 12, 12); break;
      case 'race': letter('#ff8a2a', '★', 8); break;
      case 'wash': letter('#ff5fc8', '$', 8); break;
      case 'metro': letter('#3d8bff', 'M', 7); break;
      case 'home': letter('#5fe07a', 'H', 8); break;
      case 'hospital': letter('#ff5252', '+', 7); break;
      case 'policeStation': letter('#4d8fe8', 'P', 7); break;
      case 'non': dot('#f6d36a', 4); break;
      case 'cop': dot(Math.sin(t * 10) > 0 ? '#2f6bff' : '#ff3030', 6); break;
      case 'copfoot': dot(Math.sin(t * 10) > 0 ? '#2f6bff' : '#ff3030', 4); break;
      case 'heli': dot('#2f6bff', 8); break;
      case 'waypoint': c.fillStyle = '#c86bff'; c.beginPath(); c.moveTo(0, -9); c.lineTo(7, 0); c.lineTo(0, 9); c.lineTo(-7, 0); c.closePath(); c.fill(); c.stroke(); break;
      default: dot('#fff', 4);
    }
    c.restore();
  }

  playerArrow(c, x, y, ang, s = 1) {
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.scale(s, s);
    c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 8); c.lineTo(0, 4); c.lineTo(-7, 8); c.closePath();
    c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#000'; c.stroke();
    c.restore();
  }

  // ------------------------------------------------------------ minimap
  updateMini(dt) {
    this.miniT -= dt;
    if (this.miniT > 0) return;
    this.miniT = 1 / 30;
    const g = this.game, p = g.player, c = this.mctx;
    const W = this.mini.width, R = W / 2;
    const v = p.vehicle;
    const speed = v ? v.speed : 0;
    const metresRadius = 150 + Math.min(speed * 8, 260);
    const k = R / metresRadius; // pixels per metre
    const rot = g.cameraRig.yaw + Math.PI;
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#28322d'; c.fillRect(0, 0, W, W);
    c.translate(R, R);
    c.rotate(rot);
    const s = k * SCALE;
    c.scale(s, s);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.canvas, -this.px(p.x), -this.pz(p.z));
    // GPS route
    if (g.gps && g.gps.path) {
      c.strokeStyle = '#c86bff'; c.lineWidth = 7 / s; c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath();
      const P = g.gps.path;
      for (let i = 0; i < P.length; i += 2) { const x = this.px(P[i]) - this.px(p.x), y = this.pz(P[i + 1]) - this.pz(p.z); if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
    }
    c.restore();
    // blips (unrotated drawing at rotated positions)
    const cos = Math.cos(rot), sin = Math.sin(rot);
    for (const b of this.blips()) {
      const dx = (b.x - p.x) * k, dz = (b.z - p.z) * k;
      let sx = dx * cos - dz * sin, sy = dx * sin + dz * cos;
      const d = Math.hypot(sx, sy);
      if (d > R - 10) { if (b.short) continue; sx *= (R - 10) / d; sy *= (R - 10) / d; }
      this.drawBlip(c, b.kind, R + sx, R + sy, 1.15, g.time);
    }
    // north marker
    const nx = -Math.sin(rot) * 0, ny = -1;
    const n2x = nx * cos - ny * sin, n2y = nx * sin + ny * cos;
    c.save();
    c.fillStyle = '#fff'; c.font = 'bold 15px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const nr = R - 13;
    c.beginPath(); c.arc(R + n2x * nr, R + n2y * nr, 10, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fill();
    c.fillStyle = '#fff'; c.fillText('N', R + n2x * nr, R + n2y * nr + 1);
    c.restore();
    // player arrow: heading relative to map rotation
    const hx = Math.sin(p.heading), hz = Math.cos(p.heading);
    const ax = hx * cos - hz * sin, ay = hx * sin + hz * cos;
    this.playerArrow(c, R, R, Math.atan2(ax, -ay), 1.1);
  }

  // ------------------------------------------------------------ full map
  setupBigMap() {
    const cv = this.big;
    let drag = null;
    cv.addEventListener('mousedown', (e) => {
      if (e.button === 2) { this.game.setWaypoint(null); return; }
      drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false };
      cv.style.cursor = 'grabbing';
    });
    addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      this.view.cx = drag.cx - dx / this.view.zoom;
      this.view.cz = drag.cz - dy / this.view.zoom;
      this.drawBig();
    });
    addEventListener('mouseup', (e) => {
      if (!drag) return;
      if (!drag.moved && e.button === 0) {
        const r = cv.getBoundingClientRect();
        const wx = this.view.cx + (e.clientX - r.left - r.width / 2) / this.view.zoom;
        const wz = this.view.cz + (e.clientY - r.top - r.height / 2) / this.view.zoom;
        this.game.setWaypoint(wx, wz);
      }
      drag = null;
      cv.style.cursor = 'grab';
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.view.zoom = Math.max(0.12, Math.min(4, this.view.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
      this.drawBig();
    }, { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  openBig() {
    const p = this.game.player;
    this.view.cx = p.x; this.view.cz = p.z;
    this.big.width = innerWidth; this.big.height = innerHeight;
    this.view.zoom = Math.max(this.view.zoom, Math.min(innerWidth, innerHeight) / 2600);
    this.drawBig();
  }

  drawBig() {
    const g = this.game, c = this.bctx, cv = this.big, z = this.view.zoom;
    c.fillStyle = '#1b2420';
    c.fillRect(0, 0, cv.width, cv.height);
    const toS = (x, y) => [cv.width / 2 + (x - this.view.cx) * z, cv.height / 2 + (y - this.view.cz) * z];
    const [ox, oy] = toS(this.minX, this.minZ);
    c.imageSmoothingEnabled = z * SCALE < 1.5;
    c.drawImage(this.canvas, ox, oy, this.w * SCALE * z, this.h * SCALE * z);
    // playable boundary
    const b = g.map.bounds;
    const [bx0, by0] = toS(b.minX, b.minZ), [bx1, by1] = toS(b.maxX, b.maxZ);
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.setLineDash([8, 6]); c.lineWidth = 2; c.strokeRect(bx0, by0, bx1 - bx0, by1 - by0); c.setLineDash([]);
    if (g.gps && g.gps.path) {
      c.strokeStyle = '#c86bff'; c.lineWidth = 5; c.lineJoin = 'round';
      c.beginPath();
      const P = g.gps.path;
      for (let i = 0; i < P.length; i += 2) { const [x, y] = toS(P[i], P[i + 1]); if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
    }
    // landmark labels
    c.font = '600 14px Bahnschrift, Segoe UI, Arial';
    c.textAlign = 'center';
    for (const l of g.map.landmarks) {
      const [x, y] = toS(l.x, l.z);
      c.fillStyle = 'rgba(0,0,0,0.65)';
      const w = c.measureText(l.name).width + 12;
      c.fillRect(x - w / 2, y - 26, w, 19);
      c.fillStyle = '#f4d77a';
      c.fillText(l.name, x, y - 12);
      c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill();
    }
    if (z > 0.5) {
      c.font = '12px Bahnschrift, Segoe UI, Arial';
      c.fillStyle = 'rgba(232,217,168,0.8)';
      for (const pl of g.map.places) { if (pl.rank < 1) continue; const [x, y] = toS(pl.x, pl.z); c.fillText(pl.name, x, y); }
    }
    for (const h of g.map.hospitals) { const [x, y] = toS(h.x, h.z); this.drawBlip(c, 'hospital', x, y, 1, g.time); }
    for (const h of g.map.police) { const [x, y] = toS(h.x, h.z); this.drawBlip(c, 'policeStation', x, y, 1, g.time); }
    for (const bl of this.blips()) { const [x, y] = toS(bl.x, bl.z); this.drawBlip(c, bl.kind, x, y, 1.2, g.time); }
    const p = g.player;
    const [px, py] = toS(p.x, p.z);
    this.playerArrow(c, px, py, Math.atan2(Math.sin(p.heading), -Math.cos(p.heading)), 1.3);
    c.fillStyle = '#fff'; c.font = '600 16px Bahnschrift, Segoe UI, Arial'; c.textAlign = 'left';
    c.fillText(`Money: ${formatMoney(p.money)} so‘m`, 24, cv.height - 54);
    c.fillText(`Golden non: ${g.save.non.length}/${g.pickups.nonTotal}   Missions: ${g.save.done.length}/${g.missions.storyCount}`, 24, cv.height - 30);
    c.font = '12px Bahnschrift, Segoe UI, Arial'; c.fillStyle = 'rgba(255,255,255,0.6)';
    c.fillText(g.map.attribution, 24, cv.height - 10);
  }
}
