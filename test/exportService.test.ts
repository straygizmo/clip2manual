import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runExport } from '../src/main/export/exportService';
import { type Segment } from '../src/shared/types';

function seg(overrides: Partial<Segment>): Segment {
  return {
    id: 'seg-x', videoStart: 0, videoEnd: 1,
    originalText: '', correctedText: '',
    ttsAudio: null,
    voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
    ...overrides,
  };
}

function makeProbe(rawDuration: number, ttsDuration = 1.5) {
  return async (args: string[]) => {
    const s = args.join(' ');
    if (s.includes('r_frame_rate')) return '30/1';
    if (s.includes('width,height')) return '1920,1080';
    // probeDuration: raw.webm vs tts/*.wav
    if (s.includes('raw.webm')) return String(rawDuration);
    return String(ttsDuration);
  };
}

let projectDir: string;
let tmpDir: string;
beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-exp-'));
  tmpDir = path.join(projectDir, 'export-tmp');
});
afterEach(async () => { await fs.rm(projectDir, { recursive: true, force: true }); });

describe('runExport (raw-timeline architecture)', () => {
  it('runs probe → ripple → subtitle → video → audio → mux with 5 ticks of progress', async () => {
    const ffmpegCalls: string[][] = [];
    const progress: number[] = [];
    await runExport({
      segments: [
        seg({ id: 'seg-001', videoStart: 2.96, videoEnd: 5.8, ttsAudio: 'tts/seg-001.wav', correctedText: 'a' }),
        seg({ id: 'seg-002', videoStart: 5.8, videoEnd: 7.65, ttsAudio: 'tts/seg-002.wav', correctedText: 'b' }),
      ],
      projectDir, tmpDir,
      outPath: path.join(projectDir, 'out.mp4'),
      credit: 'VOICEVOX',
      showSubtitles: false,
      runFfmpeg: async (args) => { ffmpegCalls.push(args); },
      runProbe: makeProbe(16.07),
      onProgress: (p) => progress.push(p),
      // mock to avoid sharp
      generateRippleFrames: async () => null,
      generateSubtitleOverlays: async () => [],
    });
    // 3 ffmpeg calls: video + audio + mux
    expect(ffmpegCalls.length).toBe(3);
    // First call is video encoding raw.webm
    expect(ffmpegCalls[0].join(' ')).toContain('raw.webm');
    // Second call is audio mixing
    expect(ffmpegCalls[1].join(' ')).toContain('anullsrc');
    // Mux last
    expect(ffmpegCalls[2][ffmpegCalls[2].length - 1]).toBe(path.join(projectDir, 'out.mp4'));
    // 5 ticks: 20/40/60/80/100
    expect(progress).toEqual([20, 40, 60, 80, 100]);
  });

  it('throws on empty segments list', async () => {
    await expect(runExport({
      segments: [], projectDir, tmpDir,
      outPath: path.join(projectDir, 'o.mp4'), credit: 'x',
      showSubtitles: false,
      runFfmpeg: async () => {}, runProbe: makeProbe(10),
    })).rejects.toThrow();
  });

  it('throws noEnabledSegments when all segments are disabled', async () => {
    await expect(runExport({
      segments: [seg({ id: 'a', enabled: false, ttsAudio: 'tts/a.wav', videoStart: 1, videoEnd: 2, correctedText: 'x' })],
      projectDir, tmpDir,
      outPath: path.join(projectDir, 'o.mp4'), credit: 'x',
      showSubtitles: false,
      runFfmpeg: async () => {}, runProbe: makeProbe(10),
    })).rejects.toThrow();
  });

  it('skips ripple PNG generation when no enabled segment has clicks', async () => {
    let rippleCalled = false;
    const ffmpegCalls: string[][] = [];
    await runExport({
      segments: [seg({ id: 'a', ttsAudio: 'tts/a.wav', videoStart: 1, videoEnd: 2 })],
      projectDir, tmpDir,
      outPath: path.join(projectDir, 'out.mp4'), credit: 'x',
      showSubtitles: false,
      runFfmpeg: async (args) => { ffmpegCalls.push(args); },
      runProbe: makeProbe(10),
      generateRippleFrames: async (input) => {
        rippleCalled = true;
        expect(input.clicks.length).toBe(0);
        return null;
      },
    });
    expect(rippleCalled).toBe(true);
    // video encoding goes through -vf path (no -filter_complex) when both ripple and subs are absent
    expect(ffmpegCalls[0]).toContain('-vf');
    expect(ffmpegCalls[0]).not.toContain('-filter_complex');
  });

  it('passes absolute click times (from enabled segments only) to ripple generator', async () => {
    let captured: ReadonlyArray<{ x: number; y: number; t: number }> = [];
    await runExport({
      segments: [
        seg({ id: 'a', videoStart: 1, videoEnd: 2, ttsAudio: 'tts/a.wav',
              clicks: [{ x: 10, y: 20, t: 1.5, button: 1 }] }),
        seg({ id: 'b', videoStart: 2, videoEnd: 3, enabled: false,
              clicks: [{ x: 30, y: 40, t: 2.5, button: 1 }] }),
      ],
      projectDir, tmpDir,
      outPath: path.join(projectDir, 'out.mp4'), credit: 'x',
      showSubtitles: false,
      runFfmpeg: async () => {},
      runProbe: makeProbe(10),
      generateRippleFrames: async (input) => {
        captured = input.clicks;
        return { pattern: 'rip/%06d.png', fps: 30 };
      },
    });
    expect(captured).toEqual([{ segId: 'a', x: 10, y: 20, t: 1.5, button: 1 }]);
  });

  it('passes only enabled+nonempty-text spans to subtitle generator', async () => {
    let captured: ReadonlyArray<{ segId: string; text: string }> = [];
    await runExport({
      segments: [
        seg({ id: 'a', videoStart: 1, videoEnd: 2, ttsAudio: 'tts/a.wav', correctedText: 'hello' }),
        seg({ id: 'b', videoStart: 3, videoEnd: 4, correctedText: '' }),
        seg({ id: 'c', videoStart: 5, videoEnd: 6, enabled: false, correctedText: 'cut' }),
      ],
      projectDir, tmpDir,
      outPath: path.join(projectDir, 'out.mp4'), credit: 'x',
      showSubtitles: true,
      runFfmpeg: async () => {},
      runProbe: makeProbe(10),
      generateRippleFrames: async () => null,
      generateSubtitleOverlays: async (input) => {
        captured = input.spans.map((s) => ({ segId: s.segId, text: s.text }));
        return [];
      },
    });
    expect(captured).toEqual([{ segId: 'a', text: 'hello' }]);
  });

  it('skips subtitle generator entirely when showSubtitles=false', async () => {
    let called = 0;
    await runExport({
      segments: [seg({ id: 'a', videoStart: 1, videoEnd: 2, ttsAudio: 'tts/a.wav', correctedText: 'hi' })],
      projectDir, tmpDir,
      outPath: path.join(projectDir, 'out.mp4'), credit: 'x',
      showSubtitles: false,
      runFfmpeg: async () => {},
      runProbe: makeProbe(10),
      generateRippleFrames: async () => null,
      generateSubtitleOverlays: async () => { called++; return []; },
    });
    expect(called).toBe(0);
  });

  it('audio ffmpeg call delays each TTS clip by its segment.videoStart', async () => {
    const ffmpegCalls: string[][] = [];
    await runExport({
      segments: [
        seg({ id: 'a', videoStart: 2.96, videoEnd: 5.8, ttsAudio: 'tts/a.wav' }),
        seg({ id: 'b', videoStart: 5.8, videoEnd: 7.65, ttsAudio: 'tts/b.wav' }),
      ],
      projectDir, tmpDir,
      outPath: path.join(projectDir, 'out.mp4'), credit: 'x',
      showSubtitles: false,
      runFfmpeg: async (args) => { ffmpegCalls.push(args); },
      runProbe: makeProbe(16.07),
      generateRippleFrames: async () => null,
      generateSubtitleOverlays: async () => [],
    });
    const audioArgs = ffmpegCalls[1].join(' ');
    expect(audioArgs).toContain('adelay=2960|2960');
    expect(audioArgs).toContain('adelay=5800|5800');
  });
});
