// Boot: load the OpenStreetMap-derived city, build the world, show the title screen.
import { loadMapData } from './world/mapData.js';
import { Game } from './game.js';
import { loadSave } from './settings.js';

const bar = document.querySelector('#load-bar div');
const status = document.getElementById('load-status');
const progress = (f, msg) => {
  bar.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
  if (msg) status.textContent = msg;
};

function webglOk() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

async function boot() {
  if (!webglOk()) { status.textContent = 'WebGL 2 is not available. Please update your graphics driver.'; return; }
  try {
    progress(0.01, 'Loading the map of Toshkent…');
    const map = await loadMapData('data/tashkent.json', (f) => progress(f * 0.05, `Loading OpenStreetMap data… ${Math.round(f * 100)}%`));
    const game = new Game(document.getElementById('view'), map);
    window.game = game;
    await game.load(progress);
    document.getElementById('loading').classList.add('hidden');
    const params = new URLSearchParams(location.search);
    if (params.has('autostart')) game.startGame(params.get('autostart') === 'continue');
    else game.menu.showTitle(!!loadSave());
  } catch (e) {
    console.error(e);
    status.textContent = `Error: ${e.message}`;
  }
}

boot();
