import { parseSongText, parseMidi, buildSteps, songRange, songLength, midiToName, noteLabelWithOctave } from './songs.js';
import { NoteDetector } from './pitch.js';
import { Synth } from './synth.js';
import { PianoView, COLORS } from './render.js';
import { SheetView } from './sheet.js';
import { songFromAudio } from './audio-import.js';
import { transcribeLink, failureReason } from './link-import.js';

const $ = (s) => document.querySelector(s);
const LS = 'pianoapp.';

// ---------------------------------------------------------------- settings

const DEFAULTS = {
  labels: 'solfege', sensitivity: 0.5, zoom: 1, tempo: 0.8, showHeard: true, hands: 'both',
  view: 'sheet', practice: 'wait', metronome: false, hints: true,
};
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
        <span class="stars">${stars}</span><span>${song.youtube ? ' · ▶︎ YouTube' : ''}${entry.source === 'imported' ? ` <span class="badge">${song.source === 'audio' ? 'аудио' : 'MIDI'}</span>` : ''}</span>
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
  for (const job of readJSON('pending', [])) {
    const card = document.createElement('div');
    card.className = 'song-card pending';
    card.innerHTML = '<h3></h3><div class="artist"></div>';
    card.querySelector('h3').textContent = job.title;
    card.querySelector('.artist').textContent = job.error
      ? '⚠ Не получилось: ' + job.error
      : `⏳ Распознаётся… (${Math.max(1, Math.round((Date.now() - job.at) / 60e3))} мин из ~5)`;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      writeJSON('pending', readJSON('pending', []).filter((j) => j.id !== job.id));
      renderLibrary();
    });
    card.appendChild(del);
    grid.appendChild(card);
  }
}

// ---------------------------------------------------------------- song from a YouTube link

$('#linkBtn').addEventListener('click', () => {
  $('#linkUrl').value = '';
  $('#linkTitle').value = '';
  $('#linkError').classList.add('hidden');
  $('#linkTokenBox').classList.toggle('hidden', !!readJSON('ghToken', ''));
  $('#linkOverlay').classList.remove('hidden');
});
$('#linkCancel').addEventListener('click', () => $('#linkOverlay').classList.add('hidden'));
$('#linkGo').addEventListener('click', async () => {
  const typed = $('#linkToken').value.trim();
  const token = typed || readJSON('ghToken', '');
  const showError = (msg) => { $('#linkError').textContent = msg; $('#linkError').classList.remove('hidden'); };
  if (!token) { $('#linkTokenBox').classList.remove('hidden'); return showError('Вставь ключ GitHub'); }
  $('#linkGo').disabled = true;
  try {
    const job = await transcribeLink($('#linkUrl').value.trim(), $('#linkTitle').value.trim(), token);
    if (typed) { writeJSON('ghToken', typed); $('#linkToken').value = ''; }
    writeJSON('pending', [...readJSON('pending', []).filter((j) => j.id !== job.id), job]);
    $('#linkOverlay').classList.add('hidden');
    renderLibrary();
    watchPending();
  } catch (err) {
    if (/ключ/.test(err.message)) { writeJSON('ghToken', ''); $('#linkTokenBox').classList.remove('hidden'); }
    showError('Не получилось: ' + err.message);
  } finally {
    $('#linkGo').disabled = false;
  }
});

// Waiting songs: the library is reloaded every 30 s until each one shows up in songs/index.json.
let pendingTimer = null;
async function checkPending() {
  await loadLibrary();
  const have = new Set(library.map((e) => e.song.id));
  const left = [];
  for (const job of readJSON('pending', [])) {
    if (have.has(job.id)) continue;
    if (!job.error && Date.now() - job.at > 60e3) job.error = await failureReason(job);
    if (!job.error && Date.now() - job.at > 40 * 60e3) job.error = 'GitHub не ответил за 40 минут';
    left.push(job);
  }
  writeJSON('pending', left);
  renderLibrary();
  if (!left.some((j) => !j.error)) { clearInterval(pendingTimer); pendingTimer = null; }
}
function watchPending() {
  if (!pendingTimer && readJSON('pending', []).some((j) => !j.error)) pendingTimer = setInterval(checkPending, 30e3);
}
watchPending();

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

