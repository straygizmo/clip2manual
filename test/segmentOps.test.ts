import { describe, it, expect } from 'vitest';
import { toggleEnabled, mergeWithNext, splitAt } from '../src/renderer/state/segmentOps';
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
