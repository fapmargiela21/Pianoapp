#!/usr/bin/env python3
"""YouTube link -> video.mp4 (for reading notes/hands from a falling-notes video).

  APIFY_TOKEN=... python3 tools/synthesia/fetch_video.py URL out.mp4 [720p]

Run by .github/workflows/video.yml (YouTube blocks downloads from the cloud box), which hands the
file back as a short-lived workflow artifact.
"""
import json, os, re, sys, urllib.request

url, out = sys.argv[1], sys.argv[2]
quality = sys.argv[3] if len(sys.argv) > 3 else '720p'
m = re.search(r'(?:v=|youtu\.be/|shorts/|embed/|live/)([A-Za-z0-9_-]{11})', url)
if not m: sys.exit(f'not a YouTube link: {url}')
auth = {'Authorization': 'Bearer ' + os.environ['APIFY_TOKEN']}
req = urllib.request.Request('https://api.apify.com/v2/acts/johnvc~youtube-download-api/run-sync-get-dataset-items',
    json.dumps({'videoUrls': [f'https://www.youtube.com/watch?v={m.group(1)}'], 'format': 'video',
                'quality': quality, 'videoCodec': 'h264', 'maxMinutes': 20}).encode(),
    {**auth, 'Content-Type': 'application/json'})
rows = json.loads(urllib.request.urlopen(req, timeout=330).read())
row = next((r for r in rows if r.get('resultType') == 'file'), None)
if not row: sys.exit(f'download failed: {rows[:1]}')
data = urllib.request.urlopen(urllib.request.Request(row['fileUrl'], headers=auth), timeout=600).read()
open(out, 'wb').write(data)
print(f"{row.get('title')}: {len(data) / 1e6:.1f} MB, {row.get('width')}x{row.get('height')}, {row.get('durationSeconds')} s")
