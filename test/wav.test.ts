import { describe, it, expect } from 'vitest';
import { encodeWav } from '../src/shared/wav';

function tag(buf: ArrayBuffer, offset: number): string {
  const b = new Uint8Array(buf, offset, 4);
  return String.fromCharCode(b[0], b[1], b[2], b[3]);
}

describe('encodeWav', () => {
  it('produces a 44-byte header plus 2 bytes per sample', () => {
    const buf = encodeWav(new Float32Array(3), 16000);
    expect(buf.byteLength).toBe(44 + 3 * 2);
  });

  it('writes RIFF/WAVE/data tags', () => {
    const buf = encodeWav(new Float32Array(1), 16000);
    expect(tag(buf, 0)).toBe('RIFF');
    expect(tag(buf, 8)).toBe('WAVE');
    expect(tag(buf, 36)).toBe('data');
  });

  it('writes mono / 16-bit / given sample rate in the fmt chunk', () => {
    const buf = encodeWav(new Float32Array(0), 16000);
    const view = new DataView(buf);
    expect(tag(buf, 12)).toBe('fmt ');
    expect(view.getUint16(22, true)).toBe(1);      // channels
    expect(view.getUint32(24, true)).toBe(16000);  // sample rate
    expect(view.getUint32(28, true)).toBe(32000);  // byte rate
    expect(view.getUint16(32, true)).toBe(2);      // block align
    expect(view.getUint16(34, true)).toBe(16);     // bits per sample
  });

  it('converts and clamps float samples to signed 16-bit PCM', () => {
    const view = new DataView(encodeWav(new Float32Array([0, 1, -1, 1.5]), 16000));
    expect(view.getInt16(44 + 0, true)).toBe(0);
    expect(view.getInt16(44 + 2, true)).toBe(32767);
    expect(view.getInt16(44 + 4, true)).toBe(-32768);
    expect(view.getInt16(44 + 6, true)).toBe(32767); // over-range 1.5 clamped to 1.0 -> 32767
  });
});
