// Persistent player settings and save game.
const KEY = 'gta-toshkent-settings-v1';
const SAVE_KEY = 'gta-toshkent-save-v1';

// pixelRes: internal render height in pixels (180 / 270 / 360), see fx/pixel.js
export const DEFAULTS = {
  quality: 'medium', pixelRes: 270, drawDistance: 650, traffic: 1, peds: 1, mouseSens: 1, invertY: false,
  volume: 0.8, music: 0.6, dayLength: 24, showFps: false,
};

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { s = {}; }
  const out = { ...DEFAULTS, ...s };
  delete out.autoRes; // replaced by the fixed pixel resolution
  const url = new URLSearchParams(location.search);
  if (url.get('quality')) out.quality = url.get('quality');
  if (url.get('pixel')) out.pixelRes = Number(url.get('pixel'));
  if (!(out.pixelRes >= 90 && out.pixelRes <= 2160)) out.pixelRes = DEFAULTS.pixelRes;
  return out;
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }

export const NEW_SAVE = () => ({ money: 50000, done: [], non: [], weapons: null, time: 10 * 60, stats: { kills: 0, copsKilled: 0, carsStolen: 0, wasted: 0, busted: 0, distance: 0, maxWanted: 0, playTime: 0, taxiFares: 0 } });

export function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && s.done) return { ...NEW_SAVE(), ...s, stats: { ...NEW_SAVE().stats, ...(s.stats || {}) } }; } catch { /* ignore */ }
  return null;
}
export function writeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
