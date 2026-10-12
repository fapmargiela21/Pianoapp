# notes.json -> good.json: drop intro/outro junk and fragments, snap to the 16th grid.
# usage: python3 prepare.py T_START T_END   (seconds of the video where the keyboard part runs)
import json, sys, numpy as np
from notes import cluster
t0, t1 = float(sys.argv[1]), float(sys.argv[2])
v = min(((cluster(v)[1], v) for v in np.arange(140, 150, 0.1)))[1]
notes, _ = cluster(v)
good = [n for n in notes if t0 < n['on'] < t1 and n['n'] >= 8 and (n['off'] is None or n['off'] - n['on'] >= 0.08)]
ons = np.array([n['on'] for n in good])
best = None
for bpm in np.arange(50, 200, 0.25):       # coarse tempo/phase search on a 16th grid
    g = 60 / bpm / 4
    for ph in np.linspace(0, g, 24, endpoint=False):
        r = (ons - ph) / g; e = np.mean(np.minimum(np.abs(r - np.round(r)) * g, 0.06))
        if best is None or e < best[0]: best = (e, g, ph)
_, P, ph = best
for _ in range(3):                         # least-squares refinement
    k = np.round((ons - ph) / P)
    P, ph = np.linalg.lstsq(np.vstack([k, np.ones_like(k)]).T, ons, rcond=None)[0]
for n in good:
    n['k'] = int(round((n['on'] - ph) / P))
    n['koff'] = int(round((n['off'] - ph) / P + 0.25)) if n['off'] else None
json.dump(good, open('good.json', 'w'))
print(f'v={v:.1f}px/s  bpm={60 / P / 4:.2f}  notes={len(good)}  first k={min(n["k"] for n in good)}')
