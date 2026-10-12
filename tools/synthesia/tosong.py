import json, collections, sys
good = json.load(open('good.json'))
START = 54            # first note (pickup)
BAR0 = 60             # first downbeat, in sixteenths
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']   # F# major: sharps
def name(m): return f"{NAMES[m % 12]}{m // 12 - 1}"
LEN = {16: '/1', 12: '/2.', 8: '/2', 6: '/4.', 4: '/4', 3: '/8.', 2: '/8', 1: '/16'}
def split_len(pos, L):
    """Split L sixteenths starting at pos into notatable pieces, breaking at bar lines."""
    out = []
    while L > 0:
        to_bar = 16 - ((pos - BAR0) % 16)
        seg = min(L, to_bar)
        while seg > 0:
            piece = max(v for v in LEN if v <= seg)
            out.append((pos, piece)); pos += piece; seg -= piece; L -= piece
    return out
end_k = max((n['koff'] or n['k'] + 1) for n in good)
END = BAR0 + ((end_k - BAR0 + 15) // 16) * 16
lines = {}
lost = 0
for hand, tag in (('P', 'R'), ('Y', 'L')):
    hn = [n for n in good if n['hand'] == hand]
    chords = collections.defaultdict(list)
    for n in hn: chords[n['k']].append(n)
    ks = sorted(chords)
    events = []   # (pos, length, midis or None)
    pos = START
    for i, k in enumerate(ks):
        if k > pos: events.append((pos, k - pos, None))
        if k < pos: lost += len(chords[k]); continue
        dur = max(((n['koff'] or k + 1) - k) for n in chords[k])
        nxt = ks[i + 1] if i + 1 < len(ks) else END
        dur = max(1, min(dur, nxt - k))
        events.append((k, dur, sorted(set(n['midi'] for n in chords[k]))))
        pos = k + dur
    if pos < END: events.append((pos, END - pos, None))
    toks = []
    for p0, L, ms in events:
        pieces = split_len(p0, L)
        for j, (p, piece) in enumerate(pieces):
            if p != START and (p - BAR0) % 16 == 0: toks.append('|')
            if ms is None: body = 'r'
            elif len(ms) == 1: body = name(ms[0])
            else: body = '[' + ' '.join(name(m) for m in ms) + ']'
            tie = '~' if ms is not None and j < len(pieces) - 1 else ''
            toks.append(body + LEN[piece] + tie)
    # one line per 4 bars
    out, line, bars = [], [], 0
    for t in toks:
        if t == '|':
            bars += 1
            line.append('|')
            if bars % 4 == 0: out.append(' '.join(line)); line = []
        else:
            line.append(t)
    if line: out.append(' '.join(line))
    lines[tag] = out
print('lost overlapped chords:', lost, file=sys.stderr)
head = """title: I Really Want to Stay at Your House
artist: Cyberpunk: Edgerunners (Rosa Walton, Hallie Coggins) — EASY, PianoGumi
bpm: 106
time: 4/4
key: F#
difficulty: 3
youtube: https://youtu.be/4fJy8bV07vU
# Ноты сняты покадрово с видео PianoGumi (EASY Piano Tutorial).
"""
body = '\n[R]\n' + '\n'.join(lines['R']) + '\n\n[L]\n' + '\n'.join(lines['L']) + '\n'
open(sys.argv[1], 'w', encoding='utf-8').write(head + body)
