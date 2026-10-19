// Keyboard, mouse (pointer lock) and gamepad input.
const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], handbrake: ['Space'], enter: ['KeyF', 'Enter'], use: ['KeyE'],
  reload: ['KeyR'], map: ['KeyM'], pause: ['Escape', 'KeyP'], horn: ['KeyH'], radio: ['KeyQ'], camera: ['KeyC'], job: ['KeyT'],
  w1: ['Digit1'], w2: ['Digit2'], w3: ['Digit3'], w4: ['Digit4'], w5: ['Digit5'], lookBack: ['KeyV'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.buttons = 0; this.clicked = 0;
    this.locked = false;
    this.typed = '';
    this.lastMouseMove = 0;
    this.enabled = true;
    this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: [], prev: [] };
    this.usingPad = false;
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.key.length === 1 && /[a-z]/i.test(e.key)) this.typed = (this.typed + e.key.toUpperCase()).slice(-16);
      this.usingPad = false;
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.buttons = 0; });
    canvas.addEventListener('mousedown', (e) => {
      this.buttons |= 1 << e.button;
      this.clicked |= 1 << e.button;
      if (!this.locked && this.wantLock && !this.lockUnsupported) this.requestLock();
    });
    addEventListener('mouseup', (e) => { this.buttons &= ~(1 << e.button); });
    // Without pointer lock (e.g. embedded browser views that forbid it) the camera follows the
    // free cursor over the game, and keeps turning while the cursor rests at a screen edge.
    this.cursorX = 0.5;
    this.cursorIn = false;
    this.lookActive = true;
    addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX; this.mouseDY += e.movementY;
      } else if (this.wantLock && this.lookActive && e.target === canvas) {
        const clampD = (d) => Math.max(-80, Math.min(80, d || 0));
        if (this.cursorIn) { this.mouseDX += clampD(e.movementX); this.mouseDY += clampD(e.movementY); }
        this.cursorX = e.clientX / Math.max(1, innerWidth);
        this.cursorIn = true;
      } else return;
      this.lastMouseMove = performance.now();
      this.usingPad = false;
    });
    canvas.addEventListener('mouseleave', () => { this.cursorIn = false; });
    document.addEventListener('pointerlockerror', () => { this.onLockError?.(); });
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    this.wantLock = false;
  }

  requestLock() {
    if (this.lockUnsupported || !this.canvas.requestPointerLock) return;
    // the host refuses pointer lock outright: stop asking and use free-cursor look instead
    const giveUp = (e) => { if (e && (e.name === 'WrongDocumentError' || e.name === 'NotSupportedError')) this.lockUnsupported = true; };
    const fallback = () => {
      try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(giveUp); } catch (e) { giveUp(e); }
    };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(fallback);
    } catch { fallback(); }
  }

  // -1..1 while the free cursor rests at the left/right edge (only when not pointer-locked)
  edgeTurn() {
    if (this.locked || !this.wantLock || !this.lookActive || !this.cursorIn || !this.enabled) return 0;
    const x = this.cursorX, m = 0.07;
    if (x < m) return -(1 - x / m);
    if (x > 1 - m) return (x - (1 - m)) / m;
    return 0;
  }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  is(action) {
    if (!this.enabled) return false;
    for (const c of BINDINGS[action]) if (this.down.has(c)) return true;
    return this.padIs(action);
  }
  was(action) {
    if (!this.enabled) return false;
    for (const c of BINDINGS[action]) if (this.pressed.has(c)) return true;
    return this.padWas(action);
  }
  get fire() { return this.enabled && ((this.buttons & 1) !== 0 || this.pad.rt > 0.5 || this.padBtn(5)); }
  get firePressed() { return this.enabled && ((this.clicked & 1) !== 0 || this.padBtnPressed(5)); }
  get aim() { return this.enabled && ((this.buttons & 4) !== 0 || this.pad.lt > 0.5 && !this.inVehicleHint); }
  cheat(code) { if (this.typed.endsWith(code)) { this.typed = ''; return true; } return false; }

  // gamepad (standard mapping)
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = pads && Array.from(pads).find((p) => p && p.connected);
    const P = this.pad;
    P.prev = P.buttons;
    if (!g) { P.buttons = []; P.lx = P.ly = P.rx = P.ry = P.lt = P.rt = 0; return; }
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    P.lx = dz(g.axes[0] || 0); P.ly = dz(g.axes[1] || 0); P.rx = dz(g.axes[2] || 0); P.ry = dz(g.axes[3] || 0);
    P.buttons = g.buttons.map((b) => b.pressed);
    P.lt = g.buttons[6]?.value || 0; P.rt = g.buttons[7]?.value || 0;
    if (P.buttons.some(Boolean) || Math.abs(P.lx) + Math.abs(P.ly) + Math.abs(P.rx) + Math.abs(P.ry) > 0) this.usingPad = true;
  }
  padBtn(i) { return !!this.pad.buttons[i]; }
  padBtnPressed(i) { return !!this.pad.buttons[i] && !this.pad.prev[i]; }
  padIs(action) {
    const P = this.pad;
    switch (action) {
      case 'forward': return P.ly < -0.3; case 'back': return P.ly > 0.3; case 'left': return P.lx < -0.3; case 'right': return P.lx > 0.3;
      case 'sprint': return this.padBtn(0); case 'jump': return this.padBtn(2); case 'handbrake': return this.padBtn(5) || this.padBtn(0);
      case 'horn': return this.padBtn(10);
      default: return false;
    }
  }
  padWas(action) {
    switch (action) {
      case 'enter': return this.padBtnPressed(3); case 'map': return this.padBtnPressed(8); case 'pause': return this.padBtnPressed(9);
      case 'reload': return this.padBtnPressed(1); case 'radio': return this.padBtnPressed(12); case 'camera': return this.padBtnPressed(13);
      case 'use': return this.padBtnPressed(2) && false; case 'job': return this.padBtnPressed(15); case 'jump': return this.padBtnPressed(2);
      default: return false;
    }
  }

  takeMouse() { const dx = this.mouseDX, dy = this.mouseDY; this.mouseDX = this.mouseDY = 0; return [dx, dy]; }
  takeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  endFrame() { this.pressed.clear(); this.clicked = 0; }
}
