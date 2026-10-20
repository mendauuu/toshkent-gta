// Pixel-art materials: flat colours with 3-band toon shading (MeshToonMaterial + a nearest-filtered
// ramp), hard banded fog, clean pixel building windows, and a second render output with view-space
// normals that the outline pass (fx/pixel.js) uses to find creases.
import * as THREE from 'three';
import { PAL } from './palette.js';
import { TILE, facadeTextures } from './facades.js';

// shared uniforms driven by the environment (time of day) and the game clock
export const sharedUniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
};

// ---------------------------------------------------------------- toon ramp
// sun term per facing: away from the sun / side-lit / facing the sun (the ambient light adds the
// rest, so every surface shows at most 3 shades: lit, side and shadow)
export const TOON_RAMP = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 112, 112, 112, 255, 255, 255, 255, 255]), 3, 1);
TOON_RAMP.minFilter = TOON_RAMP.magFilter = THREE.NearestFilter;
TOON_RAMP.generateMipmaps = false;
TOON_RAMP.needsUpdate = true;

export const toon = (params = {}) => new THREE.MeshToonMaterial({ gradientMap: TOON_RAMP, ...params });

// ---------------------------------------------------------------- global shader patches
// Every built-in material that supports fog includes fog_pars_fragment / fog_fragment, so these two
// chunks give all of them (a) hard 4-step fog with no haze in the near and middle distance and (b) a
// second output with the view-space normal: opaque lit surfaces write it, everything else writes 0
// with alpha 0, which blending leaves untouched (so smoke and glows never break the outlines).
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
layout(location = 1) out highp vec4 pc_fragNormal;
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float pixelFog(float d, float far) {
    float f = clamp((d - fogNear) / (far - fogNear), 0.0, 1.0);
    return f < 0.34 ? 0.0 : f < 0.67 ? 0.34 : f < 0.94 ? 0.67 : 1.0;
  }
#endif`;
THREE.ShaderChunk.pixel_normal_fragment = /* glsl */ `
#if defined( OPAQUE ) && ( defined( LAMBERT ) || defined( TOON ) || defined( PHONG ) || defined( STANDARD ) || defined( MATCAP ) )
  pc_fragNormal = vec4( normalize( normal ) * 0.5 + 0.5, 1.0 );
#else
  pc_fragNormal = vec4( 0.0 );
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, pixelFog( vFogDepth, fogFar ) );
#endif
#include <pixel_normal_fragment>`;

// far fog: tall buildings and landmarks stay visible across the city and step down, in hard bands,
// to a flat skyline silhouette (a darker tint of the horizon) instead of fading to see-through ghosts
const FAR_FOG = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * 0.84, pixelFog( vFogDepth, fogFar * 2.6 ) );
#endif
#include <pixel_normal_fragment>`;

// custom ShaderMaterials drawn into the scene declare the normal output themselves and write 0
export const NO_NORMAL_PARS = 'layout(location = 1) out highp vec4 pc_fragNormal;';
export const NO_NORMAL = 'pc_fragNormal = vec4(0.0);';

const HASH_GLSL = /* glsl */ `
float pHash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }`;

// hide small instanced props (poles, signals) beyond a distance so they never shimmer as sub-pixel lines
export function hideBeyond(mat, dist, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHideFar = { value: dist };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uHideFar;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 hidePos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          if (distance(hidePos.xz, cameraPosition.xz) > uHideFar) transformed = vec3(0.0);
        #endif`);
  };
  mat.customProgramCacheKey = () => 'hide-' + key;
  return mat;
}

// ---------------------------------------------------------------- ground layers (no depth writes)
export function makeGroundMaterial({ order = 0 } = {}) {
  const mat = toon({ vertexColors: true, depthWrite: false });
  mat.userData.order = order;
  return mat;
}

