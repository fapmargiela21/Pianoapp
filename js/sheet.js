// Sheet-music view: a grand staff that scrolls under a fixed playhead,
// with the keyboard below (drawn by PianoView).
// Music symbols come from the Bravura font (SMuFL): 1 em = 4 staff spaces.
import { PianoView } from './render.js';

const GL = {
  brace: '', gClef: '', fClef: '',
  head: { 4: '', 2: '', x: '' },
  rest: { 4: '', 2: '', 1: '', 0.5: '', 0.25: '', 0.125: '' },
  flagUp: { 0.5: '', 0.25: '', 0.125: '' },
  flagDown: { 0.5: '', 0.25: '', 0.125: '' },
  acc: { 1: '', '-1': '', 0: '', 2: '', '-2': '' },
  dot: '',
  digit: (d) => String.fromCharCode(0xe080 + d),
};
const HEAD_W = 1.18;
const STEM_W = 0.12;
const LETTER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6, H: 6 };
const ACC = { '': 0, '#': 1, '##': 2, x: 2, b: -1, bb: -2 };
const FIFTHS = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};
const SHARP_ORDER = 'FCGDAEB';
const FLAT_ORDER = 'BEADGCF';
const TREBLE_SHARPS = [38, 35, 39, 36, 33, 37, 34]; // F5 C5 G5 D5 A4 E5 B4
const TREBLE_FLATS = [34, 37, 33, 36, 32, 35, 31]; // B4 E5 A4 D5 G4 C5 F4
const STAFF = { R: { top: 38, clef: 'gClef', clefStep: 32 }, L: { top: 26, clef: 'fClef', clefStep: 24 } };

// [length in quarters, written value, dots, triplet]
const VALUES = [
  [4, 4, 0], [3, 2, 1], [2, 2, 0], [1.5, 1, 1], [1, 1, 0], [2 / 3, 1, 0, 1], [0.75, 0.5, 1], [0.5, 0.5, 0],
  [1 / 3, 0.5, 0, 1], [0.375, 0.25, 1], [0.25, 0.25, 0], [1 / 6, 0.25, 0, 1], [0.125, 0.125, 0],
];

const INK = '#1d1f22';
const GREY = '#b9bdc2';
export const SHEET_COLORS = { ink: INK, grey: GREY, current: '#0e7c74', done: '#3a9a6a', good: '#2fa462', bad: '#e5484d' };

