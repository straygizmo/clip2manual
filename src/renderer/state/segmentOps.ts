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
    correctedText: '',
    clicks: seg.clicks.filter((c) => c.t >= atTime),
    ttsAudio: null,
  };
  return [...segments.slice(0, i), first, second, ...segments.slice(i + 1)];
}
