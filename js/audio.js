// ---------------------------------------------------------------------------
// audio.js — fully synthesized audio: SFX, ambience and music via Web Audio.
// No audio files; everything is generated with oscillators and shaped noise.
// ---------------------------------------------------------------------------
import { rand, pick, clamp } from './utils.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.soundVolume = 0.8;
    this.musicVolume = 0.6;
    this._ambienceOn = false;
    this._musicOn = false;
    this._rainOn = false;
    this._birdTimer = null;
    this._musicTimer = null;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();

      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      // Gentle limiter so stacked gunshots never clip harshly.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 20;
      comp.ratio.value = 8;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);

      this.soundBus = this.ctx.createGain();
      this.soundBus.gain.value = this.soundVolume;
      this.soundBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.master);

      this._noiseBuffer = this._makeNoiseBuffer(2);
      if (this._ambienceOn) this._startAmbienceNodes();
      if (this._musicOn) this._startMusicNodes();
      if (this._rainOn) this._startRainNodes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() { return !!this.ctx; }

  setSoundVolume(v) {
    this.soundVolume = clamp(v, 0, 1);
    if (this.ctx) this.soundBus.gain.setTargetAtTime(this.soundVolume, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v) {
    this.musicVolume = clamp(v, 0, 1);
    if (this.ctx) this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------- helpers --
  _makeNoiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    return src;
  }

  _env(param, t0, points) {
    param.cancelScheduledValues(t0);
    param.setValueAtTime(points[0][1], t0);
    for (let i = 1; i < points.length; i++) {
      param.exponentialRampToValueAtTime(Math.max(points[i][1], 0.0001), t0 + points[i][0]);
    }
  }

  _osc(type, freq, t0, dur, gainPts, dest, freqEnd = null) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
    const g = this.ctx.createGain();
    this._env(g.gain, t0, gainPts);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  _noise(t0, dur, gainPts, filterType, freq, q, dest, freqEnd = null) {
    const src = this._noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) f.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 10), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g.gain, t0, gainPts);
    src.connect(f).connect(g).connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------------ SFX --
  gunshot() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const bus = this.soundBus;
    // Crack: bright noise snap.
    this._noise(t, 0.14, [[0, 0.9], [0.015, 0.55], [0.14, 0.001]], 'highpass', 900, 0.8, bus);
    // Body: mid thump sweeping down.
    this._noise(t, 0.22, [[0, 0.7], [0.22, 0.001]], 'bandpass', 420, 1.2, bus, 90);
    // Sub boom.
    this._osc('sine', 130, t, 0.2, [[0, 0.85], [0.2, 0.001]], bus, 38);
    // Mechanical click of the action.
    this._noise(t + 0.02, 0.03, [[0, 0.25], [0.03, 0.001]], 'highpass', 3200, 2, bus);
  }

  dryFire() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.04, [[0, 0.3], [0.04, 0.001]], 'highpass', 2500, 3, this.soundBus);
  }

  reload() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, bus = this.soundBus;
    // Magazine out.
    this._noise(t, 0.06, [[0, 0.35], [0.06, 0.001]], 'bandpass', 1400, 4, bus);
    this._osc('square', 220, t, 0.05, [[0, 0.12], [0.05, 0.001]], bus, 160);
    // Magazine in.
    this._noise(t + 0.55, 0.05, [[0, 0.4], [0.05, 0.001]], 'bandpass', 1800, 4, bus);
    // Bolt rack — two metallic clacks.
    this._noise(t + 0.95, 0.05, [[0, 0.45], [0.05, 0.001]], 'highpass', 2600, 3, bus);
    this._noise(t + 1.15, 0.06, [[0, 0.5], [0.06, 0.001]], 'highpass', 1900, 3, bus);
    this._osc('triangle', 340, t + 1.15, 0.07, [[0, 0.2], [0.07, 0.001]], bus, 210);
  }

  bunnyPop() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // Soft dirt "poof".
    this._noise(t, 0.12, [[0, 0.22], [0.12, 0.001]], 'lowpass', 500, 0.7, this.soundBus, 140);
  }

  squeak(fake = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, bus = this.soundBus;
    const base = fake ? rand(1500, 1900) : rand(1100, 1500);
    this._osc('sine', base, t, 0.12, [[0, 0.16], [0.05, 0.12], [0.12, 0.001]], bus, base * 1.5);
  }

  bunnyDeath() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, bus = this.soundBus;
    // Descending squeal.
    this._osc('sawtooth', 950, t, 0.28, [[0, 0.14], [0.28, 0.001]], bus, 260);
    this._osc('sine', 1400, t, 0.2, [[0, 0.12], [0.2, 0.001]], bus, 500);
  }

  hitConfirm() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, bus = this.soundBus;
    // Punchy thud + bright "ding" layer = satisfying feedback.
    this._noise(t, 0.07, [[0, 0.5], [0.07, 0.001]], 'lowpass', 700, 1, bus);
    this._osc('triangle', 1560, t, 0.14, [[0, 0.28], [0.14, 0.001]], bus, 1560);
    this._osc('triangle', 2340, t + 0.03, 0.12, [[0, 0.18], [0.12, 0.001]], bus);
  }

  impactDirt() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.1, [[0, 0.28], [0.1, 0.001]], 'lowpass', 420, 0.8, this.soundBus, 120);
  }

  impactWood() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, bus = this.soundBus;
    this._noise(t, 0.06, [[0, 0.4], [0.06, 0.001]], 'bandpass', 900, 2.5, bus);
    this._osc('triangle', 260, t, 0.06, [[0, 0.18], [0.06, 0.001]], bus, 140);
  }

  uiHover() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 720, t, 0.05, [[0, 0.08], [0.05, 0.001]], this.soundBus, 880);
  }

  uiClick() {
    if (!this.ready) return;
    const t = this.ctx.currentTime, bus = this.soundBus;
    this._osc('sine', 520, t, 0.07, [[0, 0.18], [0.07, 0.001]], bus, 660);
    this._noise(t, 0.02, [[0, 0.1], [0.02, 0.001]], 'highpass', 3000, 2, bus);
  }

  countdownBeep(final = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, bus = this.soundBus;
    const f = final ? 1046 : 660;
    const dur = final ? 0.5 : 0.18;
    this._osc('sine', f, t, dur, [[0, 0.3], [dur, 0.001]], bus);
    this._osc('triangle', f * 2, t, dur * 0.7, [[0, 0.12], [dur * 0.7, 0.001]], bus);
  }

  victory() {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime, bus = this.musicBus;
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.16;
      this._osc('triangle', f, t, 0.34, [[0, 0.22], [0.34, 0.001]], bus);
      this._osc('sine', f / 2, t, 0.34, [[0, 0.14], [0.34, 0.001]], bus);
    });
    this._noise(t0, 0.4, [[0.25, 0.0], [0.3, 0.12], [1.1, 0.001]], 'highpass', 6000, 1, bus);
  }

  // -------------------------------------------------------------- ambience --
  startAmbience() {
    this._ambienceOn = true;
    if (this.ready) this._startAmbienceNodes();
  }

  stopAmbience() {
    this._ambienceOn = false;
    if (this._windGain) {
      const g = this._windGain;
      g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
      setTimeout(() => { try { g.disconnect(); } catch { /* */ } }, 1500);
      this._windGain = null;
    }
    if (this._birdTimer) { clearTimeout(this._birdTimer); this._birdTimer = null; }
  }

  _startAmbienceNodes() {
    if (this._windGain) return;
    const ctx = this.ctx;
    // Wind: looped noise through a slowly wandering lowpass filter.
    const src = this._noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.055, ctx.currentTime, 1.5);
    src.connect(lp).connect(g).connect(this.musicBus);
    src.start();
    this._windGain = g;
    // Slow filter drift.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    const scheduleBird = () => {
      if (!this._ambienceOn || !this.ready) return;
      this._birdChirp();
      this._birdTimer = setTimeout(scheduleBird, rand(2500, 9000));
    };
    scheduleBird();
  }

  _birdChirp() {
    const t = this.ctx.currentTime, bus = this.musicBus;
    const base = rand(2200, 4200);
    const syllables = Math.floor(rand(2, 5));
    for (let i = 0; i < syllables; i++) {
      const tt = t + i * rand(0.09, 0.16);
      const f = base * rand(0.9, 1.15);
      this._osc('sine', f, tt, 0.07, [[0, 0.05], [0.03, 0.04], [0.07, 0.001]], bus, f * rand(1.1, 1.4));
    }
  }

  setRain(on) {
    if (on === this._rainOn) return;
    this._rainOn = on;
    if (!this.ready) return;
    if (on) this._startRainNodes();
    else if (this._rainGain) {
      const g = this._rainGain;
      g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.6);
      setTimeout(() => { try { g.disconnect(); } catch { /* */ } }, 2000);
      this._rainGain = null;
    }
  }

  _startRainNodes() {
    const src = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.8);
    src.connect(bp).connect(g).connect(this.musicBus);
    src.start();
    this._rainGain = g;
  }

  // ----------------------------------------------------------------- music --
  startMenuMusic() {
    if (this._musicOn) return; // idempotent — avoid layered loops
    this._musicOn = true;
    if (this.ready) this._startMusicNodes();
  }

  stopMenuMusic() {
    this._musicOn = false;
    if (this._musicTimer) { clearTimeout(this._musicTimer); this._musicTimer = null; }
  }

  _startMusicNodes() {
    // Dreamy pad progression: Am – F – C – G, one chord every 4s.
    const chords = [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 261.63, 329.63],
      [196.0, 246.94, 293.66],
    ];
    let step = 0;
    const playChord = () => {
      if (!this._musicOn || !this.ready) return;
      const t = this.ctx.currentTime, bus = this.musicBus;
      const chord = chords[step % chords.length];
      step++;
      chord.forEach((f) => {
        this._osc('sawtooth', f * 0.5, t, 4.4, [[0, 0.0001], [0.9, 0.035], [4.4, 0.001]], bus);
        this._osc('sine', f, t, 4.4, [[0, 0.0001], [1.1, 0.05], [4.4, 0.001]], bus);
      });
      // Sparse sparkle melody.
      if (Math.random() < 0.75) {
        const f = pick(chord) * 2;
        this._osc('sine', f, t + rand(0.5, 2.5), 1.4, [[0, 0.0001], [0.2, 0.045], [1.4, 0.001]], bus);
      }
      this._musicTimer = setTimeout(playChord, 4000);
    };
    playChord();
  }
}

export const audio = new AudioEngine();
