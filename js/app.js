import { parseSongText, parseMidi, buildSteps, songRange, songLength, midiToName, noteLabelWithOctave } from './songs.js';
import { NoteDetector } from './pitch.js';
import { Synth } from './synth.js';
import { PianoView, COLORS } from './render.js';

const $ = (s) => document.querySelector(s);
const LS = 'pianoapp.';

// ---------------------------------------------------------------- settings

const DEFAULTS = { labels: 'solfege', sensitivity: 0.5, zoom: 1, tempo: 0.8, showHeard: true, hands: 'both' };
const settings = { ...DEFAULTS, ...readJSON('settings', {}) };
function readJSON(key, def) {
  try { const v = localStorage.getItem(LS + key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(LS + key, JSON.stringify(v)); } catch { /* storage full or disabled */ }
}
const saveSettings = () => writeJSON('settings', settings);

// ---------------------------------------------------------------- audio

let audioCtx = null;
let synth = null;
const detector = new NoteDetector();
detector.sensitivity = settings.sensitivity;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    synth = new Synth(audioCtx);
  }
  if (audioCtx.state !== 'running') audioCtx.resume();
  return audioCtx;
}

async function startMic() {
  ensureAudio();
  await detector.start(audioCtx);
  detector.onNote = (m, info) => onNote(m, 'mic', info);
  updateMicBtn();
}

function updateMicBtn() {
  $('#micBtn').classList.toggle('on', detector.running);
  $('#micBtn').classList.toggle('off', !detector.running);
}

// ---------------------------------------------------------------- library

let library = [];

async function loadLibrary() {
  const builtin = [];
  try {
    const files = await (await fetch('songs/index.json', { cache: 'no-cache' })).json();
    const texts = await Promise.all(files.map((f) =>
      fetch('songs/' + f, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : null)).catch(() => null)));
    files.forEach((f, i) => {
      if (texts[i] == null) return;
      const id = f.replace(/\.song$/, '');
      const song = parseSongText(texts[i], id);
      if (song.warnings.length) console.warn(f, song.warnings);
      builtin.push({ song, source: 'builtin' });
    });
  } catch (e) {
    console.error('Не удалось загрузить список песен', e);
  }
  const imported = readJSON('imported', []).map((song) => ({ song, source: 'imported' }));
  library = [...builtin, ...imported];
  renderLibrary();
}

