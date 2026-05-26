import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateTts, type TtsEngine, type TtsClient } from '../src/main/voicevox/ttsService';
import { type Segment } from '../src/shared/types';

function seg(id: string, text: string): Segment {
  return {
    id, videoStart: 0, videoEnd: 1, originalText: text, correctedText: text,
    ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}

const engine: TtsEngine = { ensureRunning: async () => 'http://e' };

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-tts-'));
  await fs.mkdir(path.join(dir, 'tts'), { recursive: true });
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('generateTts', () => {
  it('synthesizes non-empty segments, writes tts/<id>.wav, sets ttsAudio, skips empty', async () => {
    const calls: string[] = [];
    const client: TtsClient = {
      synthesize: async (_baseUrl, input) => { calls.push(input.text); return Buffer.from('WAV:' + input.text); },
    };
    const result = await generateTts({
      engine, client, outDir: dir,
      segments: [seg('seg-001', 'hello'), seg('seg-002', '   '), seg('seg-003', 'world')],
    });

    expect(calls).toEqual(['hello', 'world']); // 空はスキップ
    expect(result[0].ttsAudio).toBe('tts/seg-001.wav');
    expect(result[1].ttsAudio).toBeNull();
    expect(result[2].ttsAudio).toBe('tts/seg-003.wav');
    expect(await fs.readFile(path.join(dir, 'tts/seg-001.wav'), 'utf8')).toBe('WAV:hello');
    expect(await fs.readFile(path.join(dir, 'tts/seg-003.wav'), 'utf8')).toBe('WAV:world');
  });

  it('with onlyId generates just that segment', async () => {
    const client: TtsClient = { synthesize: async () => Buffer.from('X') };
    const result = await generateTts({
      engine, client, outDir: dir, onlyId: 'seg-002',
      segments: [seg('seg-001', 'a'), seg('seg-002', 'b')],
    });
    expect(result[0].ttsAudio).toBeNull();
    expect(result[1].ttsAudio).toBe('tts/seg-002.wav');
  });

  it('reports progress and uses each segment voice', async () => {
    const speakers: number[] = [];
    const client: TtsClient = { synthesize: async (_b, input) => { speakers.push(input.speaker); return Buffer.from('X'); } };
    const s1 = { ...seg('seg-001', 'a'), voice: { speaker: 8, speed: 1.2 } };
    const progress: Array<[number, number]> = [];
    await generateTts({
      engine, client, outDir: dir, segments: [s1, seg('seg-002', 'b')],
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(speakers).toEqual([8, 3]);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });
});
