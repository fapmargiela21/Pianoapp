# Piano-like test audio for a list of steps (used by run.mjs).
import json, sys, numpy as np, wave
# usage: gen.py steps.json out.wav spacing wrong_every [pedal]
steps=json.load(open(sys.argv[1])); out=sys.argv[2]; spacing=float(sys.argv[3]); wrong_every=int(sys.argv[4])
pedal = len(sys.argv)>5 and sys.argv[5]=='pedal'
sr=48000
import os; DET=2**(float(os.environ.get("CENTS","0"))/1200)
rng=np.random.default_rng(1)
events=[]  # (time, midi)
t=2.0
for i,s in enumerate(steps):
    if wrong_every and i>0 and i%wrong_every==0:
        events.append((t, s['midi'][0]+1)); t+=spacing
    for m in s['midi']: events.append((t+rng.uniform(0,0.015), m))
    t+=spacing
total=t+2.5
y=np.zeros(int(total*sr))
# one "string" per key: a re-strike replaces the ringing note, the damper stops it on release
bykey={}
for (t0,m) in events: bykey.setdefault(m,[]).append(t0)
for m,times in bykey.items():
    times.sort()
    for j,t0 in enumerate(times):
        nxt = times[j+1] if j+1<len(times) else total
        release = t0 + (3.0 if pedal else spacing*0.9)
        end=min(nxt, release+0.3, total)
        n=int((end-t0)*sr); tt=np.arange(n)/sr
        f0=DET*440*2**((m-69)/12); B=0.0004; sig=np.zeros(n)
        for h in range(1,13):
            fh=h*f0*np.sqrt(1+B*h*h)
            if fh>10000: break
            a=1/h**1.2
            if m<48 and h==1: a*=0.35
            dec=np.exp(-tt*(1.2+0.5*h))*0.7+0.3*np.exp(-tt*0.4)
            sig+=a*np.sin(2*np.pi*fh*tt+rng.uniform(0,6.28))*dec
        sig*=np.minimum(1,tt/0.004)
        damp=np.where(tt>release-t0, np.exp(-(tt-(release-t0))/0.05), 1.0)
        sig*=damp
        k=min(n,int(0.01*sr)); sig[:k]+=rng.normal(0,0.3,k)*np.exp(-np.arange(k)/sr/0.003)
        i0=int(t0*sr); y[i0:i0+n]+=sig[:len(y)-i0]*0.12
y+=rng.normal(0,0.0015,len(y))
y=np.clip(y,-1,1)
w=wave.open(out,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((y*32767).astype(np.int16).tobytes()); w.close()
if os.environ.get('EVENTS'):   # [{s, p, wrong}] for tools/e2e/offline-eval.mjs
    wrong_t = set()
    t2 = 2.0
    for i, st in enumerate(steps):
        if wrong_every and i > 0 and i % wrong_every == 0: wrong_t.add(round(t2, 4)); t2 += spacing
        t2 += spacing
    json.dump([{'s': round(t0, 4), 'p': m, 'wrong': any(abs(t0 - w) < 1e-3 for w in wrong_t)} for t0, m in events], open(os.environ['EVENTS'], 'w'))
print(json.dumps({'events':len(events),'duration':round(total,1),'wrongs':sum(1 for i in range(1,len(steps)) if wrong_every and i%wrong_every==0)}))
