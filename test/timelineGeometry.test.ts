import { describe, it, expect } from 'vitest';
import { segmentRect, timeToPercent } from '../src/renderer/editor/timelineGeometry';

describe('timeToPercent', () => {
  it('maps time to a percentage of duration', () => {
    expect(timeToPercent(5, 10)).toBe(50);
  });
  it('returns 0 for non-positive duration', () => {
    expect(timeToPercent(5, 0)).toBe(0);
  });
  it('clamps to [0,100]', () => {
    expect(timeToPercent(-1, 10)).toBe(0);
    expect(timeToPercent(20, 10)).toBe(100);
  });
});

describe('segmentRect', () => {
  it('returns left/width as percentages', () => {
    expect(segmentRect(0, 5, 10)).toEqual({ left: 0, width: 50 });
    expect(segmentRect(5, 10, 10)).toEqual({ left: 50, width: 50 });
  });
  it('clamps a segment that runs past the duration', () => {
    expect(segmentRect(8, 15, 10)).toEqual({ left: 80, width: 20 });
  });
  it('returns zero width for non-positive duration', () => {
    expect(segmentRect(0, 5, 0)).toEqual({ left: 0, width: 0 });
  });
});
