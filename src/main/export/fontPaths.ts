import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';

const FONT_FILENAME = 'NotoSansJP-Regular.otf';

let cachedBase64: string | null = null;

/** 開発: <repo>/vendor/fonts/<f>、本番: process.resourcesPath/fonts/<f>。 */
export function resolveSubtitleFontPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'fonts', FONT_FILENAME);
  }
  return path.join(app.getAppPath(), 'vendor', 'fonts', FONT_FILENAME);
}

/** 1回のみ読込み base64 をキャッシュ。 */
export async function loadSubtitleFontBase64(): Promise<string> {
  if (cachedBase64 !== null) return cachedBase64;
  const buf = await fs.readFile(resolveSubtitleFontPath());
  cachedBase64 = buf.toString('base64');
  return cachedBase64;
}

/** テスト用にキャッシュをリセット。 */
export function resetSubtitleFontCache(): void {
  cachedBase64 = null;
}
