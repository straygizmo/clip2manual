import { describe, it, expect } from 'vitest';
import { parseHwndFromSourceId } from '../src/main/native/winBounds';

describe('parseHwndFromSourceId', () => {
  it('parses a decimal HWND from "window:HWND:..." form', () => {
    expect(parseHwndFromSourceId('window:12345:0')).toBe(12345n);
  });
  it('parses long HWNDs (64-bit ranges)', () => {
    expect(parseHwndFromSourceId('window:9876543210:1')).toBe(9876543210n);
  });
  it('throws on screen sources', () => {
    expect(() => parseHwndFromSourceId('screen:0:0')).toThrow();
  });
  it('throws on malformed ids', () => {
    expect(() => parseHwndFromSourceId('window:abc:0')).toThrow();
    expect(() => parseHwndFromSourceId('window:')).toThrow();
    expect(() => parseHwndFromSourceId('')).toThrow();
  });
});
