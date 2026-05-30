import { describe, it, expect } from 'vitest';
import {
  groupTokensIntoPhrases,
  mapWhisperSegments,
  type WhisperSegment,
} from '../src/main/transcription/mapSegments';
import { type ClickEvent } from '../src/shared/types';

const voice = { speaker: 3, speed: 1.0 };
const segs: WhisperSegment[] = [
  { offsets: { from: 0, to: 1000 }, text: ' ここを' },
  { offsets: { from: 1000, to: 2000 }, text: 'クリック ' },
];
const click = (t: number): ClickEvent => ({ x: 1, y: 2, t, button: 1 });

describe('mapWhisperSegments', () => {
  it('maps offsets(ms) to seconds and zero-pads ids', () => {
    const out = mapWhisperSegments(segs, [], voice);
    expect(out.map((s) => s.id)).toEqual(['seg-001', 'seg-002']);
    expect(out[0].videoStart).toBe(0);
    expect(out[0].videoEnd).toBe(1);
    expect(out[1].videoStart).toBe(1);
  });

  it('trims text and copies it into both originalText and correctedText', () => {
    const out = mapWhisperSegments(segs, [], voice);
    expect(out[0].originalText).toBe('ここを');
    expect(out[0].correctedText).toBe('ここを');
    expect(out[1].originalText).toBe('クリック');
  });

  it('sets defaults: ttsAudio null, given voice, enabled true', () => {
    const out = mapWhisperSegments(segs, [], voice);
    expect(out[0].ttsAudio).toBeNull();
    expect(out[0].voice).toEqual(voice);
    expect(out[0].enabled).toBe(true);
  });

  it('assigns a click to the segment whose range contains it', () => {
    const out = mapWhisperSegments(segs, [click(1.5)], voice);
    expect(out[0].clicks).toHaveLength(0);
    expect(out[1].clicks).toHaveLength(1);
  });

  it('assigns a click on the exact boundary to the containing (later) segment', () => {
    const out = mapWhisperSegments(segs, [click(1.0)], voice);
    expect(out[0].clicks).toHaveLength(0);
    expect(out[1].clicks.map((c) => c.t)).toEqual([1.0]);
  });

  it('assigns a gap/edge click to the nearest segment', () => {
    const gappy: WhisperSegment[] = [
      { offsets: { from: 0, to: 1000 }, text: 'a' },
      { offsets: { from: 5000, to: 6000 }, text: 'b' },
    ];
    const out = mapWhisperSegments(gappy, [click(2), click(10), click(-1)], voice);
    expect(out[0].clicks.map((c) => c.t)).toEqual([2, -1]); // 2 nearer to [0,1]; -1 before all
    expect(out[1].clicks.map((c) => c.t)).toEqual([10]);    // after all -> last
  });

  it('returns [] and drops clicks when there are no segments', () => {
    expect(mapWhisperSegments([], [click(1)], voice)).toEqual([]);
  });
});

