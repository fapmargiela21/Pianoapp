// Falling-notes view with a keyboard at the bottom, drawn on one canvas.
import { noteLabel, noteLabelWithOctave } from './songs.js';

const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlack = (m) => BLACK.has(((m % 12) + 12) % 12);

export const COLORS = {
  R: '#3fa9f5',
  L: '#f7a541',
  done: '#45c76a',
  good: '#45c76a',
  wrong: '#ff4d4f',
  heard: '#8fe3ff',
};

function rgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export class PianoView {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.lo = 48;
    this.hi = 84;
  }

  setRange(lo, hi) {
    // At least two octaves, padded, starting and ending on white keys.
    lo -= 2; hi += 2;
    while (hi - lo < 24) { lo--; if (hi - lo < 24) hi++; }
    if (isBlack(lo)) lo--;
    if (isBlack(hi)) hi++;
    this.lo = Math.max(21, lo);
    this.hi = Math.min(108, hi);
    this.layout();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    this.W = r.width;
    this.H = r.height;
    this.layout();
  }

  layout() {
    if (!this.W) return;
    this.kbH = Math.max(110, Math.min(230, this.H * 0.26));
    this.hitY = this.H - this.kbH;
    const whites = [];
    for (let m = this.lo; m <= this.hi; m++) if (!isBlack(m)) whites.push(m);
    const ww = this.W / whites.length;
    this.ww = ww;
    this.keys = new Map();
    whites.forEach((m, i) => this.keys.set(m, { x: i * ww, w: ww, black: false }));
    const bw = ww * 0.62;
    for (let m = this.lo; m <= this.hi; m++) {
      if (!isBlack(m)) continue;
      const left = this.keys.get(m - 1);
      if (left) this.keys.set(m, { x: left.x + ww - bw / 2, w: bw, black: true });
    }
  }

  // Which key is under a point on the keyboard (black keys first).
  keyAt(x, y) {
    if (y < this.hitY) return null;
    const blackH = this.kbH * 0.62;
    if (y - this.hitY < blackH) {
      for (const [m, k] of this.keys) if (k.black && x >= k.x && x < k.x + k.w) return m;
    }
    for (const [m, k] of this.keys) if (!k.black && x >= k.x && x < k.x + k.w) return m;
    return null;
  }

  draw(s) {
    const { g, W, H, hitY } = this;
    if (!W) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    // Lanes.
    const bg = g.createLinearGradient(0, 0, 0, hitY);
    bg.addColorStop(0, '#0e1016');
    bg.addColorStop(1, '#1a1e29');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, hitY);
    for (const [m, k] of this.keys) {
      if (k.black) {
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(k.x, 0, k.w, hitY);
      } else if (m % 12 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(k.x, 0, 1, hitY);
      }
    }

    const ppb = s.ppb;
    const yOf = (beat) => hitY - (beat - s.viewBeat) * ppb;

    // Bar lines.
    const measure = s.song.timeSig[0] * 4 / s.song.timeSig[1];
    const first = s.song.pickup || 0;
    const topBeat = s.viewBeat + hitY / ppb;
    let b = first + Math.floor((s.viewBeat - first) / measure) * measure;
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.font = '11px -apple-system, system-ui, sans-serif';
    for (; b <= topBeat; b += measure) {
      const y = yOf(b);
      if (y > hitY) continue;
      g.fillRect(0, y, W, 1);
      const bar = Math.round((b - first) / measure) + (first ? 2 : 1);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillText(String(bar), 4, y - 3);
      g.fillStyle = 'rgba(255,255,255,0.10)';
    }

    // Notes.
    const cur = s.cur;
    const labelStyle = s.labels;
    for (const n of s.song.notes) {
      const k = this.keys.get(n.midi);
      if (!k) continue;
      const y1 = yOf(n.beat);
      const y0 = yOf(n.beat + n.dur);
      if (y1 < -2 || y0 > hitY) continue;
      const pad = k.black ? 1 : Math.max(1.5, k.w * 0.08);
      const x = k.x + pad;
      const w = k.w - pad * 2;
      const h = Math.max(6, y1 - y0 - 2);
      const top = y1 - h;
      const active = n.step >= 0;
      const inTempo = s.practice === 'play';
      const isCur = active && !inTempo && n.step === cur;
      const st = inTempo && s.noteState ? s.noteState.get(n) : null;
      let fill;
      if (!active) fill = rgba(COLORS[n.hand], 0.22);
      else if (inTempo) fill = st === 'hit' ? COLORS.good : st === 'miss' ? rgba(COLORS.wrong, 0.75) : COLORS[n.hand];
      else if (n.step < cur) fill = rgba(COLORS.done, 0.55);
      else if (isCur && s.got.has(n.midi)) fill = COLORS.good;
      else fill = COLORS[n.hand];

      g.save();
      if (isCur) {
        g.shadowColor = s.wrongFlash ? COLORS.wrong : '#ffffff';
        g.shadowBlur = 18;
      }
      g.fillStyle = fill;
      roundRect(g, x, top, w, h, Math.min(8, w / 3));
      g.fill();
      g.restore();
      if (isCur) {
        g.lineWidth = 3;
        g.strokeStyle = s.wrongFlash ? COLORS.wrong : '#ffffff';
        roundRect(g, x, top, w, h, Math.min(8, w / 3));
        g.stroke();
      } else if (active && (inTempo ? !st : n.step > cur)) {
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        roundRect(g, x + 0.5, top + 0.5, w - 1, h - 1, Math.min(8, w / 3));
        g.stroke();
      }

      const label = noteLabel(n.name, labelStyle);
      const fs = Math.min(15, Math.max(9, k.w * (label.length > 2 ? 0.34 : 0.45)));
      if (label && h > fs + 4 && w > 12) {
        g.fillStyle = active ? ((inTempo ? st : n.step < cur) ? 'rgba(255,255,255,0.7)' : '#0b1020') : 'rgba(255,255,255,0.45)';
        g.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.fillText(label, x + w / 2, y1 - 4, w + 6);
      }
      if (n.finger && h > 34 && w > 12) {
        g.fillStyle = active ? 'rgba(11,16,32,0.75)' : 'rgba(255,255,255,0.4)';
        g.font = `700 ${Math.min(12, fs)}px -apple-system, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText(String(n.finger), x + w / 2, top + 3);
      }
    }
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';

    // Hit line.
    const hl = g.createLinearGradient(0, hitY - 14, 0, hitY);
    hl.addColorStop(0, 'rgba(255,255,255,0)');
    hl.addColorStop(1, s.wrongFlash ? 'rgba(255,77,79,0.45)' : 'rgba(120,200,255,0.25)');
    g.fillStyle = hl;
    g.fillRect(0, hitY - 14, W, 14);

    this.drawKeyboard(s);
  }

  drawKeyboard(s) {
    const { g, W, H, hitY, kbH } = this;
    const now = s.now;
    g.fillStyle = '#05060a';
    g.fillRect(0, hitY, W, kbH);

    let expected = s.expectedKeys; // midi -> hand
    if (!expected) {
      expected = new Map();
      const step = s.steps[s.cur];
      if (step && s.mode === 'wait') for (const n of step.notes) expected.set(n.midi, n.hand);
    }
    if (s.hints === false && s.mode !== 'listen') expected = new Map(); // read the notes yourself

    const keyColor = (m) => {
      const fx = s.keyFx.get(m);
      if (fx && fx.until > now) return { color: fx.color, a: Math.min(1, (fx.until - now) / 250) };
      if (s.lit && s.lit.has(m)) return { color: COLORS[s.lit.get(m)], a: 0.9 };
      if (expected.has(m)) {
        if (s.got.has(m)) return { color: COLORS.good, a: 0.9 };
        const pulse = 0.55 + 0.25 * Math.sin(now / 160);
        return { color: COLORS[expected.get(m)], a: pulse };
      }
      return null;
    };

    const top = hitY + 3;
    const wh = kbH - 3;
    const labelStyle = s.labels === 'none' ? 'letters' : s.labels;
    for (const [m, k] of this.keys) {
      if (k.black) continue;
      g.fillStyle = '#f4f4f0';
      roundRect(g, k.x + 1, top, k.w - 2, wh - 2, 5);
      g.fill();
      const c = keyColor(m);
      if (c) {
        g.fillStyle = rgba(c.color, c.a);
        roundRect(g, k.x + 1, top, k.w - 2, wh - 2, 5);
        g.fill();
      }
      if (m % 12 === 0 || (c && expected.has(m))) {
        g.fillStyle = c && expected.has(m) ? '#0b1020' : '#8a8f99';
        g.font = `600 ${Math.min(13, k.w * 0.38)}px -apple-system, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillText(m % 12 === 0 ? noteLabelWithOctave(s.nameOf(m), labelStyle) : noteLabel(s.nameOf(m), labelStyle),
          k.x + k.w / 2, top + wh - 10, k.w - 2);
      }
    }
    const bh = wh * 0.62;
    for (const [m, k] of this.keys) {
      if (!k.black) continue;
      const grad = g.createLinearGradient(0, top, 0, top + bh);
      grad.addColorStop(0, '#2a2c33');
      grad.addColorStop(1, '#0d0e12');
      g.fillStyle = grad;
      roundRect(g, k.x, top - 2, k.w, bh, 4);
      g.fill();
      const c = keyColor(m);
      if (c) {
        g.fillStyle = rgba(c.color, c.a);
        roundRect(g, k.x, top - 2, k.w, bh, 4);
        g.fill();
      }
    }
    g.textAlign = 'left';

    // What the microphone hears.
    if (s.showHeard && s.heard) {
      for (const m of s.heard) {
        const k = this.keys.get(m);
        if (!k) continue;
        const y = k.black ? top + bh - 12 : top + wh - 30;
        g.fillStyle = COLORS.heard;
        g.beginPath();
        g.arc(k.x + k.w / 2, y, Math.min(5, k.w * 0.2), 0, Math.PI * 2);
        g.fill();
      }
    }

    // Red felt.
    g.fillStyle = '#8c1d24';
    g.fillRect(0, hitY, W, 3);
  }
}
