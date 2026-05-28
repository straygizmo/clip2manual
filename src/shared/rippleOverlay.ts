/** リップル1発の継続時間（秒, wall-clock）。 */
export const RIPPLE_DURATION = 0.8;
/** リップル最大半径 = 映像幅 * この比。 */
export const RIPPLE_MAX_RADIUS_RATIO = 1 / 12;

/**
 * 映像時刻が prevT→currT に前進する間に「交差した」クリック（prevT < t <= currT）を返す。
 * 前進していない（currT <= prevT）場合は空配列。
 */
export function clicksCrossed<T extends { t: number }>(clicks: T[], prevT: number, currT: number): T[] {
  if (currT <= prevT) return [];
  return clicks.filter((c) => c.t > prevT && c.t <= currT);
}

/**
 * 発火からの経過秒に対するリップルの半径係数(0..1)と不透明度(1..0)。
 * 経過が継続時間以上なら null（消滅）。
 */
export function rippleProgress(
  elapsed: number,
  duration: number = RIPPLE_DURATION,
): { radius01: number; alpha: number } | null {
  if (elapsed >= duration) return null;
  const k = Math.max(0, elapsed) / duration;
  return { radius01: k, alpha: 1 - k };
}
