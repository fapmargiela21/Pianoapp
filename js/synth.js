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

    // A little room reverb so notes don't sound dry and boxy.
    try {
      const len = Math.round(ctx.sampleRate * 1.6);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.12;
      this.wet.connect(conv);
      conv.connect(comp);
    } catch { this.wet = null; }
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

  // A piano-like note: two slightly detuned "strings", a fast-then-slow decay that is longer
  // for low notes, brightness fading with time, and a soft damper release (no hard cut-off).
  play(midi, when = 0, dur = 0.5, vel = 0.8) {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const f = midiToFreq(midi);
    const low = Math.max(0, Math.min(1, (84 - midi) / 48));      // 1 for low notes, 0 for high
    const ring = 0.9 + 3.6 * low;                                 // natural decay time constant, s
    const peak = 0.3 * vel;
    const end = t + Math.max(0.15, dur);
    const release = 0.18 + 0.22 * low;                            // damper: low strings stop slower
    const stop = end + release * 5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.setTargetAtTime(peak * 0.45, t + 0.005, 0.12);         // quick drop after the hammer
    g.gain.setTargetAtTime(0, t + 0.25, ring);                    // long, slow ring
    g.gain.cancelScheduledValues(end);
    g.gain.setTargetAtTime(0, end, release);                      // key released

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.3;
    lp.frequency.setValueAtTime(Math.min(14000, f * 12), t);
    lp.frequency.setTargetAtTime(Math.min(9000, f * 2.5 + 300), t + 0.01, 0.4 + ring * 0.25);

    const oscs = [-1, 1].map((side) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.wave);
      o.frequency.value = f;
      o.detune.value = side * (1.2 + 1.5 * (1 - low));          // cents
      o.connect(lp);
      o.start(t);
      o.stop(stop);
      return o;
    });
    lp.connect(g);
    g.connect(this.out);
    if (this.wet) g.connect(this.wet);
    oscs[0].onended = () => { g.disconnect(); lp.disconnect(); };
  }
}
