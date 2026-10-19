// Title screen, pause menu and panels.
import { saveSettings } from '../settings.js';
import { formatMoney } from '../util/math.js';

const $ = (id) => document.getElementById(id);

export class Menu {
  constructor(game) {
    this.game = game;
    this.panel = null;
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      this.action(b.dataset.action, b);
    });
    this.bindSettings();
  }

  action(a, el) {
    const g = this.game;
    g.audio.init();
    switch (a) {
      case 'new': g.startGame(false); break;
      case 'continue': g.startGame(true); break;
      case 'resume': g.resume(); break;
      case 'map': this.closePanel(); g.openMap(); break;
      case 'controls': this.openPanel('controls-panel'); break;
      case 'settings': this.syncSettings(); this.openPanel('settings-panel'); break;
      case 'stats': this.fillStats(); this.openPanel('stats-panel'); break;
      case 'save': g.saveGame(true); g.hud.notify('Game saved', 'money'); break;
      case 'title': g.quitToTitle(); break;
      case 'quit': try { window.close(); } catch { /* browser */ } g.hud.notify('Close the window to quit'); break;
      case 'panel-close': this.closePanel(); break;
      case 'metro-close': this.closeMetro(); break;
      case 'metro-go': this.travel(Number(el.dataset.index)); break;
      default: break;
    }
  }

  showTitle(hasSave) {
    $('title').classList.remove('hidden');
    $('btn-continue').classList.toggle('hidden', !hasSave);
  }
  hideTitle() { $('title').classList.add('hidden'); }
  showPause() { $('pause').classList.remove('hidden'); }
  hidePause() { $('pause').classList.add('hidden'); this.closePanel(); }
  openPanel(id) { this.closePanel(); this.panel = $(id); this.panel.classList.remove('hidden'); }
  closePanel() { if (this.panel) this.panel.classList.add('hidden'); this.panel = null; }
  get panelOpen() { return !!this.panel || !$('metro-panel').classList.contains('hidden'); }

  bindSettings() {
    const s = this.game.settings;
    const bind = (id, key, parse = Number, after) => {
      const el = $(id);
      el.addEventListener('input', () => {
        s[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
        saveSettings(s);
        after?.();
      });
    };
    bind('set-quality', 'quality', String, () => this.game.applyQuality());
    bind('set-autores', 'autoRes', Boolean, () => { if (!s.autoRes) { this.game.dynScale = 1; this.game.applyQuality(); } });
    bind('set-draw', 'drawDistance');
    bind('set-traffic', 'traffic');
    bind('set-peds', 'peds');
    bind('set-sens', 'mouseSens');
    bind('set-invert', 'invertY');
    bind('set-volume', 'volume', Number, () => this.game.audio.applySettings());
    bind('set-music', 'music', Number, () => this.game.audio.applySettings());
    bind('set-daylen', 'dayLength');
    bind('set-fps', 'showFps');
  }
  syncSettings() {
    const s = this.game.settings;
    $('set-quality').value = s.quality; $('set-draw').value = s.drawDistance; $('set-autores').checked = s.autoRes; $('set-traffic').value = s.traffic; $('set-peds').value = s.peds;
    $('set-sens').value = s.mouseSens; $('set-invert').checked = s.invertY; $('set-volume').value = s.volume; $('set-music').value = s.music;
    $('set-daylen').value = s.dayLength; $('set-fps').checked = s.showFps;
  }

  fillStats() {
    const g = this.game, st = g.save.stats;
    const rows = [
      ['Story missions', `${g.save.done.length} / ${g.missions.storyCount}`],
      ['Golden non found', `${g.save.non.length} / ${g.pickups.nonTotal}`],
      ['Money', `${formatMoney(g.player.money)} so‘m`],
      ['Distance driven', `${(st.distance / 1000).toFixed(1)} km`],
      ['Cars stolen', st.carsStolen],
      ['People killed', st.kills],
      ['Police killed', st.copsKilled],
      ['Highest wanted level', '★'.repeat(st.maxWanted) || '-'],
      ['Taxi fares', st.taxiFares],
      ['Times wasted', st.wasted],
      ['Times busted', st.busted],
      ['Play time', `${Math.floor(st.playTime / 3600)}h ${Math.floor((st.playTime % 3600) / 60)}m`],
    ];
    $('stats-body').innerHTML = rows.map(([k, v]) => `<div>${k}<span>${v}</span></div>`).join('');
  }

  openMetro(from) {
    const g = this.game;
    this.metroFrom = from;
    const seen = new Set([from.name]);
    const stations = g.pickups.metroStations().filter((s) => { if (seen.has(s.name)) return false; seen.add(s.name); return true; }).sort((a, b) => a.name.localeCompare(b.name));
    this.metroStations = stations;
    $('metro-list').innerHTML = stations.map((s, i) => `<button data-action="metro-go" data-index="${i}">${s.name}</button>`).join('');
    $('metro-panel').classList.remove('hidden');
    g.setModal(true);
  }
  closeMetro() { $('metro-panel').classList.add('hidden'); this.game.setModal(false); }
  travel(i) {
    const g = this.game, s = this.metroStations[i];
    this.closeMetro();
    if (!s) return;
    if (g.player.money < 2000) { g.hud.notify('Not enough money for the metro', 'bad'); return; }
    g.addMoney(-2000);
    g.teleportPlayer(s.x + 1.5, s.z + 1.5, true, `Metro: ${s.name}`);
  }
}
