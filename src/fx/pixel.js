// Pixel-art output: the scene renders into a small canvas (about 480x270) that the browser scales
// up by a whole number with nearest-neighbour filtering, so every art pixel is a crisp block of the
// same size, while the DOM HUD on top stays at full resolution.

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

// Sizes the renderer's drawing buffer to that internal resolution and lays the canvas over the
// window at exactly that scale (centred; when the window is not an exact multiple, at most
// scale-1 device pixels are cropped at the edges).
export function fitPixelCanvas(renderer, canvas, targetHeight) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(innerWidth * dpr)), H = Math.max(1, Math.round(innerHeight * dpr));
  const scale = pixelScale(H, targetHeight);
  const width = Math.ceil(W / scale), height = Math.ceil(H / scale);
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const s = canvas.style;
  s.width = `${(width * scale) / dpr}px`;
  s.height = `${(height * scale) / dpr}px`;
  s.left = `${Math.floor((W - width * scale) / 2) / dpr}px`;
  s.top = `${Math.floor((H - height * scale) / 2) / dpr}px`;
  return { width, height, scale };
}
