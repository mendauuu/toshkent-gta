// All sounds are synthesised with WebAudio: engine, horn, siren, guns, crashes, explosions, UI,
// plus procedurally composed radio stations.
import { RadioStations } from './radio.js';

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.ready = false;
    this.listener = { x: 0, z: 0 };
  }

  // must be called from a user gesture
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine voice
    this.engOsc1 = ctx.createOscillator(); this.engOsc1.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator(); this.engOsc2.type = 'square';
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600; this.engFilter.Q.value = 2;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engOsc1.connect(this.engFilter); this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.sfx);
    this.engOsc1.start(); this.engOsc2.start();
    // tyre screech
    this.skidSrc = ctx.createBufferSource(); this.skidSrc.buffer = this.noise; this.skidSrc.loop = true;
    this.skidFilter = ctx.createBiquadFilter(); this.skidFilter.type = 'bandpass'; this.skidFilter.frequency.value = 1900; this.skidFilter.Q.value = 6;
    this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
    this.skidSrc.connect(this.skidFilter); this.skidFilter.connect(this.skidGain); this.skidGain.connect(this.sfx);
    this.skidSrc.start();
    // siren (shared voice, volume by nearest police car)
    this.sirOsc = ctx.createOscillator(); this.sirOsc.type = 'square';
    this.sirFilter = ctx.createBiquadFilter(); this.sirFilter.type = 'lowpass'; this.sirFilter.frequency.value = 2200;
    this.sirGain = ctx.createGain(); this.sirGain.gain.value = 0;
    this.sirOsc.connect(this.sirFilter); this.sirFilter.connect(this.sirGain); this.sirGain.connect(this.sfx);
    this.sirOsc.start();
    // helicopter thump
    this.heliGain = ctx.createGain(); this.heliGain.gain.value = 0;
    this.heliSrc = ctx.createBufferSource(); this.heliSrc.buffer = this.noise; this.heliSrc.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 220;
    this.heliLfo = ctx.createOscillator(); this.heliLfo.frequency.value = 11;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
    this.heliAmp = ctx.createGain(); this.heliAmp.gain.value = 0.5;
    this.heliLfo.connect(lfoGain); lfoGain.connect(this.heliAmp.gain);
    this.heliSrc.connect(hf); hf.connect(this.heliAmp); this.heliAmp.connect(this.heliGain); this.heliGain.connect(this.sfx);
    this.heliSrc.start(); this.heliLfo.start();
    this.heliLevel = 0;
    // horn voice for the player
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    for (const f of [392, 494]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(this.hornGain); o.start(); }
    const hornF = ctx.createBiquadFilter(); hornF.type = 'lowpass'; hornF.frequency.value = 1800;
    this.hornGain.connect(hornF); hornF.connect(this.sfx);
    this.radio = new RadioStations(ctx, this.music, this.noise);
    this.ready = true;
    this.applySettings();
  }

  applySettings() {
    if (!this.ready) return;
    const s = this.game.settings;
    this.master.gain.value = s.volume;
    this.music.gain.value = s.music;
  }

  // distance attenuation from the camera
  att(x, z, ref = 18, max = 220) {
    const c = this.game.camera.position;
    const d = Math.hypot(x - c.x, z - c.z);
    if (d > max) return 0;
    return Math.min(1, ref / Math.max(ref, d));
  }

  burst({ x, z, dur = 0.2, freq = 1000, q = 1, type = 'lowpass', gain = 0.5, ref = 18, sweep = 0, delay = 0 }) {
    if (!this.ready) return;
    const a = x === undefined ? 1 : this.att(x, z, ref);
    if (a <= 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * a, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  tone({ freq = 440, dur = 0.2, type = 'sine', gain = 0.3, slide = 0, delay = 0, x, z }) {
    if (!this.ready) return;
    const a = x === undefined ? 1 : this.att(x, z);
    if (a <= 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * a, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  gunshot(x, z, kind) {
    const big = kind === 'shotgun', ak = kind === 'ak';
    this.burst({ x, z, dur: big ? 0.45 : ak ? 0.22 : 0.16, freq: big ? 900 : 1800, sweep: 0.15, gain: big ? 0.9 : 0.6, ref: 25 });
    this.tone({ x, z, freq: big ? 90 : 140, slide: 0.4, dur: 0.15, type: 'triangle', gain: 0.5 });
  }
  explosion(x, z) {
    this.burst({ x, z, dur: 1.8, freq: 700, sweep: 0.08, gain: 1.2, ref: 40 });
    this.tone({ x, z, freq: 60, slide: 0.4, dur: 1.2, type: 'sine', gain: 0.9 });
  }
  crash(x, z, k) { this.burst({ x, z, dur: 0.35, freq: 500 + Math.random() * 300, q: 0.8, sweep: 0.3, gain: 0.35 + k * 0.6, ref: 20 }); }
  punch() { this.burst({ dur: 0.08, freq: 300, gain: 0.5 }); this.tone({ freq: 110, slide: 0.5, dur: 0.1, type: 'sine', gain: 0.4 }); }
  whoosh() { this.burst({ dur: 0.12, freq: 2500, type: 'bandpass', q: 2, sweep: 0.4, gain: 0.08 }); }
  reload() { this.tone({ freq: 900, dur: 0.05, type: 'square', gain: 0.08 }); this.tone({ freq: 650, dur: 0.06, type: 'square', gain: 0.08, delay: 0.35 }); }
  click() { this.tone({ freq: 1500, dur: 0.03, type: 'square', gain: 0.05 }); }
  pickup() { [660, 880, 1320].forEach((f, i) => this.tone({ freq: f, dur: 0.12, type: 'triangle', gain: 0.18, delay: i * 0.06 })); }
  cash() { [1046, 1318, 1568, 2093].forEach((f, i) => this.tone({ freq: f, dur: 0.15, type: 'triangle', gain: 0.14, delay: i * 0.05 })); }
  horn(x, z, big) { this.tone({ x, z, freq: big ? 220 : 392, dur: 0.45, type: 'square', gain: 0.12 }); this.tone({ x, z, freq: big ? 277 : 494, dur: 0.45, type: 'square', gain: 0.1 }); }
  missionPassed() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: i === 5 ? 0.6 : 0.16, type: 'triangle', gain: 0.22, delay: i * 0.13 })); }
  missionFailed() { [392, 330, 262].forEach((f, i) => this.tone({ freq: f, dur: 0.35, type: 'sawtooth', gain: 0.12, delay: i * 0.25 })); }
  wasted() { this.tone({ freq: 196, slide: 0.5, dur: 2.2, type: 'sawtooth', gain: 0.2 }); this.burst({ dur: 1.5, freq: 300, gain: 0.3, sweep: 0.2 }); }
  checkpoint() { this.tone({ freq: 880, dur: 0.12, type: 'triangle', gain: 0.2 }); this.tone({ freq: 1320, dur: 0.2, type: 'triangle', gain: 0.2, delay: 0.08 }); }
  heliAt(x, z) { this.heliLevel = Math.max(this.heliLevel, this.att(x, z, 40, 400) * 0.35); }
  nextStation() { if (!this.ready) return; const name = this.radio.next(); this.game.hud.radio(name); }

  update(dt) {
    if (!this.ready) return;
    const g = this.game, p = g.player, v = p.vehicle, t = this.ctx.currentTime;
    // engine
    if (v && !v.destroyed) {
      const sp = Math.abs(v.speedF), top = v.type.maxSpeed;
      const gears = v.type.L > 6 ? 4 : 5;
      const gearSize = top / gears;
      const gear = Math.min(gears - 1, Math.floor(sp / gearSize));
      const rpm = 0.25 + ((sp - gear * gearSize) / gearSize) * 0.75 * (1 - gear * 0.05);
      const thr = Math.abs(v.ctrl.throttle);
      const base = v.type.L > 6 ? 32 : v.typeId === 'sport' ? 70 : 48;
      const f = base + rpm * base * 2.2;
      this.engOsc1.frequency.setTargetAtTime(f, t, 0.05);
      this.engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      this.engFilter.frequency.setTargetAtTime(300 + thr * 900 + rpm * 500, t, 0.08);
      this.engGain.gain.setTargetAtTime(0.06 + thr * 0.07, t, 0.1);
      this.skidGain.gain.setTargetAtTime(v.skid && sp > 5 ? 0.09 : 0, t, 0.05);
      this.hornGain.gain.setTargetAtTime(v.horn && v.typeId !== 'police' ? 0.1 : 0, t, 0.02);
    } else {
      this.engGain.gain.setTargetAtTime(0, t, 0.15);
      this.skidGain.gain.setTargetAtTime(0, t, 0.05);
      this.hornGain.gain.setTargetAtTime(0, t, 0.02);
    }
    // nearest siren
    let siren = 0;
    for (const veh of g.vehicles.list) if (veh.sirenOn) siren = Math.max(siren, this.att(veh.x, veh.z, 25, 320));
    const wail = 650 + Math.sin(g.time * 2.4) * 280;
    this.sirOsc.frequency.setTargetAtTime(wail, t, 0.03);
    this.sirGain.gain.setTargetAtTime(siren * 0.07, t, 0.1);
    this.heliGain.gain.setTargetAtTime(this.heliLevel, t, 0.2);
    this.heliLevel = 0;
    // radio plays only inside vehicles
    this.radio.setActive(!!v && !v.destroyed && !g.paused);
    this.radio.update();
  }

  setPaused(p) { if (this.ctx) { if (p) this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05); else this.applySettings(); } }
}
