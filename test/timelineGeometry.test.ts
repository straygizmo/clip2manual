import { describe, it, expect } from 'vitest';
import {
  segmentRect, timeToPercent,
  timeToPx, pxToTime, segmentBox,
  clampZoom, applyZoomAtPoint,
  pickMajorInterval, formatTimeLabel,
  shouldAutoScroll,
} from '../src/renderer/editor/timelineGeometry';

describe('timeToPercent', () => {
  it('maps time to a percentage of duration', () => {
    expect(timeToPercent(5, 10)).toBe(50);
  });
  it('returns 0 for non-positive duration', () => {
    expect(timeToPercent(5, 0)).toBe(0);
  });
  it('returns 0 for a non-finite duration (e.g. Infinity from a metadata-less WebM)', () => {
    expect(timeToPercent(5, Infinity)).toBe(0);
    expect(timeToPercent(5, NaN)).toBe(0);
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
  it('returns zero width for a non-finite duration', () => {
    expect(segmentRect(0, 5, NaN)).toEqual({ left: 0, width: 0 });
  });
});

describe('timeToPx / pxToTime', () => {
  it('timeToPx multiplies time by pxPerSec', () => {
    expect(timeToPx(2, 100)).toBe(200);
  });
  it('pxToTime is the inverse', () => {
    expect(pxToTime(200, 100)).toBe(2);
  });
  it('returns 0 for non-positive pxPerSec', () => {
    expect(timeToPx(2, 0)).toBe(0);
    expect(pxToTime(200, 0)).toBe(0);
  });
});

describe('segmentBox', () => {
  it('returns left/width in pixels', () => {
    expect(segmentBox(1, 3, 100)).toEqual({ left: 100, width: 200 });
  });
  it('clamps negative left to 0', () => {
    expect(segmentBox(-1, 2, 100)).toEqual({ left: 0, width: 200 });
  });
  it('returns zero width for non-positive pxPerSec', () => {
    expect(segmentBox(0, 5, 0)).toEqual({ left: 0, width: 0 });
  });
});

describe('clampZoom', () => {
  it('clamps to [fit, max]', () => {
    expect(clampZoom(50, 10, 400)).toBe(50);
    expect(clampZoom(5, 10, 400)).toBe(10);
    expect(clampZoom(1000, 10, 400)).toBe(400);
  });
});

describe('applyZoomAtPoint', () => {
  it('keeps the time under the mouse fixed when zooming in', () => {
    const r = applyZoomAtPoint({
      oldPxPerSec: 100, newPxPerSec: 200,
      scrollLeft: 200, mouseOffsetPx: 100,
    });
    expect(r.pxPerSec).toBe(200);
    expect(r.scrollLeft).toBe(500);
  });
  it('returns the same scrollLeft when pxPerSec does not change', () => {
    const r = applyZoomAtPoint({
      oldPxPerSec: 100, newPxPerSec: 100,
      scrollLeft: 200, mouseOffsetPx: 100,
    });
    expect(r.scrollLeft).toBe(200);
  });
  it('handles mouse at left edge (offset=0)', () => {
    const r = applyZoomAtPoint({
      oldPxPerSec: 100, newPxPerSec: 200,
      scrollLeft: 200, mouseOffsetPx: 0,
    });
    expect(r.scrollLeft).toBe(400);
  });
});

describe('pickMajorInterval', () => {
  it('picks 0.1 when 80px fits in 0.1s', () => {
    expect(pickMajorInterval(800)).toBe(0.1);
  });
  it('picks 10 when pxPerSec=10 (10*10=100 >= 80)', () => {
    expect(pickMajorInterval(10)).toBe(10);
  });
  it('picks 120 when pxPerSec=1 (60*1=60 < 80, 120*1=120 >= 80)', () => {
    expect(pickMajorInterval(1)).toBe(120);
  });
  it('falls back to 600 for very small pxPerSec', () => {
    expect(pickMajorInterval(0.05)).toBe(600);
  });
});

describe('formatTimeLabel', () => {
  it('formats mm:ss with zero padding', () => {
    expect(formatTimeLabel(0)).toBe('0:00');
    expect(formatTimeLabel(5)).toBe('0:05');
    expect(formatTimeLabel(59)).toBe('0:59');
    expect(formatTimeLabel(60)).toBe('1:00');
    expect(formatTimeLabel(125)).toBe('2:05');
    expect(formatTimeLabel(3600)).toBe('60:00');
  });
  it('floors fractional seconds', () => {
    expect(formatTimeLabel(5.9)).toBe('0:05');
  });
});

describe('shouldAutoScroll', () => {
  it('returns null when playhead is within view', () => {
    expect(shouldAutoScroll({ playheadPx: 500, viewLeft: 0, viewWidth: 1000, margin: 40 })).toBeNull();
  });
  it('returns playheadPx - margin when playhead approaches right edge', () => {
    expect(shouldAutoScroll({ playheadPx: 970, viewLeft: 0, viewWidth: 1000, margin: 40 })).toBe(930);
  });
  it('returns max(0, playheadPx - margin) when playhead is left of view', () => {
    expect(shouldAutoScroll({ playheadPx: 100, viewLeft: 500, viewWidth: 1000, margin: 40 })).toBe(60);
    expect(shouldAutoScroll({ playheadPx: 20, viewLeft: 500, viewWidth: 1000, margin: 40 })).toBe(0);
  });
});
