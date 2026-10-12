// "🔗 По ссылке": starts .github/workflows/transcribe.yml with a YouTube link. The action
// downloads the audio (Apify), transcribes it with Transkun and commits songs/yt-<id>.song,
// which then appears in songs/index.json on this site.
// Needs a fine-grained GitHub token for this repository with only "Actions: read and write";
// it is kept in this browser's localStorage and sent only to api.github.com.

export function repoFromLocation() {
  const m = /^([^.]+)\.github\.io$/.exec(location.hostname);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? `${m[1]}/${repo}` : 'fapmargiela21/Pianoapp';
}

// The file name the action gives the song (tools/audio2song/inbox.py: lower case, anything but
// a-z 0-9 - becomes '-'), e.g. a video id with '_' in it.
export function songId(id) {
  return id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'upload';
}

export function youtubeId(url) {
  const m = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/.exec(url) || /^([A-Za-z0-9_-]{11})$/.exec(url.trim());
  return m ? m[1] : null;
}

async function gh(token, method, path, body) {
  const r = await fetch('https://api.github.com' + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) throw new Error('GitHub не принял ключ — проверь, что он скопирован целиком и не просрочен');
  if (r.status === 403 || r.status === 404) throw new Error('у ключа нет права запускать Actions в репозитории Pianoapp');
  if (!r.ok) throw new Error(`GitHub: ${r.status} ${(await r.json().catch(() => ({}))).message || ''}`);
  return r.status === 204 ? null : r.json();
}

// Returns the job to wait for: { id, title, url, at }.
export async function transcribeLink(url, title, token) {
  const vid = youtubeId(url);
  if (!vid) throw new Error('это не похоже на ссылку YouTube');
  const repo = repoFromLocation();
  const { default_branch: ref } = await gh(token, 'GET', `/repos/${repo}`);
  await gh(token, 'POST', `/repos/${repo}/actions/workflows/transcribe.yml/dispatches`,
    { ref, inputs: { url: `https://youtu.be/${vid}`, title } });
  return { id: songId(`yt-${vid}`), title: title || 'Песня с YouTube', url, at: Date.now() };
}

// The action writes inbox/failed/<id>.txt when something goes wrong; it is served by the site too.
export async function failureReason(job) {
  try {
    const r = await fetch(`inbox/failed/${job.id}.txt`, { cache: 'no-cache' });
    if (!r.ok) return null;
    const lines = (await r.text()).trim().split('\n');
    const at = /^at=(\d+)$/.exec(lines[0]);
    if (!at || +at[1] < job.at) return null;          // left over from an earlier attempt
    return lines.slice(1).slice(-2).join(' ').slice(0, 300) || 'неизвестная ошибка';
  } catch { return null; }
}
