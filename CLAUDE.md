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

**Scenario testing / screenshots:** `electron tools/harness.cjs <scenario.cjs> <outDir>` loads the game in an offscreen window and runs a CommonJS scenario `module.exports = async ({ run, wait, shot, log, win }) => {}`. `run(code)` evaluates async JS in the page (the game is `window.game`), `shot(name)` writes `<outDir>/<name>.png`, and the page console is saved to `<outDir>/console.log`. Set `GAME_QUERY` (e.g. `?autostart=new&quality=low`) to pass URL params, `HARNESS_SIZE` (e.g. `1920x1080`) for the window size, and `GAME_ROOT` to serve another checkout, such as `git archive main` extracted to a temp folder for before/after shots. `HARNESS_REAL=1` renders in a normal hidden window and captures through the real GPU compositor at the display's own scale, and `HARNESS_DPR` forces a scale factor. The offscreen mode always reports `devicePixelRatio` 1. `shot()` waits for one animation frame, because scenarios that stop the game loop and draw with `game.frame()` would otherwise capture an older frame. `tools/scenarios/compare.cjs` builds a seeded world, takes day/night shots from fixed cameras and writes a render-cost benchmark to `<outDir>/bench.json`. Pass `SHOTS=0` when timing, because screenshot readback inflates the frame times, and `BENCH=0` to skip the benchmark. `tools/scenarios/cute.cjs` stages a group of people next to the player, shoots the chibi and sprite player from the same cameras, and finds real shop, mural and mahalla walls to frame. Useful page hooks:
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
- `materials.js` holds custom shader materials sharing `sharedUniforms` (e.g. `uTime`). `sky.js` (`Environment`) runs the day/night cycle and lighting. `landmarks.js` builds hand-modelled landmarks by id (e.g. `temur`); on `pixel-style` the TV Tower and the Amir Temur statue are voxel models, and Chorsu gets a ring of small domes.
- Buildings (`SolidBuilder` in `city.js`) carry `aWin` = (u in window bays, v in floors, floors) and `aStyle` = (style, seed, wall info = kind + 4 × bays). Styles 1 to 6 are facades: 1 mahalla house, 2 Soviet panel block, 3 glass, 4 office or civic, 5 industrial, 6 big plain buildings with arches and tile bands. Style 10 is a tiled dome and 11 a pitched roof. Wall kinds are 0 plain, 1 shops on the ground floor, 2 mosaic mural (Soviet end walls) and 3 a mahalla courtyard wall with a gate. Kinds 1 and 3 are only given to walls that face a street (`facesStreet`). The building shader in `materials.js` picks tiles from the pixel facade atlas drawn in code in `facades.js` (`TILE`, 16 texels per bay) and samples it with `textureGrad`. Walls seen edge-on switch to a ribbon of glass, and distant ones to a flat facade.
- Each chunk also merges small roof props (stair rooms, water tanks, dishes, AC boxes, antennas) into `propMesh`, which is hidden beyond 260 m, and adds courtyard tree crowns over mahalla roofs. Flat ground layers that share a render order are merged (`mergeFlat`). Trees use puffy round crowns, one smooth spindle for poplars and a two-tier cone for conifers.

**Entities (`src/entities/`):** Each kind has a manager with `update(dt)`. Vehicles use arcade physics (`vehicle.js`) with procedural meshes (`vehicleModels.js`, `VTYPES`). All humans (player, peds, cops, mission NPCs) are drawn by one instanced mesh in `humans.js`, with limb animation in the vertex shader. Appearance comes from `VAR` bit flags and `POSE` codes. Each frame they are pushed via `HumanRenderer.begin/push/end`.
- On `pixel-style` the humans are chibi, with the head about 2× the old size and the same total height. Faces come from an 80×16 nearest atlas (`FACE`: happy, neutral, sleepy, stern, shades), and hair styles are `HAIR_STYLE` (short, bun, ponytail, curly).
- WebGL allows only 16 vertex attributes, so per-vertex data is packed into `aInfo` = (part, slot, variant, hair style), and the face and hair choice ride on `iAnim.w` = bits + face × 256 + hair × 2048.
- Each person's face and hair are picked in `lookStyle()` from a seeded RNG. The player is happy with short hair, police are stern and gang members wear shades.
- The headshot sphere in `weapons.js` (`SPHERES`) follows the bigger head: 1.52 m, radius 0.27.
- `playerSprite.js` is an experimental 24×32 sprite billboard for the player (4 directions × 3 walk frames). It is off by default; turn it on with `?sprite=1`, the cheat `SPRAYT` or `game.setPlayerSprite(true)`.
- Cars keep their physics sizes. Only the drawn wheels are bigger (`TOY_WHEEL`), and the bodies are rounded toys with headlight eyes. Chamfered boxes and prisms for these models come from `src/util/shapes.js`.

