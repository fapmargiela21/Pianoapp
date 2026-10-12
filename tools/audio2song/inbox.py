#!/usr/bin/env python3
"""Transcribes recordings uploaded from the app (run by .github/workflows/transcribe.yml).

The app uploads inbox/<id>.<ext> (audio or screen recording) and then inbox/<id>.json:
  {"id": "...", "file": "<id>.m4a", "title": "...", "artist": "...", "youtube": "..."}
For each such pair: audio2song.py -> songs/<id>.song, added to songs/index.json.
On failure the reason goes to inbox/failed/<id>.txt. The uploaded files are removed either way.
"""
import glob, json, os, re, subprocess, sys, time

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(root)
done = []
for meta_path in sorted(glob.glob('inbox/*.json')):
    meta = json.load(open(meta_path, encoding='utf-8'))
    sid = re.sub(r'[^a-z0-9-]+', '-', str(meta.get('id', '')).lower()).strip('-')[:60] or 'upload'
    audio = os.path.join('inbox', os.path.basename(meta.get('file', '')))
    out = f'songs/{sid}.song'
    cmd = [sys.executable, 'tools/audio2song/audio2song.py', audio, out,
           '--title', (meta.get('title') or sid).strip(), '--difficulty', '2']
    for k in ('artist', 'youtube'):
        if meta.get(k): cmd += [f'--{k}', meta[k].strip()]
    print('::group::' + sid, flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout + r.stderr, flush=True)
    print('::endgroup::', flush=True)
    mid = f'songs/{sid}.mid'
    if os.path.exists(mid):          # raw transcription, kept as a workflow artifact for checking
        os.makedirs('debug', exist_ok=True)
        os.replace(mid, f'debug/{sid}.mid')
    if r.returncode == 0 and os.path.exists(out):
        text = open(out, encoding='utf-8').read().replace(
            '# Распознано по звуку (Transkun) и проверено.',
            '# Распознано автоматически (Transkun на GitHub) по загруженной записи, не проверено вручную.')
        if not meta.get('synced'):   # an uploaded recording has its own timeline, not the video's
            text = re.sub(r'^sync:.*\n', '', text, flags=re.M)
        open(out, 'w', encoding='utf-8').write(text)
        index = json.load(open('songs/index.json', encoding='utf-8'))
        if f'{sid}.song' not in index:
            index.append(f'{sid}.song')
            json.dump(index, open('songs/index.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            open('songs/index.json', 'a', encoding='utf-8').write('\n')
        done.append(meta.get('title') or sid)
        if os.path.exists(f'inbox/failed/{sid}.txt'): os.remove(f'inbox/failed/{sid}.txt')
    else:
        os.makedirs('inbox/failed', exist_ok=True)
        open(f'inbox/failed/{sid}.txt', 'w', encoding='utf-8').write(f'at={int(time.time() * 1000)}\n' + (r.stderr or r.stdout)[-3000:])
        print(f'::error::{sid}: transcription failed', flush=True)
    for p in (audio, meta_path):
        if os.path.exists(p): os.remove(p)
print(json.dumps(done, ensure_ascii=False))
