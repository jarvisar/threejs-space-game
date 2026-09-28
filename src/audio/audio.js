import { RNG } from '../core/rng.js';

// All sound is synthesized with WebAudio, there are no audio files.

const SCALES = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  wholetone: [0, 2, 4, 6, 8, 10],
  minorPent: [0, 3, 5, 7, 10],
};

const MOODS = {
  space: { scales: ['pentatonic', 'lydian'], density: 0.35, bright: 0.6, bells: 0.5 },
  lush: { scales: ['lydian', 'pentatonic', 'mixolydian'], density: 0.6, bright: 0.9, bells: 0.3 },
  ocean: { scales: ['pentatonic', 'lydian'], density: 0.5, bright: 0.8, bells: 0.4 },
  desert: { scales: ['dorian', 'phrygian'], density: 0.4, bright: 0.6, bells: 0.2 },
  frozen: { scales: ['aeolian', 'pentatonic'], density: 0.3, bright: 0.7, bells: 0.8 },
  volcanic: { scales: ['phrygian', 'aeolian'], density: 0.35, bright: 0.35, bells: 0.1 },
  toxic: { scales: ['wholetone', 'dorian'], density: 0.45, bright: 0.5, bells: 0.3 },
  radioactive: { scales: ['minorPent', 'wholetone'], density: 0.4, bright: 0.45, bells: 0.4 },
  barren: { scales: ['minorPent', 'aeolian'], density: 0.25, bright: 0.5, bells: 0.5 },
  dead: { scales: ['minorPent'], density: 0.18, bright: 0.4, bells: 0.6 },
  exotic: { scales: ['wholetone', 'lydian'], density: 0.55, bright: 0.8, bells: 0.6 },
  title: { scales: ['lydian'], density: 0.4, bright: 0.8, bells: 0.5 },
};

