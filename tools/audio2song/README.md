# Audio → .song (main way to add songs)

Works on any **piano** recording: a screen recording of a YouTube piano tutorial (with sound),
an mp3/m4a, etc. YouTube itself cannot be downloaded from the cloud box (bot check, IP-bound
links), so the user records the screen on the iPad and uploads the file.

Setup (once per container, CPU only, ~1 GB):

    pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
    pip install transkun pretty_midi audioop-lts

On Windows without MSVC, transkun's `ncls` dependency (only used for training data) fails to build:
install everything from `requirements.txt` except transkun, plus `scipy mir-eval pydub tqdm
torch-optimizer sox soxr moduleconf`, then `pip install --no-deps transkun==2.0.1`.

Run (≈ 1 min of CPU per minute of audio):

    python3 tools/audio2song/audio2song.py recording.mp4 songs/<slug>.song \
        --title "..." --artist "..." --youtube URL --start 7 --end 292

`--start/--end` cut off the intro/outro of the video (find them by listening or from the note
times). The script prints the tempo and how well notes fit the beat grid (a few ms = steady
tempo, good). Check the result with `node tools/check-songs.mjs` and open it in the app.

Accuracy measured on the Cyberpunk tutorial against notes read frame by frame from the video:
96% raw, the remaining differences were mostly the video reader's own mistakes; the only real
miss was a repeated bass note merged into one long note. Hands matched the video colours
837/837. If the video is Synthesia-style, `tools/synthesia/` can cross-check.
