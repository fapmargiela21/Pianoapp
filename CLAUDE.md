# Piano trainer (static web app, no build step)

The user (Russian-speaking, beginner pianist) plays on an iPad via GitHub Pages. They send
YouTube links and sheet music in chat; the usual task is to add a song.

## Adding a song
1. Write `songs/<slug>.song` in the text format described in README.md (`[R]`/`[L]` sections,
   `C4/4` pitch+duration, sticky durations, `[C4 E4]` chords, `r` rests, `~` ties, `@n` fingering, `|` bars).
2. Add the filename to `songs/index.json`.
3. Run `node tools/check-songs.mjs` — it must print no ⚠ warnings (bar lengths are validated).
4. Prefer a beginner-friendly arrangement (simplified left hand) unless asked for the full one;
   put the YouTube link in `youtube:`. Never invent notes you are unsure of — ask for sheet music.

## Code map
- `js/pitch.js` mic note detection (harmonic salience per key, onset detection, overtone filtering).
- `js/app.js` game logic: practice modes "wait" (step until the right notes) and "play" (in tempo,
  notes graded hit/miss); views: `js/sheet.js` grand staff (Bravura SMuFL font) and `js/render.js`
  falling notes; both draw the keyboard. `js/songs.js` parsers. Set `key:` in songs so the staff gets
  the right key signature.
- Tests: `node tools/check-songs.mjs`; `tools/e2e/run.mjs` (fake-mic detection test, see header).
- UI text is Russian.
