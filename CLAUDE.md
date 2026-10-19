# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Grand Theft Avto: Toshkent" is a GTA-style open-world game set in central Tashkent, built from OpenStreetMap data. It is plain browser ES modules + three.js, wrapped in Electron for the desktop build. There is no bundler, transpiler, linter or unit-test framework. Node.js 22+ is required for the tools.

## Commands

```bash
npm install
npx install-electron                 # fetch the Electron binary
npm start                            # run the game in Electron (electron .)
npm run serve                        # static server at http://127.0.0.1:8173 for playing in a browser
npm run smoke-test                   # hidden window, waits for game.state === 'title', exits 0/1, prints "SMOKE OK|FAIL ..."
npm run package                      # build dist/ToshkentGTA-win32-x64/ToshkentGTA.exe (@electron/packager)
npm run icon                         # regenerate assets/icon.png + icon.ico (no dependencies)

# Rebuild the map data (rarely needed; data/tashkent.json is checked in)
node tools/extract-osm.mjs path/to/uzbekistan-latest.osm.pbf osm-raw.json [minLat minLon maxLat maxLon]
node tools/build-map.mjs osm-raw.json data/tashkent.json
```

**Scenario testing / screenshots:** `electron tools/harness.cjs <scenario.cjs> <outDir>` loads the game in an offscreen window and runs a CommonJS scenario `module.exports = async ({ run, wait, shot, log, win }) => {}`. `run(code)` evaluates async JS in the page (the game is `window.game`), `shot(name)` writes `<outDir>/<name>.png`, and the page console is saved to `<outDir>/console.log`. Set `GAME_QUERY` (e.g. `?autostart=new&quality=low`) to pass URL params, `HARNESS_SIZE` (e.g. `1920x1080`) for the window size, and `GAME_ROOT` to serve another checkout, such as `git archive main` extracted to a temp folder for before/after shots. `tools/scenarios/compare.cjs` builds a seeded world, takes day/night shots from fixed cameras and writes a render-cost benchmark to `<outDir>/bench.json`. Useful page hooks:
- `?autostart` / `?autostart=continue` skips the title screen; `?quality=low|medium|high` overrides settings.
- `game.tick(seconds, render)` advances the fixed-step simulation deterministically.
- `game.debugCam = { x, y, z, tx, ty, tz }` pins the camera; `game.teleportPlayer(x, z)`.

## Gotchas

