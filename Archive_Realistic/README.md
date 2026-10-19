# Archive_Realistic

Reference copies of the source files that produced the original **realistic** art style, taken
from `main` at commit `bc620ca` before the `pixel-style` branch changed them. The full playable
realistic version lives on the `main` branch.

| File | What it made |
|---|---|
| `src/world/materials.js` | Ground noise, procedural building windows, water, far fog, foliage sway |
| `src/world/sky.js` | Sky dome shader, sun/moon light, fog, day/night key frames, PMREM env map |
| `src/entities/vehicleModels.js` | Car body meshes and the metal/roughness paint material |
| `src/entities/humans.js` | Realistically proportioned people and their instanced shader |
| `src/world/landmarks.js` | TV tower, Amir Temur statue, globe, minarets, plov kazans |

The game never loads these files, and `tools/package.mjs` leaves this folder out of the desktop build.
