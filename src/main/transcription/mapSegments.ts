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

/**
 * whisper --max-len 1 のトークン列を、句読点 / 無音区間 / 隣接トークン間ギャップで
 * 区切った「句」単位のセグメントに束ねる。区切りトークン自体はテキストに含めず、
 * 各句は最初の内容トークンの from から最後の内容トークンの to までを範囲とする。
 *
 * silenceMidsMs: ffmpeg silencedetect で得た無音区間の中央時刻（ミリ秒、昇順想定）。
 * whisper は無音をトークン境界として落とさず、隣接する内容トークンの duration に
 * 吸収させてしまうことがある。そのため「あるトークンの (from, to) の内側に無音 mid が
 * 入っている」場合、そのトークンを無音吸収トークンとみなし、トークンの直前で句を切る。
 */
export function groupTokensIntoPhrases(
  tokens: WhisperSegment[],
  silenceMidsMs: number[] = [],
): WhisperSegment[] {
  const sortedMids = [...silenceMidsMs].sort((a, b) => a - b);
  let midIdx = 0;

  const phrases: WhisperSegment[] = [];
  let text = '';
  let from = 0;
  let to = 0;

  const flush = () => {
    if (text !== '') phrases.push({ offsets: { from, to }, text });
    text = '';
  };

  for (const tok of tokens) {
    const t = tok.text.trim();
    if (t === '') continue; // 空トークン（先頭の無音など）は無視

    // (1) このトークンの開始までに過ぎた無音 mid は、ここで句境界として消化する
    let consumedMidBefore = false;
    while (midIdx < sortedMids.length && sortedMids[midIdx] < tok.offsets.from) {
      consumedMidBefore = true;
      midIdx++;
    }
    if (consumedMidBefore && text !== '') flush();

    // (2) このトークンの (from, to) 内に無音 mid があれば、トークンが無音を吸収している
    //     とみなして、トークンの「前」で flush する（無音は前句末尾に属する扱い）。
    let consumedMidInside = false;
    while (
      midIdx < sortedMids.length &&
      sortedMids[midIdx] >= tok.offsets.from &&
      sortedMids[midIdx] < tok.offsets.to
    ) {
      consumedMidInside = true;
      midIdx++;
    }
    if (consumedMidInside && text !== '') flush();

    // (3) 隣接トークン間のギャップが PHRASE_GAP_MS 以上なら fallback で flush
    if (text !== '' && tok.offsets.from - to >= PHRASE_GAP_MS) {
      flush();
    }

    if (PHRASE_DELIMITERS.test(t)) {
      flush();
      continue;
    }
    if (text === '') from = tok.offsets.from;
    text += t;
    to = tok.offsets.to;
  }
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
