// src/main/assetProtocol.ts
import { protocol, net } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectSession } from './projectSession';

const SCHEME = 'c2m';

/** app ready より前に呼ぶ必要がある。 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true },
    },
  ]);
}

/** app ready 後に呼ぶ。c2m://asset/<相対パス> を現在のプロジェクト配下のファイルに解決する。 */
export function registerAssetProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const dir = projectSession.getCurrentProjectDir();
    if (!dir) return new Response('No project open', { status: 404 });

    const filePath = path.resolve(dir, rel);
    const normalizedDir = path.resolve(dir) + path.sep;
    if (filePath !== path.resolve(dir) && !filePath.startsWith(normalizedDir)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
