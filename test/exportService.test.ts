import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runExport } from '../src/main/export/exportService';
import { type Segment } from '../src/shared/types';

function seg(id: string, start: number, end: number, ttsAudio: string | null): Segment {
  return {
    id, videoStart: start, videoEnd: end, originalText: '', correctedText: '',
    ttsAudio, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}

let projectDir: string;
let tmpDir: string;
beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-exp-'));
  tmpDir = path.join(projectDir, 'export-tmp');
});
afterEach(async () => { await fs.rm(projectDir, { recursive: true, force: true }); });

describe('runExport', () => {
  it('probes fps + clip durations, runs per-segment + concat + mux, reports progress', async () => {
    const ffmpegCalls: string[][] = [];
    const probeCalls: string[][] = [];
    const progress: number[] = [];

    await runExport({
      segments: [seg('seg-001', 1, 3, 'tts/seg-001.wav'), seg('seg-002', 3, 6, null)],
      projectDir,
      outPath: path.join(projectDir, 'out.mp4'),
      tmpDir,
      credit: 'VOICEVOX',
      runFfmpeg: async (args) => { ffmpegCalls.push(args); },
      runProbe: async (args) => {
        probeCalls.push(args);
        return args.join(' ').includes('r_frame_rate') ? '30/1' : '2.0';
      },
      onProgress: (p) => progress.push(p),
    });

    expect(probeCalls.length).toBe(2); // fps + 1 clip duration (seg-002 has no ttsAudio)
    expect(ffmpegCalls.length).toBe(7); // 2 video + 2 audio + 2 concat + 1 mux
    expect(ffmpegCalls[6][ffmpegCalls[6].length - 1]).toBe(path.join(projectDir, 'out.mp4'));
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('throws when there are no segments', async () => {
    await expect(runExport({
      segments: [], projectDir, outPath: path.join(projectDir, 'o.mp4'), tmpDir, credit: 'x',
      runFfmpeg: async () => {}, runProbe: async () => '30/1',
    })).rejects.toThrow();
  });
});
