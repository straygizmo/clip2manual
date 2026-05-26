import { osToVideoCoords, isWithinDisplay, type CaptureGeometry } from './coordinateTransform';
import { type ClickEvent } from './types';

export interface RawClickEvent {
  osX: number;
  osY: number;
  button: number;
  timestampMs: number;
}

export function buildClickLog(
  rawEvents: RawClickEvent[],
  t0Ms: number,
  geometry: CaptureGeometry,
): ClickEvent[] {
  const result: ClickEvent[] = [];
  for (const e of rawEvents) {
    const t = (e.timestampMs - t0Ms) / 1000;
    if (t < 0) continue;
    if (!isWithinDisplay(e.osX, e.osY, geometry)) continue;
    const { x, y } = osToVideoCoords(e.osX, e.osY, geometry);
    result.push({ x, y, t, button: e.button });
  }
  return result;
}
