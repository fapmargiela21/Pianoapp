#!/usr/bin/env python3
"""Piano audio (mp3/m4a/wav/mp4 screen recording) -> .song for the app.

  python3 audio2song.py input.m4a out.song --title "..." [--artist ...] [--youtube URL]
                        [--start SEC] [--end SEC] [--midi already_transcribed.mid]

1. Transkun (state-of-the-art piano transcription, pip install transkun) -> MIDI.
2. A constant-tempo 16th grid is fitted to the note onsets (tutorial videos are played
   from MIDI, so the tempo is steady); downbeats come from where bass notes cluster.
3. Key from the pitch-class profile (Krumhansl), which also decides sharps vs flats.
4. Hands: each moment's notes are split at a moving point between melody and bass.
"""
import argparse, json, os, subprocess, sys, tempfile, collections
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('input'); ap.add_argument('out')
ap.add_argument('--title', default=''); ap.add_argument('--artist', default='')
ap.add_argument('--youtube', default=''); ap.add_argument('--difficulty', type=int, default=2)
ap.add_argument('--start', type=float, default=0); ap.add_argument('--end', type=float, default=1e9)
ap.add_argument('--midi', default=''); ap.add_argument('--time', default='')
ap.add_argument('--min-velocity', type=int, default=20)
ap.add_argument('--dump', default='', help='write the quantized notes as JSON (for checking)')
a = ap.parse_args()

# ------------------------------------------------------------------ transcription
mid = a.midi
if not mid:
    tmp = tempfile.mkdtemp()
    wav = os.path.join(tmp, 'in.wav')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', a.input, '-ac', '2', '-ar', '44100', wav], check=True)
    mid = os.path.splitext(a.out)[0] + '.mid'
    print('transcribing (a few minutes on CPU)...', file=sys.stderr)
    r = subprocess.run(['transkun', wav, mid, '--device', 'cpu'], capture_output=True, text=True)
    if r.returncode: sys.exit('transkun failed:\n' + (r.stderr or r.stdout)[-2000:])
import pretty_midi
pm = pretty_midi.PrettyMIDI(mid)
notes = sorted([(n.start, n.end, n.pitch, n.velocity) for i in pm.instruments for n in i.notes])
notes = [n for n in notes if a.start <= n[0] <= a.end and n[3] >= a.min_velocity]
if not notes: sys.exit('no notes')
ons = np.array([n[0] for n in notes])

# ------------------------------------------------------------------ tempo grid
best = None
for bpm in np.arange(50, 200, 0.25):
    g = 60 / bpm / 4
    for ph in np.linspace(0, g, 24, endpoint=False):
        r = (ons - ph) / g
        e = np.mean(np.minimum(np.abs(r - np.round(r)) * g, 0.06))
        if best is None or e < best[0]: best = (e, g, ph)
_, P, ph = best
for _ in range(3):
    k = np.round((ons - ph) / P)
    P, ph = np.linalg.lstsq(np.vstack([k, np.ones_like(k)]).T, ons, rcond=None)[0]
bpm = 60 / P / 4
# Prefer a tempo in the usual range (the grid fit cannot tell 16ths from 8ths).
while bpm < 66: bpm *= 2; P /= 2
while bpm > 170: bpm /= 2; P *= 2
K = [int(round((s - ph) / P)) for s, e, p, v in notes]
KOFF = [max(k + 1, int(round((e - ph) / P + 0.25))) for k, (s, e, p, v) in zip(K, notes)]
resid = np.array([s - (k * P + ph) for k, (s, e, p, v) in zip(K, notes)])
print(f'tempo {bpm:.1f} bpm, grid error rms {np.sqrt((resid ** 2).mean()) * 1000:.0f} ms', file=sys.stderr)

# ------------------------------------------------------------------ hands
# Split each chord: notes clearly below a running split point go to the left hand.
split = 60.0
HAND = [None] * len(notes)
byk = collections.defaultdict(list)
for i, k in enumerate(K): byk[k].append(i)
for k in sorted(byk):
    idx = sorted(byk[k], key=lambda i: notes[i][2])
    ps = [notes[i][2] for i in idx]
    if len(ps) > 1:
        gaps = [(ps[j + 1] - ps[j], j) for j in range(len(ps) - 1)]
        gmax, j = max(gaps)
        cut = (ps[j] + ps[j + 1]) / 2 if gmax >= 5 else split
    else:
        cut = split
    for i in idx: HAND[i] = 'L' if notes[i][2] < cut else 'R'
    lows = [p for p in ps if p < cut]; highs = [p for p in ps if p >= cut]
    if lows and highs: split = 0.8 * split + 0.2 * (max(lows) + min(highs)) / 2

# ------------------------------------------------------------------ bars and key
num, den = (int(x) for x in a.time.split('/')) if a.time else (None, None)
lk = [k for k, h in zip(K, HAND) if h == 'L'] or K
if num is None:      # 4/4 or 3/4: whichever bar length makes bass notes line up better
    def conc(L): c = collections.Counter(k % L for k in lk); return max(c.values()) / len(lk)
    num, den = (3, 4) if conc(12) > conc(16) * 1.15 else (4, 4)