// ---------------------------------------------------------------- road markings (dashes in shader)
// aDash = (distance along the line, type: 0 solid, 1 lane dash, 2 zebra); thin lines are hidden in
// the distance where they would break up into single stray pixels
export function makeMarkingMaterial() {
  const mat = toon({ vertexColors: true, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aDash;\nvarying vec2 vDash;\nvarying float vMarkDist;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDash = aDash;\nvMarkDist = distance((modelMatrix * vec4(transformed, 1.0)).xz, cameraPosition.xz);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDash;\nvarying float vMarkDist;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vMarkDist > (vDash.y > 1.5 ? 70.0 : 46.0)) discard;
        if (vDash.y > 0.5 && vDash.y < 1.5 && fract(vDash.x / 9.0) > 0.36) discard;
        if (vDash.y > 1.5 && fract(vDash.x / 1.2) > 0.5) discard;`);
  };
  mat.customProgramCacheKey = () => 'marking';
  return mat;
}

// ---------------------------------------------------------------- water: flat colour, blinking pixel sparkles
export function makeWaterMaterial() {
  const mat = toon({ color: PAL.sky, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec2 vWPos;\n${HASH_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 cell = floor(vWPos * vec2(0.9, 2.2));
          float tick = floor(uTime * 1.6 + pHash(cell) * 5.0);
          if (pHash(cell + tick * 0.37) > 0.965) diffuseColor.rgb = vec3(1.0);
          else if (pHash(cell * 1.7 + 3.1) > 0.9) diffuseColor.rgb *= 1.18;
        }`);
  };
  mat.customProgramCacheKey = () => 'water';
  return mat;
}

