// A small piano-like synthesizer for the "listen" mode and on-screen keys.
import { midiToFreq } from './pitch.js';

export class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.out = ctx.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(comp);
    comp.connect(ctx.destination);
    const n = 12;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    const amps = [0, 1, 0.55, 0.3, 0.22, 0.12, 0.08, 0.05, 0.035, 0.02, 0.015, 0.01];
    for (let i = 1; i < n; i++) imag[i] = amps[i];
    this.wave = ctx.createPeriodicWave(real, imag);
  }

  // Metronome / count-in tick: filtered noise, so the pitch detector ignores it.
  click(accent = false) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    if (!this.noise) {
      const len = Math.round(ctx.sampleRate * 0.04);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = accent ? 3200 : 2200;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = accent ? 1.6 : 1.0;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.out);
    src.start(t);
  }

  play(midi, when = 0, dur = 0.5, vel = 0.8) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const f = midiToFreq(midi);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(12000, f * 10), t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(8000, f * 3), t + 0.6);
    const g = ctx.createGain();
    const peak = 0.32 * vel;
    const decay = 0.35 + 1.4 * Math.max(0, (90 - midi) / 60);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.setTargetAtTime(peak * 0.25, t + 0.006, decay * 0.35);
    const end = t + Math.max(0.12, dur);
    g.gain.setTargetAtTime(0, end, 0.08);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.out);
    osc.start(t);
    osc.stop(end + 0.6);
    osc.onended = () => { g.disconnect(); lp.disconnect(); };
  }
}
