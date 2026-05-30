export interface WindowRect { x: number; y: number; w: number; h: number }

export function parseHwndFromSourceId(sourceId: string): bigint {
  if (!sourceId.startsWith('window:')) {
    throw new Error(`Not a window source id: ${sourceId}`);
  }
  const parts = sourceId.split(':');
  if (parts.length < 2 || parts[1].length === 0) {
    throw new Error(`Malformed window source id: ${sourceId}`);
  }
  if (!/^\d+$/.test(parts[1])) {
    throw new Error(`HWND segment is not numeric: ${sourceId}`);
  }
  return BigInt(parts[1]);
}

interface User32 {
  GetWindowRect: (hwnd: bigint, rectOut: object) => number;
  IsIconic: (hwnd: bigint) => number;
}

let cachedUser32: User32 | null = null;
let cachedKoffi: typeof import('koffi') | null = null;

function loadUser32(): User32 {
  if (cachedUser32) return cachedUser32;
  if (process.platform !== 'win32') {
    throw new Error('winBounds is only supported on Windows');
  }
  if (!cachedKoffi) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedKoffi = require('koffi');
  }
  const koffi = cachedKoffi!;
  const user32 = koffi.load('user32.dll');
  const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  cachedUser32 = {
    GetWindowRect: user32.func('__stdcall', 'GetWindowRect', 'bool', ['intptr', koffi.out(koffi.pointer(RECT))]),
    IsIconic: user32.func('__stdcall', 'IsIconic', 'bool', ['intptr']),
  };
  return cachedUser32!;
}

/** OS スクリーン座標（物理ピクセル）でのウィンドウ矩形。最小化中は呼ばないこと。 */
export function getWindowRectByHwnd(hwnd: bigint): WindowRect {
  const u = loadUser32();
  const rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const ok = u.GetWindowRect(hwnd, rect);
  if (!ok) throw new Error(`GetWindowRect failed for HWND ${hwnd.toString()}`);
  return { x: rect.left, y: rect.top, w: rect.right - rect.left, h: rect.bottom - rect.top };
}

export function isWindowMinimized(hwnd: bigint): boolean {
  const u = loadUser32();
  return u.IsIconic(hwnd) !== 0;
}

/** koffi/user32 がロードできるかを確認（テストや non-Windows での早期判定に使う）。 */
export function isWinBoundsAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    loadUser32();
    return true;
  } catch {
    return false;
  }
}
