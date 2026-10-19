// Offscreen Electron test harness: loads the game invisibly, runs a scenario script and saves
// screenshots. Usage:
//   electron tools/harness.cjs <scenario.cjs> <outDir>
// The scenario exports async ({ run, wait, shot, log }) => {}.
// Environment: GAME_QUERY (URL params, e.g. "?quality=low"), HARNESS_SIZE (window size in CSS
// pixels, default "1280x720"), GAME_ROOT (game folder to serve, default the folder above tools/,
// e.g. a checkout of another branch for before/after comparisons). HARNESS_REAL=1 renders in a
// normal hidden window and captures through the real GPU compositor at the display's own scale
// (e.g. Windows 125%) instead of the offscreen renderer; HARNESS_DPR forces a device scale factor
// (default 1 for offscreen shots, so they come out at exactly the window size).
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = process.env.GAME_ROOT ? path.resolve(process.env.GAME_ROOT) : path.join(__dirname, '..');
const [W, H] = (process.env.HARNESS_SIZE || '1280x720').split('x').map(Number);
const REAL = process.env.HARNESS_REAL === '1';
const [scenarioPath, outDir] = process.argv.slice(-2);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (process.env.HARNESS_DPR || !REAL) app.commandLine.appendSwitch('force-device-scale-factor', process.env.HARNESS_DPR || '1');

app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const { pathname, search } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    return net.fetch(pathToFileURL(file).toString());
  });
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, webPreferences: { offscreen: !REAL, backgroundThrottling: false } });
  let last = null;
  if (!REAL) {
    win.webContents.setFrameRate(30);
    win.webContents.on('paint', (e, dirty, image) => { last = image; });
  }
  const logs = [];
  win.webContents.on('console-message', (e) => {
    const line = `[${e.level}] ${e.message}`;
    logs.push(line);
    if (e.level === 'error' || e.level === 'warning') console.log('PAGE', line.slice(0, 400));
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = async (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const shot = async (name) => {
    // let the page present its latest canvas contents (scenarios that stop the game loop and draw
    // with game.frame() would otherwise capture an older frame)
    await run('await new Promise((r) => requestAnimationFrame(() => r()));').catch(() => {});
    if (REAL) {
      await wait(150);
      last = await win.webContents.capturePage(undefined, { stayHidden: true });
    } else {
      win.webContents.invalidate();
      await wait(400);
    }
    if (last) fs.writeFileSync(path.join(outDir, `${name}.png`), last.toPNG());
    console.log('shot', name, last ? `${last.getSize().width}x${last.getSize().height}` : 'none');
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