$('#audioInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let cancelled = false;
  const status = (text, frac) => {
    $('#importStatus').textContent = text;
    $('#importFill').style.width = Math.round(frac * 100) + '%';
  };
  $('#importCancel').onclick = () => { cancelled = true; status('Останавливаю…', 0); };
  $('#importOverlay').classList.remove('hidden');
  try {
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    const song = await songFromAudio(file, { title, onStatus: status, isCancelled: () => cancelled });
    song.id = 'audio-' + Date.now();
    const list = readJSON('imported', []);
    list.push(song);
    writeJSON('imported', list);
    if (!readJSON('imported', []).some((s) => s.id === song.id)) throw new Error('не хватило места в памяти браузера — удали несколько загруженных песен');
    $('#importOverlay').classList.add('hidden');
    await loadLibrary();
    openSong(song);
  } catch (err) {
    $('#importOverlay').classList.add('hidden');
    if (err.message !== 'cancelled') alert('Не получилось распознать: ' + err.message);
  }
});

// ---------------------------------------------------------------- player state

const canvas = $('#view');
const views = { fall: new PianoView(canvas), sheet: new SheetView(canvas) };
let view = views[settings.view] || views.sheet;

const P = {
  song: null,
  steps: [],
  cur: 0,
  got: new Set(),
  viewBeat: 0,
  // wait   – waiting for the right notes
  // ready  – "in tempo" practice, stopped (press play)
  // play   – "in tempo" practice, running
  // listen – the app plays the song itself
  // done   – finished
  mode: 'wait',
  keyFx: new Map(),
  wrongUntil: 0,
  lastWrong: 0,
  stepT: 0,
  chordT: -1e9, // when the notes of the current step were struck
  prevOnset: -1e9, // ...and of the previous step
  stats: { hits: 0, wrong: 0, t0: 0 },
  noteState: new Map(), // "in tempo": note -> 'hit' | 'miss'
  play: null,
  listen: null,
  drag: null,
  open: false,
  names: new Map(),
};

const isPlayPractice = () => settings.practice === 'play';

function ppb() {
  const base = Math.max(60, Math.min(140, (view.hitY || 400) / 5));
  const bpmFactor = P.song ? Math.max(0.7, Math.min(1.4, 100 / P.song.bpm)) : 1;
  return base * settings.zoom * bpmFactor;
}

function layoutView() {
  if (!P.song) return;
  views.sheet.zoom = settings.zoom;
  view.resize();
  const [lo, hi] = songRange(P.song);
  view.setRange(lo, hi);
  if (view.setSong) view.setSong(P.song);
  $('#playCtl').style.bottom = `${(view.kbH || 150) + 14}px`;
  $('#status').classList.toggle('light', settings.view === 'sheet');
}

const ICON_STAFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h18M3 10h18M3 14h18M3 18h18"/><ellipse cx="15" cy="16" rx="2.6" ry="2" fill="currentColor" stroke="none"/><path d="M17.4 16V5"/></svg>';
const ICON_BARS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="4" y="3" width="4" height="10" rx="1.5"/><rect x="10" y="7" width="4" height="8" rx="1.5"/><rect x="16" y="2" width="4" height="7" rx="1.5"/><rect x="2" y="17" width="20" height="5" rx="1"/></svg>';

function updateViewBtn() {
  // Shows what a tap switches to.
  $('#viewBtn').innerHTML = settings.view === 'sheet' ? ICON_BARS : ICON_STAFF;
  $('#viewBtn').title = settings.view === 'sheet' ? 'Показать полосы' : 'Показать ноты';
}

function setView(v) {
  settings.view = v;
  saveSettings();
  view = views[v] || views.sheet;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.v === v));
  updateViewBtn();
  layoutView();
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
  layoutView();
  setHands(settings.hands);
  setPractice(settings.practice);
  $('#doneOverlay').classList.add('hidden');
  $('#startOverlay').classList.toggle('hidden', !!(detector.running || P.noMic));
  updateMicBtn();
}

function closeSong() {
  stopListen();
  stopPlay();
  P.open = false;
  P.song = null;
  $('#player').classList.add('hidden');
  $('#library').classList.remove('hidden');
  renderLibrary();
}

