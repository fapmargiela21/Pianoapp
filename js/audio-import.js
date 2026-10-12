// Audio file (mp3, m4a, screen recording...) -> song, entirely on the device.
// Notes are found by Spotify's Basic Pitch model (js/vendor, TensorFlow.js), then quantized
// by transcribe.js. The ~2.3 MB model is only downloaded when this is first used.
import { notesToSong } from './transcribe.js';

const SR = 22050;               // Basic Pitch input rate
let bp = null;                  // { M, model }

async function loadModel() {
  if (!bp) {
    const M = await import('./vendor/basic-pitch.js');
    await M.tf.ready();
    const model = await M.loadModel(new URL('./vendor/basic-pitch-model/model.json', import.meta.url).href);
    bp = { M, model };
  }
  return bp;
}

async function decodeMono22k(file) {
  const data = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let buf;
  try {
    buf = await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(data, res, rej);   // old Safari has only the callback form
      if (p && p.then) p.then(res, rej);
    });
  } catch {
    throw new Error('Не получилось прочитать звук из файла. Подойдут mp3, m4a, wav или запись экрана.');
  } finally {
    ctx.close && ctx.close();
  }
  const len = Math.ceil(buf.duration * SR);
  try {
    const off = new OfflineAudioContext(1, len, SR);  // mixes to mono and resamples (with filtering)
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
  } catch {
    // Fallback: average the channels and resample linearly.
    const chans = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
    const out = new Float32Array(len);
    const step = buf.sampleRate / SR;
    for (let i = 0; i < len; i++) {
      const x = i * step, j = Math.floor(x), f = x - j;
      let v = 0;
      for (const ch of chans) v += (ch[j] || 0) * (1 - f) + (ch[j + 1] || 0) * f;
      out[i] = v / chans.length;
    }
    return out;
  }
}

// onStatus(text, fraction 0..1); isCancelled() is polled between chunks.
export async function songFromAudio(file, { title, onStatus = () => {}, isCancelled = () => false } = {}) {
  onStatus('Читаю файл…', 0);
  const audio = await decodeMono22k(file);
  if (audio.length < SR) throw new Error('Запись слишком короткая');
  onStatus('Загружаю нейросеть…', 0);
  const { M, model } = await loadModel();
  const minutes = audio.length / SR / 60;
  const run = (backend) => M.transcribe(model, audio, (p) => {
    if (isCancelled()) throw new Error('cancelled');
    onStatus(`Распознаю ноты (${minutes.toFixed(1)} мин записи)${backend === 'cpu' ? ', медленный режим' : ''}…`, p);
  });
  let events;
  try {
    events = await run(M.tf.getBackend());
  } catch (e) {
    if (e.message === 'cancelled' || M.tf.getBackend() === 'cpu') throw e;
    events = null;
  }
  // The GPU path on some iPads (16-bit float textures) can fail or come back empty: redo on the CPU.
  if (!events || events.length === 0) {
    await M.tf.setBackend('cpu');
    events = await run('cpu');
  }
  onStatus('Расставляю такты…', 1);
  return notesToSong(events, { title });
}
