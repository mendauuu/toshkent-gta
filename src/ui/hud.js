// DOM heads-up display.
import { formatMoney, formatTime } from '../util/math.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {
      root: $('hud'), clock: $('hud-clock'), weapon: $('hud-weapon-name'), ammo: $('hud-ammo'), money: $('hud-money'), stars: $('hud-stars'),
      timer: $('hud-timer'), meter: $('hud-meter'), health: $('hud-health'), armor: $('hud-armor'), help: $('hud-help'),
      street: $('hud-street'), area: $('hud-area'), location: $('hud-location'), vehicle: $('hud-vehicle'), vname: $('hud-vehicle-name'),
      speed: $('hud-speed').querySelector('span'), radio: $('hud-radio'), objective: $('hud-objective'), subtitle: $('hud-subtitle'),
      big: $('hud-big'), notify: $('hud-notify'), crosshair: $('crosshair'), fps: $('hud-fps'), hint: $('hud-hint'),
    };
    this.el.stars.innerHTML = '<span class="star">★</span>'.repeat(5);
    this.starEls = [...this.el.stars.children];
    this.shownMoney = 0;
    this.cache = {};
    this.timers = { help: 0, objective: 0, subtitle: 0, big: 0, radio: 0, location: 0 };
    this.lastStreet = '';
    this.lastArea = '';
    this.locT = 0;
    this.fpsAcc = 0; this.fpsN = 0;
  }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }
  show() { this.el.root.classList.remove('hidden'); }
  hide() { this.el.root.classList.add('hidden'); }

  notify(text, cls = '') {
    const d = document.createElement('div');
    d.textContent = text;
    if (cls) d.className = cls;
    this.el.notify.appendChild(d);
    setTimeout(() => d.remove(), 3100);
    while (this.el.notify.children.length > 5) this.el.notify.firstChild.remove();
  }
  big(title, sub = '', seconds = 4, cls = '') {
    const b = this.el.big;
    b.className = cls;
    b.querySelector('.big-title').textContent = title;
    b.querySelector('.big-sub').innerHTML = sub;
    void b.offsetWidth;
    b.classList.add('show');
    this.timers.big = seconds;
  }
  hideBig() { this.el.big.classList.add('hidden'); this.timers.big = 0; }
  objective(html, seconds = 7) { this.el.objective.innerHTML = html; this.el.objective.classList.remove('hidden'); this.timers.objective = seconds; }
  subtitle(who, text, seconds = 4) {
    this.el.subtitle.innerHTML = who ? `<span class="who">${who}:</span> ${text}` : text;
    this.el.subtitle.classList.remove('hidden');
    this.timers.subtitle = seconds;
  }
  help(html, seconds = 8) {
    const note = this.note && performance.now() < this.noteUntil && html !== this.note ? `<br><br>${this.note}` : '';
    this.el.help.innerHTML = html + note;
    this.el.help.classList.remove('hidden');
    this.timers.help = seconds;
  }
  // a short note appended to every help box for a while (so tutorials don't hide it)
  setNote(html, seconds) { this.note = html; this.noteUntil = performance.now() + seconds * 1000; }
  hint(html) {
    if (this.cache.hint === html) return;
    this.cache.hint = html;
    if (!html) this.el.hint.classList.add('hidden');
    else { this.el.hint.innerHTML = html; this.el.hint.classList.remove('hidden'); }
  }
  radio(name) { this.el.radio.innerHTML = `${name}<small>Q to change station</small>`; this.el.radio.classList.remove('hidden'); this.timers.radio = 3; }
  timer(sec) {
    if (sec === null || sec === undefined) { this.el.timer.classList.add('hidden'); return; }
    this.el.timer.classList.remove('hidden');
    this.set('timer', this.el.timer, formatTime(sec));
    this.el.timer.classList.toggle('urgent', sec < 15);
  }
  meter(label, value) {
    const m = this.el.meter;
    if (value === null || value === undefined) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    this.set('meterLabel', m.querySelector('.label'), label);
    m.querySelector('.bar div').style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  }
  flashStars() { this.el.stars.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 400 }); }
  crosshair(visible, onTarget, dot = false) {
    const c = this.el.crosshair;
    c.classList.toggle('hidden', !visible);
    c.classList.toggle('target', !!onTarget);
    c.classList.toggle('dot', dot);
  }

  update(dt) {
    const g = this.game, p = g.player;
    for (const k of Object.keys(this.timers)) {
      if (this.timers[k] <= 0) continue;
      this.timers[k] -= dt;
      if (this.timers[k] <= 0) {
        if (k === 'big') this.el.big.classList.add('hidden');
        else if (k === 'location') this.el.location.classList.add('fade');
        else if (this.el[k]) this.el[k].classList.add('hidden');
      }
    }
    if (this.timers.big > 0) this.el.big.classList.remove('hidden');
    this.set('clock', this.el.clock, g.env.clockString());
    // money counts up like GTA
    const diff = p.money - this.shownMoney;
    if (Math.abs(diff) < 1) this.shownMoney = p.money;
    else this.shownMoney += diff * Math.min(1, dt * 5);
    this.set('money', this.el.money, `${formatMoney(this.shownMoney)} so‘m`);
    const w = p.weapon, a = p.weapons[p.current];
    this.set('weapon', this.el.weapon, w.name);
    this.set('ammo', this.el.ammo, w.melee ? '' : p.reloadT > 0 ? 'reloading' : `${a.clip} / ${a.ammo}`);
    // stars
    const lv = g.police.level;
    this.starEls.forEach((s, i) => { const on = i < lv; if (s._on !== on) { s._on = on; s.classList.toggle('on', on); } });
    this.el.stars.classList.toggle('flash', g.police.flashing);
    this.el.health.firstChild.style.width = `${Math.max(0, p.health)}%`;
    this.el.health.classList.toggle('low', p.health < 25);
    this.el.armor.firstChild.style.width = `${Math.max(0, p.armor)}%`;
    // vehicle
    const v = p.vehicle;
    this.el.vehicle.classList.toggle('hidden', !v);
    if (v) {
      this.set('vname', this.el.vname, v.type.name);
      this.set('speed', this.el.speed, String(Math.round(v.kmh)));
    }
    // crosshair
    const aimingNow = !p.dead && ((p.aiming && !p.vehicle) || (p.vehicle && !w.melee && (g.input.buttons & 1)));
    const fp = g.cameraRig.firstPerson && !p.dead;
    this.crosshair(aimingNow || fp || (!p.vehicle && !w.melee && !p.dead), false, !p.aiming && (!p.vehicle || fp));
    // location: street + neighbourhood
    this.locT -= dt;
    if (this.locT <= 0) {
      this.locT = 0.5;
      const street = g.graph.nameAt(p.x, p.z);
      const area = g.areaName(p.x, p.z);
      if ((street && street !== this.lastStreet) || area !== this.lastArea) {
        this.lastStreet = street || this.lastStreet;
        this.lastArea = area;
        this.set('street', this.el.street, street || '');
        this.set('area', this.el.area, area || '');
        this.el.location.classList.remove('fade');
        this.timers.location = 4.5;
      }
    }
    if (g.settings.showFps) {
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 0.5) {
        const r = g.renderer.info.render;
        const pf = g.perf || { sim: 0, frame: 0 };
        this.set('fps', this.el.fps, `${Math.round(this.fpsN / this.fpsAcc)} fps · cpu ${pf.sim.toFixed(1)}+${pf.frame.toFixed(1)} ms · ${r.calls} draws · ${(r.triangles / 1000).toFixed(0)}k tris`);
        this.fpsAcc = 0; this.fpsN = 0;
      }
      this.el.fps.classList.remove('hidden');
    } else this.el.fps.classList.add('hidden');
  }
}
