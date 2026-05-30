export interface WindowRect { x: number; y: number; w: number; h: number }

/**
 * Electron の desktopCapturer が返す window source id（"window:<hwnd>:<...>"）から
 * HWND を BigInt として取り出す。x64 環境では HWND が 32bit 範囲を超えうるため number は使わない。
 */
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
