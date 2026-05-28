import { describe, it, expect } from 'vitest';
import { wrapJapanese } from '../src/main/export/subtitleWrap';

describe('wrapJapanese', () => {
  it('returns empty array for empty string', () => {
    expect(wrapJapanese('', 10, 3)).toEqual([]);
    expect(wrapJapanese('   ', 10, 3)).toEqual([]);
  });

  it('returns a single line when within maxCols (halfwidth)', () => {
    expect(wrapJapanese('hello', 10, 3)).toEqual(['hello']);
  });

  it('wraps halfwidth text at maxCols boundary', () => {
    expect(wrapJapanese('abcdefghij', 5, 3)).toEqual(['abcde', 'fghij']);
  });

  it('counts fullwidth chars as 2 columns', () => {
    // 「あいう」= 6 cols, maxCols=5 → 「あい」(4) + 「う」(2)
    expect(wrapJapanese('あいう', 5, 3)).toEqual(['あい', 'う']);
  });

  it('handles mixed halfwidth/fullwidth', () => {
    // 「ab漢字cd」: a=1, b=1, 漢=2, 字=2, c=1, d=1 (total 8). maxCols=5 → 'ab漢' (4) + '字cd' (4)
    expect(wrapJapanese('ab漢字cd', 5, 3)).toEqual(['ab漢', '字cd']);
  });

  it('truncates with ellipsis when exceeding maxLines', () => {
    const out = wrapJapanese('aaaaabbbbbcccccddddd', 5, 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('aaaaa');
    expect(out[1]).toBe('bbbbb');
    expect(out[2].endsWith('…')).toBe(true);
  });

  it('preserves emoji as one grapheme (counted as 2 cols)', () => {
    // 「a😀b」: a=1, 😀=2, b=1 (total 4). maxCols=5 → 1 line
    expect(wrapJapanese('a😀b', 5, 3)).toEqual(['a😀b']);
    // maxCols=3 → 'a😀' (3) + 'b' (1)
    expect(wrapJapanese('a😀b', 3, 3)).toEqual(['a😀', 'b']);
  });
});
