// The song's own YouTube video as the sound of "▶︎ Послушать" (setting "Звук: YouTube").
// A small visible player (the IFrame API needs one) plays from the moment that matches the
// current beat; the app then follows the video's clock, so buffering never breaks the sync.

let apiReady = null;
function loadApi() {
  if (!apiReady) {
    apiReady = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { apiReady = null; reject(new Error('YouTube не загрузился')); };
      document.head.appendChild(s);
    });
  }
  return apiReady;
}

export function videoId(url) {
  const m = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/.exec(url || '');
  return m ? m[1] : null;
}

export class YtSync {
  constructor(el) {
    this.el = el;
    this.player = null;
    this.vid = null;
    this.ready = false;
    this.last = null;          // { raw, at } — last time reported by the player
    this.est = 0;
    this.error = null;         // YouTube error code (101/150: the author forbids embedding)
  }

  // Prepares the player for a video (call when a song opens, so "play" can start instantly).
  async prepare(vid) {
    if (this.vid === vid && this.player) return;
    this.vid = vid;
    this.ready = false;
    this.error = null;
    const YT = await loadApi();
    if (this.vid !== vid) return;
    if (this.player) { this.player.cueVideoById(vid); this.ready = true; return; }
    const host = document.createElement('div');
    this.el.replaceChildren(host);
    await new Promise((resolve) => {
      this.player = new YT.Player(host, {
        videoId: vid, width: '100%', height: '100%',
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, fs: 0 },
        events: {
          onReady: () => { this.ready = true; resolve(); },
          onError: (e) => { this.error = e.data; },
        },
      });
    });
  }

  // Must be called straight from a tap (iOS only starts sound from a user gesture).
  play(fromSec, rate) {
    if (!this.ready) return false;
    this.player.setPlaybackRate(rate);
    this.player.seekTo(Math.max(0, fromSec), true);
    this.player.playVideo();
    this.last = null;
    this.est = fromSec;
    return true;
  }

  pause() { if (this.ready) this.player.pauseVideo(); }

  // Smoothed video time: the player reports its time in steps, so extrapolate in between.
  time(nowMs) {
    if (!this.ready) return this.est;
    const raw = this.player.getCurrentTime();
    const playing = this.player.getPlayerState() === 1;
    if (!this.last || raw !== this.last.raw) this.last = { raw, at: nowMs };
    let t = this.last.raw + (playing ? ((nowMs - this.last.at) / 1000) * this.player.getPlaybackRate() : 0);
    if (t < this.est && this.est - t < 0.15) t = this.est;          // no small jumps backwards
    this.est = t;
    return t;
  }

  playing() { return this.ready && this.player.getPlayerState() === 1; }
}
