// Notes in seconds (from the audio transcriber) -> a song for the app.
// Same steps as tools/audio2song/audio2song.py:
//   1. drop quiet ghost notes and overtones the model also reports;
//   2. fit a constant-tempo 16th grid to the onsets (tutorial videos are played from MIDI);
//   3. split hands at a moving point between melody and bass;
//   4. bar length and downbeat from where bass notes cluster, key from the pitch profile.
//
// events: [{ start, dur, midi, amp }] (seconds). Returns a song object (see songs.js).

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

export function cleanNotes(events) {
  const med = median(events.map((e) => e.amp));
  const loud = events.filter((e) => e.amp >= 0.5 * med && e.midi >= 21 && e.midi <= 108);
  // An octave / twelfth / two octaves above a louder note struck at the same moment is
  // almost always that note's overtone, not a key.
  return loud.filter((e) => !loud.some((b) => b !== e && Math.abs(b.start - e.start) < 0.08
    && [12, 19, 24].includes(e.midi - b.midi) && e.amp < 0.75 * b.amp));
}

function fitGrid(ons) {
  let best = null;
  for (let bpm = 50; bpm < 200; bpm += 0.25) {
    const g = 60 / bpm / 4;
    for (let i = 0; i < 24; i++) {
      const ph = (g * i) / 24;
      let e = 0;
      for (const t of ons) { const r = (t - ph) / g; e += Math.min(Math.abs(r - Math.round(r)) * g, 0.06); }
      if (!best || e < best[0]) best = [e, g, ph];
    }
  }
  let [, P, ph] = best;
  for (let it = 0; it < 3; it++) {          // least squares: onset = k * P + ph
    const k = ons.map((t) => Math.round((t - ph) / P));
    const n = k.length, sk = k.reduce((a, b) => a + b, 0), st = ons.reduce((a, b) => a + b, 0);
    let skk = 0, skt = 0;
    for (let i = 0; i < n; i++) { skk += k[i] * k[i]; skt += k[i] * ons[i]; }
    const den = n * skk - sk * sk;
    if (!den) break;
    P = (n * skt - sk * st) / den;
    ph = (st - P * sk) / n;
  }
  let bpm = 60 / P / 4;
  // The fit cannot tell 16ths from 8ths: prefer a tempo in the usual range.
  while (bpm < 66) { bpm *= 2; P /= 2; }
  while (bpm > 170) { bpm /= 2; P *= 2; }
  return { P, ph, bpm };
}

function splitHands(notes, K) {
  let split = 60;
  const hand = new Array(notes.length);
  const byk = new Map();
  K.forEach((k, i) => { if (!byk.has(k)) byk.set(k, []); byk.get(k).push(i); });
  for (const k of [...byk.keys()].sort((a, b) => a - b)) {
    const idx = byk.get(k).sort((a, b) => notes[a].midi - notes[b].midi);
    const ps = idx.map((i) => notes[i].midi);
    let cut = split;
    if (ps.length > 1) {
      let gmax = -1, j = 0;
      for (let q = 0; q < ps.length - 1; q++) if (ps[q + 1] - ps[q] >= gmax) { gmax = ps[q + 1] - ps[q]; j = q; }
      if (gmax >= 5) cut = (ps[j] + ps[j + 1]) / 2;
    }
    for (const i of idx) hand[i] = notes[i].midi < cut ? 'L' : 'R';
    const lows = ps.filter((p) => p < cut), highs = ps.filter((p) => p >= cut);
    if (lows.length && highs.length) split = 0.8 * split + 0.2 * (Math.max(...lows) + Math.min(...highs)) / 2;
  }
  return hand;
}

