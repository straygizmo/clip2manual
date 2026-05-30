import { describe, it, expect } from 'vitest';
import { parseSilenceStderr, silenceMidsMs } from '../src/main/transcription/silenceDetect';

describe('parseSilenceStderr', () => {
  it('parses a single silence_start / silence_end pair', () => {
    const stderr = [
      'ffmpeg version n7.0 Copyright (c) 2000-2024 ...',
      '[silencedetect @ 0x7f8a01] silence_start: 1.92',
      '[silencedetect @ 0x7f8a01] silence_end: 2.5 | silence_duration: 0.58',
      'size=N/A time=00:00:10.00',
    ].join('\n');
    const out = parseSilenceStderr(stderr);
    expect(out).toEqual([{ startSec: 1.92, endSec: 2.5 }]);
  });

  it('parses multiple silences in order', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 0.5',
      '[silencedetect @ 0x1] silence_end: 1.2 | silence_duration: 0.7',
      '[silencedetect @ 0x1] silence_start: 4.0',
      '[silencedetect @ 0x1] silence_end: 5.3 | silence_duration: 1.3',
    ].join('\n');
    const out = parseSilenceStderr(stderr);
    expect(out).toEqual([
      { startSec: 0.5, endSec: 1.2 },
      { startSec: 4.0, endSec: 5.3 },
    ]);
  });

  it('leaves endSec as null when silence_end never comes (silence at EOF)', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 3.0',
      // no silence_end before EOF
    ].join('\n');
    const out = parseSilenceStderr(stderr);
    expect(out).toEqual([{ startSec: 3.0, endSec: null }]);
  });

  it('parses integer-valued timestamps (no decimal)', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 5',
      '[silencedetect @ 0x1] silence_end: 7 | silence_duration: 2',
    ].join('\n');
    const out = parseSilenceStderr(stderr);
    expect(out).toEqual([{ startSec: 5, endSec: 7 }]);
  });

  it('returns [] when no silence lines are present', () => {
    expect(parseSilenceStderr('ffmpeg version n7.0\nframe= 100')).toEqual([]);
  });
});

describe('silenceMidsMs', () => {
  it('computes the integer midpoint in ms for each interval', () => {
    expect(silenceMidsMs([{ startMs: 1920, endMs: 2500 }])).toEqual([2210]);
    expect(
      silenceMidsMs([
        { startMs: 500, endMs: 1200 },
        { startMs: 4000, endMs: 5300 },
      ]),
    ).toEqual([850, 4650]);
  });

  it('returns startMs for a zero-length interval (EOF silence)', () => {
    expect(silenceMidsMs([{ startMs: 3000, endMs: 3000 }])).toEqual([3000]);
  });
});
