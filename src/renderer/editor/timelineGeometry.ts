export function timeToPercent(t: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(100, (t / duration) * 100));
}

export function segmentRect(start: number, end: number, duration: number): { left: number; width: number } {
  if (!Number.isFinite(duration) || duration <= 0) return { left: 0, width: 0 };
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(s, Math.min(end, duration));
  return { left: (s / duration) * 100, width: ((e - s) / duration) * 100 };
}

export function timeToPx(t: number, pxPerSec: number): number {
  if (!Number.isFinite(pxPerSec) || pxPerSec <= 0) return 0;
  return t * pxPerSec;
}

export function pxToTime(px: number, pxPerSec: number): number {
  if (!Number.isFinite(pxPerSec) || pxPerSec <= 0) return 0;
  return px / pxPerSec;
}

export function segmentBox(start: number, end: number, pxPerSec: number): { left: number; width: number } {
  if (!Number.isFinite(pxPerSec) || pxPerSec <= 0) return { left: 0, width: 0 };
  const s = Math.max(0, start);
  const e = Math.max(s, end);
  return { left: s * pxPerSec, width: (e - s) * pxPerSec };
}

export function clampZoom(px: number, fit: number, max: number): number {
  return Math.max(fit, Math.min(max, px));
}

export function applyZoomAtPoint(input: {
  oldPxPerSec: number;
  newPxPerSec: number;
  scrollLeft: number;
  mouseOffsetPx: number;
}): { pxPerSec: number; scrollLeft: number } {
  const { oldPxPerSec, newPxPerSec, scrollLeft, mouseOffsetPx } = input;
  if (oldPxPerSec <= 0) return { pxPerSec: newPxPerSec, scrollLeft };
  const newScrollLeft = (scrollLeft + mouseOffsetPx) * (newPxPerSec / oldPxPerSec) - mouseOffsetPx;
  return { pxPerSec: newPxPerSec, scrollLeft: Math.max(0, newScrollLeft) };
}

const TICK_CANDIDATES = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];
const MIN_PX_BETWEEN_MAJOR = 80;

export function pickMajorInterval(pxPerSec: number): number {
  for (const c of TICK_CANDIDATES) {
    if (c * pxPerSec >= MIN_PX_BETWEEN_MAJOR) return c;
  }
  return TICK_CANDIDATES[TICK_CANDIDATES.length - 1];
}

export function formatTimeLabel(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function shouldAutoScroll(input: {
  playheadPx: number;
  viewLeft: number;
  viewWidth: number;
  margin: number;
}): number | null {
  const { playheadPx, viewLeft, viewWidth, margin } = input;
  const viewRight = viewLeft + viewWidth;
  if (playheadPx >= viewLeft && playheadPx <= viewRight - margin) return null;
  return Math.max(0, playheadPx - margin);
}
