import { describe, it, expect } from 'vitest';
import { toggleEnabled, mergeWithNext, splitAt, resizeBoundary, MIN_SEGMENT_DURATION } from '../src/renderer/state/segmentOps';
import { type Segment, type ClickEvent } from '../src/shared/types';

function click(t: number): ClickEvent { return { x: 1, y: 1, t, button: 1 }; }
function seg(id: string, start: number, end: number, over: Partial<Segment> = {}): Segment {
  return {
    id, videoStart: start, videoEnd: end, originalText: `o-${id}`, correctedText: `c-${id}`,
    ttsAudio: `tts/${id}.wav`, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true, ...over,
  };
}

describe('toggleEnabled', () => {
  it('flips enabled of the target only', () => {
    const r = toggleEnabled([seg('seg-001', 0, 1), seg('seg-002', 1, 2)], 'seg-002');
    expect(r[0].enabled).toBe(true);
    expect(r[1].enabled).toBe(false);
  });
});

describe('mergeWithNext', () => {
  it('merges target with the following segment and nulls ttsAudio', () => {
    const a = seg('seg-001', 0, 2, { clicks: [click(0.5)] });
    const b = seg('seg-002', 2, 5, { clicks: [click(3)] });
    const r = mergeWithNext([a, b], 'seg-001');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('seg-001');
    expect(r[0].videoStart).toBe(0);
    expect(r[0].videoEnd).toBe(5);
    expect(r[0].correctedText).toBe('c-seg-001c-seg-002');
    expect(r[0].clicks).toHaveLength(2);
    expect(r[0].ttsAudio).toBeNull();
  });
  it('is a no-op on the last segment', () => {
    const segs = [seg('seg-001', 0, 2), seg('seg-002', 2, 5)];
    expect(mergeWithNext(segs, 'seg-002')).toEqual(segs);
  });
});

describe('splitAt', () => {
  it('splits at atTime: second text empty, both ttsAudio null, clicks partitioned', () => {
    const s = seg('seg-001', 0, 4, { clicks: [click(1), click(3)] });
    const r = splitAt([s], 'seg-001', 2, 'seg-NEW');
    expect(r).toHaveLength(2);
    expect(r[0].videoStart).toBe(0);
    expect(r[0].videoEnd).toBe(2);
    expect(r[0].correctedText).toBe('c-seg-001');
    expect(r[0].clicks.map((c) => c.t)).toEqual([1]);
    expect(r[0].ttsAudio).toBeNull();
    expect(r[1].id).toBe('seg-NEW');
    expect(r[1].videoStart).toBe(2);
    expect(r[1].videoEnd).toBe(4);
    expect(r[1].correctedText).toBe('');
    expect(r[1].originalText).toBe('');
    expect(r[1].clicks.map((c) => c.t)).toEqual([3]);
    expect(r[1].ttsAudio).toBeNull();
  });
  it('is a no-op when atTime is outside (videoStart, videoEnd)', () => {
    const s = [seg('seg-001', 0, 4)];
    expect(splitAt(s, 'seg-001', 0, 'x')).toEqual(s);
    expect(splitAt(s, 'seg-001', 4, 'x')).toEqual(s);
    expect(splitAt(s, 'seg-001', 5, 'x')).toEqual(s);
  });
});

describe('resizeBoundary', () => {
  const segs = () => [
    seg('seg-001', 0, 2),
    seg('seg-002', 2, 5),
    seg('seg-003', 5, 8),
  ];

  it('right-side drag of a middle segment moves the shared boundary in both', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'right', 6, 10);
    expect(r[1].videoEnd).toBe(6);
    expect(r[2].videoStart).toBe(6);
    expect(r[0]).toEqual(segs()[0]);
  });

  it('left-side drag of a middle segment moves the shared boundary in both', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'left', 1.5, 10);
    expect(r[1].videoStart).toBe(1.5);
    expect(r[0].videoEnd).toBe(1.5);
    expect(r[2]).toEqual(segs()[2]);
  });

  it('clamps the first segment left to 0', () => {
    const r = resizeBoundary(segs(), 'seg-001', 'left', -5, 10);
    expect(r[0].videoStart).toBe(0);
  });

  it('clamps the last segment right to duration', () => {
    const r = resizeBoundary(segs(), 'seg-003', 'right', 100, 10);
    expect(r[2].videoEnd).toBe(10);
  });

  it('right-side drag respects MIN_SEGMENT_DURATION on current segment', () => {
    // current videoStart=2, so right can go down to 2 + MIN
    const r = resizeBoundary(segs(), 'seg-002', 'right', 1.0, 10);
    expect(r[1].videoEnd).toBeCloseTo(2 + MIN_SEGMENT_DURATION);
    expect(r[2].videoStart).toBeCloseTo(2 + MIN_SEGMENT_DURATION);
  });

  it('right-side drag respects MIN_SEGMENT_DURATION on next segment', () => {
    // next videoEnd=8, so right can go up to 8 - MIN
    const r = resizeBoundary(segs(), 'seg-002', 'right', 100, 10);
    expect(r[1].videoEnd).toBeCloseTo(8 - MIN_SEGMENT_DURATION);
    expect(r[2].videoStart).toBeCloseTo(8 - MIN_SEGMENT_DURATION);
  });

  it('left-side drag respects MIN_SEGMENT_DURATION on current segment', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'left', 100, 10);
    expect(r[1].videoStart).toBeCloseTo(5 - MIN_SEGMENT_DURATION);
    expect(r[0].videoEnd).toBeCloseTo(5 - MIN_SEGMENT_DURATION);
  });

  it('left-side drag respects MIN_SEGMENT_DURATION on previous segment', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'left', -100, 10);
    expect(r[1].videoStart).toBeCloseTo(0 + MIN_SEGMENT_DURATION);
    expect(r[0].videoEnd).toBeCloseTo(0 + MIN_SEGMENT_DURATION);
  });

  it('preserves ttsAudio on both affected segments', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'right', 6, 10);
    expect(r[1].ttsAudio).toBe('tts/seg-002.wav');
    expect(r[2].ttsAudio).toBe('tts/seg-003.wav');
  });

  it('preserves clicks (does not redistribute on boundary move)', () => {
    const input = [
      seg('seg-001', 0, 2, { clicks: [click(0.5)] }),
      seg('seg-002', 2, 5, { clicks: [click(3)] }),
    ];
    const r = resizeBoundary(input, 'seg-001', 'right', 4, 10);
    expect(r[0].clicks.map((c) => c.t)).toEqual([0.5]);
    expect(r[1].clicks.map((c) => c.t)).toEqual([3]);
  });

  it('returns the same array when primaryId is not found', () => {
    const input = segs();
    expect(resizeBoundary(input, 'nope', 'right', 6, 10)).toBe(input);
  });
});