**Missions (`src/missions/`):** The story is a data array `STORY` in `story.js`. Each mission is an **async script** that awaits helpers on `MissionRun` (`waitFor(pred)`, `wait(sec)`, `say`, `marker`, `spawnVehicle`, `onFrame`, …). Failing throws `MissionFailed`. `MissionRun.tick` resolves waits each step and `dispose()` cleans up spawned entities. Mission locations are computed at load time by `computeSpots(game)` from real map features. Taxi/marshrutka side jobs live in `missions.js`.

**Pixel-art output** (`src/fx/pixel.js`, `PixelPipeline`, exposed as `game.pixel` with `width/height/scale`): the `pixel-style` branch renders the scene at a low internal resolution (`settings.pixelRes` = internal height 180/270/360, URL `?pixel=`). The scale is the whole number nearest that height. The scene renders into a multiple-render-target: sRGB colour, view-space normals and a depth texture. An outline pass darkens 1-pixel silhouettes (second difference of 1/depth) and creases (normal jumps), faded by the fog bands. A `blitFramebuffer` NEAREST copy then upscales onto a canvas sized to the exact physical pixels from a `ResizeObserver` with `device-pixel-content-box`. The browser therefore never scales the 3D view, and it stays crisp at any Windows display scale. Debug URL params: `?outline=0`, and `?blit=0` for the shader fallback. There is no MSAA and no tone mapping. The camera aspect and particle sizes use the internal size, and the DOM HUD stays at full resolution. `main` keeps the original realistic style, and `Archive_Realistic/` has reference copies of its rendering files.

**Pixel-art look** (`src/world/palette.js`, `materials.js`):
- Every lit material is a `MeshToonMaterial` made with `toon()`, using the 3-texel nearest `TOON_RAMP`. Light intensities in `sky.js` are tuned for that ramp: lit ≈ the base colour, side ≈ 83%, shadow ≈ 70%.
- Colours come from the 32-colour `PAL`. `cute()` and `cutePaint()` map any realistic colour onto it, and `wallColor`/`roofColor` give buildings seeded pastels.
- `materials.js` patches `ShaderChunk.fog_pars_fragment`/`fog_fragment` globally. Fog becomes 4 hard bands, and every built-in material writes the normal output `pc_fragNormal` at location 1 (opaque lit materials write the normal, others write 0). A custom `ShaderMaterial` drawn into the scene must include `NO_NORMAL_PARS`/`NO_NORMAL` (see the sky, particles and markers).
- Shadows use `BasicShadowMap` with small toy-scale biases.
- Thin props (lamp and signal poles, lane lines) are drawn wider and hidden in the distance (`hideBeyond`, marking shader).

**Quality tiers** (`settings.quality`: low/medium/high) change shadows, tree density, ped/traffic counts and whether real spot lights exist. They no longer change resolution. Lights are created up front on High only, because adding lights later forces shader recompiles. Lower tiers fake headlights with an additive glow.

**Persistence:** `src/settings.js` stores settings and the save game in `localStorage` (`gta-toshkent-settings-v1`, `gta-toshkent-save-v1`). The game autosaves every 60 s.

**Electron** (`electron/main.js`) serves the app folder over a privileged `app://game/` protocol (path-traversal checked), not `file://`. `F11` toggles fullscreen and `--smoke-test` runs the headless check. The packaged app uses `asar: false` and excludes `node_modules`, `tools`, `dist` and `docs`.

## Conventions

- In-game text, mission names and cheat codes are in Uzbek (Latin script). Money is in so'm (`formatMoney`).
- Shared helpers (`rand`, `chance`, `clamp`, `choice`, `mulberry32`, `FloatBuf`/`IndexBuf`, `pointInRing`) are in `src/util/math.js`.
- Code style: dense, compact ES modules with short local names. Each file starts with a one-line header comment saying what it does.
- `dist/` is build output. Edit `src/`, not `dist/ToshkentGTA-win32-x64/resources/app/`.
