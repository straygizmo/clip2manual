import { describe, it, expect } from 'vitest';
import {
  probeDurationArgs, parseProbeDuration, probeFpsArgs, parseFps,
  probeResolutionArgs, parseResolution,
  segmentVideoArgs, segmentAudioArgs, concatArgs, muxArgs,
} from '../src/main/export/ffargs';
import { type PreviewSlot } from '../src/shared/previewTimeline';

const slot: PreviewSlot = { segmentId: 'seg-001', slotStart: 0, slotDuration: 5, videoStart: 1, videoEnd: 3, clipDuration: 4.7 };

describe('probe parsing', () => {
  it('parseProbeDuration parses a numeric stdout', () => {
    expect(parseProbeDuration('12.34\n')).toBeCloseTo(12.34);
  });
  it('parseProbeDuration throws on garbage', () => {
    expect(() => parseProbeDuration('N/A')).toThrow();
  });
  it('parseFps parses a rational and a plain number', () => {
    expect(parseFps('30000/1001')).toBeCloseTo(29.97, 1);
    expect(parseFps('30/1')).toBe(30);
    expect(parseFps('25')).toBe(25);
  });
  it('parseFps throws on garbage', () => {
    expect(() => parseFps('0/0')).toThrow();
  });
  it('probeDurationArgs/probeFpsArgs include the file and the right show_entries', () => {
    expect(probeDurationArgs('a.wav')).toContain('a.wav');
    expect(probeDurationArgs('a.wav').join(' ')).toContain('format=duration');
    expect(probeFpsArgs('v.webm').join(' ')).toContain('r_frame_rate');
  });
  it('probeResolutionArgs queries width,height of first video stream', () => {
    const s = probeResolutionArgs('v.webm').join(' ');
    expect(s).toContain('-select_streams v:0');
    expect(s).toContain('stream=width,height');
    expect(s).toContain('v.webm');
  });
  it('parseResolution parses "1920,1080"', () => {
    expect(parseResolution('1920,1080\n')).toEqual({ width: 1920, height: 1080 });
  });
  it('parseResolution accepts whitespace', () => {
    expect(parseResolution(' 1280 , 720 \n')).toEqual({ width: 1280, height: 720 });
  });
  it('parseResolution throws on garbage', () => {
    expect(() => parseResolution('N/A')).toThrow();
    expect(() => parseResolution('1920')).toThrow();
    expect(() => parseResolution('0,0')).toThrow();
  });
});

describe('segmentVideoArgs', () => {
  it('trims [videoStart, +videoSpan] and freezes the remainder', () => {
    const args = segmentVideoArgs({ rawPath: 'raw.webm', slot, outPath: 'o.mp4', fps: 30 });
    const s = args.join(' ');
    expect(s).toContain('-ss 1');
    expect(s).toContain('-t 2');
    expect(s).toContain('stop_duration=3');
    expect(s).toContain('fps=30'); // fps が vf チェーンに注入される
    expect(s).toContain('libx264');
    // -t は -i より前（入力オプション）。そうでないと tpad のフリーズが効かない。
    expect(args.indexOf('-t')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.length - 1]).toBe('o.mp4');
  });

  it('without ripple: keeps the original -vf form and -ss/-t before -i', () => {
    const args = segmentVideoArgs({ rawPath: 'raw.webm', slot, outPath: 'o.mp4', fps: 30 });
    expect(args).toContain('-vf');
    expect(args).not.toContain('-filter_complex');
    expect(args).not.toContain('-map');
    expect(args.indexOf('-t')).toBeLessThan(args.indexOf('-i'));
  });

  it('with ripple: uses filter_complex overlay and -map [vout]', () => {
    const args = segmentVideoArgs({
      rawPath: 'raw.webm', slot, outPath: 'o.mp4', fps: 30,
      ripple: { pattern: 'tmp/seg-001_ripple/%05d.png', fps: 30 },
    });
    expect(args).toContain('-filter_complex');
    expect(args).toContain('-map');
    expect(args).toContain('[vout]');
    expect(args).not.toContain('-vf');
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1];
    expect(fc).toContain('tpad=stop_mode=clone');
    expect(fc).toContain('overlay=shortest=1');
    // PNG seq が第2入力で、-framerate がその直前
    const inputs = args.reduce<number[]>((acc, a, i) => (a === '-i' ? [...acc, i] : acc), []);
    expect(inputs).toHaveLength(2);
    expect(args[inputs[1] - 2]).toBe('-framerate');
    expect(args[inputs[1] - 1]).toBe('30');
    expect(args[inputs[1] + 1]).toBe('tmp/seg-001_ripple/%05d.png');
    // -ss/-t は依然 -i raw.webm の前（入力オプション）
    expect(args.indexOf('-ss')).toBeLessThan(inputs[0]);
    expect(args.indexOf('-t')).toBeLessThan(inputs[0]);
  });
});

