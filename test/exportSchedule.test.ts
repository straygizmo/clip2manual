import { describe, it, expect } from 'vitest';
import { computeExportSchedule, isScheduleEmpty } from '../src/shared/exportSchedule';
import { type Segment } from '../src/shared/types';

function seg(overrides: Partial<Segment>): Segment {
  return {
    id: overrides.id ?? 'seg-x',
    videoStart: 0, videoEnd: 1,
    originalText: '', correctedText: '',
    ttsAudio: null,
    voice: { speaker: 3, speed: 1 },
    clicks: [], enabled: true,
    ...overrides,
  };
}

describe('computeExportSchedule', () => {
  it('returns totalDuration = rawVideoDuration', () => {
    const s = computeExportSchedule({ segments: [], rawVideoDuration: 16.07, clipDurations: new Map() });
    expect(s.totalDuration).toBe(16.07);
  });

  it('emits an audio clip per enabled segment with ttsAudio + non-zero clipDuration', () => {
    const s = computeExportSchedule({
      segments: [
        seg({ id: 'a', videoStart: 2.96, ttsAudio: 'tts/a.wav' }),
        seg({ id: 'b', videoStart: 5.8, ttsAudio: 'tts/b.wav' }),
        seg({ id: 'c', videoStart: 7.0, ttsAudio: null }),
      ],
      rawVideoDuration: 16,
      clipDurations: new Map([['a', 1.8], ['b', 0.9]]),
    });
    expect(s.audioClips).toEqual([
      { segId: 'a', delaySec: 2.96, pathRel: 'tts/a.wav', durationSec: 1.8 },
      { segId: 'b', delaySec: 5.8, pathRel: 'tts/b.wav', durationSec: 0.9 },
    ]);
  });

  it('skips audio clips with missing or zero duration', () => {
    const s = computeExportSchedule({
      segments: [seg({ id: 'a', ttsAudio: 'tts/a.wav', videoStart: 1 })],
      rawVideoDuration: 5,
      clipDurations: new Map([['a', 0]]),
    });
    expect(s.audioClips).toEqual([]);
  });

  it('skips disabled segments entirely (no audio / subtitle / clicks)', () => {
    const s = computeExportSchedule({
      segments: [
        seg({ id: 'a', enabled: false, ttsAudio: 'tts/a.wav', videoStart: 1, videoEnd: 2,
              correctedText: 'hi', clicks: [{ x: 1, y: 2, t: 1.5, button: 1 }] }),
      ],
      rawVideoDuration: 5,
      clipDurations: new Map([['a', 1]]),
    });
    expect(s.audioClips).toEqual([]);
    expect(s.subtitleSpans).toEqual([]);
    expect(s.clicks).toEqual([]);
  });

  it('subtitle span uses corrected text falling back to original', () => {
    const s = computeExportSchedule({
      segments: [
        seg({ id: 'a', videoStart: 1, videoEnd: 2, originalText: 'orig', correctedText: 'fixed' }),
        seg({ id: 'b', videoStart: 3, videoEnd: 4, originalText: 'fallback', correctedText: '' }),
        seg({ id: 'c', videoStart: 5, videoEnd: 6, originalText: '', correctedText: '' }),
      ],
      rawVideoDuration: 10, clipDurations: new Map(),
    });
    expect(s.subtitleSpans).toEqual([
      { segId: 'a', startSec: 1, endSec: 2, text: 'fixed' },
      { segId: 'b', startSec: 3, endSec: 4, text: 'fallback' },
    ]);
  });

  it('drops subtitle span when videoEnd <= videoStart', () => {
    const s = computeExportSchedule({
      segments: [seg({ id: 'a', videoStart: 2, videoEnd: 2, correctedText: 'x' })],
      rawVideoDuration: 5, clipDurations: new Map(),
    });
    expect(s.subtitleSpans).toEqual([]);
  });

  it('collects clicks from enabled segments with absolute time', () => {
    const s = computeExportSchedule({
      segments: [
        seg({ id: 'a', videoStart: 1, videoEnd: 3,
              clicks: [{ x: 10, y: 20, t: 1.5, button: 1 }, { x: 30, y: 40, t: 2.7, button: 1 }] }),
        seg({ id: 'b', videoStart: 4, videoEnd: 5,
              clicks: [{ x: 50, y: 60, t: 4.2, button: 2 }] }),
      ],
      rawVideoDuration: 6, clipDurations: new Map(),
    });
    expect(s.clicks).toEqual([
      { segId: 'a', x: 10, y: 20, t: 1.5, button: 1 },
      { segId: 'a', x: 30, y: 40, t: 2.7, button: 1 },
      { segId: 'b', x: 50, y: 60, t: 4.2, button: 2 },
    ]);
  });

  it('clamps negative videoStart to 0 for audio + subtitle', () => {
    const s = computeExportSchedule({
      segments: [seg({ id: 'a', videoStart: -0.5, videoEnd: 1, ttsAudio: 'tts/a.wav', correctedText: 'x' })],
      rawVideoDuration: 5, clipDurations: new Map([['a', 1]]),
    });
    expect(s.audioClips[0].delaySec).toBe(0);
    expect(s.subtitleSpans[0].startSec).toBe(0);
  });

  it('isScheduleEmpty is true when no audio/subs/clicks even if total > 0', () => {
    const s = computeExportSchedule({ segments: [], rawVideoDuration: 10, clipDurations: new Map() });
    expect(isScheduleEmpty(s)).toBe(true);
  });

  it('isScheduleEmpty is false when there is any audio clip', () => {
    const s = computeExportSchedule({
      segments: [seg({ id: 'a', ttsAudio: 'tts/a.wav', videoStart: 1 })],
      rawVideoDuration: 5, clipDurations: new Map([['a', 1]]),
    });
    expect(isScheduleEmpty(s)).toBe(false);
  });
});
