// Song loading: a compact text format (.song) and standard MIDI files (.mid).
//
// A song is { id, title, artist, bpm, timeSig:[num, den], pickup, youtube, sync:{offset, bpm},
//             difficulty, notes:[{ midi, beat, dur, hand:'R'|'L', name, finger }] }
// Beats are always counted in quarter notes.

const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };
const ACC = { '': 0, '#': 1, '##': 2, x: 2, b: -1, bb: -2 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE = { C: 'До', D: 'Ре', E: 'Ми', F: 'Фа', G: 'Соль', A: 'Ля', B: 'Си', H: 'Си' };

export function midiToName(midi) {
  return SHARP_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

// name like "C#4" / "Bb3" -> label without octave in the chosen style
export function noteLabel(name, style) {
  if (style === 'none' || !name) return '';
  const m = /^([A-H])(##|#|bb|b|x)?/.exec(name);
  if (!m) return '';
  const acc = (m[2] || '').replace('##', '𝄪').replace('x', '𝄪').replace('#', '♯').replace('bb', '𝄫').replace('b', '♭');
  if (style === 'letters') return (m[1] === 'H' ? 'B' : m[1]) + acc;
  return SOLFEGE[m[1]] + acc;
}

export function noteLabelWithOctave(name, style) {
  const oct = (/(-?\d+)$/.exec(name) || [])[1] || '';
  return noteLabel(name, style === 'none' ? 'letters' : style) + oct;
}

function nameToMidi(name) {
  const m = /^([A-H])(##|#|bb|b|x)?(-?\d)$/.exec(name);
  if (!m) return null;
  return 12 * (parseInt(m[3], 10) + 1) + LETTERS[m[1]] + ACC[m[2] || ''];
}

// ---------------------------------------------------------------- text format

const TOKEN_RE = /\[[^\]]*\][^\s|]*|\||[^\s|]+/g;
const NOTE_TOKEN_RE = /^(\[[^\]]*\]|r|[A-H](?:##|#|bb|b|x)?-?\d(?:@\d+)?)(?:\/(\d+))?(\.{0,2})(t?)(~?)$/;

export function parseSongText(text, id = 'song') {
  const song = {
    id, title: id, artist: '', bpm: 90, timeSig: [4, 4], pickup: 0,
    youtube: '', difficulty: 1, notes: [], warnings: [], source: 'text',
  };
  const hands = {};
  const handState = (h) => hands[h] || (hands[h] = {
    beat: 0, barStart: 0, bar: 0, base: 4, dots: '', trip: '', ties: null,
  });
  let hand = null;
  let firstBarLen = null;

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, lineNo) => {
    let line = raw.replace(/(^|\s)\/\/.*$/, '').trim();   // '//' comments, but not inside https://
    if (!line || line.startsWith('#')) return;

    const header = /^([a-zA-Z]+)\s*:\s*(.*)$/.exec(line);
    if (header) {
      const key = header[1].toLowerCase();
      const val = header[2].trim();
      if (key === 'title') song.title = val;
      else if (key === 'artist') song.artist = val;
      else if (key === 'bpm' || key === 'tempo') song.bpm = parseFloat(val) || song.bpm;
      else if (key === 'time') {
        const t = /^(\d+)\s*\/\s*(\d+)$/.exec(val);
        if (t) song.timeSig = [parseInt(t[1], 10), parseInt(t[2], 10)];
      } else if (key === 'youtube') song.youtube = val;
      else if (key === 'difficulty') song.difficulty = parseInt(val, 10) || 1;
      else if (key === 'key') song.key = val;
      else if (key === 'sync') {          // "<seconds of beat 0 in the YouTube audio> <exact bpm>"
        const [off, bpm] = val.split(/\s+/).map(parseFloat);
        if (Number.isFinite(off)) song.sync = { offset: off, bpm: Number.isFinite(bpm) ? bpm : null };
      }
      else if (key === 'note' || key === 'comment') song.comment = val;
      return;
    }

    const section = /^\[(R|L|RH|LH|П|Л)\]$/i.exec(line);
    if (section) {
      const s = section[1].toUpperCase();
      hand = (s === 'R' || s === 'RH' || s === 'П') ? 'R' : 'L';
      return;
    }

    if (!hand) {
      song.warnings.push(`Строка ${lineNo + 1}: ноты вне секции [R] или [L]`);
      return;
    }
    const st = handState(hand);
    const measure = song.timeSig[0] * 4 / song.timeSig[1];

    for (const tok of line.match(TOKEN_RE) || []) {
      if (tok === '|') {
        const len = +(st.beat - st.barStart).toFixed(4);
        if (st.bar === 0 && len < measure && len > 0) {
          if (hand === 'R' || firstBarLen === null) firstBarLen = len;
        } else if (Math.abs(len - measure) > 1e-3) {
          song.warnings.push(`[${hand}] такт ${st.bar + 1} (строка ${lineNo + 1}): длительность ${len} вместо ${measure}`);
        }
        st.bar++;
        st.barStart = st.beat;
        continue;
      }
      const m = NOTE_TOKEN_RE.exec(tok);
      if (!m) {
        song.warnings.push(`Строка ${lineNo + 1}: не понял «${tok}»`);
        continue;
      }
      // Duration: "/n" is sticky (with its dots/triplet); bare dots apply to this note only.
      let base = st.base, dots = st.dots, trip = st.trip;
      if (m[2]) {
        base = parseInt(m[2], 10); dots = m[3]; trip = m[4];
        st.base = base; st.dots = dots; st.trip = trip;
      } else if (m[3] || m[4]) {
        dots = m[3]; trip = m[4];
      }
      let dur = 4 / base;
      let add = dur;
      for (let i = 0; i < dots.length; i++) { add /= 2; dur += add; }
      if (trip) dur *= 2 / 3;

      const body = m[1];
      const tie = m[5] === '~';
      if (body === 'r') {
        st.ties = null;
        st.beat += dur;
        continue;
      }
      const parts = body.startsWith('[') ? body.slice(1, -1).trim().split(/\s+/) : [body];
      const newTies = new Map();
      for (const p of parts) {
        const pm = /^([A-H](?:##|#|bb|b|x)?-?\d)(?:@(\d+))?$/.exec(p);
        const midi = pm ? nameToMidi(pm[1]) : null;
        if (midi == null) {
          song.warnings.push(`Строка ${lineNo + 1}: не понял ноту «${p}»`);
          continue;
        }
        const prev = st.ties && st.ties.get(midi);
        if (prev) {
          prev.dur += dur;
          newTies.set(midi, prev);
        } else {
          const note = { midi, beat: +st.beat.toFixed(5), dur, hand, name: pm[1] };
          if (pm[2]) note.finger = parseInt(pm[2], 10);
          song.notes.push(note);
          newTies.set(midi, note);
        }
      }
      st.ties = tie ? newTies : null;
      st.beat += dur;
    }
  });

  if (firstBarLen) song.pickup = firstBarLen;
  song.notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return song;
}

// ---------------------------------------------------------------- MIDI files

export function parseMidi(buffer, id = 'midi', title = 'MIDI') {
  const d = new DataView(buffer);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const u8 = () => d.getUint8(p++);
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (str(4) !== 'MThd') throw new Error('Это не MIDI-файл');
  const hlen = u32();
  const hstart = p;
  u16(); // format
  const ntrks = u16();
  const division = u16();
  p = hstart + hlen;
  const ppq = (division & 0x8000) ? 480 : division;

  let tempo = 0, timeSig = null, trackName = '';
  const raw = []; // {midi, start, end, src}
  for (let t = 0; t < ntrks && p < d.byteLength - 8; t++) {
    const tag = str(4);
    const len = u32();
    const end = p + len;
    if (tag !== 'MTrk') { p = end; continue; }
    let tick = 0, status = 0;
    const open = new Map();
    while (p < end) {
      tick += vlq();
      let b = d.getUint8(p);
      if (b & 0x80) { status = b; p++; }
      if (status === 0xff) {
        const type = u8();
        const l = vlq();
        if (type === 0x51 && !tempo) tempo = (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2);
        else if (type === 0x58 && !timeSig) timeSig = [d.getUint8(p), 2 ** d.getUint8(p + 1)];
        else if (type === 0x03 && !trackName && t <= 1) { const s = p; trackName = str(l); p = s; }
        p += l;
        if (type === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { p += vlq(); continue; }
      const kind = status & 0xf0;
      const ch = status & 0x0f;
      if (kind === 0x90 || kind === 0x80) {
        const note = u8();
        const vel = u8();
        const key = ch * 128 + note;
        if (kind === 0x90 && vel > 0) {
          if (!open.has(key)) open.set(key, []);
          open.get(key).push(tick);
        } else {
          const q = open.get(key);
          if (q && q.length) {
            const start = q.shift();
            if (ch !== 9) raw.push({ midi: note, start, end: Math.max(tick, start + 1), src: t * 16 + ch });
          }
        }
      } else if (kind === 0xc0 || kind === 0xd0) p += 1;
      else p += 2;
    }
    p = end;
  }
  if (!raw.length) throw new Error('В файле нет нот');

  // Hands: highest-sounding source -> right hand, others -> left.
  // A single source is split at middle C.
  const bySrc = new Map();
  for (const n of raw) {
    const s = bySrc.get(n.src) || { sum: 0, n: 0 };
    s.sum += n.midi; s.n++;
    bySrc.set(n.src, s);
  }
  let handOf;
  if (bySrc.size >= 2) {
    const ranked = [...bySrc.entries()].sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n);
    const right = ranked[0][0];
    handOf = (n) => (n.src === right ? 'R' : 'L');
  } else {
    handOf = (n) => (n.midi >= 60 ? 'R' : 'L');
  }

  const q = (x) => Math.round(x * 96) / 96;
  const notes = raw.map((n) => ({
    midi: n.midi,
    beat: q(n.start / ppq),
    dur: Math.max(1 / 16, q((n.end - n.start) / ppq)),
    hand: handOf(n),
    name: midiToName(n.midi),
  })).sort((a, b) => a.beat - b.beat || a.midi - b.midi);

  // Drop leading silence.
  const first = notes[0].beat;
  const ts = timeSig || [4, 4];
  const measure = ts[0] * 4 / ts[1];
  const shift = Math.floor(first / measure) * measure;
  for (const n of notes) n.beat = q(n.beat - shift);

  return {
    id, title: title || trackName || 'MIDI', artist: trackName && trackName !== title ? trackName : '',
    bpm: tempo ? Math.round(60e6 / tempo) : 100, timeSig: ts, pickup: 0,
    youtube: '', difficulty: 3, notes, warnings: [], source: 'midi',
  };
}

// ---------------------------------------------------------------- steps

// The mic hears keys from E1 up (NoteDetector.minMidi); a lower key counts as the same note an
// octave (or two) up, which is what its overtones sound like.
export const MIC_LOW = 28;
export const micMidi = (m) => { while (m < MIC_LOW) m += 12; return m; };

// Groups notes that start together into steps. Only notes of the active hand(s)
// are required; the rest are shown but never waited for.
export function buildSteps(song, hands = 'both') {
  const steps = [];
  let last = null;
  for (const n of song.notes) {
    const active = hands === 'both' || n.hand === hands;
    n.step = -1;
    if (!active) continue;
    if (!last || n.beat - last.beat > 0.04) {
      last = { beat: n.beat, notes: [], required: new Set() };
      steps.push(last);
    }
    last.notes.push(n);
    last.required.add(micMidi(n.midi));
    n.step = steps.length - 1;
  }
  return steps;
}

export function songRange(song) {
  let lo = 127, hi = 0;
  for (const n of song.notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
  if (lo > hi) { lo = 60; hi = 72; }
  return [lo, hi];
}

export function songLength(song) {
  let end = 0;
  for (const n of song.notes) end = Math.max(end, n.beat + n.dur);
  return end;
}
