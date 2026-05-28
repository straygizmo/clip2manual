import { net } from 'electron';
import { createWriteStream, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

/** url を dest にダウンロードする。content-length があれば onProgress(0..100) を通知。signal で中断可。
 *  Electron の `net.fetch`（Chromium ネットワークスタック）を使うため、
 *  Windows システムプロキシおよび `session.defaultSession.setProxy` で設定したプロキシを尊重する。
 *  失敗・中断時は部分ファイルを掃除する（dest は最終パスに直接書くため、skip-if-present の取り違えを防ぐ）。 */
export async function download(
  url: string,
  dest: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await net.fetch(url, { redirect: 'follow', signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
    const total = Number(res.headers.get('content-length') || 0);
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    if (onProgress && total > 0) {
      let received = 0;
      body.on('data', (c: Buffer) => {
        received += c.length;
        onProgress(Math.min(100, Math.round((received / total) * 100)));
      });
    }
    await pipeline(body, createWriteStream(dest));
  } catch (err) {
    await rm(dest, { force: true });
    throw err;
  }
}

/** PowerShell Expand-Archive で zip を展開する（追加依存なし）。 */
export function extractZip(zip: string, dest: string): void {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path "${zip}" -DestinationPath "${dest}" -Force`],
    { stdio: 'ignore', windowsHide: true },
  );
}

/** dir 以下を再帰検索し、名前が target（小文字一致）の最初のファイルパスを返す。 */
export function findNamed(dir: string, target: string): string | null {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const found = findNamed(p, target);
      if (found) return found;
    } else if (name.toLowerCase() === target) {
      return p;
    }
  }
  return null;
}
