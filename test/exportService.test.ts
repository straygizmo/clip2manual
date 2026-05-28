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
  it('probes fps + resolution + clip durations, runs per-segment + concat + mux, reports progress', async () => {
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
        const s = args.join(' ');
        if (s.includes('r_frame_rate')) return '30/1';
        if (s.includes('width,height')) return '1920,1080';
        return '2.0';
      },
      onProgress: (p) => progress.push(p),
    });

    expect(probeCalls.length).toBe(3); // fps + resolution + 1 clip duration (seg-002 has no ttsAudio)
    expect(ffmpegCalls.length).toBe(7); // 2 video + 2 audio + 2 concat + 1 mux (no clicks → no overlay)
    expect(ffmpegCalls[6][ffmpegCalls[6].length - 1]).toBe(path.join(projectDir, 'out.mp4'));
    expect(progress[progress.length - 1]).toBe(100);
    // 重要: clicks 空のスロットでは ripple overlay は使われない（-vf 形式のまま）
    for (let i = 0; i < 2; i++) {
      expect(ffmpegCalls[i * 2]).toContain('-vf');
      expect(ffmpegCalls[i * 2]).not.toContain('-filter_complex');
    }
  });

  it('throws when there are no segments', async () => {
    await expect(runExport({
      segments: [], projectDir, outPath: path.join(projectDir, 'o.mp4'), tmpDir, credit: 'x',
      runFfmpeg: async () => {}, runProbe: async () => '30/1',
    })).rejects.toThrow();
  });

  it('uses ripple overlay for slots that have clicks', async () => {
    const ffmpegCalls: string[][] = [];
    const generateCalls: Array<{ segmentId: string; clickCount: number }> = [];
    const segWithClicks: Segment = {
      ...seg('seg-001', 1, 3, 'tts/seg-001.wav'),
      clicks: [{ t: 1.5, x: 100, y: 200, button: 1 }],
    };
    await runExport({
      segments: [segWithClicks],
      projectDir,
      outPath: path.join(projectDir, 'out.mp4'),
      tmpDir,
      credit: 'VOICEVOX',
      runFfmpeg: async (args) => { ffmpegCalls.push(args); },
      runProbe: async (args) => {
        const s = args.join(' ');
        if (s.includes('r_frame_rate')) return '30/1';
        if (s.includes('width,height')) return '1920,1080';
        return '2.5';
      },
      generateRippleFrames: async (input) => {
        generateCalls.push({ segmentId: input.slot.segmentId, clickCount: input.clicks.length });
        return { pattern: path.join(input.outDir, '%05d.png'), fps: input.fps };
      },
    });

    expect(generateCalls).toEqual([{ segmentId: 'seg-001', clickCount: 1 }]);
    // seg-001 の video 中間クリップ呼び出しに ripple overlay が入っている
    const videoCall = ffmpegCalls[0];
    expect(videoCall).toContain('-filter_complex');
    expect(videoCall).toContain('-map');
    expect(videoCall.join(' ')).toContain('overlay=shortest=1');
  });
});
