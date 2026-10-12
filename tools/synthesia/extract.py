# Reads falling bars of a Synthesia video and outputs note events.
import subprocess, sys, json, numpy as np
F = sys.argv[1]; FPS = 15; W, H = 1280, 720; YTOP, YBOT = 0, 440
WW = 41.27; X0 = -0.5           # white key width / left edge
FIRST_WHITE = 38                # D2 (midi) is white key 0
NW = 31
WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11]
def white_midi(i):              # i-th white key from D2
    idx = 1 + i                 # D is index 1 within C-major white sequence
    return 12 * (3 + idx // 7) + WHITE_STEPS[idx % 7]   # octave: C2=36 -> 12*3
keys = []                       # (midi, x0, x1) sample span of the bar
for i in range(NW):
    m = white_midi(i); L = X0 + WW * i; R = L + WW
    keys.append([m, L, R, False])
blacks = []
BLACK_X = [44.5, 116.5, 164.5, 212.0, 284.5, 333.5, 405.5, 453.5, 501.0, 573.5, 622.5, 695.0, 742.5,
           790.5, 862.5, 911.5, 984.0, 1031.5, 1079.5, 1151.5, 1200.5]   # measured on the keyboard
bm = [white_midi(i) + 1 for i in range(NW - 1) if white_midi(i) % 12 in (0, 2, 5, 7, 9)]
for m, c in zip(bm, BLACK_X): blacks.append([m, c - 14, c + 14, True])
# white bar free zones: exclude neighbouring black bars
for k in keys:
    for b in blacks:
        if b[1] < k[2] and b[2] > k[1]:
            if b[1] > k[1]: k[2] = min(k[2], b[1] - 1)
            else: k[1] = max(k[1], b[2] + 1)
allk = keys + blacks
cols = []
for m, L, R, blk in allk:
    if blk:
        c = (L + R) / 2
        xs = [c + d for d in (-10, -7, -3, 0, 3, 7, 10)] + [c - 17, c + 17]
    else:
        xs = list(np.linspace(L + 3, R - 3, 7)) + [L + 3, R - 3]
    cols.append([int(round(x)) for x in xs])
cols = np.array(cols)
NC = 7
isblk = np.array([k[3] for k in allk])
cmd = ['ffmpeg', '-v', 'error', '-i', F, '-vf', f'fps={FPS},crop={W}:{YBOT-YTOP}:0:{YTOP}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
fs = W * (YBOT - YTOP) * 3
out = []  # (t, midi, yb, yt, hue)
n = 0
while True:
    buf = p.stdout.read(fs)
    if len(buf) < fs: break
    fr = np.frombuffer(buf, np.uint8).reshape(YBOT - YTOP, W, 3).astype(np.int16)
    t = n / FPS; n += 1
    sub = fr[:, cols.reshape(-1)].reshape(YBOT - YTOP, len(allk), NC + 2, 3)  # y, key, col, rgb
    mx = sub.max(-1); mn = sub.min(-1); lum = sub.mean(-1)
    colored = (mx - mn) > 22
    nonbg = ((mx - mn) > 11) | (lum > 34)
    anyon = (lum[:, :, :NC] > 70).sum(-1) >= 2                  # y, key: bright bar body (outlines and gaps are dark)
    outer_bg = ~colored[:, :, NC] & ~colored[:, :, NC + 1] & (lum[:, :, NC] < 60) & (lum[:, :, NC + 1] < 60)
    on = anyon & (~isblk[None, :] | outer_bg)                   # black bars are narrow
    rowbg = ~on
    sat = colored[:, :, :NC].any(-1)
    for k in range(len(allk)):
        col = ~rowbg[:, k]
        if not col.any(): continue
        y = 0; L = len(col)
        while y < L:
            if col[y]:
                s = y
                while y < L and col[y]: y += 1
                e = y - 1
                if e - s >= 3 and sat[s:e + 1, k].sum() >= 3:
                    px = sub[s:e + 1, k, :NC].reshape(-1, 3)
                    good = px[(px.max(-1) - px.min(-1)) > 40]
                    hue = 'Y' if len(good) and np.median(good[:, 2]) < np.median(good[:, 0]) * 0.5 else 'P'
                    out.append((round(t, 4), int(allk[k][0]), int(e), int(s), hue))
            else:
                y += 1
json.dump(out, open(sys.argv[2], 'w'))
print('frames', n, 'segments', len(out))
