import { net, session } from 'electron';
import { createWriteStream, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

let proxyCreds: { username: string; password: string } | null = null;

/** main エントリで HTTPS_PROXY 等から取り出した資格情報を保存する。download() の login ハンドラが使う。 */
export function setProxyCreds(creds: { username: string; password: string } | null): void {
  proxyCreds = creds;
}

/** url を dest にダウンロードする。content-length があれば onProgress(0..100) を通知。signal で中断可。
 *  Electron の `net.request` を使うため Chromium ネットワークスタック経由になり、
 *  session.defaultSession.setProxy / Windows システムプロキシ / allowNTLMCredentialsForDomains を尊重する。
 *  Basic プロキシ認証（407）は `req.on('login')` で setProxyCreds() の値を返して応答する
 *  （※ net.fetch では login イベントが発火しないため net.request 直叩きにしている）。
 *  失敗・中断時は部分ファイルを掃除する。 */
export async function download(
  url: string,
  dest: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const req = net.request({
        url,
        method: 'GET',
        redirect: 'follow',
        session: session.defaultSession,
      });

      req.on('login', (authInfo, callback) => {
        console.log('[req login]', {
          isProxy: authInfo.isProxy, scheme: authInfo.scheme, host: authInfo.host, port: authInfo.port,
        });
        if (authInfo.isProxy && proxyCreds) {
          callback(proxyCreds.username, proxyCreds.password);
        } else {
          callback(); // cancel — surfaces as a non-2xx response or request error
        }
      });

      if (signal) {
        if (signal.aborted) {
          req.abort();
          return reject(new Error(`Aborted: ${url}`));
        }
        signal.addEventListener('abort', () => req.abort(), { once: true });
      }

      req.on('error', reject);
      req.on('response', (res) => {
        const status = res.statusCode;
        if (status < 200 || status >= 300) {
          // 失敗時はレスポンス本文を最大2KBまで集めて理由をエラーに含める
          // （社内プロキシのURLフィルタは 403/451 でブロック理由を返すことが多い）。
          // Content-Type の charset を尊重する（Shift_JIS/EUC-JP の社内ブロックページに対応）。
          const chunks: Buffer[] = [];
          let collected = 0;
          res.on('data', (c: Buffer) => {
            if (collected < 2048) {
              chunks.push(c);
              collected += c.length;
            }
          });
          res.on('end', () => {
            const ctHeader = res.headers['content-type'];
            const ct = (Array.isArray(ctHeader) ? ctHeader[0] : ctHeader) ?? '';
            const charset = (ct.match(/charset=([^;\s]+)/i)?.[1] ?? 'utf-8').toLowerCase();
            const buf = Buffer.concat(chunks).subarray(0, 2048);
            let body: string;
            try { body = new TextDecoder(charset).decode(buf).trim(); }
            catch { body = buf.toString('utf8').trim(); }
            reject(new Error(`Download failed (${status}) for ${url}${body ? `: ${body}` : ''}`));
          });
          res.on('error', reject);
          return;
        }
        const cl = res.headers['content-length'];
        const total = Number((Array.isArray(cl) ? cl[0] : cl) || 0);
        const ws = createWriteStream(dest);
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (onProgress && total > 0) {
            onProgress(Math.min(100, Math.round((received / total) * 100)));
          }
          ws.write(chunk);
        });
        res.on('error', reject);
        res.on('end', () => ws.end());
        ws.on('finish', () => resolve());
        ws.on('error', reject);
      });

      req.end();
    });
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
