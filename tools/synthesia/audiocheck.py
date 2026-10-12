import json, numpy as np, wave
w = wave.open('audio.wav'); sr = w.getframerate()
x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
good = json.load(open('good.json'))
P = 0.14118712616815338; ph = 0.04865
N = 4096; win = np.hanning(N)
def spec(t):
    i = int(t * sr)
    if i < 0 or i + N > len(x): return None
    return np.abs(np.fft.rfft(x[i:i + N] * win))
def sal(S, m):
    f0 = 440 * 2 ** ((m - 69) / 12); s = 0
    for h in range(1, 5):
        b = f0 * h * N / sr; lo, hi = int(b * 0.985), int(b * 1.015) + 1
        if hi < len(S): s += S[lo:hi + 1].max() / h
    return 20 * np.log10(s + 1e-9)
# audio offset vs video timeline: search lag maximizing mean rise
def score(lag):
    r = []
    for n in good[::3]:
        a = spec(n['on'] + lag + 0.01); b = spec(n['on'] + lag - 0.2)
        if a is None or b is None: continue
        r.append(sal(a, n['midi']) - sal(b, n['midi']))
    return np.mean(r)
lags = np.arange(-0.3, 0.31, 0.02)
sc = [score(l) for l in lags]; lag = lags[int(np.argmax(sc))]
print('best audio lag', round(lag, 3), 'score', round(max(sc), 2))
res = []
for n in good:
    a = spec(n['on'] + lag + 0.01); b = spec(n['on'] + lag - 0.2)
    if a is None or b is None: continue
    rise = sal(a, n['midi']) - sal(b, n['midi'])
    # is this pitch among the loudest in that moment?
    cand = {m: sal(a, m) for m in range(36, 96)}
    rank = sorted(cand, key=lambda m: -cand[m]).index(n['midi'])
    res.append((n['on'], n['midi'], n['hand'], round(rise, 1), rank))
json.dump(res, open('audiocheck.json', 'w'))
rises = np.array([r[3] for r in res]); ranks = np.array([r[4] for r in res])
print('notes', len(res), 'median rise', np.median(rises), 'rise<2dB', (rises < 2).sum(), 'rank>6', (ranks > 6).sum())
for r in res:
    if r[3] < 2 and r[4] > 4: print('SUSPECT', r)
