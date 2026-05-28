import { type ClickEvent } from '../../shared/types';
import { type PreviewSlot } from '../../shared/previewTimeline';
import { RIPPLE_MAX_RADIUS_RATIO, rippleProgress } from '../../shared/rippleOverlay';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';

export interface ActiveRippleVisual {
  x: number;
  y: number;
  ringRadius: number;
  ringStrokeWidth: number;
  dotRadius: number;
  alpha: number;
}

/**
 * スロットに属するクリックのうち、与えられた slot 時刻で active なリップルの描画パラメータを返す。
 * クリックは `slot.videoStart < c.t <= slot.videoEnd` で slot 所属判定する（Phase 5 の clicksCrossed 半開区間に一致）。
 */
export function activeRipplesAt(
  clicks: ClickEvent[],
  slot: PreviewSlot,
  tSlot: number,
  videoW: number,
): ActiveRippleVisual[] {
  const out: ActiveRippleVisual[] = [];
  const maxR = videoW * RIPPLE_MAX_RADIUS_RATIO;
  const ringSW = Math.max(2, videoW / 400);
  const dotR = Math.max(3, videoW / 320);
  for (const c of clicks) {
    if (c.t <= slot.videoStart || c.t > slot.videoEnd) continue;
    const fireTimeSlot = c.t - slot.videoStart;
    const elapsed = tSlot - fireTimeSlot;
    if (elapsed < 0) continue;  // click hasn't fired yet
    const p = rippleProgress(elapsed);
    if (!p) continue;
    out.push({
      x: c.x,
      y: c.y,
      ringRadius: Math.max(2, p.radius01 * maxR),
      ringStrokeWidth: ringSW,
      dotRadius: dotR,
      alpha: p.alpha,
    });
  }
  return out;
}

/**
 * active リップル群を 1 枚の透明 SVG にする。背景は描かない（PNG 化時に透過のまま）。
 * 数値は小数 3 桁で出力（フレーム間の見た目を安定させる）。
 */
export function rippleSvg(actives: ActiveRippleVisual[], w: number, h: number): string {
  const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(3);
  const parts = actives.map((a) => {
    const op = fmt(a.alpha);
    return (
      `<circle cx="${fmt(a.x)}" cy="${fmt(a.y)}" r="${fmt(a.ringRadius)}" fill="none" stroke="#ffcf33" stroke-width="${fmt(a.ringStrokeWidth)}" opacity="${op}"/>` +
      `<circle cx="${fmt(a.x)}" cy="${fmt(a.y)}" r="${fmt(a.dotRadius)}" fill="#ff5470" opacity="${op}"/>`
    );
  }).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${parts}</svg>`;
}

export interface GenerateRippleFramesInput {
  slot: PreviewSlot;
  clicks: ClickEvent[];      // segment.clicks のフラット化を想定（slot 外は内部で除外）
  fps: number;
  videoW: number;
  videoH: number;
  outDir: string;            // <tmpDir>/<slotId>_ripple
  signal?: AbortSignal;
}

/**
 * スロットに属する click だけを描画した透明 PNG シーケンスを outDir に出す。
 * クリック空なら null（呼び出し側は overlay をスキップ）。
 */
export async function generateRippleFramesForSlot(
  input: GenerateRippleFramesInput,
): Promise<{ pattern: string; fps: number } | null> {
  const slotClicks = input.clicks.filter((c) => c.t > input.slot.videoStart && c.t <= input.slot.videoEnd);
  if (slotClicks.length === 0) return null;
  await fs.mkdir(input.outDir, { recursive: true });
  const totalFrames = Math.ceil(input.slot.slotDuration * input.fps);
  for (let n = 0; n < totalFrames; n++) {
    if (input.signal?.aborted) throw new Error('Export cancelled');
    const tSlot = n / input.fps;
    const actives = activeRipplesAt(slotClicks, input.slot, tSlot, input.videoW);
    const svg = rippleSvg(actives, input.videoW, input.videoH);
    const filePath = path.join(input.outDir, `${String(n).padStart(5, '0')}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(filePath);
  }
  return { pattern: path.join(input.outDir, '%05d.png'), fps: input.fps };
}
