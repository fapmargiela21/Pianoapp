# Gemini (via Polza.ai) as a YouTube-link → notes transcriber: tested, NOT usable

Polza.ai passes YouTube links straight to Gemini (`video_url`), so no download is needed —
but the notes are wrong. Test on the Cyberpunk tutorial (https://youtu.be/4fJy8bV07vU),
first 8 bars vs `songs/cyberpunk-stay-at-your-house.song` (checked frame by frame), 2026-10:

| model | tempo / key (true: 106, F#) | right-hand notes in order | left hand |
|---|---|---|---|
| google/gemini-3.8-flash | 110, B | 0 % (invented a descending pattern) | 0 % |
| google/gemini-3.1-pro-preview | 80, B | 39 % (about chance level) | 38 % |
| Transkun (`tools/audio2song`) for comparison | 106, F# | 96 % of the whole song | |

Use `ask.py` to re-test newer models. Base URL `https://api.polza.ai/api/v1` (the session's
network secret, if any, is bound to `polza.ai` and may override the Authorization header there).
