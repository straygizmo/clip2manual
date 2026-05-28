import { describe, it, expect } from 'vitest';
import { checkStatus, apportionPercent } from '../src/main/provision/status';

describe('checkStatus', () => {
  it('maps each probe to provisioned=true unless it throws', () => {
    const r = checkStatus({
      whisper: () => {},
      voicevox: () => { throw new Error('not provisioned'); },
      ffmpeg: () => {},
    });
    expect(r).toEqual({ whisper: true, voicevox: false, ffmpeg: true });
  });
});

describe('apportionPercent', () => {
  it('maps a step + its inner percent onto the overall 0..100', () => {
    expect(apportionPercent(0, 2, 0)).toBe(0);
    expect(apportionPercent(0, 2, 100)).toBe(50);
    expect(apportionPercent(0, 2, 50)).toBe(25);
    expect(apportionPercent(1, 2, 0)).toBe(50);
    expect(apportionPercent(1, 2, 100)).toBe(100);
  });
  it('clamps and handles zero steps', () => {
    expect(apportionPercent(0, 0, 50)).toBe(100);
    expect(apportionPercent(1, 2, 200)).toBe(100);
  });
});
