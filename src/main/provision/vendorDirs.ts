import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pickVendorDir, type Tool } from './paths';

/** install の書き込み先（常に userData 側）。 */
export function userVendorDir(tool: Tool): string {
  return join(app.getPath('userData'), 'vendor', tool);
}

/** resolve* に渡すベンダーディレクトリ（userData 優先・cwd フォールバック）。 */
export function vendorDir(tool: Tool): string {
  return pickVendorDir(
    join(app.getPath('userData'), 'vendor'),
    join(process.cwd(), 'vendor'),
    tool,
    (d) => existsSync(join(d, 'manifest.json')),
  );
}
