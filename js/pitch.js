// Piano note detection from the microphone.
//
// For every piano key we compute a "salience" from the spectrum: the energy at
// its fundamental plus its first harmonics. A key counts as *struck* (an onset)
// when its salience is clearly above the background and has just jumped up.
// Overtones of a note struck at the same moment (octave, octave+fifth, ...)
// are discarded unless the song actually expects both notes.

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const HARM_W = [1, 0.85, 0.7, 0.55, 0.45, 0.35];
const OVERTONE_INTERVALS = new Set([12, 19, 24, 28, 31, 34, 36]);
const HIST_MS = 140;

export class NoteDetector {
  constructor() {
    this.minMidi = 33; // A1
    this.maxMidi = 100; // E7
    this.sensitivity = 0.5; // 0..1
    this.expected = new Set();
    this.paused = false;
    this.onNote = null; // (midi, info) => void
    this.heard = []; // keys currently sounding (for display)
    this.level = -100; // input level, dBFS
    this.running = false;
  }

  async start(ctx) {
    if (this.running) return;
    this.ctx = ctx;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const src = ctx.createMediaStreamSource(this.stream);
    this.an = ctx.createAnalyser();
    this.an.fftSize = 8192;
    this.an.smoothingTimeConstant = 0;
    this.an.minDecibels = -140;
    this.an.maxDecibels = 0;
    this.anT = ctx.createAnalyser();
    this.anT.fftSize = 1024;
    src.connect(this.an);
    src.connect(this.anT);
    // Safari only runs analysers that are pulled by the destination.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.an.connect(mute);
    this.anT.connect(mute);
    mute.connect(ctx.destination);
    this.src = src;
    this.setup();
    this.running = true;
  }

  stop() {
    if (!this.running) return;
    this.stream.getTracks().forEach((t) => t.stop());
    this.src.disconnect();
    this.running = false;
    this.heard = [];
    this.level = -100;
  }

  setup() {
    const sr = this.ctx.sampleRate;
    const binHz = sr / this.an.fftSize;
    this.binHz = binHz;
    const nyq = Math.min(sr / 2 * 0.95, 6000);
    this.spec = new Float32Array(this.an.frequencyBinCount);
    this.td = new Float32Array(this.anT.fftSize);
    const n = this.maxMidi - this.minMidi + 1;
    this.n = n;
    this.ranges = []; // per key: [[lo, hi] per harmonic]
    for (let i = 0; i < n; i++) {
      const f0 = midiToFreq(this.minMidi + i);
      const r = [];
      for (let h = 1; h <= HARM_W.length; h++) {
        const f = f0 * h;
        if (f > nyq) break;
        const c = Math.round(f / binHz);
        const lo = Math.min(c, Math.floor(f * Math.pow(2, -0.35 / 12) / binHz));
        const hi = Math.max(c, Math.ceil(f * Math.pow(2, 0.35 / 12) / binHz));
        r.push([Math.max(1, lo), hi]);
      }
      this.ranges.push(r);
    }
    this.S = new Float32Array(n);
    this.F = new Float32Array(n);
    this.T = new Float32Array(n); // how much the peak stands out of its surroundings
    this.own = new Uint8Array(n); // the peak really belongs to this key
    this.T0 = new Float32Array(n); // same as T, for the fundamental itself
    this.cents = new Float32Array(n); // detuning of the peak from the key
    this.floorS = new Float32Array(n).fill(NaN);
    this.floorF = new Float32Array(n).fill(NaN);
    this.armed = new Uint8Array(n).fill(1);
    this.lastOn = new Float64Array(n);
    this.hist = []; // [{t, S, F}] for the last HIST_MS
    this.rmsHist = [];
    this.noise = null;
    this.tuning = 0; // how sharp/flat the piano is, cents (learned while playing)
    this.slot = null;
    this.globalT = -1e9;
    this.lastEmit = new Map();
    this.lastT = 0;
    this.startT = 0;
  }

  // Average level (dB) of the spectrum a few bins away from a peak.
  surround(at) {
    const { spec } = this;
    let sum = 0, cnt = 0;
    for (let d = 4; d <= 9; d++) {
      if (at - d > 0) { sum += spec[at - d]; cnt++; }
      if (at + d < spec.length) { sum += spec[at + d]; cnt++; }
    }
    return cnt ? sum / cnt : -200;
  }

