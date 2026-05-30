import { type Segment } from '../../shared/types';

/** 指定セグメントの enabled をトグルする（他は不変）。 */
export function toggleEnabled(segments: Segment[], id: string): Segment[] {
  return segments.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
}

/** 指定セグメントを次のセグメントと結合する。最後のセグメントなら変化なし。 */
export function mergeWithNext(segments: Segment[], id: string): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0 || i >= segments.length - 1) return segments;
  const a = segments[i];
  const b = segments[i + 1];
  const merged: Segment = {
    ...a,
    videoEnd: b.videoEnd,
    originalText: a.originalText + b.originalText,
    correctedText: a.correctedText + b.correctedText,
    clicks: [...a.clicks, ...b.clicks],
    ttsAudio: null,
  };
  return [...segments.slice(0, i), merged, ...segments.slice(i + 2)];
}

/** 指定セグメントを atTime で2つに分割する。atTime が (videoStart, videoEnd) 外なら変化なし。
 *  first はテキストを保持、second は correctedText='' と newId。clicks は時刻で分配。両片 ttsAudio=null。 */
export function splitAt(segments: Segment[], id: string, atTime: number, newId: string): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0) return segments;
  const seg = segments[i];
  if (atTime <= seg.videoStart || atTime >= seg.videoEnd) return segments;
  const first: Segment = {
    ...seg,
    videoEnd: atTime,
    clicks: seg.clicks.filter((c) => c.t < atTime),
    ttsAudio: null,
  };
  const second: Segment = {
    ...seg,
    id: newId,
    videoStart: atTime,
    originalText: '',
    correctedText: '',
    clicks: seg.clicks.filter((c) => c.t >= atTime),
    ttsAudio: null,
  };
  return [...segments.slice(0, i), first, second, ...segments.slice(i + 1)];
}

export const MIN_SEGMENT_DURATION = 0.05;

/**
 * セグメント境界をドラッグでリサイズ。連動仕様:
 * - 内側の端（隣あり）: 共有境界として隣も一緒に動く
 * - 外側の端（最初の左 / 最後の右）: 単独。[0, duration] で clamp
 * 各セグメント長は最低 MIN_SEGMENT_DURATION を保つ。
 * ttsAudio は保持。clicks も配列のまま（再配分しない）。
 */
export function resizeBoundary(
  segments: Segment[],
  primaryId: string,
  side: 'left' | 'right',
  newTime: number,
  duration: number,
): Segment[] {
  const i = segments.findIndex((s) => s.id === primaryId);
  if (i < 0) return segments;
  const out = segments.slice();
  if (side === 'left') {
    const lower = i > 0 ? segments[i - 1].videoStart + MIN_SEGMENT_DURATION : 0;
    const upper = segments[i].videoEnd - MIN_SEGMENT_DURATION;
    const t = Math.max(lower, Math.min(upper, newTime));
    out[i] = { ...segments[i], videoStart: t };
    if (i > 0) out[i - 1] = { ...segments[i - 1], videoEnd: t };
  } else {
    const lower = segments[i].videoStart + MIN_SEGMENT_DURATION;
    const upper = i < segments.length - 1
      ? segments[i + 1].videoEnd - MIN_SEGMENT_DURATION
      : duration;
    const t = Math.max(lower, Math.min(upper, newTime));
    out[i] = { ...segments[i], videoEnd: t };
    if (i < segments.length - 1) out[i + 1] = { ...segments[i + 1], videoStart: t };
  }
  return out;
}

export interface ClickKey {
  segmentId: string;
  t: number;
  x: number;
  y: number;
}

/** 指定セグメントの clicks から (t, x, y) が一致するクリックを 1 件削除する。
 *  該当 segmentId が無い、もしくは一致クリックが無い場合は input をそのまま（参照同一で）返す。 */
export function deleteClick(segments: Segment[], key: ClickKey): Segment[] {
  const i = segments.findIndex((s) => s.id === key.segmentId);
  if (i < 0) return segments;
  const seg = segments[i];
  const nextClicks = seg.clicks.filter((c) => !(c.t === key.t && c.x === key.x && c.y === key.y));
  if (nextClicks.length === seg.clicks.length) return segments;
  const next = segments.slice();
  next[i] = { ...seg, clicks: nextClicks };
  return next;
}