function setHands(h) {
  settings.hands = h;
  saveSettings();
  document.querySelectorAll('#handSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.hand === h));
  P.steps = buildSteps(P.song, h);
  restart();
}

function setPractice(p) {
  settings.practice = p;
  saveSettings();
  document.querySelectorAll('#practiceSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.v === p));
  $('#playCtl').classList.toggle('hidden', p !== 'play');
  restart();
}

function firstBeat() {
  return P.steps[0] ? P.steps[0].beat : 0;
}

function restart() {
  stopListen();
  stopPlay();
  P.cur = 0;
  P.got.clear();
  P.chordT = P.prevOnset = -1e9;
  P.mode = isPlayPractice() ? 'ready' : 'wait';
  P.stats = { hits: 0, wrong: 0, t0: 0 };
  P.noteState = new Map();
  P.keyFx.clear();
  P.viewBeat = isPlayPractice() ? firstBeat() : firstBeat() - 3;
  P.stepT = performance.now();
  $('#doneOverlay').classList.add('hidden');
  updateExpected();
  updateHud();
}

function seekTo(idx) {
  stopListen();
  idx = Math.max(0, Math.min(P.steps.length - 1, idx));
  if (isPlayPractice()) {
    stopPlay();
    seekBeat(P.steps[idx] ? P.steps[idx].beat : 0);
    return;
  }
  P.cur = idx;
  P.got.clear();
  P.chordT = P.prevOnset = -1e9;
  P.mode = 'wait';
  P.stepT = performance.now();
  updateExpected();
  updateHud();
}

// "In tempo": move the start position; notes from there on are graded afresh.
function seekBeat(beat) {
  P.viewBeat = beat;
  for (const n of [...P.noteState.keys()]) if (n.beat >= beat - 0.01) P.noteState.delete(n);
  P.mode = 'ready';
  updateHud();
}

function updateExpected() {
  if (isPlayPractice()) return; // updated every frame while playing
  const s = P.steps[P.cur];
  detector.expected = s ? s.required : new Set();
}

function fx(midi, color, ms) {
  P.keyFx.set(midi, { color, until: performance.now() + ms });
}

function flashWrong(midi, now) {
  fx(midi, COLORS.wrong, 600);
  P.wrongUntil = now + 450;
  if (now - P.lastWrong > 300) P.stats.wrong++;
  P.lastWrong = now;
  updateHud();
}

// ---------------------------------------------------------------- notes from the mic / screen

function onNote(midi, source, info) {
  const now = performance.now();
  if (source !== 'mic') fx(midi, COLORS.heard, 200);
  if (!P.open || P.drag) return;
  if (P.listenTail && now < P.listenTail) return;
  if (P.mode === 'play') return onNotePlay(midi, info, now);
  if (P.mode !== 'wait') return;
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
  flashWrong(midi, now);
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

// ---------------------------------------------------------------- "in tempo" practice

const HIT_WINDOW = 0.3; // seconds early/late that still count
const MIC_LATENCY = 60; // ms between striking a key and its detection

function beatsPerSec() {
  return (P.song.bpm / 60) * settings.tempo;
}

function beatAt(t) {
  return P.play.beat0 + ((t - P.play.t0) / 1000) * P.play.rate;
}

function startPlay() {
  if (!P.song || P.mode === 'play') return;
  stopListen();
  ensureAudio();
  const [num, den] = P.song.timeSig;
  const rate = beatsPerSec();
  const unit = den === 8 ? (num % 3 === 0 ? 1.5 : 0.5) : 4 / den; // count-in clicks
  const countBeats = (num * 4) / den;
  const lastBeat = Math.max(...P.song.notes.map((n) => n.beat + n.dur));
  let beat0 = P.viewBeat;
  if (beat0 >= lastBeat - 0.01) { restart(); beat0 = P.viewBeat; }
  const now = performance.now();
  P.play = { beat0, rate, t0: now + (countBeats / rate) * 1000, unit, countBeats, lastBeat, clickIdx: -1e9 };
  P.mode = 'play';
  if (!P.stats.t0) P.stats.t0 = now;
  $('#playBtn').classList.add('playing');
}

function stopPlay() {
  if (P.mode === 'play') P.mode = 'ready';
  P.play = null;
  $('#playBtn').classList.remove('playing');
}

function tickPlay(now) {
  const L = P.play;
  const beat = beatAt(now);
  P.viewBeat = beat;
  const win = HIT_WINDOW * L.rate;

  // Count-in and metronome clicks.
  const clickIdx = Math.floor((beat - L.beat0) / L.unit + 1e-6);
  if (clickIdx !== L.clickIdx) {
    L.clickIdx = clickIdx;
    if (clickIdx < 0 || settings.metronome) synth.click(clickIdx < 0 ? clickIdx === -Math.round(L.countBeats / L.unit) : false);
  }
  P.countIn = beat < L.beat0 ? Math.ceil((L.beat0 - beat) / L.unit) : 0;

  // Missed notes, and what to play now.
  const expected = new Set();
  const keys = new Map();
  for (const n of P.song.notes) {
    if (n.step < 0 || n.beat < L.beat0 - 0.01 || P.noteState.has(n)) continue;
    if (n.beat + win < beat) { P.noteState.set(n, 'miss'); continue; }
    if (n.beat - win <= beat && n.beat - beat < 0.6) expected.add(n.midi);
    if (n.beat - beat < 0.12) keys.set(n.midi, n.hand);
  }
  detector.expected = expected;
  P.expectedKeys = keys;

  if (beat > L.lastBeat + 0.5) finishPlay();
  updateHud();
}

function onNotePlay(midi, info, now) {
  const t = (info && info.t != null ? info.t : now) - MIC_LATENCY;
  const b = beatAt(t);
  const win = HIT_WINDOW * P.play.rate;
  let best = null;
  for (const n of P.song.notes) {
    if (n.step < 0 || n.midi !== midi || P.noteState.has(n)) continue;
    if (Math.abs(n.beat - b) <= win && (!best || Math.abs(n.beat - b) < Math.abs(best.beat - b))) best = n;
  }
  if (best) {
    P.noteState.set(best, 'hit');
    P.stats.hits++;
    fx(midi, COLORS.good, 350);
    return;
  }
  if (b < P.play.beat0 - 0.2) return; // during the count-in
  // A key that was just played correctly (re-trigger, overtone) is not a mistake.
  for (const [n, st] of P.noteState) if (st === 'hit' && n.midi === midi && Math.abs(n.beat - b) < 1.2 * win + 0.3) return;
  if (settings.hands !== 'both' && P.song.notes.some((n) => n.step < 0 && n.midi === midi && Math.abs(n.beat - b) <= 1)) return;
  if (info && info.strength < -12) return;
  flashWrong(midi, now);
}

function finishPlay() {
  const L = P.play;
  stopPlay();
  P.mode = 'done';
  const total = P.song.notes.filter((n) => n.step >= 0 && n.beat >= L.beat0 - 0.01).length || 1;
  const hits = [...P.noteState.values()].filter((v) => v === 'hit').length;
  showResult(Math.min(100, (100 * hits) / total), `Сыграно вовремя: <b>${hits}</b> из <b>${total}</b><br>Лишних нот: <b>${P.stats.wrong}</b><br>Темп: <b>${Math.round(settings.tempo * 100)}%</b>`, L.beat0 <= firstBeat() + 0.01);
}

// ---------------------------------------------------------------- results

function finish() {
  P.mode = 'done';
  const { hits, wrong, t0 } = P.stats;
  const acc = hits ? (100 * hits) / (hits + wrong) : 0;
  const secs = t0 ? (performance.now() - t0) / 1000 : 0;
  showResult(acc, `Точность: <b>${Math.round(acc)}%</b><br>Ошибок: <b>${wrong}</b><br>Время: <b>${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}</b>`, true);
}

function showResult(acc, html, whole) {
  const stars = acc >= 95 ? 3 : acc >= 80 ? 2 : 1;
  $('#stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('#doneStats').innerHTML = html;
  if (settings.hands === 'both' && whole) {
    const best = readJSON('best', {});
    if (best[P.song.id] == null || acc > best[P.song.id]) best[P.song.id] = acc;
    writeJSON('best', best);
  }
  setTimeout(() => { if (P.mode === 'done') $('#doneOverlay').classList.remove('hidden'); }, 600);
}

function updateHud() {
  if (!P.song) return;
  if (isPlayPractice()) {
    const end = songLength(P.song) || 1;
    $('#progressFill').style.width = `${Math.max(0, Math.min(100, (100 * (P.viewBeat - firstBeat())) / (end - firstBeat())))}%`;
    const hits = [...P.noteState.values()].filter((v) => v === 'hit').length;
    const miss = P.noteState.size - hits;
    $('#counter').innerHTML = `вовремя <b>${hits}</b>` + (miss ? ` · пропущено ${miss}` : '') +
      (P.stats.wrong ? ` · <span class="bad">лишних: ${P.stats.wrong}</span>` : '');
    return;
  }
  const total = P.steps.length || 1;
  $('#progressFill').style.width = `${(100 * P.cur) / total}%`;
  $('#counter').innerHTML = `<b>${Math.min(P.cur, total)}</b> / ${total}` +
    (P.stats.wrong ? ` · <span class="bad">ошибок: ${P.stats.wrong}</span>` : '');
}

// ---------------------------------------------------------------- listen mode

function startListen() {
  if (!P.song) return;
  stopPlay();
  ensureAudio();
  const rate = beatsPerSec();
  const startBeat = isPlayPractice() ? P.viewBeat : P.steps[P.cur] ? P.steps[P.cur].beat : 0;
  const idx = P.song.notes.findIndex((n) => n.beat >= startBeat - 1e-6);
  P.listen = { t0: audioCtx.currentTime + 0.25, beat0: startBeat - 0.25 * rate, rate, idx: idx < 0 ? P.song.notes.length : idx, on: [], back: P.mode };
  P.mode = 'listen';
  detector.paused = true;
  $('#listenBtn').textContent = '■ Стоп';
}

function stopListen() {
  if (!P.listen) return;
  const back = P.listen.back;
  P.listen = null;
  if (P.mode === 'listen') P.mode = back === 'done' ? 'done' : isPlayPractice() ? 'ready' : 'wait';
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
  if (L.idx >= notes.length && !L.on.length) {
    const end = beatNow;
    stopListen();
    if (isPlayPractice()) P.viewBeat = Math.min(end, songLength(P.song));
  }
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
  P.expectedKeys = null;
  P.countIn = 0;
  const dt = P.lastFrame ? Math.min(0.05, (now - P.lastFrame) / 1000) : 0.016;
  P.lastFrame = now;
  if (P.listen) tickListen();
  else if (P.play) tickPlay(now);
  else if (!P.drag && !isPlayPractice()) {
    const step = P.steps[P.cur] || P.steps[P.steps.length - 1];
    const target = P.mode === 'done' ? songLength(P.song) : step ? step.beat : 0;
    P.viewBeat += (target - P.viewBeat) * Math.min(1, dt * 7);
  }
  if (isPlayPractice() && !P.play && !P.listen) { // stopped: show where to start
    P.expectedKeys = new Map();
    for (const n of P.song.notes) if (n.step >= 0 && Math.abs(n.beat - P.viewBeat) < 0.05) P.expectedKeys.set(n.midi, n.hand);
  }

  view.draw({
    song: P.song,
    steps: P.steps,
    cur: P.mode === 'done' && !isPlayPractice() ? P.steps.length : P.cur,
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
    practice: settings.practice,
    noteState: P.noteState,
    expectedKeys: P.expectedKeys,
    countIn: P.countIn,
    hints: settings.hints,
    hands: settings.hands,
    now,
    nameOf: (m) => P.names.get(m) || midiToName(m),
  });
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- input

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
  if (P.mode === 'listen' || P.mode === 'play') return;
  canvas.setPointerCapture(e.pointerId);
  P.drag = { x, y, beat: P.viewBeat, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!P.drag) return;
  const r = canvas.getBoundingClientRect();
  const dx = e.clientX - r.left - P.drag.x;
  const dy = e.clientY - r.top - P.drag.y;
  if (Math.abs(dx) > 6 || Math.abs(dy) > 6) P.drag.moved = true;
  P.viewBeat = settings.view === 'sheet' ? P.drag.beat - dx / views.sheet.ppb : P.drag.beat + dy / ppb();
  P.viewBeat = Math.max(firstBeat() - 2, Math.min(songLength(P.song), P.viewBeat));
});
const endDrag = () => {
  if (!P.drag) return;
  const moved = P.drag.moved;
  P.drag = null;
  if (!moved || !P.steps.length) return;
  let best = 0;
  P.steps.forEach((s, i) => { if (Math.abs(s.beat - P.viewBeat) < Math.abs(P.steps[best].beat - P.viewBeat)) best = i; });
  if (isPlayPractice()) seekBeat(P.steps[best].beat);
  else seekTo(best);
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

$('#progress').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  seekTo(Math.floor(((e.clientX - r.left) / r.width) * P.steps.length));
});

// MIDI keyboard (where the browser supports it).
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

window.addEventListener('resize', layoutView);

// ---------------------------------------------------------------- buttons

$('#backBtn').addEventListener('click', closeSong);
$('#restartBtn').addEventListener('click', restart);
$('#againBtn').addEventListener('click', restart);
$('#toLibBtn').addEventListener('click', closeSong);
document.querySelectorAll('#handSeg button').forEach((b) => b.addEventListener('click', () => setHands(b.dataset.hand)));
document.querySelectorAll('#practiceSeg button').forEach((b) => b.addEventListener('click', () => setPractice(b.dataset.v)));
$('#listenBtn').addEventListener('click', () => (P.listen ? stopListen() : startListen()));
$('#playBtn').addEventListener('click', () => {
  if (P.mode === 'play') stopPlay();
  else { if (P.mode === 'done') restart(); startPlay(); }
});

function setTempo(v) {
  settings.tempo = Math.max(0.3, Math.min(1.5, Math.round(v * 20) / 20));
  saveSettings();
  $('#tempoVal').textContent = Math.round(settings.tempo * 100) + '%';
  $('#tempoText').textContent = Math.round(settings.tempo * 100) + '%';
  $('#tempoRange').value = settings.tempo;
  if (P.play) { // keep the position, change the speed
    const now = performance.now();
    const beat = beatAt(now);
    P.play.rate = beatsPerSec();
    P.play.beat0 = Math.max(beat, P.play.beat0);
    P.play.t0 = now + (P.play.beat0 - beat) / P.play.rate * 1000;
  }
}
$('#tempoDown').addEventListener('click', () => setTempo(settings.tempo - 0.05));
$('#tempoUp').addEventListener('click', () => setTempo(settings.tempo + 0.05));
$('#metroBtn').addEventListener('click', () => {
  settings.metronome = !settings.metronome;
  saveSettings();
  $('#metroBtn').classList.toggle('on', settings.metronome);
});

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
  stopPlay();
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
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.v === settings.view));
  $('#sensRange').value = settings.sensitivity;
  $('#zoomRange').value = settings.zoom;
  $('#tempoRange').value = settings.tempo;
  $('#tempoText').textContent = Math.round(settings.tempo * 100) + '%';
  $('#heardChk').checked = settings.showHeard;
  $('#hintsChk').checked = settings.hints;
  $('#settingsOverlay').classList.remove('hidden');
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#libSettings').addEventListener('click', openSettings);
$('#settingsClose').addEventListener('click', () => { $('#settingsOverlay').classList.add('hidden'); saveSettings(); });
document.querySelectorAll('#labelSeg button').forEach((b) => b.addEventListener('click', () => {
  settings.labels = b.dataset.v;
  document.querySelectorAll('#labelSeg button').forEach((x) => x.classList.toggle('sel', x === b));
}));
document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));
$('#sensRange').addEventListener('input', (e) => { settings.sensitivity = +e.target.value; detector.sensitivity = settings.sensitivity; });
$('#zoomRange').addEventListener('input', (e) => { settings.zoom = +e.target.value; layoutView(); });
$('#tempoRange').addEventListener('input', (e) => setTempo(+e.target.value));
$('#heardChk').addEventListener('change', (e) => { settings.showHeard = e.target.checked; });
$('#hintsChk').addEventListener('change', (e) => { settings.hints = e.target.checked; saveSettings(); });
$('#viewBtn').addEventListener('click', () => setView(settings.view === 'sheet' ? 'fall' : 'sheet'));

setTempo(settings.tempo);
updateViewBtn();
$('#metroBtn').classList.toggle('on', !!settings.metronome);
document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.v === settings.view));

// Debug/testing hook (used by automated tests).
window.__piano = { P, detector, settings, openSong: (id) => openSong(library.find((e) => e.song.id === id).song), library: () => library, setPractice, setView, startPlay };

document.fonts && document.fonts.load('40px Bravura').catch(() => {});
loadLibrary();
