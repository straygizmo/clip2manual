import { type Segment } from './types';

export type SubtitleCursor =
  | { kind: 'original'; videoTime: number }
  | { kind: 'tts'; slotId: string; offsetInSlot: number; visibleDuration: number };

export interface SubtitleSelectInput {
  segments: Segment[];
  showSubtitles: boolean;
  cursor: SubtitleCursor;
}

function textOf(seg: Segment): string | null {
  const c = seg.correctedText.trim();
  if (c !== '') return c;
  const o = seg.originalText.trim();
  if (o !== '') return o;
  return null;
}

/**
 * 現在の再生位置・モードから、表示すべき字幕テキストを決める純関数。
 * 表示しない場合は null。
 */
export function pickSubtitle(input: SubtitleSelectInput): string | null {
  if (!input.showSubtitles) return null;
  if (input.cursor.kind === 'original') {
    const t = input.cursor.videoTime;
    const seg = input.segments.find((s) => s.enabled !== false && t >= s.videoStart && t < s.videoEnd);
    return seg ? textOf(seg) : null;
  } else if (input.cursor.kind === 'tts') {
    const cursor = input.cursor;
    if (cursor.offsetInSlot >= cursor.visibleDuration) return null;
    const seg = input.segments.find((s) => s.id === cursor.slotId);
    return seg ? textOf(seg) : null;
  }
  return null;
}
