import { describe, it, expect } from 'vitest';
import { osToVideoCoords, isWithinDisplay, type CaptureGeometry } from '../src/shared/coordinateTransform';

const single: CaptureGeometry = {
  displayOriginX: 0, displayOriginY: 0,
  displayWidth: 1920, displayHeight: 1080,
  videoWidth: 1920, videoHeight: 1080,
};

const hidpi: CaptureGeometry = {
  displayOriginX: 0, displayOriginY: 0,
  displayWidth: 1280, displayHeight: 720,
  videoWidth: 2560, videoHeight: 1440,
};

const secondMonitor: CaptureGeometry = {
  displayOriginX: 1920, displayOriginY: 0,
  displayWidth: 1920, displayHeight: 1080,
  videoWidth: 1920, videoHeight: 1080,
};

describe('osToVideoCoords', () => {
  it('maps 1:1 when display and video match', () => {
    expect(osToVideoCoords(960, 540, single)).toEqual({ x: 960, y: 540 });
  });

  it('scales up for HiDPI capture', () => {
    expect(osToVideoCoords(640, 360, hidpi)).toEqual({ x: 1280, y: 720 });
  });

  it('subtracts the display origin for a second monitor', () => {
    expect(osToVideoCoords(2880, 540, secondMonitor)).toEqual({ x: 960, y: 540 });
  });
});

describe('isWithinDisplay', () => {
  it('returns true for a point inside the display', () => {
    expect(isWithinDisplay(100, 100, single)).toBe(true);
  });

  it('returns false for a point on another monitor', () => {
    expect(isWithinDisplay(2000, 100, single)).toBe(false);
  });

  it('treats the far edges as outside (half-open range)', () => {
    expect(isWithinDisplay(1920, 0, single)).toBe(false);
    expect(isWithinDisplay(0, 1080, single)).toBe(false);
  });
});