function mtof(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicVolume = 0.55;
    this.started = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.6;
    this.reverb.connect(revGain);
    revGain.connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVolume;
    this.music.connect(this.master);
    this.musicRev = ctx.createGain();
    this.musicRev.gain.value = 0.9;
    this.music.connect(this.musicRev);
    this.musicRev.connect(this.reverb);

    this.noiseBuf = this.makeNoise(2);
    this.buildLoops();
    this.mood = null;
    this.nextNote = 0;
    this.nextChord = 0;
    this.started = true;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    return s;
  }

  // ---------------------------------------------------------------- loops

  buildLoops() {
    const ctx = this.ctx;
    const mk = (type, freq) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      return o;
    };
    // ship engine: two detuned saws and noise, all through one lowpass
    const eng = { gain: ctx.createGain(), filter: ctx.createBiquadFilter(), o1: mk('sawtooth', 55), o2: mk('sawtooth', 55.6), sub: mk('sine', 36), noise: this.noiseSource(), nGain: ctx.createGain(), nFilter: ctx.createBiquadFilter() };
    eng.filter.type = 'lowpass';
    eng.filter.frequency.value = 300;
    eng.gain.gain.value = 0;
    eng.o1.connect(eng.filter);
    eng.o2.connect(eng.filter);
    eng.sub.connect(eng.gain);
    eng.filter.connect(eng.gain);
    eng.nFilter.type = 'bandpass';
    eng.nFilter.frequency.value = 700;
    eng.nFilter.Q.value = 0.8;
    eng.noise.connect(eng.nFilter);
    eng.nFilter.connect(eng.nGain);
    eng.nGain.connect(eng.gain);
    eng.nGain.gain.value = 0.3;
    eng.gain.connect(this.sfx);
    eng.o1.start();
    eng.o2.start();
    eng.sub.start();
    eng.noise.start();
    this.engine = eng;

    const wind = { gain: ctx.createGain(), filter: ctx.createBiquadFilter(), noise: this.noiseSource() };
    wind.filter.type = 'bandpass';
    wind.filter.frequency.value = 500;
    wind.filter.Q.value = 0.6;
    wind.noise.connect(wind.filter);
    wind.filter.connect(wind.gain);
    wind.gain.gain.value = 0;
    wind.gain.connect(this.sfx);
    wind.noise.start();
    this.wind = wind;

    const jet = { gain: ctx.createGain(), filter: ctx.createBiquadFilter(), noise: this.noiseSource() };
    jet.filter.type = 'highpass';
    jet.filter.frequency.value = 1200;
    jet.noise.connect(jet.filter);
    jet.filter.connect(jet.gain);
    jet.gain.gain.value = 0;
    jet.gain.connect(this.sfx);
    jet.noise.start();
    this.jet = jet;

    const beam = { gain: ctx.createGain(), o: mk('sawtooth', 120), o2: mk('square', 241), filter: ctx.createBiquadFilter(), lfo: mk('sine', 13), lfoGain: ctx.createGain() };
    beam.filter.type = 'lowpass';
    beam.filter.frequency.value = 1400;
    beam.o.connect(beam.filter);
    beam.o2.connect(beam.filter);
    beam.filter.connect(beam.gain);
    beam.lfo.connect(beam.lfoGain);
    beam.lfoGain.gain.value = 300;
    beam.lfoGain.connect(beam.filter.frequency);
    beam.gain.gain.value = 0;
    beam.gain.connect(this.sfx);
    beam.o.start();
    beam.o2.start();
    beam.lfo.start();
    this.beam = beam;
  }

  setLoop(param, value, rate = 0.08) {
    param.setTargetAtTime(value, this.ctx.currentTime, rate);
  }

  // called every frame with the game state that drives continuous sounds
  update(p) {
    if (!this.ctx) return;
    const e = this.engine;
    const ship = p.shipAudible ? 1 : 0;
    const thr = Math.max(0, p.throttle || 0);
    const drive = ship * (0.05 + thr * 0.09 + p.boost * 0.08 + p.pulse * 0.1);
    this.setLoop(e.gain.gain, drive, 0.15);
    const f = 45 + thr * 30 + p.boost * 25 + p.pulse * 50;
    this.setLoop(e.o1.frequency, f, 0.3);
    this.setLoop(e.o2.frequency, f * 1.012, 0.3);
    this.setLoop(e.filter.frequency, 250 + thr * 500 + p.boost * 900 + p.pulse * 1400, 0.2);
    this.setLoop(e.nFilter.frequency, 500 + p.speedK * 1500 + p.pulse * 2000, 0.2);
    this.setLoop(this.wind.gain.gain, Math.min(0.35, p.wind), 0.3);
    this.setLoop(this.wind.filter.frequency, 300 + p.wind * 900, 0.3);
    this.setLoop(this.jet.gain.gain, p.jet ? 0.12 : 0, 0.05);
    this.setLoop(this.beam.gain.gain, p.beam ? 0.07 : 0, 0.03);
    this.setLoop(this.beam.o.frequency, 110 + (p.beamProgress || 0) * 90, 0.05);
    this.setLoop(this.beam.o2.frequency, 221 + (p.beamProgress || 0) * 180, 0.05);
    this.music.gain.setTargetAtTime(this.musicVolume * (p.musicDuck ? 0.4 : 1), this.ctx.currentTime, 0.5);
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.1);
    this.scheduleMusic();
  }

  // ---------------------------------------------------------------- one shots

  env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(freq, dur, type = 'sine', vol = 0.2, bus, when = 0, sweepTo) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(g);
    g.connect(bus || this.sfx);
    if (bus !== this.music) g.connect(this.reverb);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  noiseHit(dur, freq, q, vol, when = 0, sweepTo) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.01, vol, dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + dur + 0.1);
  }

  click() {
    this.tone(1800, 0.05, 'sine', 0.05);
  }

  ping() {
    this.tone(880, 0.9, 'sine', 0.18, null, 0, 1320);
    this.tone(1320, 0.6, 'sine', 0.08, null, 0.28, 1760);
    this.tone(1760, 0.5, 'sine', 0.05, null, 0.56, 2200);
  }

  pickup(n = 0) {
    const notes = [72, 74, 76, 79, 81, 84];
    this.tone(mtof(notes[n % notes.length]), 0.25, 'triangle', 0.08);
  }

  discovery() {
    [0, 4, 7, 12].forEach((s, i) => this.tone(mtof(76 + s), 1.4, 'sine', 0.1, null, i * 0.11));
  }

  chorus() {
    // the Chorus motif, heard at stones and spires
    const m = [0, 7, 4, 12, 11];
    m.forEach((s, i) => {
      this.tone(mtof(62 + s), 2.5, 'sine', 0.12, null, i * 0.32);
      this.tone(mtof(50 + s), 3.0, 'triangle', 0.05, null, i * 0.32);
    });
  }

  craft() {
    this.tone(660, 0.12, 'square', 0.04);
    this.tone(990, 0.3, 'triangle', 0.08, null, 0.08);
  }

  error() {
    this.tone(220, 0.15, 'square', 0.05);
    this.tone(180, 0.2, 'square', 0.05, null, 0.12);
  }

  alert() {
    this.tone(880, 0.12, 'square', 0.04);
    this.tone(660, 0.12, 'square', 0.04, null, 0.16);
  }

  thud(vol = 0.3) {
    this.tone(70, 0.35, 'sine', vol, null, 0, 35);
    this.noiseHit(0.25, 300, 0.7, vol * 0.6);
  }

  whoosh(dur = 1.2, vol = 0.25) {
    this.noiseHit(dur, 300, 0.8, vol, 0, 2400);
  }

  step() {
    this.noiseHit(0.08, 900 + Math.random() * 500, 1.2, 0.035);
  }

  warpCharge() {
    this.noiseHit(1.6, 200, 0.6, 0.35, 0, 6000);
    this.tone(40, 1.8, 'sawtooth', 0.12, null, 0, 160);
  }

  warpBoom() {
    this.noiseHit(2.5, 1200, 0.4, 0.5, 0, 80);
    this.tone(90, 2.2, 'sine', 0.35, null, 0, 30);
  }

  // ---------------------------------------------------------------- music

  setMood(key, seed) {
    if (!this.ctx) return;
    const def = MOODS[key] || MOODS.space;
    const rng = new RNG(seed >>> 0);
    const scale = SCALES[rng.pick(def.scales)];
    const root = 45 + rng.int(0, 7);
    const id = `${key}:${seed}`;
    if (this.mood && this.mood.id === id) return;
    this.mood = { id, def, scale, root, rng, chord: 0 };
    this.nextChord = 0;
  }

  scheduleMusic() {
    if (!this.mood || this.musicVolume <= 0.001) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const m = this.mood;
    if (now > this.nextChord - 0.2) {
      const degrees = [0, 3, 4, 5, 0, 2];
      m.chord = degrees[Math.floor(Math.random() * degrees.length)];
      const t = Math.max(now, this.nextChord);
      const len = 14 + Math.random() * 10;
      this.pad(m, t, len);
      this.nextChord = t + len - 2.5;
    }
    while (this.nextNote < now + 0.3) {
      const t = Math.max(now, this.nextNote);
      if (Math.random() < m.def.density) {
        const deg = m.chord + Math.floor(Math.random() * 7) - 1;
        const octave = 24 + (Math.random() < 0.3 ? 12 : 0);
        const note = this.degree(m, deg) + octave;
        if (Math.random() < m.def.bells) this.bell(mtof(note), t);
        else this.pluck(mtof(note), t, m.def.bright);
      }
      this.nextNote = t + [0.5, 0.75, 1, 1, 1.5, 2][Math.floor(Math.random() * 6)] * (1.4 - m.def.density);
    }
  }

  degree(m, d) {
    const s = m.scale;
    const oct = Math.floor(d / s.length);
    const i = ((d % s.length) + s.length) % s.length;
    return m.root + s[i] + oct * 12;
  }

  pad(m, t, len) {
    const ctx = this.ctx;
    const notes = [this.degree(m, m.chord), this.degree(m, m.chord + 2), this.degree(m, m.chord + 4), this.degree(m, m.chord) + 12];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 3.5);
    g.gain.setValueAtTime(0.045, t + len - 4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400 + m.def.bright * 500, t);
    f.frequency.linearRampToValueAtTime(700 + m.def.bright * 900, t + len * 0.5);
    f.frequency.linearRampToValueAtTime(400 + m.def.bright * 500, t + len);
    f.connect(g);
    g.connect(this.music);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + len + 0.1);
      }
    }
  }

  pluck(freq, t, bright) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const g = ctx.createGain();
    const dec = 1.6 + Math.random() * 1.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + bright * 0.03, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(this.music);
    o.start(t);
    o2.start(t);
    o.stop(t + dec + 0.1);
    o2.stop(t + dec + 0.1);
  }

  bell(freq, t) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.04, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    g.connect(this.music);
    for (const [mul, v] of [[1, 1], [2.76, 0.35], [5.4, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mul;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + 4.1);
    }
  }
}
