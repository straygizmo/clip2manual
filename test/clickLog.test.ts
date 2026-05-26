import { describe, it, expect } from 'vitest';
import { buildClickLog, type RawClickEvent } from '../src/shared/clickLog';
import { type CaptureGeometry } from '../src/shared/coordinateTransform';

const geometry: CaptureGeometry = {
  displayOriginX: 0, displayOriginY: 0,
  displayWidth: 1920, displayHeight: 1080,
  videoWidth: 1920, videoHeight: 1080,
};

const raw = (osX: number, osY: number, timestampMs: number): RawClickEvent => ({
  osX, osY, button: 1, timestampMs,
});

describe('buildClickLog', () => {
  it('converts absolute timestamps to seconds relative to t0', () => {
    const log = buildClickLog([raw(100, 200, 1500)], 1000, geometry);
    expect(log).toEqual([{ x: 100, y: 200, t: 0.5, button: 1 }]);
  });

  it('drops events that occur before t0', () => {
    const log = buildClickLog([raw(100, 200, 900), raw(100, 200, 1100)], 1000, geometry);
    expect(log).toHaveLength(1);
    expect(log[0].t).toBeCloseTo(0.1);
  });

  it('drops clicks outside the captured display', () => {
    const log = buildClickLog([raw(5000, 200, 2000)], 1000, geometry);
    expect(log).toEqual([]);
  });

  it('preserves order of valid events', () => {
    const log = buildClickLog([raw(10, 10, 1100), raw(20, 20, 1200)], 1000, geometry);
    expect(log.map((e) => e.x)).toEqual([10, 20]);
  });

  it('keeps a click that happens exactly at t0 (t = 0)', () => {
    const log = buildClickLog([raw(100, 200, 1000)], 1000, geometry);
    expect(log).toHaveLength(1);
    expect(log[0].t).toBe(0);
  });
});
