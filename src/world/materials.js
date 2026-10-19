// Pixel-art materials: flat colours with 3-band toon shading (MeshToonMaterial + a nearest-filtered
// ramp), hard banded fog, clean pixel building windows, and a second render output with view-space
// normals that the outline pass (fx/pixel.js) uses to find creases.
import * as THREE from 'three';
import { PAL } from './palette.js';

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

// ---------------------------------------------------------------- buildings with clean pixel windows
// aWin = (u in window bays, v in floors, number of window rows); aStyle = (style, seed).
// Near: separate window rectangles with hard edges. Middle: one ribbon of glass per floor.
// Far: a flat facade; at night lit windows merge into chunky blocks of light so they never sparkle.
export function makeBuildingMaterial(farFog = false) {
  const mat = toon({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = sharedUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWin;\nattribute vec2 aStyle;\nvarying vec3 vWin;\nvarying vec2 vStyle;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;\nvStyle = aStyle;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec3 vWin;
        varying vec2 vStyle;
        float bHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 winLight = vec3(0.0);
        if (vStyle.x > 0.5) {
          float st = vStyle.x;
          vec2 ww; float sill;
          if (st < 1.5) { ww = vec2(0.42, 0.46); sill = 0.28; }
          else if (st < 2.5) { ww = vec2(0.5, 0.5); sill = 0.26; }
          else if (st < 3.5) { ww = vec2(0.84, 0.76); sill = 0.12; }
          else if (st < 4.5) { ww = vec2(0.64, 0.56); sill = 0.22; }
          else { ww = vec2(0.82, 0.24); sill = 0.6; }
          vec2 cell = vWin.xy, id = floor(cell), f = fract(cell);
          vec2 ppc = 1.0 / max(fwidth(cell), vec2(1e-4)); // screen pixels per window cell
          float valid = step(0.0, id.y) * step(id.y, vWin.z - 0.5);
          float inX = step(0.5 - ww.x * 0.5, f.x) * step(f.x, 0.5 + ww.x * 0.5);
          float inY = step(sill, f.y) * step(f.y, sill + ww.y);
          bool curtain = st > 2.5 && st < 3.5;
          vec3 glass = curtain ? vec3(0.34, 0.78, 1.0) : vec3(0.1, 0.36, 0.76);
          vec3 lightC = bHash(id + 3.31 + vStyle.y) > 0.8 ? vec3(0.55, 0.85, 1.0) : vec3(1.0, 0.72, 0.28);
          if (ppc.y < 2.6) {
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, 0.22 * valid);
            float k = exp2(ceil(log2(3.2 / max(min(ppc.x, ppc.y), 0.02))));
            vec2 g = cell / k, gf = fract(g);
            float lit = step(0.74, bHash(floor(g) * 2.31 + vStyle.y));
            winLight = lit * valid * step(0.2, gf.x) * step(gf.x, 0.8) * step(0.25, gf.y) * step(gf.y, 0.75) * lightC * uNight;
          } else if (curtain) {
            // glass curtain wall: frames are exactly one pixel wide at every distance (a pixel is a
            // frame if its footprint crosses a cell boundary), so the grid never wobbles
            vec2 fw = fwidth(cell);
            vec2 edge = vec2(greaterThan(floor(cell + fw * 0.5), floor(cell - fw * 0.5)));
            float m = (1.0 - max(edge.x, edge.y)) * valid;
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, m);
            float lit = step(0.62, bHash(id * 1.713 + vStyle.y * 3.17 + 11.0));
            winLight = lit * m * lightC * uNight;
          } else {
            float m = (ppc.x < 3.6 ? inY : inX * inY) * valid;
            if (m > 0.5 && f.y > sill + ww.y * 0.72 && ppc.y > 9.0) glass = vec3(0.34, 0.66, 0.98);
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, m);
            vec2 lid = ppc.x < 3.6 ? vec2(0.0, id.y) : id;
            float lit = step(0.6, bHash(lid * 1.713 + vStyle.y * 3.17 + 11.0));
            winLight = lit * m * lightC * uNight;
          }
        }`)
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
