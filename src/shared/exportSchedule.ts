import { type Segment } from './types';

export interface ExportAudioClip {
  segId: string;
  /** TTS 開始位置（= seg.videoStart）。 */
  delaySec: number;
  /** projectDir からの相対パス（例: tts/seg-001.wav）。 */
  pathRel: string;
  /** TTS クリップ長（ffprobe 値）。0 はスキップ済み。 */
  durationSec: number;
}

export interface ExportSubtitleSpan {
  segId: string;
  /** 表示開始（= seg.videoStart）。 */
  startSec: number;
  /** 表示終了（= seg.videoEnd）。プレビューの original-mode 同様、TTS 長は無視。 */
  endSec: number;
  text: string;
}

export interface ExportClick {
  segId: string;
  x: number;
  y: number;
  /** raw.webm のグローバル時刻（= ClickEvent.t）。 */
  t: number;
  button: number;
}

export interface ExportSchedule {
  /** 出力動画長 = raw.webm 全長。 */
  totalDuration: number;
  audioClips: ExportAudioClip[];
  subtitleSpans: ExportSubtitleSpan[];
  /** 有効セグメントのクリックのみ（無効セグメントの click は除外）。 */
  clicks: ExportClick[];
}

export interface ExportScheduleInput {
  segments: Segment[];
  /** ffprobe で取得した raw.webm の長さ。 */
  rawVideoDuration: number;
  /** segId → TTS クリップ長。enabled かつ ttsAudio を持つセグメントのみ。 */
  clipDurations: Map<string, number>;
}

/**
 * raw.webm のタイムラインをそのまま使い、有効セグメントの TTS / 字幕 / クリックを
 * 絶対時刻でオーバーレイするためのスケジュールを作る。プレビューの TTS モードと一致する設計:
 *   - 映像は raw.webm を 0..totalDuration で連続再生
 *   - TTS は seg.videoStart の位置に重ねる（映像は止めず、次セグメントとオーバーラップしうる）
 *   - 字幕は [seg.videoStart, seg.videoEnd) の間だけ表示
 *   - クリックのリップルは絶対時刻 c.t から開始
 *   - 無効セグメントは TTS / 字幕 / クリックを出さない（映像は素のまま見える）
 */
export function computeExportSchedule(input: ExportScheduleInput): ExportSchedule {
  const audioClips: ExportAudioClip[] = [];
  const subtitleSpans: ExportSubtitleSpan[] = [];
  const clicks: ExportClick[] = [];
  for (const seg of input.segments) {
    if (seg.enabled === false) continue;
    if (seg.ttsAudio) {
      const d = input.clipDurations.get(seg.id) ?? 0;
      if (d > 0) {
        audioClips.push({
          segId: seg.id,
          delaySec: Math.max(0, seg.videoStart),
          pathRel: seg.ttsAudio,
          durationSec: d,
        });
      }
    }
    const text = seg.correctedText.trim() || seg.originalText.trim();
    if (text !== '' && seg.videoEnd > seg.videoStart) {
      subtitleSpans.push({
        segId: seg.id,
        startSec: Math.max(0, seg.videoStart),
        endSec: seg.videoEnd,
        text,
      });
    }
    for (const c of seg.clicks) {
      clicks.push({ segId: seg.id, x: c.x, y: c.y, t: c.t, button: c.button });
    }
  }
  return {
    totalDuration: Math.max(0, input.rawVideoDuration),
    audioClips,
    subtitleSpans,
    clicks,
  };
}

/** schedule に「有効な出力」が一切ない場合 true（= raw.webm が無音だけになる）。
 *  UI 側で「有効セグメント無し」エラーとして拾うために使う。 */
export function isScheduleEmpty(schedule: ExportSchedule): boolean {
  return (
    schedule.audioClips.length === 0
    && schedule.subtitleSpans.length === 0
    && schedule.clicks.length === 0
  );
}
