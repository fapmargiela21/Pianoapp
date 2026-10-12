# Test: can Gemini (via Polza.ai, which accepts YouTube links for Gemini) transcribe a piano video?
#   POLZA_API_KEY=... python3 tools/gemini/ask.py google/gemini-3.1-pro-preview https://www.youtube.com/watch?v=4fJy8bV07vU out.song
# Compare out.song with songs/cyberpunk-stay-at-your-house.song (first 8 bars, checked frame by frame).
import json, os, sys, time, urllib.request
model, url, out = sys.argv[1], sys.argv[2], sys.argv[3]
prompt = open(os.path.join(os.path.dirname(__file__), 'prompt.txt')).read()
body = {"model": model, "messages": [{"role": "user", "content": [
    {"type": "text", "text": prompt}, {"type": "video_url", "video_url": {"url": url}}]}]}
req = urllib.request.Request('https://polza.ai/api/v1/chat/completions', json.dumps(body).encode(),
    {'Authorization': 'Bearer ' + os.environ['POLZA_API_KEY'], 'Content-Type': 'application/json'})
t = time.time()
try:
    r = json.load(urllib.request.urlopen(req, timeout=600))
except urllib.error.HTTPError as e:
    sys.exit(f'HTTP {e.code}: {e.read()[:500]}')
open(out, 'w').write(r['choices'][0]['message']['content'])
print(model, f'{time.time()-t:.0f}s', json.dumps(r.get('usage', {}))[:300])
