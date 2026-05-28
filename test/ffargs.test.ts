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
