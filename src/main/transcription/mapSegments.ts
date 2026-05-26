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

/**
 * whisper --max-len 1 のトークン列を、句読点で区切った「句」単位のセグメントに束ねる。
 * 区切りトークン自体はテキストに含めず、各句は最初の内容トークンの from から
 * 最後の内容トークンの to までを範囲とする。
 */
export function groupTokensIntoPhrases(tokens: WhisperSegment[]): WhisperSegment[] {
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
