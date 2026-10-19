// Procedural car radio: "Doira FM" (Uzbek folk style) and "Toshkent Pop".
import { mulberry32 } from '../util/math.js';

const semi = (f, n) => f * Math.pow(2, n / 12);

function folkSong(seed) {
  const r = mulberry32(Math.floor(seed * 1e9));
  const bpm = 104 + r() * 26;
  const stepDur = 60 / bpm / 4;
  const root = semi(146.83, [0, 2, 5, -2, 3][Math.floor(r() * 5)]);
  const scale = r() < 0.6 ? [0, 1, 4, 5, 7, 8, 10, 12, 13, 16] : [0, 2, 3, 5, 7, 8, 10, 12, 14, 15]; // hijaz or minor
  // doira usul: B = bum, T = tak, z = jingle
  const usuls = ['B..T.TB.T..TB.T.', 'B.zTB.T.B.zTB.T.', 'B..TB..T.TB.T.T.', 'B.T.zTB.B.T.zT..'];
  const usul = usuls[Math.floor(r() * usuls.length)];
  const phrase = (len) => {
    const notes = [];
    let deg = 4 + Math.floor(r() * 3), step = 0;
    while (step < len) {
      const dur = [1, 2, 2, 2, 3, 4, 4, 6][Math.floor(r() * 8)];
      deg = Math.max(0, Math.min(scale.length - 1, deg + [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)]));
      if (r() < 0.12) { step += dur; continue; }
      notes.push({ step, dur: Math.min(dur, len - step), deg, grace: r() < 0.25 });
      step += dur;
    }
    return notes;
  };
  const A = phrase(32), B = phrase(32), C = phrase(32);
  const form = [A, A, B, A, C, C, B, A];
  const bars = form.length * 2;
  return {
    name: 'Doira FM', stepDur, length: bars * 16,
    play(R, step, t) {
      const inBar = step % 16;
      const ch = usul[inBar];
      if (ch === 'B') R.doiraBum(t, 0.55);
      else if (ch === 'T') R.doiraTak(t, 0.32);
      else if (ch === 'z') R.zang(t, 0.12);
      if (inBar % 4 === 2 && r() < 0.3) R.zang(t, 0.06);
      // dutar drone on the beats
      if (inBar % 4 === 0) R.pluck(t, semi(root, inBar === 0 ? 0 : 7) / 2, stepDur * 3.5, 0.13, 0.5);
      if (inBar % 8 === 6) R.pluck(t, semi(root, 12) / 2, stepDur * 2, 0.08, 0.6);
      // melody
      const ph = form[Math.floor(step / 32) % form.length];
      const local = step % 32;
      for (const n of ph) if (n.step === local) {
        const f = semi(root * 2, scale[n.deg]);
        if (n.grace) R.lead(t, semi(f, 1), stepDur * 0.4, 0.07);
        R.lead(t + (n.grace ? stepDur * 0.35 : 0), f, stepDur * n.dur * 0.95, 0.11);
        if (Math.floor(step / 64) % 2 === 1) R.pluck(t, f, stepDur * n.dur, 0.06, 1);
      }
    },
  };
}

function popSong(seed) {
  const r = mulberry32(Math.floor(seed * 1e9));
  const bpm = 94 + r() * 16;
  const stepDur = 60 / bpm / 4;
  const root = semi(110, [0, 2, 3, 5, -2][Math.floor(r() * 5)]);
  const progs = [[0, -4, 3, -2], [0, -4, -7, -2], [0, 3, -2, -4], [0, -2, -4, -5]];
  const prog = progs[Math.floor(r() * progs.length)];
  const minor = [0, 2, 3, 5, 7, 8, 11, 12, 14, 15];
  const mel = [];
  for (let k = 0; k < 2; k++) {
    const notes = [];
    let deg = 4, s = 0;
    while (s < 64) {
      const dur = [2, 2, 2, 4, 4, 1, 3][Math.floor(r() * 7)];
      deg = Math.max(0, Math.min(minor.length - 1, deg + [-2, -1, 0, 1, 1, 2][Math.floor(r() * 6)]));
      if (r() > 0.15) notes.push({ s, dur, deg });
      s += dur;
    }
    mel.push(notes);
  }
  const bars = 32;
  const bassPat = [0, 3, 6, 8, 11, 14];
  return {
    name: 'Toshkent Pop', stepDur, length: bars * 16,
    play(R, step, t) {
      const bar = Math.floor(step / 16), inBar = step % 16;
      const chord = prog[bar % 4];
      const section = bar < 4 ? 0 : bar < 20 ? 1 : 2;
      if (inBar === 0 || inBar === 8 || (inBar === 10 && r() < 0.5)) R.kick(t, 0.6);
      if (section > 0 && (inBar === 4 || inBar === 12)) R.clap(t, 0.3);
      if (inBar % 2 === 0) R.hat(t, inBar === 14 ? 0.07 : 0.045, inBar === 14);
      if (bassPat.includes(inBar)) R.bass(t, semi(root / 2, chord), stepDur * 1.8, 0.22);
      // plucked arpeggio
      const arp = [0, 7, 12, 3 + (chord === 0 || chord === -5 ? 0 : 1), 7, 12, 15, 7];
      if (inBar % 2 === 0) R.pluck(t, semi(root * 2, chord + arp[(inBar / 2) % 8]), stepDur * 1.6, 0.05, 1.4);
      if (section === 1 || section === 2) {
        const ph = mel[section === 1 ? 0 : 1];
        const local = step % 64;
        for (const n of ph) if (n.s === local) R.lead(t, semi(root * 4, minor[n.deg]), stepDur * n.dur * 0.9, 0.085, true);
      }
    },
  };
}