function renderLibrary() {
  const grid = $('#songGrid');
  grid.innerHTML = '';
  const best = readJSON('best', {});
  for (const entry of library) {
    const { song } = entry;
    const card = document.createElement('div');
    card.className = 'song-card';
    const stars = '★'.repeat(Math.max(1, Math.min(5, song.difficulty || 1)));
    const b = best[song.id];
    card.innerHTML = `
      <h3></h3>
      <div class="artist"></div>
      <div class="meta">
        <span>${stars}${song.youtube ? ' · ▶︎ YouTube' : ''}${entry.source === 'imported' ? ' <span class="badge">MIDI</span>' : ''}</span>
        <span class="best">${b != null ? Math.round(b) + '%' : ''}</span>
      </div>`;
    card.querySelector('h3').textContent = song.title;
    card.querySelector('.artist').textContent = song.artist || '';
    card.addEventListener('click', () => openSong(song));
    if (entry.source === 'imported') {
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Удалить «${song.title}»?`)) return;
        writeJSON('imported', readJSON('imported', []).filter((s) => s.id !== song.id));
        loadLibrary();
      });
      card.appendChild(del);
    }
    grid.appendChild(card);
  }
}

$('#midiInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const title = file.name.replace(/\.(mid|midi)$/i, '').replace(/[_-]+/g, ' ');
    const song = parseMidi(await file.arrayBuffer(), 'midi-' + Date.now(), title);
    const list = readJSON('imported', []);
    list.push(song);
    writeJSON('imported', list);
    await loadLibrary();
    openSong(song);
  } catch (err) {
    alert('Не получилось открыть файл: ' + err.message);
  }
});

// ---------------------------------------------------------------- player state

const view = new PianoView($('#view'));
const P = {
  song: null,
  steps: [],
  cur: 0,
  got: new Set(),
  viewBeat: 0,
  mode: 'wait', // wait | listen | done
  keyFx: new Map(),
  wrongUntil: 0,
  lastWrong: 0,
  stepT: 0,
  chordT: -1e9, // when the notes of the current step were struck
  prevOnset: -1e9, // ...and of the previous step
  stats: { hits: 0, wrong: 0, t0: 0 },
  listen: null,
  drag: null,
  open: false,
  names: new Map(),
};

function ppb() {
  const base = Math.max(60, Math.min(140, (view.hitY || 400) / 5));
  const bpmFactor = P.song ? Math.max(0.7, Math.min(1.4, 100 / P.song.bpm)) : 1;
  return base * settings.zoom * bpmFactor;
}

function openSong(song) {
  P.song = song;
  P.open = true;
  P.names = new Map();
  for (const n of song.notes) if (!P.names.has(n.midi)) P.names.set(n.midi, n.name);
  $('#library').classList.add('hidden');
  $('#player').classList.remove('hidden');
  $('#songTitle').textContent = song.title;
  $('#songSub').textContent = [song.artist, `${song.bpm} BPM`, `${song.timeSig[0]}/${song.timeSig[1]}`].filter(Boolean).join(' · ');
  $('#ytBtn').classList.toggle('hidden', !song.youtube);
  $('#startTitle').textContent = song.title;
  const [lo, hi] = songRange(song);
  view.resize();
  view.setRange(lo, hi);
  setHands(settings.hands, true);
  $('#doneOverlay').classList.add('hidden');
  $('#startOverlay').classList.toggle('hidden', !!(detector.running || P.noMic));
  updateMicBtn();
}

function closeSong() {
  stopListen();
  P.open = false;
  P.song = null;
  $('#player').classList.add('hidden');
  $('#library').classList.remove('hidden');
  renderLibrary();
}

function setHands(h, restartNow) {
  settings.hands = h;
  saveSettings();
  document.querySelectorAll('#handSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.hand === h));
  P.steps = buildSteps(P.song, h);
  if (restartNow || true) restart();
}

function restart() {
  stopListen();
  P.cur = 0;
  P.got.clear();
  P.chordT = P.prevOnset = -1e9;
  P.mode = 'wait';
  P.stats = { hits: 0, wrong: 0, t0: 0 };
  P.keyFx.clear();
  const first = P.steps[0] ? P.steps[0].beat : 0;
  P.viewBeat = first - 3;
  P.stepT = performance.now();
  $('#doneOverlay').classList.add('hidden');
  updateExpected();
  updateHud();
}

function seekTo(idx) {
  stopListen();
  P.cur = Math.max(0, Math.min(P.steps.length - 1, idx));
  P.got.clear();
  P.chordT = P.prevOnset = -1e9;
  P.mode = 'wait';
  P.stepT = performance.now();
  updateExpected();
  updateHud();
}

function updateExpected() {
  const s = P.steps[P.cur];
  detector.expected = s ? s.required : new Set();
}

function fx(midi, color, ms) {
  P.keyFx.set(midi, { color, until: performance.now() + ms });
}

// ---------------------------------------------------------------- game logic

function onNote(midi, source, info) {
  const now = performance.now();
  if (source !== 'mic') fx(midi, COLORS.heard, 200);
  if (!P.open || P.mode !== 'wait' || P.drag) return;
  if (P.listenTail && now < P.listenTail) return;
  const step = P.steps[P.cur];
  if (!step) return;
  if (!P.stats.t0) P.stats.t0 = now;
  // Overtones of the strike that finished the previous step are not new notes.
  if (info && info.t <= P.prevOnset + 40) return;

  if (step.required.has(midi)) {
    P.got.add(midi);
    P.chordT = Math.max(P.chordT, info ? info.t : now);
    fx(midi, COLORS.good, 350);
    if (P.got.size >= step.required.size) advance(now);
    return;
  }
  // Re-triggers of the notes just played are not mistakes.
  const prev = P.steps[P.cur - 1];
  if (prev && prev.required.has(midi) && now - P.stepT < 700) return;
  // When practising one hand, the other hand's notes nearby are allowed.
  if (settings.hands !== 'both') {
    const near = P.song.notes.some((n) => n.step < 0 && n.midi === midi && Math.abs(n.beat - step.beat) <= 2);
    if (near) return;
  }
  // Faint mic detections are not trusted enough to count as mistakes.
  if (info && info.strength < -12) return;
  fx(midi, COLORS.wrong, 600);
  P.wrongUntil = now + 450;
  if (now - P.lastWrong > 300) P.stats.wrong++;
  P.lastWrong = now;
  updateHud();
}

function advance(now) {
  P.prevOnset = P.chordT;
  P.chordT = -1e9;
  P.stats.hits++;
  P.cur++;
  P.got.clear();
  P.stepT = now;
  updateExpected();
  updateHud();
  if (P.cur >= P.steps.length) finish();
}

function finish() {
  P.mode = 'done';
  const { hits, wrong, t0 } = P.stats;
  const acc = hits ? (100 * hits) / (hits + wrong) : 0;
  const secs = t0 ? (performance.now() - t0) / 1000 : 0;
  const stars = acc >= 95 ? 3 : acc >= 80 ? 2 : 1;
  $('#stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('#doneStats').innerHTML =
    `Точность: <b>${Math.round(acc)}%</b><br>Ошибок: <b>${wrong}</b><br>Время: <b>${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}</b>`;
  if (settings.hands === 'both') {
    const best = readJSON('best', {});
    if (best[P.song.id] == null || acc > best[P.song.id]) best[P.song.id] = acc;
    writeJSON('best', best);
  }
  setTimeout(() => { if (P.mode === 'done') $('#doneOverlay').classList.remove('hidden'); }, 600);
}

function updateHud() {
  const total = P.steps.length || 1;
  $('#progressFill').style.width = `${(100 * P.cur) / total}%`;
  $('#counter').innerHTML = `<b>${Math.min(P.cur, total)}</b> / ${total}` +
    (P.stats.wrong ? ` · <span class="bad">ошибок: ${P.stats.wrong}</span>` : '');
}

// ---------------------------------------------------------------- listen mode

function startListen() {
  if (!P.song) return;
  ensureAudio();
  const rate = (P.song.bpm / 60) * settings.tempo;
  const startBeat = P.steps[P.cur] ? P.steps[P.cur].beat : 0;
  const idx = P.song.notes.findIndex((n) => n.beat >= startBeat - 1e-6);
  P.listen = { t0: audioCtx.currentTime + 0.25, beat0: startBeat - 0.25 * rate, rate, idx: Math.max(0, idx), on: [] };
  P.mode = 'listen';
  detector.paused = true;
  $('#listenBtn').textContent = '■ Стоп';
}

function stopListen() {
  if (!P.listen) return;
  P.listen = null;
  if (P.mode === 'listen') P.mode = 'wait';
  P.listenTail = performance.now() + 900;
  detector.paused = false;
  $('#listenBtn').textContent = '▶︎ Послушать';
}

function tickListen() {
  const L = P.listen;
  const t = audioCtx.currentTime;
  const beatNow = L.beat0 + (t - L.t0) * L.rate;
  P.viewBeat = beatNow;
  const notes = P.song.notes;
  const ahead = beatNow + 0.3 * L.rate;
  while (L.idx < notes.length && notes[L.idx].beat <= ahead) {
    const n = notes[L.idx++];
    const when = L.t0 + (n.beat - L.beat0) / L.rate;
    synth.play(n.midi, when, n.dur / L.rate, n.hand === 'R' ? 0.85 : 0.6);
    L.on.push(n);
  }
  P.lit = new Map();
  L.on = L.on.filter((n) => n.beat + n.dur > beatNow);
  for (const n of L.on) if (n.beat <= beatNow) P.lit.set(n.midi, n.hand);
  if (L.idx >= notes.length && !L.on.length) stopListen();
}

// ---------------------------------------------------------------- frame loop

function frame(now) {
  requestAnimationFrame(frame);
  if (detector.running) {
    detector.process(now);
    const lvl = Math.max(0, Math.min(1, (detector.level + 70) / 60));
    $('#levelMeter i').style.width = `${lvl * 100}%`;
    if (P.open) {
      const heard = detector.heard.slice(0, 4).map((m) => noteLabelWithOctave(P.names.get(m) || midiToName(m), settings.labels === 'none' ? 'letters' : settings.labels));
      $('#heardText').textContent = heard.length ? 'Слышу: ' + heard.join(' ') : '';
    }
  }
  if (!P.open || !P.song) return;

  P.lit = null;
  if (P.listen) tickListen();
  else if (!P.drag) {
    const step = P.steps[P.cur] || P.steps[P.steps.length - 1];
    const target = P.mode === 'done' ? songLength(P.song) : step ? step.beat : 0;
    const dt = P.lastFrame ? Math.min(0.05, (now - P.lastFrame) / 1000) : 0.016;
    P.viewBeat += (target - P.viewBeat) * Math.min(1, dt * 7);
  }
  P.lastFrame = now;

  view.draw({
    song: P.song,
    steps: P.steps,
    cur: P.mode === 'done' ? P.steps.length : P.cur,
    got: P.got,
    viewBeat: P.viewBeat,
    ppb: ppb(),
    labels: settings.labels,
    keyFx: P.keyFx,
    lit: P.lit,
    heard: settings.showHeard && detector.running ? detector.heard : null,
    showHeard: settings.showHeard,
    wrongFlash: now < P.wrongUntil,
    mode: P.mode,
    now,
    nameOf: (m) => P.names.get(m) || midiToName(m),
  });
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- input

const canvas = $('#view');
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const key = view.keyAt(x, y);
  if (key != null) {
    ensureAudio();
    synth.play(key, 0, 0.4, 0.8);
    onNote(key, 'touch');
    return;
  }
  if (P.mode === 'listen') return;
  canvas.setPointerCapture(e.pointerId);
  P.drag = { y, beat: P.viewBeat, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!P.drag) return;
  const y = e.clientY - canvas.getBoundingClientRect().top;
  const dy = y - P.drag.y;
  if (Math.abs(dy) > 6) P.drag.moved = true;
  P.viewBeat = P.drag.beat + dy / ppb();
});
const endDrag = () => {
  if (!P.drag) return;
  const moved = P.drag.moved;
  P.drag = null;
  if (!moved || !P.steps.length) return;
  let best = 0;
  P.steps.forEach((s, i) => { if (Math.abs(s.beat - P.viewBeat) < Math.abs(P.steps[best].beat - P.viewBeat)) best = i; });
  seekTo(best);
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

$('#progress').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  seekTo(Math.floor(((e.clientX - r.left) / r.width) * P.steps.length));
});

// Computer keyboard / MIDI keyboard (where supported) for testing.
if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess().then((access) => {
    const bind = () => access.inputs.forEach((inp) => {
      inp.onmidimessage = (msg) => {
        const [st, note, vel] = msg.data;
        if ((st & 0xf0) === 0x90 && vel > 0) onNote(note, 'midi');
      };
    });
    bind();
    access.onstatechange = bind;
  }).catch(() => {});
}

window.addEventListener('resize', () => view.resize());

// ---------------------------------------------------------------- buttons

$('#backBtn').addEventListener('click', closeSong);
$('#restartBtn').addEventListener('click', restart);
$('#againBtn').addEventListener('click', restart);
$('#toLibBtn').addEventListener('click', closeSong);
document.querySelectorAll('#handSeg button').forEach((b) => b.addEventListener('click', () => setHands(b.dataset.hand)));
$('#listenBtn').addEventListener('click', () => (P.listen ? stopListen() : startListen()));

$('#startMic').addEventListener('click', async () => {
  $('#micError').classList.add('hidden');
  try {
    await startMic();
    $('#startOverlay').classList.add('hidden');
  } catch (err) {
    const msg = window.isSecureContext
      ? 'Нет доступа к микрофону. Разреши его в настройках Safari (aA → Настройки веб-сайта → Микрофон) и попробуй снова.'
      : 'Микрофон работает только по https:// — открой приложение по ссылке GitHub Pages.';
    $('#micError').textContent = msg + ` (${err.name || err.message})`;
    $('#micError').classList.remove('hidden');
  }
});
$('#startNoMic').addEventListener('click', () => {
  ensureAudio();
  P.noMic = true;
  $('#startOverlay').classList.add('hidden');
});
$('#micBtn').addEventListener('click', async () => {
  if (detector.running) {
    detector.stop();
    $('#heardText').textContent = '';
    $('#levelMeter i').style.width = '0';
    updateMicBtn();
  } else {
    try { await startMic(); } catch { $('#startOverlay').classList.remove('hidden'); }
  }
});

// YouTube
function youtubeId(url) {
  const m = /(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/.exec(url || '');
  return m ? m[1] : null;
}
$('#ytBtn').addEventListener('click', () => {
  const id = youtubeId(P.song.youtube);
  if (!id) { window.open(P.song.youtube, '_blank'); return; }
  stopListen();
  detector.paused = true;
  $('#ytWrap').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  $('#ytOverlay').classList.remove('hidden');
});
$('#ytClose').addEventListener('click', () => {
  $('#ytWrap').innerHTML = '';
  $('#ytOverlay').classList.add('hidden');
  detector.paused = false;
  P.listenTail = performance.now() + 500;
});

// Settings
function openSettings() {
  document.querySelectorAll('#labelSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.v === settings.labels));
  $('#sensRange').value = settings.sensitivity;
  $('#zoomRange').value = settings.zoom;
  $('#tempoRange').value = settings.tempo;
  $('#tempoText').textContent = Math.round(settings.tempo * 100) + '%';
  $('#heardChk').checked = settings.showHeard;
  $('#settingsOverlay').classList.remove('hidden');
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#libSettings').addEventListener('click', openSettings);
$('#settingsClose').addEventListener('click', () => { $('#settingsOverlay').classList.add('hidden'); saveSettings(); });
document.querySelectorAll('#labelSeg button').forEach((b) => b.addEventListener('click', () => {
  settings.labels = b.dataset.v;
  document.querySelectorAll('#labelSeg button').forEach((x) => x.classList.toggle('sel', x === b));
}));
$('#sensRange').addEventListener('input', (e) => { settings.sensitivity = +e.target.value; detector.sensitivity = settings.sensitivity; });
$('#zoomRange').addEventListener('input', (e) => { settings.zoom = +e.target.value; });
$('#tempoRange').addEventListener('input', (e) => {
  settings.tempo = +e.target.value;
  $('#tempoText').textContent = Math.round(settings.tempo * 100) + '%';
});
$('#heardChk').addEventListener('change', (e) => { settings.showHeard = e.target.checked; });

// Debug/testing hook (used by automated tests).
window.__piano = { P, detector, settings, openSong: (id) => openSong(library.find((e) => e.song.id === id).song), library: () => library };

loadLibrary();
