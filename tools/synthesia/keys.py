#!/usr/bin/env python3
"""Notes and hands from the lit keys of a Synthesia-style video (one colour per hand).

  python3 tools/synthesia/keys.py video.mp4 audio-notes.json out.json [--offset 0.13]

For each frame, every key is classified by colour (blue = left hand, green = right hand in the
howtoplaytutorial videos); a run of frames is a note. A key that stays lit through repeated strikes
is split where the audio transcription (audio-notes.json: [{s, p}], e.g. the raw Transkun MIDI of
the same video) has a new onset of that pitch. Output: [{s, e, p, hand}] on the audio timeline,
ready for `audio2song.py x out.song --notes out.json`.

Calibration (1280x720, default Synthesia keyboard whose "C0" label is our C1): white key width W,
black-key offsets BLACK, sample rows Y_BLACK / Y_WHITE. Check them on one frame for a new layout.
The key lights ~0.13 s before the note is heard (--offset).
"""
import argparse, collections, json, subprocess, numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('video'); ap.add_argument('audio'); ap.add_argument('out')
ap.add_argument('--offset', type=float, default=0.13)
ap.add_argument('--fps', type=float, default=25)
a = ap.parse_args()

W = 33.67                    # white key width, px
Y0, H = 470, 230             # decoded band of rows
Y_BLACK, Y_WHITE = 565, 690  # where black keys / white key fronts are sampled
BASE = 24                    # midi of the leftmost white key (C1)
STEP = [0, 2, 4, 5, 7, 9, 11]
BLACK = {1: (1, -2), 3: (2, 5), 6: (4, -4), 8: (5, 0), 10: (6, 6)}   # semitone -> (white boundary, px offset)

keys = []
for p in range(BASE, BASE + 88):
    o, s = divmod(p - BASE, 12)
    if s in BLACK: b, off = BLACK[s]; x, y = W * (7 * o + b) + off, Y_BLACK
    else: x, y = W * (7 * o + STEP.index(s)) + W / 2, Y_WHITE
    if x < 1277: keys.append((p, int(round(x)), y - Y0))

def colour(r, g, b):
    if g - r > 35 and g > b + 15: return 2      # green: right hand
    if b - r > 30 and b >= g - 5: return 1      # blue: left hand
    return 0

proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', a.video, '-vf', f'crop=1280:{H}:0:{Y0}',
                         '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
size, states = 1280 * H * 3, []
while True:
    buf = proc.stdout.read(size)
    if len(buf) < size: break
    img = np.frombuffer(buf, np.uint8).reshape(H, 1280, 3).astype(int)
    states.append([colour(*img[y - 3:y + 4, x - 2:x + 3].reshape(-1, 3).mean(0)) for _, x, y in keys])
S = np.array(states, np.int8)

notes = []
for k, (p, _, _) in enumerate(keys):
    col = S[:, k].copy()
    for i in range(1, len(col) - 2):          # 1-2 frame dropouts (the onset sparkle washes the colour out)
        if col[i] == 0 and col[i - 1] and (col[i + 1] == col[i - 1] or col[i + 2] == col[i - 1]): col[i] = col[i - 1]
    i = 0
    while i < len(col):
        if col[i]:
            j = i
            while j < len(col) and col[j] == col[i]: j += 1
            if j - i >= 2: notes.append(dict(p=p, s=i / a.fps, e=j / a.fps, hand='L' if col[i] == 1 else 'R'))
            i = j
        else: i += 1

onsets = collections.defaultdict(list)
for n in json.load(open(a.audio)): onsets[n['p']].append(n['s'] - a.offset)
out = []
for n in notes:
    s0 = n['s']
    for t in [t for t in onsets[n['p']] if n['s'] + 0.15 < t < n['e'] - 0.08]:
        out.append(dict(n, s=s0, e=t - 0.02)); s0 = t
    out.append(dict(n, s=s0))
out = [dict(s=round(n['s'] + a.offset, 4), e=round(n['e'] + a.offset, 4), p=n['p'], hand=n['hand'])
       for n in sorted(out, key=lambda n: (n['s'], n['p']))]
json.dump(out, open(a.out, 'w'))
audio = json.load(open(a.audio))
heard = sum(any(m['p'] == n['p'] and abs(m['s'] - n['s']) < 0.09 for m in audio) for n in out)
print(f"{len(out)} notes (L {sum(n['hand'] == 'L' for n in out)}, R {sum(n['hand'] == 'R' for n in out)}); "
      f"{heard} also heard in the audio at the same pitch and time")
