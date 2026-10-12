// Source of js/vendor/basic-pitch.js (Spotify Basic Pitch + TensorFlow.js in one ES module).
// Rebuild: see tools/basic-pitch/build.sh
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
import { loadGraphModel } from '@tensorflow/tfjs-converter';
import { outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch/esm/toMidi.js';

// Same constants as @spotify/basic-pitch/esm/inference.js.
export const SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const AUDIO_N_SAMPLES = SAMPLE_RATE * 2 - FFT_HOP;
const N_OVERLAP_OVER_2 = 15;
const OVERLAP_LENGTH_FRAMES = 30 * FFT_HOP;
const HOP_SIZE = AUDIO_N_SAMPLES - OVERLAP_LENGTH_FRAMES;
const FPS = Math.floor(SAMPLE_RATE / FFT_HOP);

export { tf };

export async function loadModel(urlOrHandler) {
  if (tf.getBackend() == null) await tf.ready();
  return loadGraphModel(urlOrHandler);
}

// audio: mono Float32Array at 22050 Hz. Returns [{ start, dur, midi, amp }] in seconds.
// Unlike the package's BasicPitch.evaluateModel this frees every tensor (long songs on iPad).
export async function transcribe(model, audio, onProgress = () => {}, opts = {}) {
  const want = Math.floor(audio.length * FPS / SAMPLE_RATE);
  const windows = tf.tidy(() => {
    const wav = tf.concat1d([tf.zeros([OVERLAP_LENGTH_FRAMES / 2]), tf.tensor1d(audio)]);
    return tf.expandDims(tf.signal.frame(wav, AUDIO_N_SAMPLES, HOP_SIZE, true, 0), -1);
  });
  const frames = [], onsets = [];
  const n = windows.shape[0];
  try {
    for (let i = 0; i < n && frames.length < want; i++) {
      onProgress(i / n);
      const [f, o] = tf.tidy(() => {
        const out = model.execute(tf.slice(windows, i, 1), ['Identity_1', 'Identity_2']);
        return out.map((r) => {
          const s = tf.slice(r, [0, N_OVERLAP_OVER_2, 0], [-1, r.shape[1] - 2 * N_OVERLAP_OVER_2, -1]);
          return tf.reshape(s, [s.shape[1], s.shape[2]]);
        });
      });
      const [fa, oa] = [await f.array(), await o.array()];
      f.dispose(); o.dispose();
      const take = Math.min(fa.length, want - frames.length);
      for (let j = 0; j < take; j++) { frames.push(fa[j]); onsets.push(oa[j]); }
      await new Promise((r) => setTimeout(r, 0));        // let the page repaint the progress bar
    }
  } finally {
    windows.dispose();
  }
  onProgress(1);
  const notes = noteFramesToTime(outputToNotesPoly(frames, onsets,
    opts.onsetThresh ?? 0.5, opts.frameThresh ?? 0.3, opts.minNoteLen ?? 11, true, null, null, true));
  return notes.map((x) => ({ start: x.startTimeSeconds, dur: x.durationSeconds, midi: x.pitchMidi, amp: x.amplitude }));
}
