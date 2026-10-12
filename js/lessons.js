// Step-by-step lessons for a song: it is cut into 4-bar phrases; each new phrase is learned
// right hand -> left hand -> both hands -> both hands in tempo (graded), every two phrases are
// joined, and the whole song comes last. Phrases that repeat are learned once.

const PHRASE_BARS = 4;

export function bars(song) {
  const measure = (song.timeSig[0] * 4) / song.timeSig[1];
  let end = 0;
  for (const n of song.notes) end = Math.max(end, n.beat + n.dur);
  const starts = [0];
  let b = song.pickup > 0 ? song.pickup : measure;
  while (b < end - 1e-6) { starts.push(b); b += measure; }
  return { starts, end, measure };
}

// The part of a song between two beats, as a song of its own (beats start at 0).
export function section(song, b0, b1, label) {
  const notes = song.notes
    .filter((n) => n.beat >= b0 - 1e-6 && n.beat < b1 - 1e-6)
    .map((n) => ({ ...n, beat: +(n.beat - b0).toFixed(5), dur: Math.min(n.dur, b1 - n.beat) }));
  const sub = { ...song, id: `${song.id}@${b0}-${b1}`, notes, pickup: b0 === 0 ? song.pickup : 0, parent: song.id, label };
  if (song.sync) sub.sync = { ...song.sync, offset: song.sync.offset + (b0 * 60) / (song.sync.bpm || song.bpm) };
  return sub;
}

function tokens(song, b0, b1) {
  return new Set(song.notes.filter((n) => n.beat >= b0 - 1e-6 && n.beat < b1 - 1e-6)
    .map((n) => `${n.midi}${n.hand}${(n.beat - b0).toFixed(2)}`));
}
// Two phrases count as the same when almost all their notes match (songs transcribed from
// audio differ in a note or two between repeats).
function similar(a, b) {
  if (!a.size && !b.size) return true;
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return common / Math.max(a.size, b.size) >= 0.85;
}

const barsLabel = (a, b) => (a === b ? `такт ${a}` : `такты ${a}–${b}`);

// [{ title, sub, exercises: [{ key, title, hands, practice, b0, b1 }] }]
export function buildLessons(song) {
  const { starts, end } = bars(song);
  const has = (hand, b0, b1) => song.notes.some((n) => n.hand === hand && n.beat >= b0 - 1e-6 && n.beat < b1 - 1e-6);
  // Phrases of 4 bars (a last short one is merged into the one before when it has fewer than 2 bars).
  const phrases = [];
  for (let i = 0; i < starts.length; i += PHRASE_BARS) {
    const j = Math.min(i + PHRASE_BARS, starts.length);
    phrases.push({ first: i + 1, last: j, b0: starts[i], b1: j < starts.length ? starts[j] : end });
  }
  if (phrases.length > 1 && phrases[phrases.length - 1].last - phrases[phrases.length - 1].first < 1) {
    const tail = phrases.pop();
    Object.assign(phrases[phrases.length - 1], { last: tail.last, b1: tail.b1 });
  }
  const phrasesWithNotes = phrases.filter((p) => song.notes.some((n) => n.beat >= p.b0 - 1e-6 && n.beat < p.b1 - 1e-6));
  const learned = [];      // [{ tokens, lesson }]
  const lessons = [];
  let num = 0;
  let pendingJoin = [];
  for (const p of phrasesWithNotes) {
    const tk = tokens(song, p.b0, p.b1);
    const same = learned.find((l) => similar(l.tokens, tk));
    if (same) { same.lesson.repeats++; pendingJoin = []; continue; }
    const where = barsLabel(p.first, p.last);
    const ex = [];
    const key = `${p.b0}`;
    if (has('R', p.b0, p.b1)) ex.push({ key: `${key}R`, title: 'Правая рука', hands: 'R', practice: 'wait', b0: p.b0, b1: p.b1 });
    if (has('L', p.b0, p.b1)) ex.push({ key: `${key}L`, title: 'Левая рука', hands: 'L', practice: 'wait', b0: p.b0, b1: p.b1 });
    if (has('R', p.b0, p.b1) && has('L', p.b0, p.b1)) ex.push({ key: `${key}B`, title: 'Двумя руками', hands: 'both', practice: 'wait', b0: p.b0, b1: p.b1 });
    ex.push({ key: `${key}T`, title: 'Проверка: в темпе', hands: 'both', practice: 'play', b0: p.b0, b1: p.b1, graded: true });
    const lesson = { title: `Урок ${++num}`, sub: where, exercises: ex, repeats: 1 };
    learned.push({ tokens: tk, lesson });
    lessons.push(lesson);
    pendingJoin.push(p);
    // Every two new phrases that follow each other: play them in one go.
    if (pendingJoin.length === 2) {
      const a = pendingJoin[0], b = pendingJoin[1];
      lessons.push({
        title: 'Связка', sub: barsLabel(a.first, b.last), join: true,
        exercises: [
          { key: `j${a.b0}-${b.b1}W`, title: 'Двумя руками', hands: 'both', practice: 'wait', b0: a.b0, b1: b.b1 },
          { key: `j${a.b0}-${b.b1}T`, title: 'Проверка: в темпе', hands: 'both', practice: 'play', b0: a.b0, b1: b.b1, graded: true },
        ],
      });
      pendingJoin = [];
    }
  }
  const b0 = phrasesWithNotes.length ? phrasesWithNotes[0].b0 : 0;
  const b1 = phrasesWithNotes.length ? phrasesWithNotes[phrasesWithNotes.length - 1].b1 : 0;
  const lastJoin = lessons.filter((l) => l.join).pop();
  const covered = lastJoin && lastJoin.exercises[0].b0 === b0 && lastJoin.exercises[0].b1 === b1;
  if (phrasesWithNotes.length > 1 && !covered) {
    lessons.push({
      title: 'Вся песня', sub: barsLabel(phrasesWithNotes[0].first, phrasesWithNotes[phrasesWithNotes.length - 1].last), final: true,
      exercises: [
        { key: 'allW', title: 'Двумя руками', hands: 'both', practice: 'wait', b0, b1 },
        { key: 'allT', title: 'Проверка: в темпе', hands: 'both', practice: 'play', b0, b1, graded: true },
      ],
    });
  }
  return lessons;
}

export const starsFor = (acc) => (acc == null ? 0 : acc >= 95 ? 3 : acc >= 80 ? 2 : acc >= 60 ? 1 : 0);
export const PASS = 80;     // % needed to count an exercise as done
