import { describe, it, expect } from 'vitest';
import {
  groupTokensIntoPhrases,
  mapWhisperSegments,
  clampSegmentsToDuration,
  type WhisperSegment,
} from '../src/main/transcription/mapSegments';
import { type ClickEvent, type Segment } from '../src/shared/types';

function seg(id: string, start: number, end: number): Segment {
  return {
    id, videoStart: start, videoEnd: end, originalText: `o-${id}`, correctedText: `c-${id}`,
    ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}

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

  it('splits AFTER the silence-absorbing token when the mid lies inside it', () => {
    // whisper は「音→無音」の順で timestamp を伸ばすため、silence は token の後半に
    // 入っていることが多い。よって mid 含有トークンの直後で句を切る。
    const tokens: WhisperSegment[] = [
      { offsets: { from: 40, to: 1900 }, text: 'これ' },
      { offsets: { from: 1900, to: 4360 }, text: 'あれ' }, // 2460ms 長: silence 吸収
      { offsets: { from: 4360, to: 4750 }, text: 'だ' },
    ];
    const out = groupTokensIntoPhrases(tokens, [2210]);
    expect(out.map((p) => p.text)).toEqual(['これあれ', 'だ']);
    expect(out[0].offsets).toEqual({ from: 40, to: 4360 });
    expect(out[1].offsets).toEqual({ from: 4360, to: 4750 });
  });

  it('expands the split point forward through adjacent long tokens', () => {
    // 実機ケース再現: 「左上クリック」+ 無音 + 「最初か」を whisper が
    // ク (短) / リ (長) / ック (長) / 最 (短) として返す。mid が「リ」に入っても、
    // 後続「ック」も長いので前方に拡張し、最後の long の後 (= ック の後) で切る。
    const tokens: WhisperSegment[] = [
      { offsets: { from: 0, to: 200 }, text: '左' },
      { offsets: { from: 200, to: 1000 }, text: '上' },
      { offsets: { from: 1000, to: 1500 }, text: 'ク' },
      { offsets: { from: 1500, to: 2700 }, text: 'リ' },   // 1200ms 長
      { offsets: { from: 2700, to: 4100 }, text: 'ック' }, // 1400ms 長
      { offsets: { from: 4100, to: 4600 }, text: '最' },   // 短
      { offsets: { from: 4600, to: 5100 }, text: '初' },
    ];
    const out = groupTokensIntoPhrases(tokens, [2000]); // mid は「リ」内
    expect(out.map((p) => p.text)).toEqual(['左上クリック', '最初']);
  });

  it('flushes once when a silence mid lies in the gap between tokens', () => {
    // mid=1500 はどのトークンの (from,to) にも入らない。直前トークン (はい) の後で切る。
    const tokens: WhisperSegment[] = [
      { offsets: { from: 0, to: 1000 }, text: 'はい' },
      { offsets: { from: 2000, to: 2500 }, text: 'では' },
    ];
    const out = groupTokensIntoPhrases(tokens, [1500]);
    expect(out.map((p) => p.text)).toEqual(['はい', 'では']);
  });

  it('separates silences across distinct long-token clusters', () => {
    // 短いトークンで仕切られた 2 つの long クラスタにそれぞれ silence がある場合、
    // クラスタごとに 1 つずつ flush して 3 句に分ける。
    const tokens: WhisperSegment[] = [
      { offsets: { from: 0, to: 500 }, text: 'A' },
      { offsets: { from: 500, to: 2000 }, text: 'B' },   // 1500ms 長
      { offsets: { from: 2000, to: 2500 }, text: 'C' },  // 短
      { offsets: { from: 2500, to: 4000 }, text: 'D' },  // 1500ms 長
      { offsets: { from: 4000, to: 4500 }, text: 'E' },
    ];
    const out = groupTokensIntoPhrases(tokens, [1200, 3000]);
    expect(out.map((p) => p.text)).toEqual(['AB', 'CD', 'E']);
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
    // 句読点でまず flush、続いて silence-after も (空 buffer なので) no-op。
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
      { offsets: { from: 0, to: 500 }, text: 'A' },
      { offsets: { from: 500, to: 2000 }, text: 'B' },
      { offsets: { from: 2000, to: 2500 }, text: 'C' },
      { offsets: { from: 2500, to: 4000 }, text: 'D' },
      { offsets: { from: 4000, to: 4500 }, text: 'E' },
    ];
    const out = groupTokensIntoPhrases(tokens, [3000, 1200]);
    expect(out.map((p) => p.text)).toEqual(['AB', 'CD', 'E']);
  });
});

describe('clampSegmentsToDuration', () => {
  it('clamps the last segment when it overruns the video duration', () => {
    const r = clampSegmentsToDuration([seg('a', 0, 2), seg('b', 2, 5.5)], 5);
    expect(r).toHaveLength(2);
    expect(r[1].videoEnd).toBe(5);
  });

  it('drops segments that start at or past the video duration', () => {
    const r = clampSegmentsToDuration([seg('a', 0, 5), seg('b', 6, 7)], 5);
    expect(r.map((s) => s.id)).toEqual(['a']);
  });

  it('returns input unchanged when nothing overruns', () => {
    const segs = [seg('a', 0, 2), seg('b', 2, 5)];
    const r = clampSegmentsToDuration(segs, 5);
    expect(r).toBe(segs);
  });

  it('returns input unchanged for non-positive or non-finite duration', () => {
    const segs = [seg('a', 0, 5)];
    expect(clampSegmentsToDuration(segs, 0)).toBe(segs);
    expect(clampSegmentsToDuration(segs, Number.NaN)).toBe(segs);
    expect(clampSegmentsToDuration(segs, Infinity)).toBe(segs);
  });

  it('clamps a segment whose start is negative', () => {
    const r = clampSegmentsToDuration([seg('a', -0.5, 2)], 5);
    expect(r[0].videoStart).toBe(0);
    expect(r[0].videoEnd).toBe(2);
  });
});
