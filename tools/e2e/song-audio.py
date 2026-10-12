# Piano-like recording of a whole song: song-audio.py notes.json out.wav
# notes.json: [{"t": seconds, "d": seconds, "midi": n}]  (written by audio-import.mjs)
import json, sys, wave, numpy as np
ev = json.load(open(sys.argv[1])); out = sys.argv[2]; sr = 44100
rng = np.random.default_rng(1)
total = max(e['t'] + e['d'] for e in ev) + 2
y = np.zeros(int(total * sr))
for e in ev:
    t0 = e['t'] + rng.uniform(0, 0.01); m = e['midi']; rel = e['d'] * 0.95
    n = int((rel + 0.3) * sr); tt = np.arange(n) / sr
    f0 = 440 * 2 ** ((m - 69) / 12); sig = np.zeros(n)
    for h in range(1, 13):
        fh = h * f0 * np.sqrt(1 + 0.0004 * h * h)
        if fh > 10000: break
        a = 1 / h ** 1.2 * (0.35 if m < 48 and h == 1 else 1)
        sig += a * np.sin(2 * np.pi * fh * tt + rng.uniform(0, 6.28)) * (np.exp(-tt * (1.2 + 0.5 * h)) * 0.7 + 0.3 * np.exp(-tt * 0.4))
    sig *= np.minimum(1, tt / 0.004) * np.where(tt > rel, np.exp(-(tt - rel) / 0.05), 1.0)
    i0 = int(t0 * sr); y[i0:i0 + n] += sig[:len(y) - i0] * 0.1 * (0.8 + 0.4 * rng.random())
y = np.clip(y + rng.normal(0, 0.001, len(y)), -1, 1)
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes((y * 32767).astype(np.int16).tobytes()); w.close()
