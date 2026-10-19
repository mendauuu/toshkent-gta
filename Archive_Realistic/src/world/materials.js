// Custom materials built on three.js Lambert/Standard materials via onBeforeCompile so they keep
// lights, shadows and fog.
import * as THREE from 'three';

// shared uniforms driven by the environment (time of day) and the game clock
export const sharedUniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
};

const NOISE_GLSL = /* glsl */ `
float gHash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

// Fog that fades tall/far objects more gently so the skyline stays visible.
const FAR_FOG = /* glsl */ `
#ifdef USE_FOG
  float fogFactor = smoothstep( fogNear, fogFar * 3.2, vFogDepth ) * 0.92;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

// ---------------------------------------------------------------- ground layers (no depth writes)
export function makeGroundMaterial({ noiseScale = 0.35, noiseAmp = 0.12, order = 0 } = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false });
  const u = { uNoiseScale: { value: noiseScale }, uNoiseAmp: { value: noiseAmp } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vGroundPos;\nuniform float uNoiseScale;\nuniform float uNoiseAmp;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gn = gNoise(vGroundPos * uNoiseScale) * 0.55 + gNoise(vGroundPos * uNoiseScale * 4.7) * 0.3 + gNoise(vGroundPos * 0.031) * 0.15;
        diffuseColor.rgb *= 1.0 + (gn - 0.5) * 2.0 * uNoiseAmp;`);
  };
  mat.customProgramCacheKey = () => 'ground';
  mat.userData.order = order;
  return mat;
}

// ---------------------------------------------------------------- road markings (dashes in shader)
export function makeMarkingMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aDash;\nvarying vec2 vDash;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDash = aDash;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDash;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vDash.y > 0.5 && vDash.y < 1.5 && fract(vDash.x / 9.0) > 0.36) discard;
        if (vDash.y > 1.5 && fract(vDash.x / 1.2) > 0.5) discard;`);
  };
  mat.customProgramCacheKey = () => 'marking';
  return mat;
}

// ---------------------------------------------------------------- water
export function makeWaterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3f6f7e, roughness: 0.08, metalness: 0.05, depthWrite: false, envMapIntensity: 1.1 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec2 vWPos;\n${NOISE_GLSL}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          vec2 p = vWPos * 0.45;
          float n1 = gNoise(p + vec2(uTime * 0.35, uTime * 0.2));
          float n2 = gNoise(p * 2.3 - vec2(uTime * 0.25, -uTime * 0.31));
          vec3 pert = vec3(n1 - 0.5, 0.0, n2 - 0.5) * 0.32;
          normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => 'water';
  return mat;
}

// ---------------------------------------------------------------- buildings with procedural windows
// aWin = (u in window bays, v in floors, number of window rows); aStyle = (style, seed)
export function makeBuildingMaterial(farFog = false) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
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
          if (st < 1.5) { ww = vec2(0.34, 0.42); sill = 0.30; }
          else if (st < 2.5) { ww = vec2(0.44, 0.46); sill = 0.28; }
          else if (st < 3.5) { ww = vec2(0.88, 0.80); sill = 0.10; }
          else if (st < 4.5) { ww = vec2(0.64, 0.55); sill = 0.22; }
          else { ww = vec2(0.82, 0.20); sill = 0.62; }
          vec2 cell = vWin.xy;
          vec2 id = floor(cell);
          vec2 f = fract(cell);
          vec2 fw = max(fwidth(cell), vec2(1e-4));
          float x0 = 0.5 - ww.x * 0.5, x1 = 0.5 + ww.x * 0.5, y0 = sill, y1 = sill + ww.y;
          float mx = smoothstep(x0 - fw.x, x0 + fw.x, f.x) * (1.0 - smoothstep(x1 - fw.x, x1 + fw.x, f.x));
          float my = smoothstep(y0 - fw.y, y0 + fw.y, f.y) * (1.0 - smoothstep(y1 - fw.y, y1 + fw.y, f.y));
          float valid = step(0.0, id.y) * step(id.y, vWin.z - 0.5);
          float lod = clamp(max(fw.x, fw.y) * 2.2 - 0.35, 0.0, 1.0);
          float m = mix(mx * my, ww.x * ww.y * 0.85, lod) * valid;
          float rnd = bHash(id + vStyle.y);
          vec3 glass = mix(vec3(0.13, 0.17, 0.22), vec3(0.32, 0.4, 0.48), rnd * 0.6 + f.y * 0.4);
          if (st > 2.5 && st < 3.5) glass = mix(vec3(0.2, 0.3, 0.38), vec3(0.48, 0.6, 0.68), rnd * 0.45 + f.y * 0.55);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, m);
          float lit = step(0.56, bHash(id * 1.713 + vStyle.y * 3.17 + 11.0));
          vec3 lc = mix(vec3(1.0, 0.74, 0.42), vec3(0.8, 0.88, 1.0), step(0.72, bHash(id + 3.31 + vStyle.y)));
          winLight = lit * m * lc * uNight * 1.25;
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += winLight;');
    if (farFog) shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FAR_FOG);
  };
  mat.customProgramCacheKey = () => (farFog ? 'building-far' : 'building');
  return mat;
}

// generic lambert material with gentle far fog (landmarks seen across the city)
export function makeFarFogMaterial(params) {
  const mat = new THREE.MeshLambertMaterial(params);
  mat.onBeforeCompile = (shader) => { shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', FAR_FOG); };
  mat.customProgramCacheKey = () => 'farfog-' + (params.vertexColors ? 'vc' : 'c') + (params.flatShading ? 'f' : '');
  return mat;
}

// trees: instanced, gentle wind sway on the crowns
export function makeFoliageMaterial(sway = true) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
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