// Key signature in fifths from "G", "Am", "F# minor", "Eb major"...
export function keyFifths(key) {
  const m = /^\s*([A-G])([#b]?)\s*(m|min|minor|moll)?\b/i.exec(key || '');
  if (!m) return 0;
  const tonic = m[1].toUpperCase() + m[2];
  if (!m[3]) return FIFTHS[tonic] ?? 0;
  // minor: relative major is a minor third up
  const majorOf = {
    A: 'C', E: 'G', B: 'D', 'F#': 'A', 'C#': 'E', 'G#': 'B', 'D#': 'F#', 'A#': 'C#',
    D: 'F', G: 'Bb', C: 'Eb', F: 'Ab', Bb: 'Db', Eb: 'Gb', Ab: 'Cb',
  };
  return FIFTHS[majorOf[tonic]] ?? 0;
}

function parseName(name) {
  const m = /^([A-H])(##|#|bb|b|x)?(-?\d)$/.exec(name);
  if (!m) return { step: 28, letter: 'C', acc: 0 };
  return { step: parseInt(m[3], 10) * 7 + LETTER[m[1]], letter: m[1] === 'H' ? 'B' : m[1], acc: ACC[m[2] || ''] };
}

export class SheetView extends PianoView {
  constructor(canvas) {
    super(canvas);
    this.song = null;
    this.zoom = 1;
  }

  setSong(song) {
    this.song = song;
    this.fifths = keyFifths(song.key);
    this.engrave();
    this.layout();
  }

  // ------------------------------------------------------------ engraving (in beats)

  engrave() {
    const song = this.song;
    const [num, den] = song.timeSig;
    const measure = (num * 4) / den;
    let end = 0;
    for (const n of song.notes) end = Math.max(end, n.beat + n.dur);
    const bars = [];
    let b = 0;
    if (song.pickup > 0) { bars.push({ start: 0, end: song.pickup }); b = song.pickup; }
    while (b < end - 1e-3 || !bars.length) { bars.push({ start: b, end: b + measure }); b += measure; }
    this.bars = bars;
    this.endBeat = bars[bars.length - 1].end;
    this.beamUnit = den === 8 ? 1.5 : 1;

    const hands = ['R', 'L'].filter((h) => song.notes.some((n) => n.hand === h));
    this.hands = hands.length ? hands : ['R'];
    this.staves = {};
    for (const h of this.hands) this.staves[h] = this.engraveHand(song.notes.filter((n) => n.hand === h), h);
  }

  barAt(beat) {
    for (const bar of this.bars) if (beat < bar.end - 1e-6) return bar;
    return this.bars[this.bars.length - 1];
  }

  // Splits [a, b) into written values, breaking at bar lines.
  pieces(a, b) {
    const out = [];
    let t = a;
    let guard = 0;
    while (b - t > 0.03 && guard++ < 64) {
      const bar = this.barAt(t);
      const segEnd = Math.min(b, bar.end);
      const rem = segEnd - t;
      const pos = t - bar.start;
      // Triplet values only when the length is not a plain binary one.
      const tripletish = Math.abs(rem * 16 - Math.round(rem * 16)) > 0.15;
      let pick = VALUES.find(([len, , , trip]) => len <= rem + 0.02 && !!trip === tripletish &&
        (len < 2 || Math.abs(pos - Math.round(pos)) < 0.02));
      if (!pick) pick = VALUES[VALUES.length - 1];
      out.push({ beat: t, len: pick[0], val: pick[1], dots: pick[2], trip: !!pick[3], bar });
      t += pick[0];
    }
    return out;
  }

  engraveHand(notes, hand) {
    const chords = [];
    for (const n of notes) {
      const last = chords[chords.length - 1];
      if (last && Math.abs(n.beat - last.beat) < 0.05) last.notes.push(n);
      else chords.push({ beat: n.beat, notes: [n] });
    }
    const syms = [];
    const rest = (a, b) => {
      for (const p of this.pieces(a, b)) {
        const prev = syms[syms.length - 1];
        // A completely empty bar gets one whole rest in its middle.
        if (Math.abs(p.beat - p.bar.start) < 1e-3 && p.beat + p.len >= p.bar.end - 1e-3 && p.bar.end - p.bar.start > 1) {
          syms.push({ rest: true, beat: p.beat, val: 4, dots: 0, barRest: true, bar: p.bar });
        } else if (prev && prev.barRest && prev.bar === p.bar) {
          continue;
        } else {
          syms.push({ rest: true, beat: p.beat, val: p.val, dots: p.dots, trip: p.trip, bar: p.bar });
        }
      }
    };
    let t = this.bars[0].start;
    chords.forEach((c, i) => {
      if (c.beat < t - 0.03) return; // overlapping voice: skip (rare in these arrangements)
      if (c.beat > t + 0.03) rest(t, c.beat);
      let dur = Math.max(...c.notes.map((n) => n.dur));
      if (chords[i + 1]) dur = Math.min(dur, chords[i + 1].beat - c.beat);
      const ps = this.pieces(c.beat, c.beat + dur);
      if (!ps.length) ps.push({ beat: c.beat, len: dur, val: 0.25, dots: 0, trip: false, bar: this.barAt(c.beat) });
      const heads = c.notes.map((n) => ({ n, ...parseName(n.name) })).sort((a, b) => a.step - b.step);
      ps.forEach((p, k) => syms.push({
        beat: p.beat, val: p.val, dots: p.dots, trip: p.trip, bar: p.bar, heads,
        first: k === 0, tieNext: k < ps.length - 1, notes: c.notes,
      }));
      t = c.beat + ps.reduce((s, p) => s + p.len, 0);
    });
    if (this.endBeat - t > 0.03) rest(t, this.endBeat);

    // Accidentals: written when they differ from the key signature or from an
    // earlier note on the same line in the bar.
    const keyAcc = {};
    for (let i = 0; i < Math.abs(this.fifths); i++) keyAcc[(this.fifths > 0 ? SHARP_ORDER : FLAT_ORDER)[i]] = this.fifths > 0 ? 1 : -1;
    let bar = null;
    let state = {};
    for (const s of syms) {
      if (s.bar !== bar) { bar = s.bar; state = {}; }
      if (s.rest) continue;
      for (const h of s.heads) {
        const cur = state[h.step] ?? keyAcc[h.letter] ?? 0;
        h.showAcc = s.first && cur !== h.acc ? h.acc : null;
        state[h.step] = h.acc;
      }
    }

    // Beams: runs of eighths or shorter inside one beat unit (no rests between).
    let group = null;
    for (const s of syms) {
      const beamable = !s.rest && s.val <= 0.5;
      const unit = Math.floor((s.beat - s.bar.start + 1e-6) / this.beamUnit);
      if (beamable && group && group.bar === s.bar && group.unit === unit) {
        group.syms.push(s);
      } else {
        group = beamable ? { bar: s.bar, unit, syms: [s] } : null;
      }
      s.group = group;
    }
    for (const s of syms) if (s.group && s.group.syms.length < 2) s.group = null;

    // Stem directions (by the note furthest from the middle line).
    const mid = STAFF[hand].top - 4;
    const dirOf = (list) => {
      let far = 0;
      for (const s of list) for (const h of s.heads) if (Math.abs(h.step - mid) > Math.abs(far)) far = h.step - mid;
      return far > 0 ? -1 : 1; // 1 = up
    };
    for (const s of syms) {
      if (s.rest) continue;
      s.dir = s.group ? (s.group.dir ??= dirOf(s.group.syms)) : dirOf([s]);
    }
    return syms;
  }

  // ------------------------------------------------------------ layout (pixels)

  layout() {
    super.layout();
    if (!this.song || !this.W) return;
    const sheetH = this.hitY;
    const two = this.hands.length === 2;
    this.sp = Math.max(7, Math.min(13, sheetH / (two ? 21 : 13)));
    const sp = this.sp;
    const gap = 7 * sp;
    const total = two ? 8 * sp + gap : 4 * sp;
    const top = Math.max(3.5 * sp, (sheetH - total) / 2);
    this.staffTop = {};
    if (two) { this.staffTop.R = top; this.staffTop.L = top + 4 * sp + gap; } else this.staffTop[this.hands[0]] = top;
    this.sysTop = top;
    this.sysBottom = top + total;

    // Horizontal spacing proportional to time, wide enough for the shortest notes.
    const onsets = [...new Set(this.song.notes.map((n) => Math.round(n.beat * 1000) / 1000))].sort((a, b) => a - b);
    const iois = [];
    for (let i = 1; i < onsets.length; i++) iois.push(onsets[i] - onsets[i - 1]);
    iois.sort((a, b) => a - b);
    const minIoi = iois.length ? iois[Math.floor(iois.length * 0.1)] : 1;
    this.ppb = Math.max(7 * sp, Math.min(26 * sp, (3.6 * sp) / Math.max(0.1, minIoi))) * this.zoom;
    this.playX = Math.round(this.W * 0.3);

    const nKey = Math.abs(this.fifths);
    this.headerW = sp * (1.5 + 3.4 + (nKey ? nKey * 1.05 + 0.6 : 0) + 2.4 + 2.6);
    this.stickyW = sp * (1.2 + 3.4 + (nKey ? nKey * 1.05 + 0.6 : 0));
    for (const h of this.hands) this.layoutBeams(this.staves[h], h);
  }

  yOf(hand, step) {
    return this.staffTop[hand] + ((STAFF[hand].top - step) * this.sp) / 2;
  }

  layoutBeams(syms, hand) {
    const sp = this.sp;
    const done = new Set();
    for (const s of syms) {
      if (s.rest) continue;
      if (!s.group) {
        const outer = s.dir > 0 ? s.heads[s.heads.length - 1] : s.heads[0];
        const inner = s.dir > 0 ? s.heads[0] : s.heads[s.heads.length - 1];
        let len = 3.5 * sp;
        // Stems of notes far outside the staff reach the middle line.
        const midY = this.yOf(hand, STAFF[hand].top - 4);
        const y = this.yOf(hand, outer.step);
        if (s.dir > 0 && y - len > midY) len = y - midY;
        if (s.dir < 0 && y + len < midY) len = midY - y;
        s.stemFrom = this.yOf(hand, inner.step);
        s.stemTo = y - s.dir * len;
        continue;
      }
      const g = s.group;
      if (done.has(g)) continue;
      done.add(g);
      const xs = g.syms.map((m) => m.beat * this.ppb);
      const outerY = g.syms.map((m) => this.yOf(hand, (g.dir > 0 ? m.heads[m.heads.length - 1] : m.heads[0]).step));
      const x0 = xs[0], x1 = xs[xs.length - 1];
      const dy = Math.max(-sp, Math.min(sp, outerY[outerY.length - 1] - outerY[0]));
      const slope = x1 > x0 ? dy / (x1 - x0) : 0;
      let y0 = g.dir > 0 ? Infinity : -Infinity;
      g.syms.forEach((m, i) => {
        const want = outerY[i] - g.dir * 3.25 * sp - slope * (xs[i] - x0);
        y0 = g.dir > 0 ? Math.min(y0, want) : Math.max(y0, want);
      });
      g.beam = { x0, y0, slope };
      g.syms.forEach((m) => {
        const inner = g.dir > 0 ? m.heads[0] : m.heads[m.heads.length - 1];
        m.stemFrom = this.yOf(hand, inner.step);
        m.stemTo = y0 + slope * (m.beat * this.ppb - x0);
      });
    }
  }

  // ------------------------------------------------------------ drawing

  draw(s) {
    const { g, W, hitY } = this;
    if (!W || !this.song) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#f3f3f1';
    g.fillRect(0, 0, W, hitY);

    const sp = this.sp;
    const off = this.playX - s.viewBeat * this.ppb; // screen x of beat 0
    this.off = off;
    g.save();
    g.beginPath();
    g.rect(0, 0, W, hitY);
    g.clip();

    // Staff lines.
    g.fillStyle = '#5b5f66';
    const lineH = Math.max(1, 0.13 * sp);
    const startX = Math.max(0, off + this.bars[0].start * this.ppb - this.headerW);
    const endX = Math.min(W, off + this.endBeat * this.ppb);
    for (const h of this.hands) {
      g.fillStyle = this.handActive(s, h) ? '#5b5f66' : '#c9ccd0';
      for (let i = 0; i < 5; i++) g.fillRect(startX, this.staffTop[h] + i * sp - lineH / 2, endX - startX, lineH);
    }

    // Bar lines.
    const two = this.hands.length === 2;
    for (const bar of this.bars) {
      const x = off + bar.end * this.ppb - 1.6 * sp;
      if (x < -10 || x > W + 10) continue;
      const last = bar === this.bars[this.bars.length - 1];
      g.fillStyle = '#5b5f66';
      if (last) {
        g.fillRect(x - 0.7 * sp, this.sysTop, 0.16 * sp, this.sysBottom - this.sysTop);
        g.fillRect(x - 0.2 * sp, this.sysTop, 0.5 * sp, this.sysBottom - this.sysTop);
      } else if (two) {
        for (const h of this.hands) g.fillRect(x, this.staffTop[h], Math.max(1, 0.16 * sp), 4 * sp);
        g.fillStyle = '#c9ccd0';
        g.fillRect(x, this.staffTop.R + 4 * sp, Math.max(1, 0.16 * sp), this.staffTop.L - this.staffTop.R - 4 * sp);
      } else {
        g.fillRect(x, this.sysTop, Math.max(1, 0.16 * sp), 4 * sp);
      }
    }

    // Opening clefs, key and time signature.
    const hx = off + this.bars[0].start * this.ppb - this.headerW;
    if (hx > -this.headerW - 50) this.drawHeader(s, hx, true);

    // Notes.
    g.font = `${4 * sp}px Bravura`;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    for (const h of this.hands) this.drawStaff(s, h, off);

    // Sticky clefs once the beginning has scrolled away.
    if (hx < 0) {
      // Also hide what is left of the scrolled-away time signature.
      const solid = Math.max(this.stickyW, Math.min(hx + this.headerW - 2 * sp, this.stickyW + 6 * sp));
      const grad = g.createLinearGradient(solid, 0, solid + 2 * sp, 0);
      grad.addColorStop(0, 'rgba(243,243,241,1)');
      grad.addColorStop(1, 'rgba(243,243,241,0)');
      g.fillStyle = '#f3f3f1';
      g.fillRect(0, 0, solid, hitY);
      g.fillStyle = grad;
      g.fillRect(solid, 0, 2 * sp, hitY);
      this.drawHeader(s, 0.2 * sp, false);
    }

    // Playhead.
    g.fillStyle = s.wrongFlash ? 'rgba(229,72,77,0.55)' : 'rgba(110,160,156,0.55)';
    const ph = { x: this.playX - 0.45 * sp, y: this.sysTop - 3.5 * sp, w: 0.9 * sp, h: this.sysBottom - this.sysTop + 7 * sp };
    this.roundRect(ph.x, ph.y, ph.w, ph.h, ph.w / 2);
    g.fill();
    g.restore();

    if (s.countIn) {
      g.fillStyle = 'rgba(14,124,116,0.9)';
      g.font = `700 ${8 * sp}px -apple-system, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(String(s.countIn), this.playX + 9 * sp, this.sysTop + (this.sysBottom - this.sysTop) / 2 + 3 * sp);
      g.textAlign = 'left';
    }

    this.drawKeyboard(s);
  }

  roundRect(x, y, w, h, r) {
    const g = this.g;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  handActive(s, h) {
    return s.hands === 'both' || s.hands === h;
  }

  drawHeader(s, x, withTime) {
    const { g } = this;
    const sp = this.sp;
    const two = this.hands.length === 2;
    g.font = `${4 * sp}px Bravura`;
    g.textBaseline = 'alphabetic';
    g.fillStyle = INK;
    if (two) {
      // Brace and the line joining the staves.
      const h = this.sysBottom - this.sysTop;
      g.save();
      g.translate(x + 0.1 * sp, this.sysBottom);
      g.scale(1, h / (4 * sp));
      g.fillText(GL.brace, 0, 0);
      g.restore();
      g.fillRect(x + 0.9 * sp, this.sysTop, Math.max(1, 0.16 * sp), h);
    } else {
      g.fillRect(x + 0.9 * sp, this.sysTop, Math.max(1, 0.16 * sp), 4 * sp);
    }
    for (const h of this.hands) {
      g.fillStyle = this.handActive(s, h) ? INK : GREY;
      let cx = x + 1.5 * sp;
      g.fillText(GL[STAFF[h].clef], cx, this.yOf(h, STAFF[h].clefStep));
      cx += 3.4 * sp;
      const n = Math.abs(this.fifths);
      if (n) {
        const steps = this.fifths > 0 ? TREBLE_SHARPS : TREBLE_FLATS;
        for (let i = 0; i < n; i++) {
          g.fillText(GL.acc[this.fifths > 0 ? 1 : -1], cx + i * 1.05 * sp, this.yOf(h, steps[i] - (h === 'L' ? 14 : 0)));
        }
        cx += n * 1.05 * sp + 0.6 * sp;
      }
      if (withTime) {
        const [num, den] = this.song.timeSig;
        const mid = this.staffTop[h] + 2 * sp;
        const digits = (v) => String(v).split('').map((d) => GL.digit(+d)).join('');
        const nw = g.measureText(digits(num)).width;
        const dw = g.measureText(digits(den)).width;
        const w = Math.max(nw, dw);
        g.fillText(digits(num), cx + (w - nw) / 2, mid - sp);
        g.fillText(digits(den), cx + (w - dw) / 2, mid + sp);
      }
    }
  }

  noteColor(s, n) {
    if (n.step < 0) return GREY;
    if (s.practice === 'play' && s.noteState) {
      const st = s.noteState.get(n);
      if (st === 'hit') return SHEET_COLORS.good;
      if (st === 'miss') return SHEET_COLORS.bad;
      if (Math.abs(n.beat - s.viewBeat) <= 0.15) return SHEET_COLORS.current;
      return INK;
    }
    if (s.mode === 'listen') {
      return n.beat <= s.viewBeat && s.viewBeat < n.beat + n.dur ? SHEET_COLORS.current : INK;
    }
    if (n.step < s.cur) return SHEET_COLORS.done;
    if (n.step === s.cur) {
      if (s.got.has(n.midi)) return SHEET_COLORS.good;
      return s.wrongFlash ? SHEET_COLORS.bad : SHEET_COLORS.current;
    }
    return INK;
  }

  drawStaff(s, hand, off) {
    const { g, W } = this;
    const sp = this.sp;
    const syms = this.staves[hand];
    const active = this.handActive(s, hand);
    const top = this.staffTop[hand];
    const topStep = STAFF[hand].top;
    const lineW = Math.max(1, 0.16 * sp);
    const drawn = new Set();

    for (let i = 0; i < syms.length; i++) {
      const m = syms[i];
      const cx = off + m.beat * this.ppb; // centre of the notehead
      if (cx < -6 * sp || cx > W + 6 * sp) continue;

      if (m.rest) {
        g.fillStyle = active ? INK : GREY;
        const mid = top + 2 * sp;
        if (m.barRest) {
          const bx = off + ((m.bar.start + m.bar.end) / 2) * this.ppb - 1.3 * sp; // middle of the bar
          g.fillText(GL.rest[4], bx, mid - sp);
        } else {
          const glyph = GL.rest[m.val] || GL.rest[0.125];
          const y = m.val === 4 ? mid - sp : mid;
          g.fillText(glyph, cx - 0.55 * sp, y);
          if (m.dots) g.fillText(GL.dot, cx + 0.9 * sp, mid - 0.5 * sp);
        }
        continue;
      }

      const color = (h) => this.noteColor(s, h.n);
      const left = cx - (HEAD_W * sp) / 2;
      const dir = m.val >= 4 ? 1 : m.dir;

      // Seconds in a chord sit on the other side of the stem.
      const order = dir > 0 ? m.heads : [...m.heads].reverse();
      const shift = new Map();
      let prev = null;
      for (const h of order) {
        const disp = prev && Math.abs(h.step - prev.step) === 1 && !shift.get(prev);
        shift.set(h, disp ? dir * (HEAD_W - STEM_W) * sp : 0);
        prev = h;
      }

      // Ledger lines.
      g.fillStyle = active ? '#5b5f66' : '#c9ccd0';
      const lo = m.heads[0].step, hi = m.heads[m.heads.length - 1].step;
      const ext = 0.4 * sp;
      const lw = (HEAD_W * sp) + 2 * ext + (Math.max(...[...shift.values()].map(Math.abs)) || 0);
      const lx = left - ext + Math.min(0, ...shift.values());
      for (let st = topStep + 2; st <= hi; st += 2) g.fillRect(lx, this.yOf(hand, st) - lineW / 2, lw, lineW);
      for (let st = topStep - 10; st >= lo; st -= 2) g.fillRect(lx, this.yOf(hand, st) - lineW / 2, lw, lineW);

      // Glow behind the notes waiting at the playhead.
      if (m.first && active && m.notes.some((n) => n.step === s.cur && n.step >= 0) && s.practice === 'wait' && s.mode === 'wait') {
        const y0 = this.yOf(hand, hi) - sp, y1 = this.yOf(hand, lo) + sp;
        g.fillStyle = s.wrongFlash ? 'rgba(229,72,77,0.18)' : 'rgba(14,124,116,0.14)';
        this.roundRect(left - 0.8 * sp, y0, HEAD_W * sp + 1.6 * sp, y1 - y0, 0.8 * sp);
        g.fill();
      }

      // Accidentals.
      const accX = [];
      for (const h of [...m.heads].reverse()) {
        if (h.showAcc == null) continue;
        const y = this.yOf(hand, h.step);
        let col = 0;
        while (accX.some((a) => a.col === col && Math.abs(a.y - y) < 2.6 * sp)) col++;
        accX.push({ col, y });
        g.fillStyle = color(h);
        g.fillText(GL.acc[h.showAcc], left - (1.25 + col * 1.15) * sp + Math.min(0, shift.get(h)), y);
      }

      // Heads.
      const glyph = m.val >= 4 ? GL.head[4] : m.val >= 2 ? GL.head[2] : GL.head.x;
      for (const h of m.heads) {
        g.fillStyle = color(h);
        g.fillText(glyph, left + shift.get(h), this.yOf(hand, h.step));
      }

      // Dots.
      if (m.dots) {
        for (const h of m.heads) {
          const onLine = (topStep - h.step) % 2 === 0;
          g.fillStyle = color(h);
          g.fillText(GL.dot, left + HEAD_W * sp + 0.35 * sp + Math.max(0, shift.get(h)), this.yOf(hand, h.step) - (onLine ? 0.5 * sp : 0));
        }
      }

      const mainColor = color(dir > 0 ? m.heads[0] : m.heads[m.heads.length - 1]);

      // Stem and flag.
      if (m.val < 4) {
        const sx = dir > 0 ? left + (HEAD_W - STEM_W) * sp : left;
        g.fillStyle = mainColor;
        const to = m.group ? this.beamY(m.group, sx, off) : m.stemTo;
        const y0 = Math.min(m.stemFrom, to), y1 = Math.max(m.stemFrom, to);
        g.fillRect(sx, y0 + (dir > 0 ? 0 : 0.17 * sp), STEM_W * sp, y1 - y0 - 0.17 * sp);
        if (m.val <= 0.5 && !m.group) {
          g.fillText((dir > 0 ? GL.flagUp : GL.flagDown)[m.val] || GL.flagUp[0.125], sx, m.stemTo);
        }
      }

      // Beams (drawn once per group, from its first member).
      if (m.group && !drawn.has(m.group)) {
        drawn.add(m.group);
        // One colour for the beam only when the whole group shares it.
        const cols = new Set(m.group.syms.map((x) => this.noteColor(s, x.heads[0].n)));
        this.drawBeams(s, m.group, off, hand, cols.size === 1 ? mainColor : active ? INK : GREY);
      }

      // Ties to the next piece of the same notes.
      if (m.tieNext) {
        const next = syms[i + 1];
        if (next && !next.rest) {
          const nx = off + next.beat * this.ppb - (HEAD_W * sp) / 2;
          for (const h of m.heads) {
            g.fillStyle = color(h);
            this.tie(left + HEAD_W * sp + 0.15 * sp, nx - 0.15 * sp, this.yOf(hand, h.step), dir > 0 ? 1 : -1);
          }
        }
      }

      // Fingering.
      if (m.first) {
        const fingers = m.heads.filter((h) => h.n.finger);
        if (fingers.length) {
          g.save();
          g.font = `600 ${1.5 * sp}px -apple-system, system-ui, sans-serif`;
          g.textAlign = 'center';
          g.fillStyle = active ? INK : GREY;
          const above = hand === 'R';
          const edge = above
            ? Math.min(top - 1.2 * sp, this.yOf(hand, hi) - 1.4 * sp, dir > 0 ? m.stemTo - 0.6 * sp : Infinity)
            : Math.max(top + 5.2 * sp, this.yOf(hand, lo) + 2.4 * sp, dir < 0 ? m.stemTo + 1.8 * sp : -Infinity);
          const list = above ? fingers : [...fingers].reverse();
          list.forEach((h, k) => g.fillText(String(h.n.finger), cx, above ? edge - k * 1.5 * sp : edge + k * 1.5 * sp));
          g.restore();
        }
      }

      // Triplet mark.
      if (m.trip && m.first && (!m.group || m.group.syms[0] === m)) {
        g.save();
        g.font = `italic 600 ${1.3 * sp}px -apple-system, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillStyle = active ? INK : GREY;
        const gx = m.group ? off + (m.group.syms[0].beat + m.group.syms[m.group.syms.length - 1].beat) / 2 * this.ppb : cx;
        const y = dir > 0 ? Math.min(m.stemTo, top) - 0.8 * sp : Math.max(m.stemTo, top + 4 * sp) + 1.8 * sp;
        g.fillText('3', gx, y);
        g.restore();
      }
    }
  }

  beamY(group, x, off) {
    const { x0, y0, slope } = group.beam;
    return y0 + slope * (x - off - x0);
  }

  drawBeams(s, group, off, hand, color) {
    const { g } = this;
    const sp = this.sp;
    const dir = group.dir;
    const stemX = (m) => off + m.beat * this.ppb + (dir > 0 ? (HEAD_W / 2 - STEM_W) * sp : -(HEAD_W / 2) * sp);
    const th = 0.5 * sp;
    const seg = (xa, xb, level) => {
      const o = dir * level * 0.75 * sp; // further beams sit closer to the heads
      const ya = this.beamY(group, xa, off) + o, yb = this.beamY(group, xb, off) + o;
      g.beginPath();
      g.moveTo(xa, ya);
      g.lineTo(xb, yb);
      g.lineTo(xb, yb + dir * th);
      g.lineTo(xa, ya + dir * th);
      g.closePath();
      g.fill();
    };
    g.fillStyle = color;
    const ms = group.syms;
    const w = STEM_W * sp;
    seg(stemX(ms[0]), stemX(ms[ms.length - 1]) + w, 0);
    for (const [level, val] of [[1, 0.25], [2, 0.125]]) {
      for (let i = 0; i < ms.length; i++) {
        if (ms[i].val > val) continue;
        let j = i;
        while (j + 1 < ms.length && ms[j + 1].val <= val) j++;
        if (j > i) seg(stemX(ms[i]), stemX(ms[j]) + w, level);
        else if (i > 0) seg(stemX(ms[i]) - 1.1 * sp, stemX(ms[i]) + w, level); // stub towards the neighbour
        else seg(stemX(ms[i]), stemX(ms[i]) + 1.1 * sp, level);
        i = j;
      }
    }
  }

  tie(xa, xb, y, down) {
    const { g } = this;
    const sp = this.sp;
    if (xb - xa < sp * 0.5) return;
    const yy = y + down * 0.55 * sp;
    const h = Math.min(1.2 * sp, (xb - xa) * 0.18) * down;
    g.beginPath();
    g.moveTo(xa, yy);
    g.bezierCurveTo(xa + (xb - xa) * 0.25, yy + h, xa + (xb - xa) * 0.75, yy + h, xb, yy);
    g.bezierCurveTo(xa + (xb - xa) * 0.75, yy + h * 0.7, xa + (xb - xa) * 0.25, yy + h * 0.7, xa, yy);
    g.fill();
  }
}
