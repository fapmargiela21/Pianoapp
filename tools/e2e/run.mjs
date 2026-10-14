// End-to-end test of microphone note detection.
// Synthesises piano-like audio for a song and feeds it to Chromium as a fake microphone,
// then checks that the app walks through every step.
//
//   npx http-server -p 8080 -s -c-1 &      (from the repo root)
//   node tools/e2e/run.mjs                 (needs python3 + numpy and Playwright)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSongText, buildSteps } from '../../js/songs.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const exe = process.env.CHROMIUM || undefined;
const url = process.env.APP_URL || 'http://localhost:8080/index.html';
const tmp = mkdtempSync(join(tmpdir(), 'piano-e2e-'));

// [song, hands, seconds between steps, insert a wrong note every N steps, pedal, detune cents]
const CASES = [
  ['ode-to-joy', 'R', 0.5, 0, false, 0],
  ['ode-to-joy', 'R', 0.5, 0, true, 0],
  ['ode-to-joy', 'R', 0.5, 0, false, -35],
  ['twinkle', 'both', 0.55, 7, false, 0],
  ['fur-elise', 'both', 0.35, 0, true, 0],
  ['fur-elise', 'both', 0.3, 6, false, 0],
  ['scale-c-major', 'both', 0.6, 0, true, 0],
];

let failed = 0;
for (const [id, hands, spacing, wrongEvery, pedal, cents] of CASES) {
  const song = parseSongText(readFileSync(join(root, 'songs', id + '.song'), 'utf8'), id);
  const steps = buildSteps(song, hands).map((s) => ({ beat: s.beat, midi: [...s.required] }));
  const json = join(tmp, id + '.json');
  const wav = join(tmp, `${id}-${hands}-${pedal}-${cents}.wav`);
  writeFileSync(json, JSON.stringify(steps));
  const info = JSON.parse(execFileSync(process.env.PYTHON || 'python3', [join(here, 'make-audio.py'), json, wav, String(spacing), String(wrongEvery), pedal ? 'pedal' : ''],
    { env: { ...process.env, CENTS: String(cents) } }).toString());

  const browser = await chromium.launch({ executablePath: exe, args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`] });
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  await page.goto(url);
  await page.waitForFunction(() => window.__piano && window.__piano.library().length > 0);
  await page.evaluate(([i, h]) => { window.__piano.settings.hands = h; window.__piano.openSong(i); }, [id, hands]);
  await page.click('#startMic');
  await page.waitForFunction(() => window.__piano.detector.running);
  await page.waitForTimeout((info.duration + 1.5) * 1000);
  const r = await page.evaluate(() => ({ cur: window.__piano.P.cur, total: window.__piano.P.steps.length, wrong: window.__piano.P.stats.wrong }));
  await browser.close();
  const ok = r.cur === r.total && Math.abs(r.wrong - info.wrongs) <= Math.max(2, info.wrongs * 0.3);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${hands}${pedal ? ' pedal' : ''}${cents ? ` ${cents}c` : ''}: шагов ${r.cur}/${r.total}, ошибок ${r.wrong} (вставлено ${info.wrongs})`);
}
process.exit(failed ? 1 : 0);
