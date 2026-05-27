import { describe, it, expect } from 'vitest';
import { computePreviewTimeline, previewTotalDuration, TAIL_PAUSE } from '../src/shared/previewTimeline';
import { type Segment } from '../src/shared/types';

function seg(id: string, start: number, end: number): Segment {
  return {
    id, videoStart: start, videoEnd: end, originalText: '', correctedText: '',
    ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}

describe('computePreviewTimeline', () => {
  it('returns [] for no segments', () => {
    expect(computePreviewTimeline([], new Map())).toEqual([]);
  });

  it('uses videoSpan + TAIL_PAUSE when there is no clip', () => {
    const slots = computePreviewTimeline([seg('seg-001', 0, 2)], new Map());
    expect(slots[0].slotStart).toBe(0);
    expect(slots[0].clipDuration).toBe(0);
    expect(slots[0].slotDuration).toBeCloseTo(2 + TAIL_PAUSE);
  });

  it('uses clip length when the clip is longer than the video span', () => {
    const slots = computePreviewTimeline([seg('seg-001', 0, 2)], new Map([['seg-001', 5]]));
    expect(slots[0].slotDuration).toBeCloseTo(5 + TAIL_PAUSE);
  });

  it('uses video span when the clip is shorter', () => {
    const slots = computePreviewTimeline([seg('seg-001', 0, 4)], new Map([['seg-001', 1]]));
    expect(slots[0].slotDuration).toBeCloseTo(4 + TAIL_PAUSE);
  });

  it('accumulates slotStart and computes total duration', () => {
    const slots = computePreviewTimeline(
      [seg('seg-001', 0, 2), seg('seg-002', 2, 5)],
      new Map([['seg-001', 3], ['seg-002', 1]]),
    );
    expect(slots[0].slotStart).toBe(0);
    expect(slots[0].slotDuration).toBeCloseTo(3 + TAIL_PAUSE);
    expect(slots[1].slotStart).toBeCloseTo(3 + TAIL_PAUSE);
    expect(slots[1].slotDuration).toBeCloseTo(3 + TAIL_PAUSE);
    expect(previewTotalDuration(slots)).toBeCloseTo((3 + TAIL_PAUSE) * 2);
  });
});
