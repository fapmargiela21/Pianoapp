# Synthesia video → .song

Used for PianoGumi-style videos (falling bars over a keyboard). The user screen-records the
YouTube video on the iPad and uploads it (YouTube itself blocks downloads from the cloud box).

1. `python3 extract.py video.mp4 segs.json` — reads the bars above the keyboard every frame.
   Calibration constants at the top (white key width/offset, first white key, black key
   centres `BLACK_X`, hit line `YHIT` in notes.py) were measured for a 1280×720 PianoGumi
   video showing D2–F6; re-measure them from a frame for other layouts.
2. `notes.py` clusters per-frame bar observations into notes (fall speed found by grid search).
3. `python3 prepare.py T_START T_END` drops intro/outro junk and fragments and fits the tempo grid
   (writes `good.json`). Then set `START` (first note) and `BAR0` (first downbeat, found from where
   the left-hand notes fall mod 16) plus the header in `tosong.py`, and run `python3 tosong.py out.song`.
4. `audiocheck.py` checks every note against the video's audio (pitch salience rise).
Hands come from bar colour (yellow = left, purple = right in PianoGumi videos).
