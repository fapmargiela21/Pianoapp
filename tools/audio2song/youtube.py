#!/usr/bin/env python3
"""YouTube link -> inbox/yt-<videoId>.m4a + .json, for inbox.py (run by the transcribe action).

  APIFY_TOKEN=... python3 tools/audio2song/youtube.py URL [TITLE]

YouTube blocks downloads from servers, so the audio comes from the Apify actor
johnvc/youtube-download-api (pay per audio minute; Apify's free monthly credit is plenty).
"""
import json, os, re, sys, urllib.error, urllib.request

ACTOR = 'johnvc~youtube-download-api'
url = sys.argv[1].strip()
title = sys.argv[2].strip() if len(sys.argv) > 2 else ''
m = re.search(r'(?:v=|youtu\.be/|shorts/|embed/|live/)([A-Za-z0-9_-]{11})', url) or re.fullmatch(r'([A-Za-z0-9_-]{11})', url)
vid = m.group(1) if m else 'invalid'
sid = f'yt-{vid}'.lower()

def fail(msg):
    # Recorded for the app (it shows inbox/failed/<id>.txt); exit 0 so the action still commits it.
    os.makedirs('inbox/failed', exist_ok=True)
    open(f'inbox/failed/{sid}.txt', 'w', encoding='utf-8').write(msg + '\n')
    print('::error::' + msg)
    sys.exit(0)

if not m: fail(f'Не похоже на ссылку YouTube: {url}')
if not os.environ.get('APIFY_TOKEN'): fail('Нет секрета APIFY_TOKEN в настройках репозитория')
auth = {'Authorization': 'Bearer ' + os.environ['APIFY_TOKEN']}

def call(u, body=None, timeout=330):
    req = urllib.request.Request(u, json.dumps(body).encode() if body is not None else None,
                                 {**auth, **({'Content-Type': 'application/json'} if body is not None else {})})
    try:
        return urllib.request.urlopen(req, timeout=timeout).read()
    except urllib.error.HTTPError as e:
        fail(f'Apify: HTTP {e.code} {e.read()[:300]!r}')
    except Exception as e:
        fail(f'Apify: {e}')

rows = json.loads(call(f'https://api.apify.com/v2/acts/{ACTOR}/run-sync-get-dataset-items',
                       {'videoUrls': [f'https://www.youtube.com/watch?v={vid}'], 'format': 'audio',
                        'audioFormat': 'm4a', 'audioQuality': 'high', 'maxMinutes': 20}))
row = next((r for r in rows if r.get('resultType') == 'file'), None)
if not row:
    r = rows[0] if rows else {}
    fail(f"Не удалось скачать с YouTube: {r.get('error', '?')} {r.get('errorMessage', '')}")
ext = row.get('container') or 'm4a'
os.makedirs('inbox', exist_ok=True)
data = call(row['fileUrl'], timeout=300)
open(f'inbox/{sid}.{ext}', 'wb').write(data)
meta = {'id': sid, 'file': f'{sid}.{ext}', 'title': title or row.get('title') or sid,
        'artist': row.get('channelName') or '', 'youtube': f'https://youtu.be/{vid}'}
json.dump(meta, open(f'inbox/{sid}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f"{meta['title']}: {len(data) / 1e6:.1f} MB, {row.get('durationSeconds')} s")
