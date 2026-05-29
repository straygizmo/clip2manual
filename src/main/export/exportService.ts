import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Segment } from '../../shared/types';
import { computePreviewTimeline } from '../../shared/previewTimeline';
import {
  probeDurationArgs, parseProbeDuration, probeFpsArgs, parseFps,
  probeResolutionArgs, parseResolution,
  segmentVideoArgs, segmentAudioArgs, concatArgs, muxArgs,
} from './ffargs';
import { generateRippleFramesForSlot, type GenerateRippleFramesInput } from './rippleFrames';
import { generateSubtitleFrameForSlot, type GenerateSubtitleFrameInput, type SubtitleFrameOutput } from './subtitleFrames';
import { loadSubtitleFontBase64 } from './fontPaths';
import { tMain } from '../i18n';

export interface ExportOptions {
  /** 書き出し対象の segments。enabled での絞り込みは computePreviewTimeline 内で行われる。 */
  segments: Segment[];
  projectDir: string; // assets/raw.webm, tts/<id>.wav がある
  outPath: string;    // 最終 MP4
  tmpDir: string;     // 中間ファイル
  credit: string;     // メタデータ comment
  showSubtitles: boolean;
  runFfmpeg: (args: string[]) => Promise<void>;
  runProbe: (args: string[]) => Promise<string>;
  /** デフォルトは本物の generateRippleFramesForSlot。テストでモック可。 */
  generateRippleFrames?: (
    input: GenerateRippleFramesInput,
  ) => Promise<{ pattern: string; fps: number } | null>;
  generateSubtitleFrame?: (
    input: GenerateSubtitleFrameInput,
  ) => Promise<SubtitleFrameOutput | null>;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** concat リスト用にパスを安全に引用する。 */
function listLine(p: string): string {
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

export async function runExport(opts: ExportOptions): Promise<void> {
  if (opts.segments.length === 0) throw new Error(tMain('errors.noSegments'));
  const raw = path.join(opts.projectDir, 'assets/raw.webm');
  await fs.mkdir(opts.tmpDir, { recursive: true });

  const fps = parseFps(await opts.runProbe(probeFpsArgs(raw)));
  const { width: videoW, height: videoH } = parseResolution(await opts.runProbe(probeResolutionArgs(raw)));

  const clipDurations = new Map<string, number>();
  for (const s of opts.segments) {
    if (!s.ttsAudio) continue;
    const d = parseProbeDuration(await opts.runProbe(probeDurationArgs(path.join(opts.projectDir, s.ttsAudio))));
    clipDurations.set(s.id, d);
  }

  const slots = computePreviewTimeline(opts.segments, clipDurations);
  if (slots.length === 0) throw new Error(tMain('errors.noEnabledSegments')); // 全カット等
  const total = slots.length + 3; // segments + 2 concat + 1 mux
  let done = 0;
  const tick = () => { done += 1; opts.onProgress?.(Math.round((done / total) * 100)); };

  const generate = opts.generateRippleFrames ?? generateRippleFramesForSlot;
  const generateSubtitle = opts.generateSubtitleFrame ?? generateSubtitleFrameForSlot;
  // fontBase64: load once iff we need the real subtitle renderer (skip when caller injects a mock)
  const fontBase64 = (opts.showSubtitles && !opts.generateSubtitleFrame)
    ? await loadSubtitleFontBase64()
    : '';

  const videoParts: string[] = [];
  const audioParts: string[] = [];
  for (const slot of slots) {
    if (opts.signal?.aborted) throw new Error(tMain('errors.exportCancelled'));
    const segment = opts.segments.find((s) => s.id === slot.segmentId);
    const clicks = segment?.clicks ?? [];
    const ripple = await generate({
      slot,
      clicks,
      fps,
      videoW,
      videoH,
      outDir: path.join(opts.tmpDir, `${slot.segmentId}_ripple`),
      signal: opts.signal,
    });

    let subtitle: { pngPath: string; durationSec: number } | undefined;
    if (opts.showSubtitles && segment) {
      const text = (segment.correctedText.trim() || segment.originalText.trim());
      const out = await generateSubtitle({
        slot,
        text,
        videoW,
        videoH,
        fontBase64,
        outDir: path.join(opts.tmpDir, `${slot.segmentId}_subtitle`),
        signal: opts.signal,
      });
      if (out !== null) subtitle = out;
    }

    const vOut = path.join(opts.tmpDir, `${slot.segmentId}.mp4`);
    const aOut = path.join(opts.tmpDir, `${slot.segmentId}.wav`);
    const clipPath = segment && segment.ttsAudio ? path.join(opts.projectDir, segment.ttsAudio) : null;
    await opts.runFfmpeg(segmentVideoArgs({ rawPath: raw, slot, outPath: vOut, fps, ripple: ripple ?? undefined, subtitle }));
    await opts.runFfmpeg(segmentAudioArgs({ clipPath, slotDuration: slot.slotDuration, outPath: aOut }));
    videoParts.push(vOut);
    audioParts.push(aOut);
    tick();
  }

  const vList = path.join(opts.tmpDir, 'video.txt');
  const aList = path.join(opts.tmpDir, 'audio.txt');
  await fs.writeFile(vList, videoParts.map(listLine).join('\n'), 'utf8');
  await fs.writeFile(aList, audioParts.map(listLine).join('\n'), 'utf8');

  const vConcat = path.join(opts.tmpDir, 'video.mp4');
  const aConcat = path.join(opts.tmpDir, 'audio.wav');
  await opts.runFfmpeg(concatArgs({ listFile: vList, outPath: vConcat }));
  tick();
  await opts.runFfmpeg(concatArgs({ listFile: aList, outPath: aConcat }));
  tick();

  await opts.runFfmpeg(muxArgs({ videoPath: vConcat, audioPath: aConcat, outPath: opts.outPath, comment: opts.credit }));
  tick();
}
