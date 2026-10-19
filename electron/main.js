// Electron shell: serves the game from the app folder through a private app:// protocol and opens
// a desktop window. F11 toggles fullscreen.
const { app, BrowserWindow, protocol, net, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// keep the integrated GPU in use for WebGL even if it is on Chromium's block list
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function serveApp() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    const rel = path.relative(ROOT, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#05070b',
    title: 'Grand Theft Avto: Toshkent',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // links (e.g. OpenStreetMap attribution) open in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('app://game/index.html');
  return win;
}

// `ToshkentGTA.exe --smoke-test` loads the game in a hidden window, checks it reaches the title
// screen and exits with code 0 (or 1 on failure). Used to verify a build.
async function smokeTest() {
  const win = new BrowserWindow({ width: 1280, height: 720, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  await win.loadURL('app://game/index.html');
  let state = '';
  for (let i = 0; i < 120 && state !== 'title'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    state = await win.webContents.executeJavaScript(`window.game ? window.game.state : document.getElementById('load-status').textContent`);
    if (String(state).startsWith('Error')) break;
  }
  const info = await win.webContents.executeJavaScript(`JSON.stringify({ buildings: window.game?.map.buildings.length, roads: window.game?.map.roads.length, gl: (() => { const g = document.createElement('canvas').getContext('webgl2'); const d = g && g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })() })`);
  const ok = state === 'title' && errors.length === 0;
  process.stdout.write(`SMOKE ${ok ? 'OK' : 'FAIL'} state=${state} ${info} errors=${JSON.stringify(errors.slice(0, 5))}\n`);
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(() => {
  serveApp();
  if (process.argv.includes('--smoke-test')) smokeTest();
  else createWindow();
});
app.on('window-all-closed', () => app.quit());
