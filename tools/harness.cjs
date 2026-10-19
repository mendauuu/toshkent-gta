// Offscreen Electron test harness: loads the game invisibly, runs a scenario script and saves
// screenshots. Usage:
//   electron tools/harness.cjs <scenario.cjs> <outDir>
// The scenario exports async ({ run, wait, shot, log }) => {}.
// Environment: GAME_QUERY (URL params, e.g. "?quality=low"), HARNESS_SIZE (window size, default
// "1280x720"), GAME_ROOT (game folder to serve, default the folder above tools/, e.g. a checkout
// of another branch for before/after comparisons).
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = process.env.GAME_ROOT ? path.resolve(process.env.GAME_ROOT) : path.join(__dirname, '..');
const [W, H] = (process.env.HARNESS_SIZE || '1280x720').split('x').map(Number);
const [scenarioPath, outDir] = process.argv.slice(-2);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// screenshots come out at exactly W x H whatever the Windows display scaling is
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const { pathname, search } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    return net.fetch(pathToFileURL(file).toString());
  });
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(30);
  let last = null;
  win.webContents.on('paint', (e, dirty, image) => { last = image; });
  const logs = [];
  win.webContents.on('console-message', (e) => {
    const line = `[${e.level}] ${e.message}`;
    logs.push(line);
    if (e.level === 'error' || e.level === 'warning') console.log('PAGE', line.slice(0, 400));
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = async (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const shot = async (name) => {
    win.webContents.invalidate();
    await wait(400);
    if (last) fs.writeFileSync(path.join(outDir, `${name}.png`), last.toPNG());
    console.log('shot', name);
  };
  const log = (...a) => console.log(...a);
  try {
    const query = process.env.GAME_QUERY || '';
    await win.loadURL(`app://game/index.html${query}`);
    const scenario = require(path.resolve(scenarioPath));
    await scenario({ run, wait, shot, log, win });
  } catch (e) {
    console.log('HARNESS ERROR', e && e.stack ? e.stack : e);
  }
  fs.writeFileSync(path.join(outDir, 'console.log'), logs.join('\n'));
  app.quit();
});
