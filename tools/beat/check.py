#!/usr/bin/env python3
"""Check a beat's loop against the audio: all loop repeats are averaged sixteenth by sixteenth, so
the repeating melody/bass add up and noise averages out. For every sixteenth it prints the strongest
pitches and which ones newly start there (big '+' = a note begins).

  python3 tools/beat/check.py audio.wav BPM LOOP_START_SECONDS [--bars 4]

A loud rise of several unrelated pitches at once on the same beat of every bar is a drum (snare).
Bass pitch is unreliable below ~60 Hz here (bins too coarse); trust the transcription's bass notes.
"""
import argparse, wave, numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('wav'); ap.add_argument('bpm', type=float); ap.add_argument('t0', type=float)
ap.add_argument('--bars', type=int, default=4)
a = ap.parse_args()
w = wave.open(a.wav); sr = w.getframerate()
y = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
if w.getnchannels() == 2: y = y.reshape(-1, 2).mean(1)
g = 60 / a.bpm / 4; L = 16 * a.bars; N = 4096; win = np.hanning(N)
loops = int((len(y) / sr - a.t0) / (L * g))
spec = np.zeros((L, N // 2 + 1))
for l in range(loops):
    for k in range(L):
        s = int((a.t0 + (l * L + k) * g + 0.02) * sr)
        if s + N <= len(y): spec[k] += np.abs(np.fft.rfft(y[s:s + N] * win))
spec /= max(1, loops)
names = 'C C# D D# E F F# G G# A A# B'.split(); nm = lambda p: names[p % 12] + str(p // 12 - 1)
def sal(S, p):
    f0 = 440 * 2 ** ((p - 69) / 12); v = 0
    for h in range(1, 5):
        i = int(round(f0 * h * N / sr)); v += S[max(0, i - 1):i + 2].max() / h
    return v
lo, hi = 43, 84
M = np.array([[sal(spec[k], p) for p in range(lo, hi)] for k in range(L)])
print(f'{loops} repeats averaged; pitches {nm(lo)}..{nm(hi - 1)}')
for k in range(L):
    rise = M[k] - M[k - 1]; top = np.argsort(M[k])[::-1][:3]; new = np.argsort(rise)[::-1][:3]
    print(f"bar {k // 16 + 1} beat {k % 16 / 4 + 1:4.2f} | strongest: {' '.join(nm(lo + i) for i in top):14} | starts: "
          + ' '.join(f'{nm(lo + i)}(+{rise[i]:.0f})' for i in new if rise[i] > 0))
