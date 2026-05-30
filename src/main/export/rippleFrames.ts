import { type ClickEvent } from '../../shared/types';
import { RIPPLE_MAX_RADIUS_RATIO, rippleProgress } from '../../shared/rippleOverlay';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { tMain } from '../i18n';

export interface ActiveRippleVisual {
  x: number;
  y: number;
  ringRadius: number;
  ringStrokeWidth: number;
  dotRadius: number;
  alpha: number;
}

/**
 * 絶対時刻 t（raw.webm のグローバル時刻）における active なリップル群を返す。
 * 各 click は c.t がそのまま「発火時刻」。elapsed = t - c.t。
 * elapsed が rippleProgress の有効範囲外なら除外。
 */
export function activeRipplesAtT(
  clicks: ReadonlyArray<{ x: number; y: number; t: number }>,
  t: number,
  videoW: number,
): ActiveRippleVisual[] {
  const out: ActiveRippleVisual[] = [];
  const maxR = videoW * RIPPLE_MAX_RADIUS_RATIO;
  const ringSW = Math.max(2, videoW / 400);
  const dotR = Math.max(3, videoW / 320);
  for (const c of clicks) {
    const elapsed = t - c.t;
    if (elapsed < 0) continue;
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
 * 透明 SVG に active リップルを描く。背景は描かない（PNG 化時に透過）。
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

export interface GenerateGlobalRippleFramesInput {
  /** 絶対時刻 t のクリック群（無効セグメントのクリックは含めないこと）。 */
  clicks: ReadonlyArray<{ x: number; y: number; t: number }>;
  /** 出力動画長（raw.webm 全長）。 */
  totalDuration: number;
  fps: number;
  videoW: number;
  videoH: number;
  outDir: string;
  signal?: AbortSignal;
}

/**
 * raw.webm 全長にわたる透明 PNG シーケンスを outDir に出す。
 * クリックが 1 件も無ければ null（呼び出し側は overlay をスキップ）。
 * 各フレームは ceil(totalDuration * fps) 枚生成し、リップル無し区間は空 SVG（透明）を書き出す。
 *
 * 空フレームのために sharp を 1 度だけ起動して buffer を作り、それを使い回すことで
 * sharp 起動コストを大幅に削減する（30 分動画でも実用速度）。
 */
export async function generateGlobalRippleFrames(
  input: GenerateGlobalRippleFramesInput,
): Promise<{ pattern: string; fps: number } | null> {
  if (input.clicks.length === 0) return null;
  if (input.totalDuration <= 0) return null;
  await fs.mkdir(input.outDir, { recursive: true });
  const totalFrames = Math.ceil(input.totalDuration * input.fps);

  // 空フレーム PNG をキャッシュ（クリック密度が低いほど効果大）
  const emptySvg = rippleSvg([], input.videoW, input.videoH);
  const emptyBuf = await sharp(Buffer.from(emptySvg)).png({ compressionLevel: 9 }).toBuffer();

  for (let n = 0; n < totalFrames; n++) {
    if (input.signal?.aborted) throw new Error(tMain('errors.exportCancelled'));
    const t = n / input.fps;
    const actives = activeRipplesAtT(input.clicks, t, input.videoW);
    const filePath = path.join(input.outDir, `${String(n).padStart(6, '0')}.png`);
    if (actives.length === 0) {
      await fs.writeFile(filePath, emptyBuf);
    } else {
      const svg = rippleSvg(actives, input.videoW, input.videoH);
      await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(filePath);
    }
  }
  return { pattern: path.join(input.outDir, '%06d.png'), fps: input.fps };
}
