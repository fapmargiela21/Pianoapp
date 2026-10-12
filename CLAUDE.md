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
5. Easiest: the user adds songs themselves with "🔗 По ссылке" (GitHub Actions: Apify download + Transkun,
   `.github/workflows/transcribe.yml`, `tools/audio2song/youtube.py` + `inbox.py`); you can trigger the same
   workflow (workflow_dispatch, inputs url/title). Auto songs are unchecked — review them if asked.
   YouTube downloads are blocked here (bot check). Ask for an iPad screen recording or an audio
   file of a *piano* version, then `tools/audio2song/` (Transkun transcription → .song, see its
   README). For Synthesia-style videos `tools/synthesia/keys.py` reads notes AND hands from the lit-key
   colours (see its README; auto songs split hands by pitch, which can give one hand a >octave chord).

6. A rap/trap beat (not piano): Transkun gives noise. Follow `tools/beat/README.md` — find the loop in
   the raw transcription (`loop.py`), confirm against the loop-averaged audio (`check.py`), write the
   melody + bass of one loop by hand (example `songs/yt--pwb1lcg12i.song`).

## Code map
- `js/pitch.js` mic note detection (harmonic salience per key, onset detection, overtone filtering).
- `js/audio-import.js` + `js/transcribe.js`: in-app "🎵 Из аудио" (Basic Pitch via TF.js in `js/vendor/`,
  rebuilt by `tools/basic-pitch/build.sh`; transcribe.js is a JS port of audio2song.py's grid/hands/key logic).
- `js/app.js` game logic: practice modes "wait" (step until the right notes) and "play" (in tempo,
  notes graded hit/miss); views: `js/sheet.js` grand staff (Bravura SMuFL font) and `js/render.js`
  falling notes; both draw the keyboard. `js/songs.js` parsers. Set `key:` in songs so the staff gets
  the right key signature.
- `js/lessons.js`: "📚 Уроки" — a song cut into 4-bar phrases (repeats learned once), each R → L → both →
  graded in-tempo check, joins every two phrases, whole song last; exercises run as sub-songs (`section`).
- Mic detection is tuned on real recordings with `tools/e2e/offline-eval.mjs` (runs pitch.js without a
  browser; pass `rec.wav notes.json` pairs, notes from Transkun). Bass keys (< E3) are detected by their
  overtone row (iPad mics barely pick up their fundamental); keep chords and synthetic cases passing.
- Tests: `node tools/check-songs.mjs`; `tools/e2e/run.mjs` (fake-mic detection test, see header);
  `tools/e2e/audio-import.mjs` (upload a synthesised recording, compare with the original song).
- UI text is Russian.

## Workflow and state (carried over from the cloud sessions)
- GitHub Pages serves branch `claude/piano-training-app-v577ce` (also the default branch) at
  https://fapmargiela21.github.io/Pianoapp/. Work on a separate branch and let the user merge it
  (compare link → Create pull request → Merge), unless they say to push to the site branch directly.
- Secrets: `APIFY_TOKEN` lives only in the repo's Actions secrets; the GitHub token for "🔗 По ссылке"
  only in the iPad's localStorage. Never put keys in the repo or ask the user to paste them in chat.
- On the user's own PC YouTube is not bot-blocked: `yt-dlp -x --audio-format mp3 <url>` then
  `tools/audio2song/` (install `tools/audio2song/requirements.txt`, CPU torch) works locally.
- Songs read by hand from sheet-music screenshots (OMR by eye, zoomed crops with staff-line guides):
  `songs/platina-neo.song` (НЕО, Easy-Medium). Uncertain spots there: intro chords (bars 1–8),
  LH end of bar 28, RH bar 70 (the note after F4).
- Keys below E1 can't be heard by the mic; `micMidi()` in `js/songs.js` counts them an octave up.
