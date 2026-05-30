import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { subtitleSvg } from './subtitleSvg';
import { type ExportSubtitleSpan } from '../../shared/exportSchedule';

export interface SubtitleOverlay {
  pngPath: string;
  startSec: number;
  endSec: number;
}

export interface GenerateSubtitleOverlaysInput {
  spans: ReadonlyArray<ExportSubtitleSpan>;
  videoW: number;
  videoH: number;
  fontBase64: string;
  outDir: string;
  signal?: AbortSignal;
}

/**
 * 各セグメントの字幕 PNG を 1 枚ずつ生成する。subtitleSvg が null（空テキスト等）を返した
 * span はスキップ。返り値の配列順は spans の入力順を保つ（ffmpeg 側の overlay enable=between(t,…)
 * は時間条件で動くので順序自体は描画結果に影響しないが、テストと再現性のため順序保持）。
 */
export async function generateSubtitleOverlays(
  input: GenerateSubtitleOverlaysInput,
): Promise<SubtitleOverlay[]> {
  const out: SubtitleOverlay[] = [];
  if (input.spans.length === 0) return out;
  await fs.mkdir(input.outDir, { recursive: true });
  for (const span of input.spans) {
    if (input.signal?.aborted) return out;
    if (span.endSec <= span.startSec) continue;
    const svg = subtitleSvg({
      text: span.text,
      videoW: input.videoW,
      videoH: input.videoH,
      fontBase64: input.fontBase64,
    });
    if (svg === null) continue;
    const pngPath = path.join(input.outDir, `${span.segId}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(pngPath);
    out.push({ pngPath, startSec: span.startSec, endSec: span.endSec });
  }
  return out;
}
