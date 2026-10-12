#!/usr/bin/env python3
"""Find the repeating loop of a beat in a (noisy) Transkun transcription and list its stable notes.

  python3 tools/beat/loop.py raw.mid [--bars 4] [--min-bpm 60] [--max-bpm 180] [--keep 0.35]

Prints the tempo, where the loop starts (seconds, = 'sync:' offset) and every (position, pitch)
present in at least --keep of the loop repeats. Notes in most repeats are the real melody/bass;
the rest is drums and noise the piano model misheard.
"""
import argparse, collections, numpy as np, pretty_midi

ap = argparse.ArgumentParser()
ap.add_argument('midi'); ap.add_argument('--bars', type=int, default=4)
ap.add_argument('--min-bpm', type=float, default=60); ap.add_argument('--max-bpm', type=float, default=180)
ap.add_argument('--keep', type=float, default=0.35)
a = ap.parse_args()
pm = pretty_midi.PrettyMIDI(a.midi)
raw = sorted([(n.start, n.pitch) for i in pm.instruments for n in i.notes])
ons = np.array([s for s, _ in raw])
best = None
for bpm in np.arange(a.min_bpm, a.max_bpm, 0.02):
    g = 60 / bpm / 4
    for ph in np.linspace(0, g, 20, endpoint=False):
        r = (ons - ph) / g
        e = np.mean(np.minimum(np.abs(r - np.round(r)) * g, 0.05))
        if best is None or e < best[0]: best = (e, bpm, ph)
e, bpm, ph = best; g = 60 / bpm / 4
L = 16 * a.bars
K = np.round((ons - ph) / g).astype(int)
best2 = None
for shift in range(L):
    c = collections.Counter(((k - shift) % L, p) for k, (_, p) in zip(K, raw))
    sc = sum(v * v for v in c.values())
    if best2 is None or sc > best2[0]: best2 = (sc, shift)
shift = best2[1]
loops = collections.defaultdict(set)
for k, (_, p) in zip(K, raw): loops[(k - shift) // L].add(((k - shift) % L, p))
n = len(loops)
freq = collections.Counter(x for s in loops.values() for x in s)
names = 'C C# D D# E F F# G G# A A# B'.split()
nm = lambda p: names[p % 12] + str(p // 12 - 1)
print(f'tempo {bpm:.2f} bpm (grid error {e * 1000:.0f} ms) | loop of {a.bars} bars starts at {ph + shift * g:.3f} s | {n} repeats')
print('pitch classes:', collections.Counter(names[p % 12] for _, p in raw).most_common())
for (pos, p), c in sorted(freq.items()):
    if c >= a.keep * n:
        print(f'  bar {pos // 16 + 1} beat {pos % 16 / 4 + 1:.2f} (16th #{pos % 16})  {nm(p):4} in {c}/{n}')