// ---------------------------------------------------------------- buildings: pixel facade atlas
// aWin = (u in window bays, v in floors, number of floors); aStyle = (style, seed, wall info =
// kind + 4 * bays) from city.js. Styles: 1 mahalla house, 2 Soviet panel block, 3 glass tower,
// 4 office/civic, 5 industrial, 6 monument, 10 tiled dome, 11 pitched roof. Each window bay x floor
// cell picks a tile from the facade atlas (world/facades.js) by style, wall kind, floor and hashes;
// wall pixels take the building colour. textureGrad uses the continuous cell coordinate so tile
// edges never pick a wrong mip. Far away facades turn flat and lit windows merge into chunky blocks.
const T = Object.fromEntries(Object.entries(TILE).map(([k, [x, y]]) => [k, `vec2(${x * 16}.0, ${y * 16}.0)`]));
const BUILDING_FRAG = /* glsl */ `
  vec3 winLight = vec3(0.0);
  {
    float st = vStyle.x, seed = vStyle.y, info = vStyle.z;
    vec2 cell = vWin.xy, id = floor(cell), f = fract(cell);
    vec2 dcx = dFdx(cell), dcy = dFdy(cell);
    if (st > 9.5 && st < 10.5) {
      // dome tiles; the roof colour shows through the tile ground
      vec4 c = facadeTap(uFacade, ${T.domeTile}, vec2(16.0), f, vec2(1.0), dcx, dcy);
      diffuseColor.rgb = mix(diffuseColor.rgb * c.rgb, c.rgb, c.a);
    } else if (st > 10.5) {
      // pitched roof: crisp rows of tiles
      float rows = 1.0 / max(abs(dcx.y) + abs(dcy.y), 1e-4);
      if (rows > 3.0 && fract(cell.y) < 0.22) diffuseColor.rgb *= 0.8;
    } else if (st > 0.5) {
      float kind = mod(info + 0.5, 4.0) - 0.5, nb = max(1.0, floor((info + 0.5) / 4.0));
      float floors = vWin.z;
      float h1 = bHash(id + seed), hc = bHash(vec2(id.x * 1.31, seed + 7.0));
      vec2 ppc = 1.0 / max(abs(dcx) + abs(dcy), vec2(1e-4)); // screen pixels per cell
      bool ground = id.y < 0.5, top = id.y > floors - 0.5;
      bool mid = abs(id.x - floor(nb * 0.5)) < 0.5;
      vec2 O = ${T.plain}, S = vec2(16.0), L = f, G = vec2(1.0);
      bool tiled = true, mural = false, glassWall = false;
      if (st < 1.5) { // mahalla house: courtyard wall and gate on the street, windows elsewhere
        if (top) O = ${T.plain};
        else if (ground && kind > 2.5) O = mid ? ${T.hGate} : (h1 < 0.35 ? ${T.hDuvalVine} : ${T.hDuval});
        else O = h1 < 0.35 ? ${T.hWinCurtain} : ${T.hWin};
      } else if (st < 2.5) { // Soviet panel block: balconies, AC units, pots, shops, murals on the ends
        if (top) { O = ${T.sParapet}; }
        else if (kind > 1.5 && kind < 2.5 && !ground) {
          mural = true; S = vec2(32.0, 48.0);
          O = ${T.mural0} + vec2(mod(floor(seed * 3.7), 4.0) * 32.0, 0.0);
          L = vec2(cell.x / nb, (cell.y - 1.0) / max(floors - 1.0, 1.0)); G = vec2(1.0 / nb, 1.0 / max(floors - 1.0, 1.0));
        }
        else if (ground && kind > 0.5 && kind < 1.5) {
          O = ${T.shop0} + vec2(floor(bHash(vec2(floor(id.x * 0.5), seed)) * 8.0) * 32.0, 0.0);
          S = vec2(32.0, 16.0); L = vec2(fract(cell.x * 0.5), f.y); G = vec2(0.5, 1.0);
        }
        else if (ground) O = (mod(id.x, 4.0) > 0.5 && mod(id.x, 4.0) < 1.5 && nb > 2.5) ? ${T.sEntr} : ${T.sWin};
        else if (hc < 0.38) O = h1 < 0.3 ? ${T.sBalcLaundry} : (h1 < 0.5 ? ${T.sBalcPlants} : ${T.sBalc});
        else O = h1 < 0.12 ? ${T.sWinAC} : (h1 < 0.27 ? ${T.sWinPot} : ${T.sWin});
      } else if (st < 3.5) { // glass tower
        glassWall = true; tiled = false;
      } else if (st < 4.5 || st > 5.5) { // office / civic / monument: arches, ganch, blue tile band
        if (top) { O = ${T.oTile}; L = vec2(f.x, fract((cell.y - floors) * 2.0)); G = vec2(1.0, 2.0); }
        else if (ground && kind > 0.5 && kind < 1.5) {
          O = ${T.shop0} + vec2(floor(bHash(vec2(floor(id.x * 0.5), seed)) * 8.0) * 32.0, 0.0);
          S = vec2(32.0, 16.0); L = vec2(fract(cell.x * 0.5), f.y); G = vec2(0.5, 1.0);
        }
        else if (ground && mid) O = ${T.oDoor};
        else if (st > 5.5) O = mod(id.y, 2.0) < 0.5 ? ${T.oWin} : ${T.oGanch};
        else O = mod(id.y, 2.0) < 0.5 ? ${T.oWinGanch} : ${T.oWin};
      } else O = ${T.iWin}; // industrial
      bool far = ppc.y < 2.6 && !mural;
      // walls seen edge-on squeeze the cells sideways: draw one clean band of glass per floor instead
      // of a squashed tile (which would flicker between mip levels from one pixel to the next)
      bool ribbon = !far && !mural && ppc.x < 4.0 && !(st > 2.5 && st < 3.5);
      vec3 lightC = bHash(id + 3.31 + seed) > 0.8 ? vec3(0.55, 0.85, 1.0) : vec3(1.0, 0.72, 0.28);
      if (ribbon) {
        float valid = step(0.0, id.y) * step(id.y, floors - 0.5);
        float band = step(0.3, f.y) * step(f.y, 0.74) * valid;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.36, 0.76), band * 0.8);
        winLight = band * step(0.55, bHash(vec2(floor(cell.x * 0.5), id.y) * 1.913 + seed)) * lightC * uNight;
        tiled = false; glassWall = false;
      }
      if (glassWall) {
        // glass curtain wall: frames exactly one pixel wide at every distance
        vec2 edge = vec2(greaterThan(floor(cell + (abs(dcx) + abs(dcy)) * 0.5), floor(cell - (abs(dcx) + abs(dcy)) * 0.5)));
        float m = (1.0 - max(edge.x, edge.y)) * step(id.y, floors - 0.5) * step(0.0, id.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.78, 1.0), m);
        winLight = step(0.62, bHash(id * 1.713 + seed * 3.17 + 11.0)) * m * lightC * uNight;
      } else if (far && !ribbon) {
        // flat facade; at night lit windows merge into chunky blocks of light so they never sparkle
        float valid = step(0.0, id.y) * step(id.y, floors - 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.36, 0.76), 0.22 * valid);
        float k = exp2(ceil(log2(3.2 / max(min(ppc.x, ppc.y), 0.02))));
        vec2 g = cell / k, gf = fract(g);
        float lit = step(0.74, bHash(floor(g) * 2.31 + seed));
        winLight = lit * valid * step(0.2, gf.x) * step(gf.x, 0.8) * step(0.25, gf.y) * step(gf.y, 0.75) * lightC * uNight;
      } else if (tiled) {
        // pick the mip from the less squeezed direction (allowing 2x sideways squeeze): mips are
        // isotropic, so a wall seen at an angle would otherwise blur its windows into grey streaks
        float tpx = (abs(dcx.x) + abs(dcy.x)) * S.x * G.x, tpy = (abs(dcx.y) + abs(dcy.y)) * S.y * G.y;
        float sq = clamp(max(tpy, tpx * 0.5) / max(tpx, 1e-5), 0.0, 1.0);
        vec2 gx = vec2(dcx.x * sq, dcx.y), gy = vec2(dcy.x * sq, dcy.y);
        vec4 c = facadeTap(uFacade, O, S, L, G, gx, gy);
        vec4 e = facadeTap(uFacadeGlow, O, S, L, G, gx, gy);
        diffuseColor.rgb = mix(diffuseColor.rgb * c.rgb, c.rgb, c.a);
        float lit = step(0.6, bHash(id * 1.713 + seed * 3.17 + 11.0));
        winLight = (e.r * lit * lightC + e.g * c.rgb * 1.4 + e.b * vec3(1.0, 0.82, 0.45)) * uNight;
        // drainpipes down the ends of house and panel-block walls
        if (st < 2.5 && kind < 0.5 && ((id.x < 0.5 && f.x < 0.12) || (id.x > nb - 1.5 && f.x > 0.88))) diffuseColor.rgb = f.x < 0.06 || f.x > 0.94 ? vec3(0.2, 0.2, 0.36) : vec3(0.48, 0.45, 0.68);
      }
    }
  }
`;
export function makeBuildingMaterial(farFog = false) {
  const mat = toon({ vertexColors: true });
  const atlas = facadeTextures();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = sharedUniforms.uNight;
    shader.uniforms.uFacade = { value: atlas.color };
    shader.uniforms.uFacadeGlow = { value: atlas.glow };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWin;\nattribute vec3 aStyle;\nvarying vec3 vWin;\nvarying vec3 vStyle;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;\nvStyle = aStyle;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        uniform sampler2D uFacade; uniform sampler2D uFacadeGlow;
        varying vec3 vWin;
        varying vec3 vStyle;
        float bHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        // a region of the atlas: o = top-left texel, s = size in texels, l = 0..1 inside it (y up),
        // g = d(l)/d(cell) so the hardware picks the mip from the smooth cell coordinate
        vec4 facadeTap(sampler2D t, vec2 o, vec2 s, vec2 l, vec2 g, vec2 dcx, vec2 dcy) {
          vec2 A = vec2(${atlas.size[0]}.0, ${atlas.size[1]}.0);
          vec2 uv = vec2(o.x + clamp(l.x, 0.0, 0.999) * s.x, A.y - o.y - (1.0 - clamp(l.y, 0.0, 0.999)) * s.y) / A;
          vec2 k = g * s / A;
          return textureGrad(t, uv, dcx * k, dcy * k);
        }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + BUILDING_FRAG)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += winLight;');
    if (farFog) shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FAR_FOG);
  };
  mat.customProgramCacheKey = () => (farFog ? 'building-far' : 'building');
  return mat;
}

// toon material with gentle far fog (landmarks seen across the city)
export function makeFarFogMaterial(params) {
  const mat = toon(params);
  mat.onBeforeCompile = (shader) => { shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FAR_FOG); };
  mat.customProgramCacheKey = () => 'farfog-' + (params.vertexColors ? 'vc' : 'c');
  return mat;
}

// trees: instanced round crowns with smooth normals (clean toon bands), gentle wind sway
export function makeFoliageMaterial(sway = true) {
  const mat = toon({ color: 0xffffff });
  if (sway) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = sharedUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            float sw = sin(uTime * 1.3 + ip.x * 0.21 + ip.z * 0.17) * 0.06 + sin(uTime * 2.7 + ip.x) * 0.02;
            transformed.x += sw * max(position.y + 1.0, 0.0);
            transformed.z += sw * 0.6 * max(position.y + 1.0, 0.0);
          #endif`);
    };
    mat.customProgramCacheKey = () => 'foliage';
  }
  return mat;
}
