// Fully synthesised audio: engine, wind, siren and one-shot cues.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
    this.wanted = false;
    this.wheelieSqueal = 0;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.65;
    this.master.connect(ctx.destination);

    // --- engine: two detuned saws through a lowpass ---
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 3;
    this.engineFilter = filter;
    this.engineOsc = [];
    for (const [type, detune] of [['sawtooth', 0], ['square', 7]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 52;
      o.detune.value = detune;
      o.connect(filter);
      o.start();
      this.engineOsc.push(o);
    }
    filter.connect(this.engineGain);
    this.engineGain.connect(this.master);

    // --- wind / tire noise ---
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 950;
    nf.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(nf); nf.connect(this.windGain); this.windGain.connect(this.master);
    noise.start();

    // --- siren: wailing oscillator ---
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    const siren = ctx.createOscillator();
    siren.type = 'sawtooth';
    siren.frequency.value = 640;
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass'; sf.frequency.value = 1400;
    siren.connect(sf); sf.connect(this.sirenGain); this.sirenGain.connect(this.master);
    siren.start();
    this.siren = siren;

    this.started = true;
    this.applyMute();
  }

  setMuted(m) {
    this.muted = m;
    this.applyMute();
  }

  applyMute() {
    if (!this.started) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.65, this.ctx.currentTime, 0.05);
  }

  setWanted(on) {
    if (!this.started) { this.wanted = on; return; }
    this.wanted = on;
    this.sirenGain.gain.setTargetAtTime(on ? 0.055 : 0, this.ctx.currentTime, 0.25);
  }

  update(dt, { riding = false, speed = 0, throttle = 0, wheelie = 0 } = {}) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const moving = riding ? Math.abs(speed) : 0;
    const f = 46 + moving * 9.5 + throttle * 26;
    for (const o of this.engineOsc) o.frequency.setTargetAtTime(f, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(280 + moving * 44, t, 0.08);
    this.engineGain.gain.setTargetAtTime(riding ? 0.075 + Math.min(0.1, moving * 0.006) : 0, t, 0.1);
    this.windGain.gain.setTargetAtTime(riding ? Math.min(0.12, moving * 0.008) : 0, t, 0.1);
    if (this.wanted) {
      const wail = 620 + Math.sin(t * 4.2) * 260 + Math.sin(t * 1.3) * 90;
      this.siren.frequency.setTargetAtTime(wail, t, 0.05);
    }
    this.wheelieSqueal += ((wheelie > 0.25 ? 1 : 0) - this.wheelieSqueal) * Math.min(1, dt * 6);
    if (!this.squeal && this.started) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 2100;
      g.gain.value = 0;
      o.connect(g); g.connect(this.master); o.start();
      this.squeal = o; this.squealGain = g;
    }
    if (this.squealGain) {
      this.squealGain.gain.setTargetAtTime(this.wheelieSqueal * 0.014, t, 0.08);
      this.squeal.frequency.setTargetAtTime(1900 + Math.sin(t * 30) * 260, t, 0.04);
    }
  }

  blip(freq = 440, dur = 0.08, type = 'square', vol = 0.08) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  cash() {
    if (!this.started) return;
    [784, 988, 1319].forEach((f, i) => setTimeout(() => this.blip(f, 0.12, 'triangle', 0.1), i * 70));
  }

  star() {
    if (!this.started) return;
    [220, 330, 440, 660].forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 'sawtooth', 0.07), i * 65));
  }

  alarm() {
    if (!this.started) return;
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.blip(880, 0.12, 'square', 0.05), i * 190);
      setTimeout(() => this.blip(620, 0.12, 'square', 0.05), i * 190 + 95);
    }
  }

  summon() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.5);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.6);
  }

  bust() {
    if (!this.started) return;
    [660, 440, 330, 220].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'sawtooth', 0.09), i * 130));
  }
}
