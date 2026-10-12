import json, collections, numpy as np, sys
seg=json.load(open('segs.json'))
YHIT=488
def cluster(v, tol=0.06):
    ons=collections.defaultdict(list)
    for t,m,yb,yt,h in seg:
        if yb>=438: continue                    # bottom hidden below the window
        on=t+(YHIT-yb)/v
        off=t+(YHIT-yt)/v if yt>1 else None
        ons[m].append((on,off,h))
    notes=[]; spread=[]
    for m,l in ons.items():
        l.sort(key=lambda x: x[0])
        grp=[l[0]]
        def flush(g):
            o=np.array([x[0] for x in g]); offs=[x[1] for x in g if x[1] is not None]
            if len(g)<4: return
            on=np.median(o); spread.append(np.std(o))
            hand=collections.Counter(x[2] for x in g).most_common(1)[0][0]
            notes.append(dict(midi=m,on=on,off=float(np.median(offs)) if offs else None,hand=hand,n=len(g)))
        for x in l[1:]:
            if x[0]-grp[-1][0]<tol: grp.append(x)
            else: flush(grp); grp=[x]
        flush(grp)
    return sorted(notes,key=lambda n:(n['on'],n['midi'])), np.mean(spread)
if __name__=='__main__':
    for v in np.arange(140,153,1.0):
        n,s=cluster(v); print(v,len(n),round(s*1000,1))
