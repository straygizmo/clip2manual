// src/renderer/audio/decodeToWav.ts
import { encodeWav } from '../../shared/wav';

const TARGET_RATE = 16000;

/** webm/opus などの音声 ArrayBuffer を 16kHz モノラルの 16bit WAV にデコード変換する。 */
export async function decodeToWav(input: ArrayBuffer): Promise<ArrayBuffer> {
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(input.slice(0));
  } finally {
    await decodeCtx.close();
  }

  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), TARGET_RATE);
}
