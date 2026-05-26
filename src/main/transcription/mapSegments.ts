import { type ClickEvent, type Segment, type SegmentVoice } from '../../shared/types';

export interface WhisperSegment {
  offsets: { from: number; to: number }; // ミリ秒
  text: string;
}

export interface WhisperJson {
  transcription: WhisperSegment[];
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
    let best = 0;
    let bestDist = Infinity;
    segments.forEach((s, i) => {
      const d = distanceToRange(c.t, s.videoStart, s.videoEnd);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    segments[best].clicks.push(c);
  }
  return segments;
}
