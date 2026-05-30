import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Segment } from '../../shared/types';
import { computeExportSchedule, isScheduleEmpty } from '../../shared/exportSchedule';
import {
  probeDurationArgs, parseProbeDuration, probeFpsArgs, parseFps,
  probeResolutionArgs, parseResolution,
  globalVideoArgs, globalAudioArgs, muxArgs,
} from './ffargs';
import { generateGlobalRippleFrames, type GenerateGlobalRippleFramesInput } from './rippleFrames';
import { generateSubtitleOverlays, type GenerateSubtitleOverlaysInput, type SubtitleOverlay } from './subtitleFrames';
import { loadSubtitleFontBase64 } from './fontPaths';
import { tMain } from '../i18n';

export interface ExportOptions {
  /** 書き出し対象の segments。enabled での絞り込みは computeExportSchedule 内で行われる。 */
  segments: Segment[];
  projectDir: string; // assets/raw.webm, tts/<id>.wav がある
  outPath: string;    // 最終 MP4
  tmpDir: string;     // 中間ファイル
  credit: string;     // メタデータ comment
  showSubtitles: boolean;
  runFfmpeg: (args: string[]) => Promise<void>;
  runProbe: (args: string[]) => Promise<string>;
  /** デフォルトは本物の generateGlobalRippleFrames。テストでモック可。 */
  generateRippleFrames?: (
    input: GenerateGlobalRippleFramesInput,
  ) => Promise<{ pattern: string; fps: number } | null>;
  generateSubtitleOverlays?: (
    input: GenerateSubtitleOverlaysInput,
  ) => Promise<SubtitleOverlay[]>;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * raw.webm のタイムラインをそのまま使い、TTS/字幕/リップルを絶対時刻で重ねて MP4 を出力する。
 * プレビューの TTS モードと同じ見え方になる（先頭の無声区間や segment 間ギャップを保持し、
 * TTS が映像より長くても映像は止めない）。
 *
 * パイプライン:
 *   1. raw.webm の fps / 解像度 / 全長を probe
 *   2. 各 enabled+ttsAudio セグメントの TTS 長を probe
 *   3. ExportSchedule を構築
 *   4. リップル PNG シーケンス（全長分）を生成
 *   5. 字幕 PNG 群（span ごとに 1 枚）を生成
 *   6. 動画エンコード（raw + overlays → mp4）
 *   7. 音声エンコード（silence + adelay'd TTS の amix → wav）
 *   8. mux
 */
export async function runExport(opts: ExportOptions): Promise<void> {
  if (opts.segments.length === 0) throw new Error(tMain('errors.noSegments'));
  const raw = path.join(opts.projectDir, 'assets/raw.webm');
  await fs.mkdir(opts.tmpDir, { recursive: true });

  const fps = parseFps(await opts.runProbe(probeFpsArgs(raw)));
  const { width: videoW, height: videoH } = parseResolution(await opts.runProbe(probeResolutionArgs(raw)));
  const rawVideoDuration = parseProbeDuration(await opts.runProbe(probeDurationArgs(raw)));
  if (!(rawVideoDuration > 0)) throw new Error(tMain('errors.ffprobeParseDuration', { stdout: String(rawVideoDuration) }));

  const clipDurations = new Map<string, number>();
  for (const s of opts.segments) {
    if (s.enabled === false || !s.ttsAudio) continue;
    const d = parseProbeDuration(await opts.runProbe(probeDurationArgs(path.join(opts.projectDir, s.ttsAudio))));
    if (d > 0) clipDurations.set(s.id, d);
  }

  const schedule = computeExportSchedule({
    segments: opts.segments,
    rawVideoDuration,
    clipDurations,
  });
  if (isScheduleEmpty(schedule)) throw new Error(tMain('errors.noEnabledSegments'));

  // 5 フェーズ: ripple PNG → subtitle PNG → video encode → audio encode → mux
  const TOTAL_PHASES = 5;
  let done = 0;
  const tick = () => { done += 1; opts.onProgress?.(Math.round((done / TOTAL_PHASES) * 100)); };

  const generateRipple = opts.generateRippleFrames ?? generateGlobalRippleFrames;
  const generateSubs = opts.generateSubtitleOverlays ?? generateSubtitleOverlays;
  const needFont = opts.showSubtitles && !opts.generateSubtitleOverlays && schedule.subtitleSpans.length > 0;
  const fontBase64 = needFont ? await loadSubtitleFontBase64() : '';

  if (opts.signal?.aborted) throw new Error(tMain('errors.exportCancelled'));
  const ripple = await generateRipple({
    clicks: schedule.clicks,
    totalDuration: schedule.totalDuration,
    fps,
    videoW,
    videoH,
    outDir: path.join(opts.tmpDir, 'ripple'),
    signal: opts.signal,
  });
  tick();

  const subtitleOverlays = (opts.showSubtitles && schedule.subtitleSpans.length > 0)
    ? await generateSubs({
        spans: schedule.subtitleSpans,
        videoW,
        videoH,
        fontBase64,
        outDir: path.join(opts.tmpDir, 'subtitles'),
        signal: opts.signal,
      })
    : [];
  tick();

  const videoOut = path.join(opts.tmpDir, 'video.mp4');
  const audioOut = path.join(opts.tmpDir, 'audio.wav');

  if (opts.signal?.aborted) throw new Error(tMain('errors.exportCancelled'));
  await opts.runFfmpeg(globalVideoArgs({
    rawPath: raw,
    totalDuration: schedule.totalDuration,
    fps,
    outPath: videoOut,
    ripple: ripple ?? undefined,
    subtitles: subtitleOverlays,
  }));
  tick();

  if (opts.signal?.aborted) throw new Error(tMain('errors.exportCancelled'));
  await opts.runFfmpeg(globalAudioArgs({
    totalDuration: schedule.totalDuration,
    outPath: audioOut,
    clips: schedule.audioClips.map((c) => ({
      delaySec: c.delaySec,
      pathAbs: path.join(opts.projectDir, c.pathRel),
    })),
  }));
  tick();

  if (opts.signal?.aborted) throw new Error(tMain('errors.exportCancelled'));
  await opts.runFfmpeg(muxArgs({
    videoPath: videoOut,
    audioPath: audioOut,
    outPath: opts.outPath,
    comment: opts.credit,
  }));
  tick();
}