function detectKey(notes) {
  const pc = new Array(12).fill(0);
  for (const n of notes) pc[n.midi % 12] += n.dur;
  const corr = (prof, t) => {
    const x = pc, y = prof.map((_, i) => prof[(i - t + 12) % 12]);
    const mx = x.reduce((a, b) => a + b) / 12, my = y.reduce((a, b) => a + b) / 12;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < 12; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy || 1);
  };
  let best = null;
  for (let t = 0; t < 12; t++) {
    for (const [prof, mode] of [[MAJ, 'maj'], [MIN, 'min']]) {
      const c = corr(prof, t);
      if (!best || c > best[0]) best = [c, t, mode];
    }
  }
  const [, tonic, mode] = best;
  const fifths = FIFTHS[mode === 'maj' ? tonic : (tonic + 3) % 12];
  let names = fifths >= 0 ? SHARP : FLAT;
  const key = names[tonic] + (mode === 'min' ? 'm' : '');
  if (fifths === 6) names = [...SHARP.slice(0, 5), 'E#', ...SHARP.slice(6)];
  if (fifths === -6) names = [...FLAT.slice(0, 11), 'Cb'];
  const nameOf = (m) => {
    const n = names[m % 12];
    let oct = Math.floor(m / 12) - 1;
    if (n === 'E#') oct = Math.floor((m - 1) / 12) - 1;   // E#4 sounds as F4
    if (n === 'Cb') oct = Math.floor((m + 1) / 12) - 1;   // Cb5 sounds as B4
    return n + oct;
  };
  return { key, nameOf };
}

export function notesToSong(events, { id = 'audio-' + Date.now(), title = 'Из аудио' } = {}) {
  const notes = cleanNotes(events).sort((a, b) => a.start - b.start || a.midi - b.midi);
  if (notes.length < 4) throw new Error('В записи не нашлось нот пианино');
  const ons = notes.map((n) => n.start);
  const { P, ph, bpm } = fitGrid(ons);
  const K = notes.map((n) => Math.round((n.start - ph) / P));
  const KOFF = notes.map((n, i) => Math.max(K[i] + 1, Math.round((n.start + n.dur - ph) / P + 0.25)));
  const hand = splitHands(notes, K);

  // Bars: 4/4 or 3/4, whichever makes bass onsets line up better; downbeat where they cluster.
  const lk = K.filter((_, i) => hand[i] === 'L');
  const bass = lk.length ? lk : K;
  const counts = (L) => { const c = new Map(); for (const k of bass) c.set(((k % L) + L) % L, (c.get(((k % L) + L) % L) || 0) + 1); return c; };
  const conc = (L) => Math.max(...counts(L).values()) / bass.length;
  const [num, den] = conc(12) > conc(16) * 1.15 ? [3, 4] : [4, 4];
  const BAR = num * 16 / den;
  const phase = [...counts(BAR).entries()].sort((a, b) => b[1] - a[1])[0][0];
  const START = Math.min(...K);
  const BAR0 = START + (((phase - START) % BAR) + BAR) % BAR;

  const { key, nameOf } = detectKey(notes);

  // Per hand: notes struck together form a chord; it lasts until released or until the next
  // chord of that hand. Keys are released a little early: a one-16th gap counts as legato.
  const out = [];
  for (const h of ['R', 'L']) {
    const chords = new Map();
    hand.forEach((x, i) => {
      if (x !== h) return;
      if (!chords.has(K[i])) chords.set(K[i], []);
      chords.get(K[i]).push(i);
    });
    const ks = [...chords.keys()].sort((a, b) => a - b);
    ks.forEach((k, j) => {
      const idx = chords.get(k);
      const nxt = j + 1 < ks.length ? ks[j + 1] : Infinity;
      let dur = Math.max(...idx.map((i) => KOFF[i] - k));
      dur = Math.max(1, Math.min(dur, nxt - k));
      if (nxt - (k + dur) === 1) dur = nxt - k;
      for (const m of new Set(idx.map((i) => notes[i].midi))) {
        out.push({ midi: m, beat: (k - START) / 4, dur: dur / 4, hand: h, name: nameOf(m) });
      }
    });
  }
  out.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return {
    id, title, artist: '', bpm: Math.round(bpm), timeSig: [num, den], key,
    pickup: (BAR0 - START) / 4, youtube: '', difficulty: 3, notes: out, warnings: [], source: 'audio',
  };
}
