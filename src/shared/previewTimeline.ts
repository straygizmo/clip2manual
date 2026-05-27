import { type Segment } from './types';

export interface PreviewSlot {
  segmentId: string;
  slotStart: number;     // プレビュータイムライン上の開始秒
  slotDuration: number;  // このスロットの長さ（秒）
  videoStart: number;    // 元映像の開始秒
  videoEnd: number;      // 元映像の終了秒
  clipDuration: number;  // TTS クリップ長（秒）。未生成は 0
}

/** 各セグメント末尾の小休止（秒）。 */
export const TAIL_PAUSE = 0.3;

/**
 * セグメントと TTS クリップ長から、プレビュー（=書き出し）のスロット列を作る。
 * 各スロット長 = max(クリップ長, 映像区間長) + TAIL_PAUSE。
 * これで「音声が長ければ末尾フレームをフリーズ保持、短ければ末尾に小休止」を統一表現する。
 */
export function computePreviewTimeline(
  segments: Segment[],
  clipDurations: Map<string, number>,
): PreviewSlot[] {
  const slots: PreviewSlot[] = [];
  let cursor = 0;
  for (const seg of segments) {
    if (seg.enabled === false) continue; // カット（無効）セグメントは出力に含めない
    const videoSpan = Math.max(0, seg.videoEnd - seg.videoStart);
    const clipDuration = clipDurations.get(seg.id) ?? 0;
    const slotDuration = Math.max(clipDuration, videoSpan) + TAIL_PAUSE;
    slots.push({
      segmentId: seg.id,
      slotStart: cursor,
      slotDuration,
      videoStart: seg.videoStart,
      videoEnd: seg.videoEnd,
      clipDuration,
    });
    cursor += slotDuration;
  }
  return slots;
}

export function previewTotalDuration(slots: PreviewSlot[]): number {
  return slots.reduce((sum, s) => sum + s.slotDuration, 0);
}