  // Call once per animation frame. `now` in ms.
  process(now) {
    if (!this.running) return;
    if (!this.startT) this.startT = now;
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;

    const { spec, td, S, F, T, T0, own, n } = this;
    this.an.getFloatFrequencyData(spec);
    this.anT.getFloatTimeDomainData(td);

    let sum = 0, hf = 0;
    for (let i = 0; i < td.length; i++) {
      sum += td[i] * td[i];
      if (i) hf += (td[i] - td[i - 1]) ** 2;
    }
    const rms = Math.max(-90, 10 * Math.log10(sum / td.length + 1e-12));
    // Level of the sharp part of the sound: jumps the most when a hammer hits.
    const hfc = Math.max(-100, 10 * Math.log10(hf / td.length + 1e-12));
    this.level = rms;

    let smax = -200;
    for (let i = 0; i < n; i++) {
      const r = this.ranges[i];
      let lin = 0;
      const th = this.minMidi + i < 40 ? 1 : 0; // bass keys: judge by the 2nd harmonic
      for (let h = 0; h < r.length; h++) {
        let pk = -200, at = r[h][0];
        for (let k = r[h][0]; k <= r[h][1]; k++) if (spec[k] > pk) { pk = spec[k]; at = k; }
        if (h === 0) {
          F[i] = Math.max(-120, pk);
          T0[i] = pk - this.surround(at);
        }
        if (h === th) {
          T[i] = pk - this.surround(at);
          // Exact peak frequency (parabolic interpolation) must round to this key.
          const a = spec[at - 1], b = spec[at], c = spec[at + 1];
          const den = a - 2 * b + c;
          const off = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0;
          const f = ((at + off) * this.binHz) / (h + 1);
          const semis = 12 * Math.log2(f / 440) + 69 - this.tuning / 100;
          own[i] = Math.round(semis) === this.minMidi + i ? 1 : 0;
          this.cents[i] = 100 * (semis - this.minMidi - i);
        }
        lin += HARM_W[h] * Math.pow(10, pk / 20);
      }
      S[i] = Math.max(-110, 20 * Math.log10(lin + 1e-12));
      if (S[i] > smax) smax = S[i];
    }

    // Background level per key: drifts down quickly and up slowly, so it sits
    // at the quiet end of the noise and ignores the notes themselves.
    const warm = now - this.startT < 600;
    const down = Math.min(1, dt * (warm ? 10 : 4));
    const up = Math.min(1, dt * (warm ? 10 : 0.05));
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(this.floorS[i])) { this.floorS[i] = S[i]; this.floorF[i] = F[i]; continue; }
      this.floorS[i] += (S[i] - this.floorS[i]) * (S[i] < this.floorS[i] ? down : up);
      this.floorF[i] += (F[i] - this.floorF[i]) * (F[i] < this.floorF[i] ? down : up);
    }

    // Room noise: drops at once to any quieter moment (100 ms average) and
    // creeps up only slowly, so long pedalled passages are not taken for noise.
    if (rms > -89.9) { // -90 is digital silence while the mic starts
      const slot = Math.floor(now / 100);
      if (this.slot !== slot) {
        if (this.slot != null && this.slotN) {
          const avg = this.slotSum / this.slotN;
          this.noise = this.noise == null ? avg : Math.min(this.noise, avg);
        }
        this.slot = slot; this.slotSum = 0; this.slotN = 0;
      }
      this.slotSum += rms; this.slotN++;
    }
    if (this.noise != null) this.noise += dt * 0.1;
    const noise = this.noise != null ? this.noise : rms;
    const loud = rms - noise > 8;

    // History for rise detection.
    this.hist.push({ t: now, S: S.slice(), F: F.slice() });
    while (this.hist.length > 2 && now - this.hist[0].t > HIST_MS) this.hist.shift();
    this.rmsHist.push({ t: now, v: rms, hf: hfc });
    while (this.rmsHist.length > 2 && now - this.rmsHist[0].t > 100) this.rmsHist.shift();
    let rmsMin = Infinity, hfMin = Infinity;
    for (const h of this.rmsHist) { rmsMin = Math.min(rmsMin, h.v); hfMin = Math.min(hfMin, h.hf); }
    // The level meter reacts faster than the spectrum: remember when the
    // sound got louder, so a re-struck key that is still ringing counts too.
    if (loud && (rms - rmsMin > 4 || hfc - hfMin > 6) && now - this.globalT > 120) this.globalT = now;

    const presence = 20 - 12 * this.sensitivity; // dB above background
    const riseNeed = presence * 0.5;
    const present = [];
    const cands = [];
    for (let i = 0; i < n; i++) {
      const midi = this.minMidi + i;
      let ok = own[i] && T[i] > 12 && S[i] - this.floorS[i] > presence && S[i] > smax - 30;
      if (ok) ok = midi >= 40 ? F[i] - this.floorF[i] > presence * 0.6
        // Bass keys sound mostly through their overtones, but a real one still
        // has a (weak) peak at its own fundamental.
        : F[i] - this.floorF[i] > presence * 0.35 && T0[i] > 6;
      // How much the key got louder just now, judged both by all its
      // harmonics and by its own fundamental alone.
      let lo = Infinity, loF = Infinity;
      for (const h of this.hist) { lo = Math.min(lo, h.S[i]); loF = Math.min(loF, h.F[i]); }
      const rise = Math.max(S[i] - lo, F[i] - loF);
      if (rise < riseNeed * 0.4) this.armed[i] = 1;
      if (!ok) continue;
      present.push(midi);
      if (warm || !loud) continue;
      const strong = this.armed[i] && rise > riseNeed;
      const restrike = now - this.globalT < 220 && this.lastOn[i] < this.globalT && rise > 3;
      if ((strong || restrike) && now - this.lastOn[i] > 90) cands.push({ midi, i, S: S[i], rise, weak: !strong });
    }
    // For display: drop keys that are just overtones/undertones of a louder key.
    this.heard = present.filter((m) => S[m - this.minMidi] > smax - 18 &&
      !present.some((o) => OVERTONE_INTERVALS.has(Math.abs(m - o)) && F[o - this.minMidi] > F[m - this.minMidi] + 6));
    if (this.debug) this.debug({ now, rms, noise, loud, smax, present, cands: cands.map((c) => c.midi), S, F, floorS: this.floorS, floorF: this.floorF });

    for (const c of cands) { this.armed[c.i] = 0; this.lastOn[c.i] = now; }
    if (this.paused) { this.pending = []; return; }
    if (cands.length > 24) return; // broadband noise (clap, knock) – ignore

    // Onsets wait a moment so that a fundamental detected a frame later can
    // still claim its overtones.
    this.pending = this.pending || [];
    this.recent = (this.recent || []).filter((r) => now - r.t < 160);
    for (const c of cands) {
      c.t = now;
      c.cents = this.cents[c.i];
      this.pending.push(c);
      this.recent.push(c);
    }
    // Unexpected keys wait longer: a piano note holds its pitch, a voice glides.
    const holdFor = (c) => (this.expected.has(c.midi) ? 45 : 130);
    const ready = this.pending.filter((c) => now - c.t >= holdFor(c));
    this.pending = this.pending.filter((c) => now - c.t < holdFor(c));
    const presentNow = new Set(present);
    // A pair of onsets an overtone interval apart is usually one note: the
    // upper one is its overtone, or the lower one a phantom whose own
    // fundamental is missing. Only a real (root) note can explain another.
    const explains = (o, c) => {
      if (o === c || o.weak || Math.abs(o.t - c.t) >= 140 || !presentNow.has(o.midi)) return false;
      if (!OVERTONE_INTERVALS.has(Math.abs(c.midi - o.midi))) return false;
      if (this.expected.has(c.midi) && this.expected.has(o.midi)) return false;
      if (o.midi < c.midi) return F[c.i] < F[o.i] + 12 && isRoot(o);
      return F[c.i] < F[o.i] - 20;
    };
    const isRoot = (x) => !this.recent.some((o) => o.midi < x.midi && explains(o, x));
    for (const c of ready) {
      // The thump of a key or a click fades at once; a real note is still there.
      if (!presentNow.has(c.midi)) continue;
      const explained = this.recent.some((o) => explains(o, c));
      if (this.debugReady) this.debugReady(c.midi, explained, this.recent.filter((o) => explains(o, c)).map((o) => o.midi));
      if (explained) continue;
      let target = c.midi;
      if (!this.expected.has(c.midi)) {
        if (c.weak) continue; // a ringing key that only got a bit louder
        if (Math.abs(this.cents[c.i] - c.cents) > 15 || Math.abs(this.cents[c.i]) > 40) continue;
        // A phantom an octave (or two) below a sounding key.
        if ([12, 19, 24].some((d) => presentNow.has(c.midi + d) && F[c.i] < F[c.i + d] - 15)) continue;
        // An overtone of a key that is already sounding. When that key is
        // expected, it was most likely struck again: its overtones jump
        // more than its own fundamental does.
        const below = present.filter((m) => m < c.midi && OVERTONE_INTERVALS.has(c.midi - m));
        const base = below.find((m) => this.expected.has(m) && F[c.i] < F[m - this.minMidi] - 3);
        if (base !== undefined) target = base;
        else if (below.some((m) => this.expected.has(m) || F[m - this.minMidi] > F[c.i] + 3)) continue;
      }
      if (now - (this.lastEmit.get(target) || -1e9) < 250) continue;
      this.lastEmit.set(target, now);
      const ti = target - this.minMidi;
      if (target === c.midi && this.expected.has(target)) {
        this.tuning = Math.max(-45, Math.min(45, this.tuning + 0.15 * this.cents[c.i]));
      }
      if (this.onNote) this.onNote(target, { strength: S[ti] - smax, rise: c.rise, t: c.t });
    }
  }
}
