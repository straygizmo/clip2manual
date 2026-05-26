import { describe, it, expect } from 'vitest';
import { parseProgress } from '../src/main/transcription/progress';

describe('parseProgress', () => {
  it('extracts percent from a whisper progress line', () => {
    expect(parseProgress('whisper_print_progress_callback: progress =  50%')).toBe(50);
  });
  it('handles 0 and 100', () => {
    expect(parseProgress('progress = 0%')).toBe(0);
    expect(parseProgress('progress = 100%')).toBe(100);
  });
  it('returns null for unrelated lines', () => {
    expect(parseProgress('whisper_full: something')).toBeNull();
    expect(parseProgress('')).toBeNull();
  });
});
