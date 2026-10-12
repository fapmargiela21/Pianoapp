// End-to-end test of "🎵 Из аудио": synthesises a recording of a song, uploads it in Chromium
// and compares the transcribed song with the original.
//
//   npx http-server -p 8080 -s -c-1 &      (from the repo root)
//   node tools/e2e/audio-import.mjs [song-id] [seconds]   (needs python3 + numpy and Playwright)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSongText } from '../../js/songs.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const url = process.env.APP_URL || 'http://localhost:8080/index.html';
const id = process.argv[2] || 'cyberpunk-stay-at-your-house';
const maxSec = parseFloat(process.argv[3] || '45');
const tmp = mkdtempSync(join(tmpdir(), 'piano-audio-'));

const ref = parseSongText(readFileSync(join(root, 'songs', id + '.song'), 'utf8'), id);
const spb = 60 / ref.bpm;
const want = ref.notes.filter((n) => 1 + n.beat * spb < maxSec);
writeFileSync(join(tmp, 'n.json'), JSON.stringify(want.map((n) => ({ t: 1 + n.beat * spb, d: n.dur * spb, midi: n.midi }))));
const wav = join(tmp, id + '.wav');
execFileSync('python3', [join(here, 'song-audio.py'), join(tmp, 'n.json'), wav]);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
page.on('dialog', (d) => { console.log('alert:', d.message()); d.dismiss(); });
await page.goto(url);
await page.waitForFunction(() => window.__piano && window.__piano.library().length > 0);
// Headless Chromium has no GPU (WebGL is emulated and very slow): BACKEND=cpu is much faster here.
if (process.env.BACKEND) {
  await page.evaluate(async (b) => { const M = await import('./js/vendor/basic-pitch.js'); await M.tf.setBackend(b); }, process.env.BACKEND);
}
const t0 = Date.now();
await page.setInputFiles('#audioInput', wav);
const tick = setInterval(async () => {
  const s = await page.evaluate(() => document.querySelector('#importStatus').textContent + ' ' + document.querySelector('#importFill').style.width).catch(() => '');
  if (s.trim()) console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s ${s}`);
}, 30000);
await page.waitForFunction(() => !document.querySelector('#player').classList.contains('hidden'), null, { timeout: 600000 });
clearInterval(tick);
const song = await page.evaluate(() => JSON.parse(localStorage.getItem('pianoapp.imported')).at(-1));
const backend = await page.evaluate(async () => (await import('./js/vendor/basic-pitch.js')).tf.getBackend());
await browser.close();

const key = (n) => `${n.midi}@${n.beat.toFixed(2)}`;
const got = new Map(song.notes.map((n) => [key(n), n]));
let hit = 0, hand = 0;
for (const n of want) {
  const g = got.get(key(n));
  if (g) { hit++; if (g.hand === n.hand) hand++; }
}
const recall = hit / want.length, precision = hit / song.notes.length;
const ok = song.bpm === Math.round(ref.bpm) && song.timeSig.join('/') === ref.timeSig.join('/')
  && song.key === ref.key && song.pickup === ref.pickup && recall > 0.9 && precision > 0.85;
console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} (${maxSec}s, ${backend}, ${((Date.now() - t0) / 1000).toFixed(0)}s): `
  + `bpm ${song.bpm}/${ref.bpm}, ${song.timeSig.join('/')}, key ${song.key}/${ref.key}, pickup ${song.pickup}/${ref.pickup}, `
  + `notes found ${hit}/${want.length} (${(recall * 100).toFixed(0)}%), extra ${song.notes.length - hit}, hand ok ${hand}/${hit}`);
process.exit(ok ? 0 : 1);
