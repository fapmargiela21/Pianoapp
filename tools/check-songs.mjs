// Validates every song in songs/index.json: node tools/check-songs.mjs
import { readFileSync } from 'node:fs';
import { parseSongText, buildSteps } from '../js/songs.js';

const files = JSON.parse(readFileSync(new URL('../songs/index.json', import.meta.url)));
let bad = 0;
for (const f of files) {
  const song = parseSongText(readFileSync(new URL('../songs/' + f, import.meta.url), 'utf8'), f.replace(/\.song$/, ''));
  const steps = buildSteps(song, 'both');
  const hands = ['R', 'L'].map((h) => song.notes.filter((n) => n.hand === h).length);
  console.log(`${f}: «${song.title}», нот R/L ${hands.join('/')}, шагов ${steps.length}, затакт ${song.pickup}`);
  for (const w of song.warnings) { console.log('  ⚠ ' + w); bad++; }
}
process.exit(bad ? 1 : 0);
