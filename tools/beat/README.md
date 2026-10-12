# Beat (rap/trap instrumental) → piano part

Transkun only knows piano: on a beat it hears synths, 808 and drums as a mess. A beat is a loop,
so the real notes are the ones that come back in most repeats.

1. Raw transcription: the `raw-midi` artifact of the "Transcribe" run for the link (or run
   `transkun audio.wav raw.mid --device cpu`). Audio: push `tools/synthesia/video-request.txt`
   (`<url> 360p`) on a working branch → artifact `video` → `ffmpeg -i video.mp4 -ac 1 -ar 22050 a.wav`.
2. `python3 tools/beat/loop.py raw.mid --bars 4` → tempo, loop start (the `sync:` offset), stable notes.
   Try `--bars 2` / `8` if the loop looks unclear.
3. `python3 tools/beat/check.py a.wav BPM START` → confirm each note starts where the loop says,
   catch notes the transcription missed, drop drum hits (several unrelated pitches rising together).
4. Write the song by hand: right hand = melody (one octave around C4–C5), left hand = bass roots,
   loop ×4; `key:` from the pitch classes (minor keys are common; spell notes in the key, e.g. E#
   in D# minor); comment that it is "мелодия бита". `node tools/check-songs.mjs` must be clean.
Example: `songs/yt--pwb1lcg12i.song` (Платина — Плывут).
