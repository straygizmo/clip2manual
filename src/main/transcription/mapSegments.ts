import { type ClickEvent, type Segment, type SegmentVoice } from '../../shared/types';

export interface WhisperSegment {
  offsets: { from: number; to: number }; // ミリ秒
  text: string;
}

export interface WhisperJson {
  transcription: WhisperSegment[];
}

/** 句・文の区切りとして扱う文字（日本語・ASCII）。 */
const PHRASE_DELIMITERS = /^[、。，．！？!?,.…]+$/;

/** トークン間の無音ギャップ（ミリ秒）。これ以上空くと句境界として扱う。
 *  whisper のモデル・言語によっては句読点が出力されないケースがあるため、
 *  自然な発話間ポーズで分割する fallback。 */
export const PHRASE_GAP_MS = 700;

/** 単一トークンの duration がこの値を超えると「無音吸収トークン」候補とみなす（ミリ秒）。
 *  普通に発声した一音節は通常 1000ms 未満で、それを超えるのは silence が timestamp に
 *  吸収された場合がほとんど。 */
const LONG_TOKEN_MS = 1000;

/**
 * 句境界として「flush-after」すべき content-index の集合を計算する。
 *
 * 各無音 mid について:
 *  - mid が content[idx] の (from, to) の内側に入る → そのトークン + そこから前方に
 *    連続する LONG トークン群（連続する無音吸収帯）の **最後** で flush する。
 *    whisper は「音 → 無音」の順に timestamp を延ばす傾向があるので、
 *    クラスタ末尾で切ると単語の途中で切れにくい。
 *  - mid がどのトークンにも入らない（トークン間ギャップ）→ mid 直前の最後の
 *    トークンの後で flush する。
 */
function computeSilenceSplits(content: WhisperSegment[], mids: number[]): Set<number> {
  const out = new Set<number>();
  for (const mid of [...mids].sort((a, b) => a - b)) {
    const idx = content.findIndex(
      (t) => t.offsets.from <= mid && mid < t.offsets.to,
    );
    if (idx >= 0) {
      let end = idx;
      while (
        end + 1 < content.length &&
        content[end + 1].offsets.to - content[end + 1].offsets.from > LONG_TOKEN_MS
      ) {
        end++;
      }
      out.add(end);
    } else {
      const next = content.findIndex((t) => t.offsets.from > mid);
      if (next > 0) out.add(next - 1);
    }
  }
  return out;
}

/**
 * whisper --max-len 1 のトークン列を、句読点 / 無音区間 / 隣接トークン間ギャップで
 * 区切った「句」単位のセグメントに束ねる。区切りトークン自体はテキストに含めず、
 * 各句は最初の内容トークンの from から最後の内容トークンの to までを範囲とする。
 *
 * silenceMidsMs: ffmpeg silencedetect で得た無音区間の中央時刻（ミリ秒）。
 * whisper は無音をトークン境界として落とさず、隣接する内容トークンの duration に
 * 吸収させてしまう。computeSilenceSplits で「無音吸収トークン群」の末尾を求め、
 * そのトークンの後で句を切る。
 */
export function groupTokensIntoPhrases(
  tokens: WhisperSegment[],
  silenceMidsMs: number[] = [],
): WhisperSegment[] {
  const content = tokens.filter((t) => t.text.trim() !== '');
  const splitAfter = computeSilenceSplits(content, silenceMidsMs);

  const phrases: WhisperSegment[] = [];
  let text = '';
  let from = 0;
  let to = 0;
  let prevTo = -1;

  const flush = () => {
    if (text !== '') phrases.push({ offsets: { from, to }, text });
    text = '';
  };

  content.forEach((tok, i) => {
    const t = tok.text.trim();

    // (1) 隣接トークン間のギャップが PHRASE_GAP_MS 以上なら fallback で flush
    if (text !== '' && prevTo >= 0 && tok.offsets.from - prevTo >= PHRASE_GAP_MS) {
      flush();
    }

    if (PHRASE_DELIMITERS.test(t)) {
      flush();
    } else {
      if (text === '') from = tok.offsets.from;
      text += t;
      to = tok.offsets.to;
    }
    prevTo = tok.offsets.to;

    // (2) 無音 mid からの "split-after" hint
    if (splitAfter.has(i)) flush();
  });
  flush();
  return phrases;
}

function contains(t: number, start: number, end: number): boolean {
  return t >= start && t < end;
}

function distanceToRange(t: number, start: number, end: number): number {
  if (t < start) return start - t;
  if (t >= end) return t - end;
  return 0;
}

/** whisper のセグメント配列を Project の Segment[] に変換し、clicks を時間で割り当てる。 */
export function mapWhisperSegments(
  whisper: WhisperSegment[],
  clicks: ClickEvent[],
  defaultVoice: SegmentVoice,
): Segment[] {
  const segments: Segment[] = whisper.map((w, i) => ({
    id: `seg-${String(i + 1).padStart(3, '0')}`,
    videoStart: w.offsets.from / 1000,
    videoEnd: w.offsets.to / 1000,
    originalText: w.text.trim(),
    correctedText: w.text.trim(),
    ttsAudio: null,
    voice: { ...defaultVoice },
    clicks: [],
    enabled: true,
  }));

  if (segments.length === 0) return segments;

  for (const c of clicks) {
    let best = segments.findIndex((s) => contains(c.t, s.videoStart, s.videoEnd));
    if (best === -1) {
      let bestDist = Infinity;
      segments.forEach((s, i) => {
        const d = distanceToRange(c.t, s.videoStart, s.videoEnd);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
    }
    segments[best].clicks.push(c);
  }
  return segments;
}
