// Scores js/pitch.js offline (tools/e2e/offline-detect.mjs) on synthesised songs and, if present,
// on real piano recordings with reference notes. Run after changing pitch.js:
//   node tools/e2e/offline-eval.mjs [real.wav real-notes.json ...]
// Real reference notes: [{s, p}] (e.g. Transkun on the recording, ghost octaves removed).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSongText, buildSteps } from '../../js/songs.js';
import { detect, score } from './offline-detect.mjs';
import { NoteDetector } from '../../js/pitch.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'piano-eval-'));
const { minMidi, maxMidi } = new NoteDetector();
// [song, hands, seconds between steps, wrong note every N steps, pedal, detune cents]
const CASES = [
  ['ode-to-joy', 'R', 0.5, 0, false, 0], ['ode-to-joy', 'R', 0.5, 0, true, 0], ['ode-to-joy', 'R', 0.5, 0, false, -35],
  ['twinkle', 'both', 0.55, 7, false, 0], ['fur-elise', 'both', 0.35, 0, true, 0], ['fur-elise', 'both', 0.3, 6, false, 0],
  ['scale-c-major', 'both', 0.6, 0, true, 0], ['cyberpunk-stay-at-your-house', 'both', 0.3, 0, true, 0],
];
const rows = [];
for (const [id, hands, spacing, wrongEvery, pedal, cents] of CASES) {
  const song = parseSongText(readFileSync(join(root, 'songs', id + '.song'), 'utf8'), id);
  const steps = buildSteps(song, hands).slice(0, 120).map((s) => ({ beat: s.beat, midi: [...s.required] }));
  const json = join(tmp, 'steps.json'), wav = join(tmp, 'a.wav'), ev = join(tmp, 'ev.json');
  writeFileSync(json, JSON.stringify(steps));
  execFileSync('python3', [join(here, 'make-audio.py'), json, wav, String(spacing), String(wrongEvery), pedal ? 'pedal' : ''],
    { env: { ...process.env, CENTS: String(cents), EVENTS: ev } });
  const events = JSON.parse(readFileSync(ev));
  const right = events.filter((e) => !e.wrong), wrong = events.filter((e) => e.wrong);
  const log = detect(wav, right);
  const r = score(log, right, { lo: minMidi, hi: maxMidi });
  const wrongHeard = wrong.filter((w) => log.some((d) => d.p === w.p && Math.abs(d.t - w.s) < 0.25)).length;
  rows.push([`${id} ${hands}${pedal ? ' pedal' : ''}${cents ? ` ${cents}c` : ''}`, r.hit.length, r.total, r.extra.length - wrongHeard, `${wrongHeard}/${wrong.length}`]);
}
const real = process.argv.slice(2);
for (let i = 0; i + 1 < real.length; i += 2) {
  const ref = JSON.parse(readFileSync(real[i + 1]));
  const log = detect(real[i], ref);
  const r = score(log, ref, { lo: minMidi, hi: maxMidi });
  rows.push([real[i].split('/').pop(), r.hit.length, r.total, r.extra.length, '-']);
}
console.log('case'.padEnd(42), 'heard'.padStart(9), 'extra'.padStart(6), 'wrong notes caught');
let H = 0, T = 0, E = 0;
for (const [name, h, t, e, w] of rows) {
  console.log(name.padEnd(42), `${h}/${t}`.padStart(9), String(e).padStart(6), w.padStart(8));
  H += h; T += t; E += e;
}
console.log('TOTAL'.padEnd(42), `${H}/${T}`.padStart(9), String(E).padStart(6));
