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

  it('keeps truncated line within maxCols when ellipsis would overflow', () => {
    // 'あいうえお' = 10 cols. maxCols=5, maxLines=1 → triggers truncation.
    // Without the fix, would emit 'あ…' (4 cols) — fine in this case.
    // But with a longer first line that has cols=5 exactly: e.g. text 'あいう' wraps as ['あい','う'] (no truncation).
    // Force truncation past maxLines:
    const out = wrapJapanese('あいうえお', 5, 1);
    expect(out).toHaveLength(1);
    // Verify final line never exceeds maxCols=5
    // colWidth of 'あ…' = 2+2 = 4 ≤ 5; 'あい…' = 2+2+2 = 6 > 5 (must NOT be emitted)
    expect(out[0]).toBe('あ…');
  });

  it('iteratively pops graphemes when ellipsis would push line past maxCols', () => {
    // text 'aaaaa' (5 cols), force truncation to 1 line: ellipsis is 2 cols
    // raw lastLine = 'aaaaa' (5 cols). 5 + 2 = 7 > 5. Pop 'a' → 4+2=6 > 5. Pop again → 3+2=5 ≤ 5. → 'aaa…'
    const out = wrapJapanese('aaaaabbbbb', 5, 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('aaa…');
  });
});
