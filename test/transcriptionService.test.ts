// test/transcriptionService.test.ts
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { transcribe } from '../src/main/transcription/transcriptionService';
import { type WhisperRunner, type WhisperRunInput } from '../src/main/transcription/whisperRunner';

class FakeRunner implements WhisperRunner {
  async run(input: WhisperRunInput): Promise<void> {
    input.onProgress?.(100);
    const json = {
      transcription: [
        { offsets: { from: 0, to: 1000 }, text: ' a' },
        { offsets: { from: 1000, to: 2000 }, text: ' b' },
      ],
    };
    await fs.writeFile(`${input.outBase}.json`, JSON.stringify(json), 'utf8');
  }
}

describe('transcribe', () => {
  it('runs the runner, reads its JSON, and maps to segments with clicks', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-tx-'));
    let lastPct = -1;
    const segments = await transcribe({
      runner: new FakeRunner(),
      binPath: 'bin', modelPath: 'model', audioPath: 'a.wav',
      outDir: dir, language: 'ja',
      clicks: [{ x: 1, y: 2, t: 0.5, button: 1 }],
      defaultVoice: { speaker: 3, speed: 1.0 },
      onProgress: (p) => { lastPct = p; },
    });

    expect(segments.map((s) => s.id)).toEqual(['seg-001', 'seg-002']);
    expect(segments[0].clicks).toHaveLength(1);
    expect(lastPct).toBe(100);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