BAR = num * 16 // den
phase = collections.Counter(k % BAR for k in lk).most_common(1)[0][0]
START = min(K)
BAR0 = START + ((phase - START) % BAR)          # first downbeat at or after the first note
if BAR0 - START == 0: pickup = 0

pc = np.zeros(12)
for (s, e, p, v) in notes: pc[p % 12] += e - s
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
cands = []
for t in range(12):
    cands.append((np.corrcoef(np.roll(MAJ, t), pc)[0, 1], t, 'maj'))
    cands.append((np.corrcoef(np.roll(MIN, t), pc)[0, 1], t, 'min'))
_, tonic, mode = max(cands)
SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
major_tonic = tonic if mode == 'maj' else (tonic + 3) % 12
FIFTHS = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1}
fifths = FIFTHS[major_tonic]
names = SHARP if fifths >= 0 else FLAT
key = (names[tonic] + ('m' if mode == 'min' else ''))
# In the key's own scale use its spelling (E# in F#, Cb in Gb ...).
if fifths == 6: names = SHARP[:5] + ['E#'] + SHARP[6:]
if fifths == -6: names = FLAT[:11] + ['Cb']
def name(m):
    n = names[m % 12]; octv = m // 12 - 1
    if n == 'E#': octv = (m - 1) // 12 - 1          # E#4 sounds as F4
    if n == 'Cb': octv = (m + 1) // 12 - 1          # Cb5 sounds as B4
    return f'{n}{octv}'

# ------------------------------------------------------------------ write
LEN = {16: '/1', 12: '/2.', 8: '/2', 6: '/4.', 4: '/4', 3: '/8.', 2: '/8', 1: '/16'}
def split_len(pos, L):
    out = []
    while L > 0:
        to_bar = BAR - ((pos - BAR0) % BAR)
        seg = min(L, to_bar)
        while seg > 0:
            piece = max(v for v in LEN if v <= seg)
            out.append((pos, piece)); pos += piece; seg -= piece; L -= piece
    return out
end_k = max(KOFF)
END = BAR0 + ((end_k - BAR0 + BAR - 1) // BAR) * BAR
lines = {}
for tag in ('R', 'L'):
    chords = collections.defaultdict(list)
    for i, h in enumerate(HAND):
        if h == tag: chords[K[i]].append(i)
    ks = sorted(chords)
    events, pos = [], START
    for j, k in enumerate(ks):
        if k < pos: continue                      # overlapping voice inside one hand: keep the first
        if k > pos: events.append((pos, k - pos, None))
        dur = max(KOFF[i] - k for i in chords[k])
        nxt = ks[j + 1] if j + 1 < len(ks) else END
        dur = max(1, min(dur, nxt - k))
        # Keys are released a little early; a gap of one 16th before the next note is legato.
        if 0 < nxt - (k + dur) <= 1 and nxt < END: dur = nxt - k
        events.append((k, dur, sorted({notes[i][2] for i in chords[k]})))
        pos = k + dur
    if pos < END: events.append((pos, END - pos, None))
    toks = []
    for p0, L, ms in events:
        pieces = split_len(p0, L)
        for j, (p, piece) in enumerate(pieces):
            if p != START and (p - BAR0) % BAR == 0: toks.append('|')
            body = 'r' if ms is None else name(ms[0]) if len(ms) == 1 else '[' + ' '.join(name(m) for m in ms) + ']'
            toks.append(body + LEN[piece] + ('~' if ms is not None and j < len(pieces) - 1 else ''))
    out, line, bars = [], [], 0
    for t in toks:
        line.append(t)
        if t == '|':
            bars += 1
            if bars % 4 == 0: out.append(' '.join(line)); line = []
    if line: out.append(' '.join(line))
    lines[tag] = out
head = [f'title: {a.title or os.path.splitext(os.path.basename(a.input))[0]}']
if a.artist: head.append(f'artist: {a.artist}')
head += [f'bpm: {round(bpm)}', f'time: {num}/{den}', f'key: {key}', f'difficulty: {a.difficulty}']
if a.youtube: head.append(f'youtube: {a.youtube}')
# Where beat 0 (the first written note) is in the recording, and the exact tempo: lets the app
# play the original audio in sync with the notes (only meaningful when the audio is the video's own).
head.append(f'sync: {START * P + ph:.3f} {60 / P / 4:.4f}')
head.append('# Распознано по звуку (Transkun) и проверено.')
open(a.out, 'w').write('\n'.join(head) + '\n\n[R]\n' + '\n'.join(lines['R']) + '\n\n[L]\n' + '\n'.join(lines['L']) + '\n')
if a.dump:
    json.dump([dict(start=s, end=e, midi=p, k=k, hand=h) for (s, e, p, v), k, h in zip(notes, K, HAND)], open(a.dump, 'w'))
print(json.dumps({'notes': len(notes), 'bpm': round(bpm, 2), 'time': f'{num}/{den}', 'key': key,
                  'right': HAND.count('R'), 'left': HAND.count('L')}), file=sys.stderr)
