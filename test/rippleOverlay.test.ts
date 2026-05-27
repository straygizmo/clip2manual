import { describe, it, expect } from 'vitest';
import { clicksCrossed, rippleProgress, RIPPLE_DURATION } from '../src/renderer/editor/rippleOverlay';

describe('clicksCrossed', () => {
  const clicks = [{ t: 1 }, { t: 2 }, { t: 3 }];
  it('returns clicks with prevT < t <= currT (forward)', () => {
    expect(clicksCrossed(clicks, 0.5, 2)).toEqual([{ t: 1 }, { t: 2 }]);
  });
  it('excludes t === prevT, includes t === currT', () => {
    expect(clicksCrossed(clicks, 1, 2)).toEqual([{ t: 2 }]);
  });
  it('returns [] when not advancing (currT <= prevT)', () => {
    expect(clicksCrossed(clicks, 2, 2)).toEqual([]);
    expect(clicksCrossed(clicks, 3, 1)).toEqual([]);
  });
});

describe('rippleProgress', () => {
  it('starts at radius01 0, alpha 1', () => {
    expect(rippleProgress(0)).toEqual({ radius01: 0, alpha: 1 });
  });
  it('is half-way at half the duration', () => {
    const p = rippleProgress(RIPPLE_DURATION / 2);
    expect(p).not.toBeNull();
    expect(p!.radius01).toBeCloseTo(0.5);
    expect(p!.alpha).toBeCloseTo(0.5);
  });
  it('returns null once elapsed >= duration', () => {
    expect(rippleProgress(RIPPLE_DURATION)).toBeNull();
    expect(rippleProgress(RIPPLE_DURATION + 1)).toBeNull();
  });
});
