import { describe, it, expect } from 'vitest';
import { activeRipplesAt, type ActiveRippleVisual } from '../src/main/export/rippleFrames';
import { type ClickEvent } from '../src/shared/types';
import { type PreviewSlot } from '../src/shared/previewTimeline';

const slot: PreviewSlot = {
  segmentId: 'seg-001', slotStart: 0, slotDuration: 3,
  videoStart: 1, videoEnd: 2, clipDuration: 2.5,
};
const w = 1920; // 仮想映像幅
// 期待値の事前計算
// maxR = w * (1/12) = 160
// ringSW = max(2, w/400) = max(2, 4.8) = 4.8
// dotR = max(3, w/320) = max(3, 6) = 6

function click(t: number, x = 100, y = 200): ClickEvent {
  return { t, x, y, button: 1 };
}

describe('activeRipplesAt', () => {
  it('returns no ripples when no clicks are in the slot', () => {
    expect(activeRipplesAt([], slot, 0.5, w)).toEqual([]);
  });

  it('ignores clicks outside the slot video range', () => {
    // c.t <= videoStart or c.t > videoEnd are filtered out
    expect(activeRipplesAt([click(0.5)], slot, 0.5, w)).toEqual([]);
    expect(activeRipplesAt([click(1.0)], slot, 0.5, w)).toEqual([]); // boundary: c.t === videoStart is excluded
    expect(activeRipplesAt([click(2.5)], slot, 0.5, w)).toEqual([]); // after videoEnd
  });

  it('includes a click that fires exactly at tSlot (elapsed 0, alpha 1)', () => {
    // click at c.t = 1.5 → fireTimeSlot = 0.5; tSlot = 0.5 → elapsed = 0
    const out = activeRipplesAt([click(1.5)], slot, 0.5, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(1);
    expect(out[0].ringRadius).toBe(2); // max(2, 0 * maxR) = 2
    expect(out[0].dotRadius).toBeCloseTo(6);
    expect(out[0].ringStrokeWidth).toBeCloseTo(4.8);
    expect(out[0].x).toBe(100);
    expect(out[0].y).toBe(200);
  });

  it('computes mid-animation values at half duration', () => {
    // fireTimeSlot = 0.5; tSlot = 0.5 + 0.4 = 0.9 → elapsed = 0.4 (half of 0.8)
    const out = activeRipplesAt([click(1.5)], slot, 0.9, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(0.5);
    expect(out[0].ringRadius).toBeCloseTo(0.5 * 160); // k * maxR = 80
  });

  it('drops a ripple once elapsed >= RIPPLE_DURATION', () => {
    // fireTimeSlot = 0.5; tSlot = 0.5 + 0.8 = 1.3 → elapsed = 0.8 (expired)
    expect(activeRipplesAt([click(1.5)], slot, 1.3, w)).toEqual([]);
  });

  it('keeps a ripple alive into the freeze region (tSlot > videoSpan)', () => {
    // videoSpan = 1; click at c.t = 1.9 → fireTimeSlot = 0.9
    // tSlot = 1.2 (in freeze, since slotDuration=3 > videoSpan=1) → elapsed = 0.3
    const out = activeRipplesAt([click(1.9)], slot, 1.2, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(1 - 0.3 / 0.8, 3);
  });

  it('returns multiple actives when their windows overlap', () => {
    const out = activeRipplesAt([click(1.2), click(1.6)], slot, 1.7, w);
    // c1: fireTimeSlot=0.2, elapsed=1.5 → expired
    // c2: fireTimeSlot=0.6, elapsed=1.1 → expired
    expect(out).toHaveLength(0);
    const out2 = activeRipplesAt([click(1.2), click(1.6)], slot, 1.3, w);
    // c1: fireTimeSlot=0.2, elapsed=1.1 → expired
    // c2: fireTimeSlot=0.6, elapsed=0.7 → active
    expect(out2).toHaveLength(1);
    const out3 = activeRipplesAt([click(1.2), click(1.6)], slot, 0.9, w);
    // c1: fireTimeSlot=0.2, elapsed=0.7 → active
    // c2: fireTimeSlot=0.6, elapsed=0.3 → active
    expect(out3).toHaveLength(2);
  });
});