describe('groupTokensIntoPhrases', () => {
  // whisper --max-len 1 が返すトークン単位の実データの一部（句読点は独立トークン）。
  const tokens: WhisperSegment[] = [
    { offsets: { from: 0, to: 20 }, text: '' },
    { offsets: { from: 20, to: 870 }, text: ' じゃあ' },
    { offsets: { from: 870, to: 1250 }, text: 'もう' },
    { offsets: { from: 1250, to: 2000 }, text: '一回ね' },
    { offsets: { from: 2000, to: 2200 }, text: '、' },
    { offsets: { from: 2200, to: 2600 }, text: 'もし' },
    { offsets: { from: 2600, to: 2960 }, text: 'もし' },
    { offsets: { from: 2960, to: 3310 }, text: '、' },
    { offsets: { from: 3310, to: 5640 }, text: 'でクリックする' },
  ];

  it('merges subword tokens into one phrase per punctuation-delimited run', () => {
    const out = groupTokensIntoPhrases(tokens);
    expect(out.map((p) => p.text)).toEqual(['じゃあもう一回ね', 'もしもし', 'でクリックする']);
  });

  it('spans each phrase from its first content token to its last', () => {
    const out = groupTokensIntoPhrases(tokens);
    expect(out[0].offsets).toEqual({ from: 20, to: 2000 });
    expect(out[1].offsets).toEqual({ from: 2200, to: 2960 });
    expect(out[2].offsets).toEqual({ from: 3310, to: 5640 });
  });

  it('flushes a trailing phrase that has no closing punctuation', () => {
    const out = groupTokensIntoPhrases([
      { offsets: { from: 0, to: 500 }, text: 'あ' },
      { offsets: { from: 500, to: 600 }, text: '。' },
      { offsets: { from: 600, to: 900 }, text: 'い' },
    ]);
    expect(out.map((p) => p.text)).toEqual(['あ', 'い']);
    expect(out[1].offsets).toEqual({ from: 600, to: 900 });
  });

  it('returns [] for empty or punctuation-only input', () => {
    expect(groupTokensIntoPhrases([])).toEqual([]);
    expect(groupTokensIntoPhrases([{ offsets: { from: 0, to: 100 }, text: '、' }])).toEqual([]);
  });

  it('splits on a silence gap >= PHRASE_GAP_MS when no punctuation is present', () => {
    // ギャップが 700ms 以上なら句境界（句読点なしでも分割される）
    const out = groupTokensIntoPhrases([
      { offsets: { from: 0, to: 500 }, text: 'はい' },
      { offsets: { from: 500, to: 800 }, text: 'どうも' },
      // 800 → 1700 のギャップ = 900ms（>=700ms）→ ここで分割
      { offsets: { from: 1700, to: 2000 }, text: 'では' },
      { offsets: { from: 2000, to: 2500 }, text: '始めます' },
    ]);
    expect(out.map((p) => p.text)).toEqual(['はいどうも', 'では始めます']);
    expect(out[0].offsets).toEqual({ from: 0, to: 800 });
    expect(out[1].offsets).toEqual({ from: 1700, to: 2500 });
  });

  it('does not split on a gap shorter than PHRASE_GAP_MS', () => {
    // ギャップ 200ms（<700ms）は連続扱い
    const out = groupTokensIntoPhrases([
      { offsets: { from: 0, to: 500 }, text: 'あい' },
      { offsets: { from: 700, to: 1000 }, text: 'うえ' },
    ]);
    expect(out.map((p) => p.text)).toEqual(['あいうえ']);
  });

  it('combines gap and punctuation splits without double-flushing', () => {
    const out = groupTokensIntoPhrases([
      { offsets: { from: 0, to: 500 }, text: 'あい' },
      // 句読点で区切り
      { offsets: { from: 500, to: 600 }, text: '。' },
      // ギャップでも区切れる位置だが既に flush 済 → 1 つの新しい句が始まる
      { offsets: { from: 1500, to: 1800 }, text: 'うえ' },
    ]);
    expect(out.map((p) => p.text)).toEqual(['あい', 'うえ']);
  });

  it('splits before a token whose (from, to) range contains a silence mid', () => {
    // 実機 whisper の挙動: 隣接トークン間に gap が無く、無音が次トークンの duration に
    // 吸収されているケース。silence_mid 2210 は 2 番目のトークン (1900-4360) に含まれる。
    const tokens: WhisperSegment[] = [
      { offsets: { from: 40, to: 1900 }, text: 'これ' },
      { offsets: { from: 1900, to: 4360 }, text: 'あれ' },
      { offsets: { from: 4360, to: 4750 }, text: 'だ' },
    ];
    const out = groupTokensIntoPhrases(tokens, [2210]);
    expect(out.map((p) => p.text)).toEqual(['これ', 'あれだ']);
    expect(out[0].offsets).toEqual({ from: 40, to: 1900 });
    expect(out[1].offsets).toEqual({ from: 1900, to: 4750 });
  });

  it('flushes once when a silence mid lies in the gap between tokens', () => {
    // mid=1500 はどのトークンの (from,to) にも入らず、トークン1の後・トークン2の前
    // にある。前置 while で消化され、句境界として一度 flush する。
    const tokens: WhisperSegment[] = [
      { offsets: { from: 0, to: 1000 }, text: 'はい' },
      { offsets: { from: 2000, to: 2500 }, text: 'では' },
    ];
    const out = groupTokensIntoPhrases(tokens, [1500]);
    expect(out.map((p) => p.text)).toEqual(['はい', 'では']);
  });

  it('uses every silence mid even when multiple long tokens absorb silence', () => {
    const tokens: WhisperSegment[] = [
      { offsets: { from: 0, to: 1000 }, text: 'A' },
      { offsets: { from: 1000, to: 3000 }, text: 'B' }, // mid=2000 入る
      { offsets: { from: 3000, to: 5000 }, text: 'C' }, // mid=4000 入る
      { offsets: { from: 5000, to: 6000 }, text: 'D' },
    ];
    const out = groupTokensIntoPhrases(tokens, [2000, 4000]);
    expect(out.map((p) => p.text)).toEqual(['A', 'B', 'CD']);
  });

  it('ignores silence mids that fall entirely after all tokens', () => {
    const tokens: WhisperSegment[] = [
      { offsets: { from: 0, to: 500 }, text: 'あ' },
      { offsets: { from: 500, to: 1000 }, text: 'い' },
    ];
    const out = groupTokensIntoPhrases(tokens, [9999]);
    expect(out.map((p) => p.text)).toEqual(['あい']);
  });

  it('does not double-flush when silence mid and punctuation align', () => {
    // 句読点でまず flush、続いて silence mid=600 (空 buffer) は no-op。
    const tokens: WhisperSegment[] = [
      { offsets: { from: 0, to: 500 }, text: 'あ' },
      { offsets: { from: 500, to: 700 }, text: '。' },
      { offsets: { from: 700, to: 1200 }, text: 'い' },
    ];
    const out = groupTokensIntoPhrases(tokens, [600]);
    expect(out.map((p) => p.text)).toEqual(['あ', 'い']);
  });

  it('accepts unsorted silence mids and still splits correctly', () => {
    const tokens: WhisperSegment[] = [
      { offsets: { from: 0, to: 1000 }, text: 'A' },
      { offsets: { from: 1000, to: 3000 }, text: 'B' },
      { offsets: { from: 3000, to: 5000 }, text: 'C' },
    ];
    const out = groupTokensIntoPhrases(tokens, [4000, 2000]);
    expect(out.map((p) => p.text)).toEqual(['A', 'B', 'C']);
  });
});