export class RadioStations {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.noise = noise;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const comp = ctx.createDynamicsCompressor();
    this.bus.connect(hp); hp.connect(comp); comp.connect(out);
    this.stations = [{ name: 'Doira FM 104.0', gen: folkSong }, { name: 'Toshkent Pop 101.5', gen: popSong }, { name: 'Radio off', gen: null }];
    this.index = Math.floor(Math.random() * 2);
    this.active = false;
    this.song = null; this.step = 0; this.nextTime = 0;
  }
  get name() { return this.stations[this.index].name; }
  setActive(a) {
    if (a === this.active) return;
    this.active = a;
    const t = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(a ? 0.55 : 0, t, 0.15);
    if (a) this.nextTime = t + 0.1;
  }
  next() {
    this.index = (this.index + 1) % this.stations.length;
    this.song = null; this.step = 0; this.nextTime = this.ctx.currentTime + 0.15;
    return this.name;
  }
  update() {
    if (!this.active) return;
    const st = this.stations[this.index];
    if (!st.gen) return;
    if (!this.song) { this.song = st.gen(Math.random()); this.step = 0; }
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05;
    while (this.nextTime < now + 0.3) {
      this.song.play(this, this.step, this.nextTime);
      this.nextTime += this.song.stepDur;
      this.step++;
      if (this.step >= this.song.length) { this.song = st.gen(Math.random()); this.step = 0; this.nextTime += 0.9; }
    }
  }

  env(t, g, attack, dur) {
    const n = this.ctx.createGain();
    n.gain.setValueAtTime(0.0001, t);
    n.gain.exponentialRampToValueAtTime(g, t + attack);
    n.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(this.bus);
    return n;
  }
  noiseHit(t, g, dur, type, freq, q = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); f.connect(this.env(t, g, 0.002, dur));
    s.start(t, Math.random(), dur + 0.05);
  }
  osc(t, type, freq, g, attack, dur, endFreq) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur * 0.6);
    o.connect(this.env(t, g, attack, dur));
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  kick(t, g) { this.osc(t, 'sine', 150, g, 0.003, 0.35, 42); }
  clap(t, g) { this.noiseHit(t, g, 0.16, 'bandpass', 1500, 0.7); this.noiseHit(t + 0.012, g * 0.6, 0.12, 'bandpass', 1800, 0.7); }
  hat(t, g, open) { this.noiseHit(t, g, open ? 0.2 : 0.045, 'highpass', 7500); }
  doiraBum(t, g) { this.osc(t, 'sine', 105, g, 0.003, 0.3, 62); this.noiseHit(t, g * 0.25, 0.05, 'lowpass', 600); }
  doiraTak(t, g) { this.noiseHit(t, g, 0.07, 'bandpass', 2800, 1.4); this.osc(t, 'triangle', 420, g * 0.25, 0.002, 0.05); }
  zang(t, g) { this.noiseHit(t, g, 0.14, 'highpass', 6500); this.noiseHit(t + 0.03, g * 0.7, 0.1, 'highpass', 8000); }
  bass(t, f, dur, g) { this.osc(t, 'sine', f, g, 0.01, dur); this.osc(t, 'square', f, g * 0.15, 0.01, dur * 0.8); }
  pluck(t, f, dur, g, bright = 1) {
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(9000, f * 6 * bright), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 1.1), t + Math.min(0.4, dur));
    o.connect(lp); lp.connect(this.env(t, g, 0.004, Math.max(0.12, dur)));
    o.start(t); o.stop(t + dur + 0.1);
  }
  lead(t, f, dur, g, synth = false) {
    const o = this.ctx.createOscillator(); o.type = synth ? 'sawtooth' : 'triangle'; o.frequency.value = f;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 5.4;
    const lg = this.ctx.createGain(); lg.gain.value = synth ? 4 : 9;
    lfo.connect(lg); lg.connect(o.detune);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = synth ? 2400 : 3200;
    const e = this.ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(g, t + 0.035);
    e.gain.setValueAtTime(g, t + Math.max(0.04, dur - 0.08));
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(lp); lp.connect(e); e.connect(this.bus);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.12); lfo.stop(t + dur + 0.12);
  }
}