describe('segmentAudioArgs', () => {
  it('with a clip pads to slotDuration', () => {
    const args = segmentAudioArgs({ clipPath: 'c.wav', slotDuration: 5, outPath: 'a.wav' });
    const s = args.join(' ');
    expect(s).toContain('c.wav');
    expect(s).toContain('apad');
    expect(s).toContain('-t 5');
  });
  it('without a clip generates slotDuration of silence', () => {
    const args = segmentAudioArgs({ clipPath: null, slotDuration: 5, outPath: 'a.wav' });
    const s = args.join(' ');
    expect(s).toContain('anullsrc');
    expect(s).toContain('-t 5');
  });
});

describe('concatArgs / muxArgs', () => {
  it('concatArgs uses the concat demuxer with stream copy', () => {
    const s = concatArgs({ listFile: 'l.txt', outPath: 'o.mp4' }).join(' ');
    expect(s).toContain('-f concat');
    expect(s).toContain('-safe 0');
    expect(s).toContain('-c copy');
  });
  it('muxArgs copies video, encodes aac, embeds the credit comment', () => {
    const args = muxArgs({ videoPath: 'v.mp4', audioPath: 'a.wav', outPath: 'out.mp4', comment: 'VOICEVOX' });
    const s = args.join(' ');
    expect(s).toContain('-c:v copy');
    expect(s).toContain('-c:a aac');
    expect(args).toContain('comment=VOICEVOX');
  });
});

describe('segmentVideoArgs with subtitle', () => {
  it('adds subtitle overlay with -loop 1 input and enable=lt(t,dur)', () => {
    const args = segmentVideoArgs({
      rawPath: 'raw.webm', slot, outPath: 'v.mp4', fps: 30,
      subtitle: { pngPath: 'sub.png', durationSec: 4.5 },
    });
    expect(args).toContain('-loop');
    expect(args).toContain('sub.png');
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('overlay=0:0:enable=');
    expect(fc).toContain("lt(t,4.500)");
    expect(args).toContain('[vout]');
  });

  it('combines ripple and subtitle in a single filter chain', () => {
    const args = segmentVideoArgs({
      rawPath: 'raw.webm', slot, outPath: 'v.mp4', fps: 30,
      ripple: { pattern: 'rip/%05d.png', fps: 30 },
      subtitle: { pngPath: 'sub.png', durationSec: 2 },
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[vbase][1:v] overlay=shortest=1');
    expect(fc).toMatch(/\[v[a-z0-9]+\]\[2:v\] overlay=0:0:enable='lt\(t,2\.000\)'/);
    expect(args).toContain('[vout]');
  });

  it('uses -vf path (no filter_complex) when neither ripple nor subtitle is provided', () => {
    const args = segmentVideoArgs({ rawPath: 'raw.webm', slot, outPath: 'v.mp4', fps: 30 });
    expect(args).toContain('-vf');
    expect(args).not.toContain('-filter_complex');
  });
});
