import { describe, it, expect } from 'vitest';
import {
  probeDurationArgs, parseProbeDuration,
  probeFpsArgs, parseFps,
  probeResolutionArgs, parseResolution,
  globalVideoArgs, globalAudioArgs, muxArgs,
} from '../src/main/export/ffargs';

describe('probeDurationArgs / parseProbeDuration', () => {
  it('builds the ffprobe args and parses the float', () => {
    expect(probeDurationArgs('x.wav')).toContain('format=duration');
    expect(parseProbeDuration(' 2.5 \n')).toBeCloseTo(2.5);
  });
  it('throws on non-numeric', () => {
    expect(() => parseProbeDuration('N/A')).toThrow();
  });
});

describe('probeFpsArgs / parseFps', () => {
  it('parses rational form', () => {
    expect(parseFps('30000/1001')).toBeCloseTo(30000 / 1001);
    expect(parseFps('64/3')).toBeCloseTo(64 / 3);
  });
  it('parses decimal form', () => {
    expect(parseFps('29.97')).toBeCloseTo(29.97);
  });
  it('throws on garbage', () => {
    expect(() => parseFps('foo')).toThrow();
    expect(() => parseFps('0/0')).toThrow();
  });
});

describe('probeResolutionArgs / parseResolution', () => {
  it('parses WxH csv', () => {
    expect(parseResolution('1920,1080')).toEqual({ width: 1920, height: 1080 });
  });
  it('throws on garbage', () => {
    expect(() => parseResolution('bad')).toThrow();
    expect(() => parseResolution('0,0')).toThrow();
  });
});

describe('globalVideoArgs', () => {
  const base = { rawPath: 'raw.webm', totalDuration: 16, fps: 30, outPath: 'v.mp4' };

  it('uses -vf (no filter_complex) when neither ripple nor subtitles are provided', () => {
    const args = globalVideoArgs({ ...base });
    expect(args).toContain('-vf');
    expect(args).not.toContain('-filter_complex');
    expect(args).toContain('-t');
    expect(args).toContain('16');
    expect(args[args.length - 1]).toBe('v.mp4');
  });

  it('switches to filter_complex with ripple overlay (shortest=1)', () => {
    const args = globalVideoArgs({ ...base, ripple: { pattern: 'rip/%06d.png', fps: 30 } });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[0:v] fps=30,setpts=PTS-STARTPTS [vbase]');
    expect(fc).toMatch(/\[vbase\]\[1:v\] overlay=shortest=1 \[vout\]/);
    expect(args).toContain('-map');
    expect(args).toContain('[vout]');
    expect(args).toContain('-an');
  });

  it('adds a -loop 1 subtitle input with between(t,start,end) and shortest=1', () => {
    const args = globalVideoArgs({
      ...base,
      subtitles: [{ pngPath: 's1.png', startSec: 2.96, endSec: 5.8 }],
    });
    expect(args.join(' ')).toContain('-loop 1 -i s1.png');
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toMatch(/\[vbase\]\[1:v\] overlay=0:0:shortest=1:enable='between\(t,2\.960,5\.800\)' \[vout\]/);
  });

  it('chains ripple + multiple subtitle overlays with stable label progression', () => {
    const args = globalVideoArgs({
      ...base,
      ripple: { pattern: 'rip/%06d.png', fps: 30 },
      subtitles: [
        { pngPath: 's1.png', startSec: 2.96, endSec: 5.8 },
        { pngPath: 's2.png', startSec: 5.8, endSec: 7.65 },
      ],
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    // ripple is input #1, subtitles are #2 and #3
    expect(fc).toContain('[vbase][1:v] overlay=shortest=1 [vrip]');
    expect(fc).toMatch(/\[vrip\]\[2:v\] overlay=0:0:shortest=1:enable='between\(t,2\.960,5\.800\)' \[vsub0\]/);
    expect(fc).toMatch(/\[vsub0\]\[3:v\] overlay=0:0:shortest=1:enable='between\(t,5\.800,7\.650\)' \[vout\]/);
    expect(args).toContain('[vout]');
  });

  it('caps output with -t totalDuration in both overlay and no-overlay modes', () => {
    const a1 = globalVideoArgs({ ...base });
    expect(a1[a1.indexOf('-t') + 1]).toBe('16');
    const a2 = globalVideoArgs({ ...base, ripple: { pattern: 'r/%06d.png', fps: 30 } });
    // overlay mode has -t in inputs section AND output section; both should equal totalDuration
    const idxs = a2.reduce<number[]>((acc, v, i) => (v === '-t' ? [...acc, i] : acc), []);
    expect(idxs.length).toBeGreaterThanOrEqual(1);
    for (const i of idxs) expect(a2[i + 1]).toBe('16');
  });
});

describe('globalAudioArgs', () => {
  it('produces silence-only when there are no TTS clips', () => {
    const args = globalAudioArgs({ totalDuration: 16, outPath: 'a.wav', clips: [] });
    expect(args.join(' ')).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
    expect(args).toContain('-t');
    expect(args).toContain('16');
    expect(args).not.toContain('-filter_complex');
    expect(args[args.length - 1]).toBe('a.wav');
  });

  it('chains adelay + amix when clips are provided', () => {
    const args = globalAudioArgs({
      totalDuration: 16, outPath: 'a.wav',
      clips: [
        { delaySec: 2.96, pathAbs: '/abs/a.wav' },
        { delaySec: 5.8, pathAbs: '/abs/b.wav' },
      ],
    });
    expect(args.join(' ')).toContain('-i /abs/a.wav');
    expect(args.join(' ')).toContain('-i /abs/b.wav');
    const fc = args[args.indexOf('-filter_complex') + 1];
    // ms-rounded delay
    expect(fc).toContain('adelay=2960|2960');
    expect(fc).toContain('adelay=5800|5800');
    // silence base [0:a] participates in amix
    expect(fc).toMatch(/\[0:a\]\[a0\]\[a1\] amix=inputs=3:normalize=0:duration=longest \[aout\]/);
    expect(args).toContain('-map');
    expect(args).toContain('[aout]');
  });

  it('clamps negative delaySec to 0ms', () => {
    const args = globalAudioArgs({
      totalDuration: 5, outPath: 'a.wav',
      clips: [{ delaySec: -0.4, pathAbs: '/abs/a.wav' }],
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('adelay=0|0');
  });
});

describe('muxArgs', () => {
  it('contains the credit and faststart', () => {
    const args = muxArgs({ videoPath: 'v.mp4', audioPath: 'a.wav', outPath: 'o.mp4', comment: 'VOICEVOX' });
    expect(args).toContain('-movflags');
    expect(args).toContain('+faststart');
    expect(args.join(' ')).toContain('comment=VOICEVOX');
    expect(args[args.length - 1]).toBe('o.mp4');
  });
});
