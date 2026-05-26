export function timeToPercent(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(100, (t / duration) * 100));
}

export function segmentRect(start: number, end: number, duration: number): { left: number; width: number } {
  if (duration <= 0) return { left: 0, width: 0 };
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(s, Math.min(end, duration));
  return { left: (s / duration) * 100, width: ((e - s) / duration) * 100 };
}
