import { ipcMain, desktopCapturer, screen } from 'electron';
import { formatCaptureSources, type CaptureSource } from '../captureSources';
import { getMainWindow } from '../index';
import {
  getWindowRectByHwnd,
  isWindowMinimized,
  isWinBoundsAvailable,
  parseHwndFromSourceId,
} from '../native/winBounds';

export interface PendingCaptureBounds {
  /** OS スクリーン座標・物理ピクセル */
  x: number; y: number; w: number; h: number;
  scaleFactor: number;
}

export interface PendingCapture {
  sourceId: string;
  kind: 'screen' | 'window';
  label: string;
  bounds: PendingCaptureBounds;
}

let pending: PendingCapture | null = null;

/** recording:stop が消費。bounds/label/kind を全部使う。 */
export function takePendingCapture(): PendingCapture | null {
  const v = pending; pending = null; return v;
}

/** setDisplayMediaRequestHandler 専用: sourceId だけ消費し、recording:stop 用に他は残す。 */
export function takePendingCaptureSourceId(): string | null {
  if (!pending) return null;
  const id = pending.sourceId;
  pending = { ...pending, sourceId: '' };
  return id;
}

/** bounds 取得を依存注入で受ける */
export interface BoundsResolver {
  isAvailable(): boolean;
  isMinimized(hwnd: bigint): boolean;
  getRect(hwnd: bigint): { x: number; y: number; w: number; h: number };
  scaleFactorFor(hwnd: bigint): number;
}

let boundsResolver: BoundsResolver = {
  isAvailable: () => isWinBoundsAvailable(),
  isMinimized: (h) => isWindowMinimized(h),
  getRect: (h) => getWindowRectByHwnd(h),
  // GetWindowRect は物理 px を返すため、ここは 1.0 を返す。
  // CaptureGeometry の videoWidth/Height で吸収する。
  scaleFactorFor: () => 1.0,
};

export function __setBoundsResolverForTest(r: BoundsResolver): void {
  boundsResolver = r;
}

// Task 13 で i18n に置き換える一時 fallback。
function labelTemplates(): { displayPrimary: string; display: string } {
  return {
    displayPrimary: 'ディスプレイ {{n}}（プライマリ・{{w}}×{{h}}）',
    display: 'ディスプレイ {{n}}（{{w}}×{{h}}）',
  };
}

async function listSources(): Promise<CaptureSource[]> {
  const labels = labelTemplates();
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const win = getMainWindow();
  const selfId = win && !win.isDestroyed() ? win.getMediaSourceId() : '';

  try {
    const raw = await desktopCapturer.getSources({ types: ['window', 'screen'], fetchWindowIcons: false });
    return formatCaptureSources({
      sources: raw.map((s) => ({ id: s.id, name: s.name, display_id: s.display_id })),
      displays: displays.map((d) => ({
        id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor, primary: d.id === primaryId,
      })),
      selfMediaSourceId: selfId,
      labels,
    });
  } catch (err) {
    console.warn('[capture] getSources failed, falling back to displays only:', err);
    return displays.map((d, i) => ({
      id: `screen:${i}:0`,
      kind: 'screen' as const,
      label: (d.id === primaryId ? labels.displayPrimary : labels.display)
        .replace('{{n}}', String(i + 1))
        .replace('{{w}}', String(d.bounds.width))
        .replace('{{h}}', String(d.bounds.height)),
      displayId: d.id,
    }));
  }
}

type PrepareResult = { ok: true } | { ok: false; reason: string };

async function prepare(sourceId: string): Promise<PrepareResult> {
  pending = null;
  const list = await listSources();
  const found = list.find((s) => s.id === sourceId);
  if (!found) return { ok: false, reason: 'not-found' };

  if (found.kind === 'screen') {
    const display = screen.getAllDisplays().find((d) => d.id === found.displayId);
    if (!display) return { ok: false, reason: 'not-found' };
    const sf = display.scaleFactor;
    pending = {
      sourceId,
      kind: 'screen',
      label: found.label,
      bounds: {
        x: display.bounds.x * sf, y: display.bounds.y * sf,
        w: display.bounds.width * sf, h: display.bounds.height * sf,
        scaleFactor: sf,
      },
    };
    return { ok: true };
  }

  // window
  if (!boundsResolver.isAvailable()) return { ok: false, reason: 'unsupported' };
  const hwnd = parseHwndFromSourceId(sourceId);
  if (boundsResolver.isMinimized(hwnd)) return { ok: false, reason: 'minimized' };
  let rect: { x: number; y: number; w: number; h: number };
  try {
    rect = boundsResolver.getRect(hwnd);
  } catch (err) {
    console.warn('[capture] getRect failed:', err);
    return { ok: false, reason: 'bounds-failed' };
  }
  pending = {
    sourceId,
    kind: 'window',
    label: found.label,
    bounds: { ...rect, scaleFactor: boundsResolver.scaleFactorFor(hwnd) },
  };
  return { ok: true };
}

export function registerCaptureSourcesIpc(): void {
  ipcMain.handle('capture:listSources', () => listSources());
  ipcMain.handle('capture:prepare', (_e, sourceId: string) => prepare(sourceId));
}
