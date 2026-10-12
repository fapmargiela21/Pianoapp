// Runs js/pitch.js on a recording without a browser: a stand-in for the Web Audio analysers
// computes the same spectra (Blackman window, dB) frame by frame, so results are exact and fast.
//
//   node tools/e2e/offline-detect.mjs recording.wav [expected.json] [out.json]
//
// recording.wav: mono 16-bit PCM (ffmpeg -i in.m4a -ac 1 -ar 48000 out.wav).
// expected.json: [{s: seconds, p: midi}] — the notes really played (e.g. from Transkun); when given,
// the detector is told to expect each note from 0.4 s before it (as in "wait" mode) and a score is printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { NoteDetector } from '../../js/pitch.js';

function readWav(path) {
  const b = readFileSync(path);
  let p = 12, sr = 48000, data = null, bits = 16, ch = 1;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(p + 10); sr = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); }
    if (id === 'data') { data = b.subarray(p + 8, p + 8 + len); break; }
    p += 8 + len + (len & 1);
  }
  if (bits !== 16) throw new Error('need 16-bit PCM');
  const n = data.length / 2 / ch, y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = data.readInt16LE(i * 2 * ch) / 32768;
  return { sr, y };
}

function fft(re, im) {                     // in place, radix 2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// Mimics AnalyserNode: the last fftSize samples, Blackman window, |X|/N in dB.
class FakeAnalyser {
  constructor(src, fftSize) {
    this.src = src; this.fftSize = fftSize; this.frequencyBinCount = fftSize / 2;
    this.win = Float32Array.from({ length: fftSize }, (_, i) => 0.42 - 0.5 * Math.cos(2 * Math.PI * i / fftSize) + 0.08 * Math.cos(4 * Math.PI * i / fftSize));
    this.re = new Float64Array(fftSize); this.im = new Float64Array(fftSize);
  }
  frame(out) {
    const { y, pos } = this.src, N = this.fftSize;
    for (let i = 0; i < N; i++) { const k = pos - N + i; out[i] = k >= 0 ? y[k] : 0; }
  }
  getFloatTimeDomainData(out) { this.frame(out); }
  getFloatFrequencyData(out) {
    const N = this.fftSize, { re, im } = this;
    const t = new Float32Array(N); this.frame(t);
    for (let i = 0; i < N; i++) { re[i] = t[i] * this.win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) out[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / N + 1e-20);
  }
}

export function detect(wavPath, expected = null, { fps = 60, tune } = {}) {
  const { sr, y } = readWav(wavPath);
  const src = { y, pos: 0 };
  const d = new NoteDetector();
  if (tune) tune(d);
  d.ctx = { sampleRate: sr };
  d.an = new FakeAnalyser(src, 8192);
  d.anT = new FakeAnalyser(src, 1024);
  d.setup();
  d.running = true;
  const log = [];
  d.onNote = (m, info) => log.push({ t: src.pos / sr, p: m });
  const step = sr / fps;
  for (let f = 0; f * step < y.length; f++) {
    src.pos = Math.round(f * step);
    const t = src.pos / sr;
    if (expected) d.expected = new Set(expected.filter((n) => t > n.s - 0.4 && t < n.s + 1.0).map((n) => n.p));
    d.process(t * 1000 + 1000);
  }
  return log;
}

// Matches detections to the notes played: right (same key, within -0.05..+0.25 s), missed, extra.
export function score(log, ref, { lo = 21, hi = 108 } = {}) {
  const inRange = ref.filter((n) => n.p >= lo && n.p <= hi);
  const used = new Set();
  const hit = [], miss = [];
  for (const n of inRange) {
    const i = log.findIndex((d, k) => !used.has(k) && d.p === n.p && d.t - n.s > -0.05 && d.t - n.s < 0.25);
    if (i >= 0) { used.add(i); hit.push({ ...n, delay: log[i].t - n.s }); } else miss.push(n);
  }
  const extra = log.filter((_, k) => !used.has(k));
  return { total: inRange.length, hit, miss, extra };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [wav, expPath, outPath] = process.argv.slice(2);
  const exp = expPath ? JSON.parse(readFileSync(expPath)) : null;
  const log = detect(wav, exp);
  if (outPath) writeFileSync(outPath, JSON.stringify(log));
  if (exp) {
    const d = new NoteDetector();
    const r = score(log, exp, { lo: d.minMidi, hi: d.maxMidi });
    const names = 'C C# D D# E F F# G G# A A# B'.split(' '), nm = (p) => names[p % 12] + (Math.floor(p / 12) - 1);
    console.log(`heard right ${r.hit.length}/${r.total} (${Math.round(100 * r.hit.length / r.total)}%), extra ${r.extra.length}`);
    console.log('missed:', r.miss.map((n) => `${nm(n.p)}@${n.s.toFixed(1)}`).join(' '));
    console.log('extra:', r.extra.map((n) => `${nm(n.p)}@${n.t.toFixed(1)}`).join(' '));
  } else console.log(JSON.stringify(log));
}
