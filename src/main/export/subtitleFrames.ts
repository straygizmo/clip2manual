import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { subtitleSvg } from './subtitleSvg';
import { type PreviewSlot } from '../../shared/previewTimeline';

export interface GenerateSubtitleFrameInput {
  slot: PreviewSlot;
  text: string;
  videoW: number;
  videoH: number;
  fontBase64: string;
  outDir: string;
  signal?: AbortSignal;
}

export interface SubtitleFrameOutput {
  pngPath: string;
  durationSec: number;
}

/**
 * スロットの字幕 PNG を 1枚生成する。
 * 表示すべきものが無いとき（空テキスト or 区間長 0）は null。
 * durationSec はプレビューの visibleDuration と同じ式: clipDuration > 0 ? clipDuration : videoSpan。
 */
export async function generateSubtitleFrameForSlot(
  input: GenerateSubtitleFrameInput,
): Promise<SubtitleFrameOutput | null> {
  if (input.text.trim() === '') return null;
  const videoSpan = Math.max(0, input.slot.videoEnd - input.slot.videoStart);
  const durationSec = input.slot.clipDuration > 0 ? input.slot.clipDuration : videoSpan;
  if (durationSec <= 0) return null;
  const svg = subtitleSvg({
    text: input.text,
    videoW: input.videoW,
    videoH: input.videoH,
    fontBase64: input.fontBase64,
  });
  if (svg === null) return null;
  if (input.signal?.aborted) return null;
  await fs.mkdir(input.outDir, { recursive: true });
  const pngPath = path.join(input.outDir, 'subtitle.png');
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(pngPath);
  return { pngPath, durationSec };
}