- **three.js is vendored.** `index.html` uses an import map `"three": "./vendor/three.module.js"`, and `three.module.js` imports `./three.core.js`. Both files are committed in `vendor/`, copied from `three/build/` at the version pinned in `package-lock.json` (0.186.1). When you upgrade three, recopy them. Nothing resolves `node_modules` at runtime: `tools/serve.mjs` blocks it and `tools/package.mjs` excludes it. If `vendor/` is missing, the game hangs at "Loading map…" and the smoke test reports `net::ERR_FILE_NOT_FOUND`.
- **`ELECTRON_RUN_AS_NODE=1` is set inside VS Code terminals.** With it, Electron acts as plain Node and fails with `bad option: --smoke-test`. Unset it before running `electron .` or `ToshkentGTA.exe` from here (PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`).
- A packaged `ToshkentGTA.exe` ignores any script argument, so `tools/harness.cjs` needs the dev `electron` binary from `node_modules`.

## Architecture

**Boot** (`src/main.js`): `loadMapData('data/tashkent.json')` → `new Game(canvas, map)` → `await game.load(progress)` → title menu. `Game` (`src/game.js`) owns every subsystem and passes itself (`this`) to each manager's constructor, so systems reach each other through the game object (`game.collision`, `game.graph`, `game.vehicles`, `game.police`, `game.hud`, `game.missions`, …). Cross-system events such as `damageHuman`, `explosion`, `onGunshot`, `ejectDriver`, `bustPlayer` and `respawn` live on `Game`.

**Loop:** `loop()` runs a fixed 60 Hz `step(dt)` (at most 4 steps per frame) for simulation and a variable-rate `frame()` for camera, culling, environment, instanced human rendering, effects, HUD and audio. `game.state` is one of `loading | title | playing | paused | map | modal`. Input presses are consumed by exactly one sim step (`input.endFrame()`).

**Map data pipeline:** `tools/extract-osm.mjs` (self-contained PBF parser) → raw JSON → `tools/build-map.mjs` → `data/tashkent.json` (~6.5 MB). The file stores coordinates as **integer decimetres** with compact keys (`p`, `h`, `rf`, …). `src/world/mapData.js` decodes it into metres and readable field names. Coordinates are local metres: **+x = east, +z = south**, y up. `bounds` is the playable area and `scenery` is bounds plus a 230 m rendered margin. If you add a field in `build-map.mjs`, also decode it in `mapData.js`.

**World (`src/world/`):**
- `city.js` builds all static geometry (ground, roads, markings, buildings, trees, furniture) into merged meshes grouped into 300 m `CHUNK`s for distance culling. It also registers building walls and obstacles with the collision world. Draw order of the flat ground layers is controlled by `ORDER` render orders, not depth.
- `collision.js` is a static 2D (x/z) grid of wall segments and circles in CSR form. Call `finalize()` after everything is added. Queries include `collideCircle` and `isFree`.
- `roadGraph.js` is the drivable graph from OSM: lanes, traffic signals (`SIGNAL_CYCLE`), nearest-edge queries and A* `findPath`. AI traffic, pedestrians, GPS and mission placement (`streetSpot` in `missions/story.js`) all use it.
- `materials.js` holds custom shader materials sharing `sharedUniforms` (e.g. `uTime`). `sky.js` (`Environment`) runs the day/night cycle and lighting. `landmarks.js` builds hand-modelled landmarks by id (e.g. `temur`).

**Entities (`src/entities/`):** Each kind has a manager with `update(dt)`. Vehicles use arcade physics (`vehicle.js`) with procedural meshes (`vehicleModels.js`, `VTYPES`). All humans (player, peds, cops, mission NPCs) are drawn by one instanced mesh in `humans.js`, with limb animation in the vertex shader. Appearance comes from `VAR` bit flags and `POSE` codes. Each frame they are pushed via `HumanRenderer.begin/push/end`.

**Missions (`src/missions/`):** The story is a data array `STORY` in `story.js`. Each mission is an **async script** that awaits helpers on `MissionRun` (`waitFor(pred)`, `wait(sec)`, `say`, `marker`, `spawnVehicle`, `onFrame`, …). Failing throws `MissionFailed`. `MissionRun.tick` resolves waits each step and `dispose()` cleans up spawned entities. Mission locations are computed at load time by `computeSpots(game)` from real map features. Taxi/marshrutka side jobs live in `missions.js`.

**Pixel-art output** (`src/fx/pixel.js`): the `pixel-style` branch renders the scene at a low internal resolution (`settings.pixelRes` = internal height 180/270/360, URL `?pixel=`). `fitPixelCanvas` picks the integer scale nearest that height for the window, sizes the drawing buffer to `ceil(window / scale)` and lays the canvas over the window at exactly that scale, with CSS `image-rendering: pixelated` doing the nearest-neighbour upscale. `game.pixel` holds `{ width, height, scale }`. The camera aspect and particle point sizes use the internal size. There is no MSAA. The DOM HUD stays at full resolution. `main` keeps the original realistic style, and `Archive_Realistic/` has reference copies of its rendering files.

**Quality tiers** (`settings.quality`: low/medium/high) change shadows, tree density, ped/traffic counts and whether real spot lights exist. They no longer change resolution. Lights are created up front on High only, because adding lights later forces shader recompiles. Lower tiers fake headlights with an additive glow.

**Persistence:** `src/settings.js` stores settings and the save game in `localStorage` (`gta-toshkent-settings-v1`, `gta-toshkent-save-v1`). The game autosaves every 60 s.

**Electron** (`electron/main.js`) serves the app folder over a privileged `app://game/` protocol (path-traversal checked), not `file://`. `F11` toggles fullscreen and `--smoke-test` runs the headless check. The packaged app uses `asar: false` and excludes `node_modules`, `tools`, `dist` and `docs`.

## Conventions

- In-game text, mission names and cheat codes are in Uzbek (Latin script). Money is in so'm (`formatMoney`).
- Shared helpers (`rand`, `chance`, `clamp`, `choice`, `mulberry32`, `FloatBuf`/`IndexBuf`, `pointInRing`) are in `src/util/math.js`.
- Code style: dense, compact ES modules with short local names. Each file starts with a one-line header comment saying what it does.
- `dist/` is build output. Edit `src/`, not `dist/ToshkentGTA-win32-x64/resources/app/`.
