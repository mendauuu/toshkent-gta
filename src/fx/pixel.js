// Pixel-art output pipeline. The scene renders at a low internal resolution (about 480x270) into a
// target holding colour, view-space normals (second output, see the chunk patch in world/materials.js)
// and depth. An outline pass darkens the outer edge pixels of every object (depth jumps) and sharp
// creases (normal jumps), exactly one internal pixel wide. The result is then copied onto a canvas
// that matches the screen's physical pixels 1:1, blown up by an exact whole number with a
// nearest-neighbour hardware blit, so neither the browser nor Windows display scaling ever smooths
// it. The DOM HUD on top stays at full resolution.
import * as THREE from 'three';
import { PAL } from '../world/palette.js';

// internal heights offered in Settings (low, medium, high); the width follows the window shape
export const PIXEL_HEIGHTS = [180, 270, 360];

// whole-number scale whose internal height is nearest `target`; Low/Medium/High always get different
// scales when the window allows it (at 900 px both 270 and 360 would otherwise round to x3)
function pixelScale(H, target) {
  let s = Math.max(1, Math.round(H / Math.max(1, target)));
  const i = PIXEL_HEIGHTS.indexOf(target);
  if (i > 0) s = Math.max(1, Math.min(s, pixelScale(H, PIXEL_HEIGHTS[i - 1]) - 1));
  return s;
}

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// 1 / view distance is linear across flat surfaces in screen space, so its second difference is ~0
// on any plane and strongly negative on the near side of a silhouette: the outline lands on the
// object's own outer pixels and is exactly one pixel thick. Output is sRGB-encoded for the blit.
const OUTLINE_FRAG = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tNormal; uniform sampler2D tDepth;
uniform vec2 uTexel; uniform float uNear, uFar, uFogNear, uFogFar, uOn;
uniform vec3 uInk;
varying vec2 vUv;
float invZ(vec2 uv) { float d = texture2D(tDepth, uv).x; return (uFar - d * (uFar - uNear)) / (uNear * uFar); }
vec4 nrm(vec2 uv) { vec4 n = texture2D(tNormal, uv); return vec4(n.xyz * 2.0 - 1.0, n.a); }
void main() {
  vec4 col = texture2D(tColor, vUv);
  vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
  float c = invZ(vUv), l = invZ(vUv - dx), r = invZ(vUv + dx), d = invZ(vUv - dy), u = invZ(vUv + dy);
  float dist = 1.0 / max(c, 1e-6);
  // silhouettes: a neighbour well behind the plane through this pixel and its opposite neighbour
  float sil = step(0.22 * c, -min(l + r - 2.0 * c, d + u - 2.0 * c));
  // creases: the normal turns sharply towards the right or upper neighbour on the same surface
  float crease = 0.0;
  vec4 n0 = nrm(vUv);
  if (n0.a > 0.5 && dist < 160.0) {
    vec4 nr = nrm(vUv + dx), nu = nrm(vUv + dy);
    if (nr.a > 0.5 && dot(n0.xyz, nr.xyz) < 0.55 && abs(r - c) < 0.2 * c) crease = 1.0;
    if (nu.a > 0.5 && dot(n0.xyz, nu.xyz) < 0.55 && abs(u - c) < 0.2 * c) crease = 1.0;
  }
  // fade with the same hard fog steps the scene uses, so the far city is not a mess of lines
  float fog = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  float k = fog < 0.34 ? 1.0 : fog < 0.67 ? 0.5 : 0.0;
  vec3 dark = col.rgb * 0.16 + uInk * 0.5;
  if (sil > 0.5) col.rgb = mix(col.rgb, dark, k * uOn);
  else if (crease > 0.5) col.rgb = mix(col.rgb, col.rgb * 0.42, k * uOn);
  gl_FragColor = sRGBTransferOETF(vec4(clamp(col.rgb, 0.0, 1.0), 1.0));
}`;

// fallback when the hardware blit is unavailable: the same exact integer nearest-neighbour upscale
const UPSCALE_FRAG = /* glsl */ `
uniform sampler2D tLow; uniform vec2 uOffset; uniform float uScale;
varying vec2 vUv;
void main() {
  ivec2 p = ivec2(floor((gl_FragCoord.xy - uOffset) / uScale));
  gl_FragColor = vec4(texelFetch(tLow, p, 0).rgb, 1.0);
}`;

export class PixelPipeline {
  constructor(renderer, canvas) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.width = 1; this.height = 1; this.scale = 1;
    this.outlines = new URLSearchParams(location.search).get('outline') !== '0';
    // 8-bit targets: sRGB colour (hardware decodes for the outline pass, blends in linear), plain normals
    const rtOpts = { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, stencilBuffer: false };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, count: 2, depthBuffer: true, depthTexture: new THREE.DepthTexture(1, 1) });
    this.sceneRT.textures[0].colorSpace = THREE.SRGBColorSpace;
    this.lineRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
    const [cTex, nTex] = this.sceneRT.textures;
    this.outlineMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: OUTLINE_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: cTex }, tNormal: { value: nTex }, tDepth: { value: this.sceneRT.depthTexture }, uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.3 }, uFar: { value: 9000 }, uFogNear: { value: 300 }, uFogFar: { value: 650 }, uOn: { value: this.outlines ? 1 : 0 },
        uInk: { value: new THREE.Color(PAL.ink) },
      },
    });
    this.upscaleMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: UPSCALE_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tLow: { value: this.lineRT.texture }, uOffset: { value: new THREE.Vector2() }, uScale: { value: 1 } },
    });
    // one fullscreen triangle, drawn with either pass material
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(tri, this.outlineMat);
    this.quad.frustumCulled = false;
    this.post = new THREE.Scene();
    this.post.add(this.quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blit = new URLSearchParams(location.search).get('blit') !== '0';
    // exact physical size of the canvas (Windows 125%/150% scaling gives fractional CSS sizes)
    this.devW = Math.max(1, Math.round(innerWidth * devicePixelRatio));
    this.devH = Math.max(1, Math.round(innerHeight * devicePixelRatio));
    this.exact = false;
    this.onDeviceResize = null;
    try {
      this.observer = new ResizeObserver(([e]) => {
        const s = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
        if (!s) return;
        this.exact = true;
        if (s.inlineSize !== this.devW || s.blockSize !== this.devH) { this.devW = s.inlineSize; this.devH = s.blockSize; this.onDeviceResize?.(); }
      });
      this.observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch { this.observer = null; /* fall back to window size x devicePixelRatio */ }
  }

  // fit the internal resolution nearest `targetHeight` to the canvas at a whole-number scale
  resize(targetHeight) {
    if (!this.exact) {
      this.devW = Math.max(1, Math.round(innerWidth * devicePixelRatio));
      this.devH = Math.max(1, Math.round(innerHeight * devicePixelRatio));
    }
    const W = this.devW, H = this.devH;
    const s = pixelScale(H, targetHeight);
    const w = Math.ceil(W / s), h = Math.ceil(H / s);
    this.width = w; this.height = h; this.scale = s;
    this.offX = Math.floor((W - w * s) / 2); this.offY = Math.floor((H - h * s) / 2);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.sceneRT.setSize(w, h);
    this.lineRT.setSize(w, h);
    this.outlineMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.upscaleMat.uniforms.uScale.value = s;
    this.upscaleMat.uniforms.uOffset.value.set(this.offX, this.offY);
    return this;
  }

  render(scene, camera) {
    const r = this.renderer, U = this.outlineMat.uniforms;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    U.uNear.value = camera.near; U.uFar.value = camera.far;
    if (scene.fog) { U.uFogNear.value = scene.fog.near; U.uFogFar.value = scene.fog.far; }
    this.quad.material = this.outlineMat;
    r.setRenderTarget(this.lineRT);
    r.render(this.post, this.postCam);
    r.setRenderTarget(null);
    // hardware nearest-neighbour copy of the low-res image onto the physical-pixel canvas
    const fb = this.blit && r.properties.get(this.lineRT).__webglFramebuffer;
    if (fb) {
      const gl = r.getContext(), x = this.offX, y = this.offY;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      gl.blitFramebuffer(0, 0, this.width, this.height, x, y, x + this.width * this.scale, y + this.height * this.scale, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    } else {
      this.quad.material = this.upscaleMat;
      r.render(this.post, this.postCam);
    }
  }

  // compile the scene's shaders for the render target they will actually draw into
  compile(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.compile(scene, camera);
    r.setRenderTarget(null);
  }
}
