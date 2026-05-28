import { type ClickEvent } from '../../shared/types';
import { type PreviewSlot } from '../../shared/previewTimeline';
import { RIPPLE_MAX_RADIUS_RATIO, rippleProgress } from '../../shared/rippleOverlay';

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
