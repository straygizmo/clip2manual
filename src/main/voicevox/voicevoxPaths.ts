import * as fs from 'node:fs';
import * as path from 'node:path';
import { tMain } from '../i18n';

export class VoicevoxNotProvisionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoicevoxNotProvisionedError';
  }
}

export interface VoicevoxPaths {
  runPath: string;
}

function assertExists(p: string): void {
  if (!fs.existsSync(p)) {
    throw new VoicevoxNotProvisionedError(tMain('errors.voicevoxFileNotFound', { path: p }));
  }
}

/**
 * VOICEVOX エンジンの run 実行ファイルパスを解決する。
 * 優先順: 環境変数 C2M_VOICEVOX_RUN → vendor/voicevox/manifest.json。
 * 設定画面による上書きはフェーズ8で追加予定。
 */
export function resolveVoicevox(opts: { vendorDir?: string } = {}): VoicevoxPaths {
  const envRun = process.env.C2M_VOICEVOX_RUN;
  if (envRun) {
    assertExists(envRun);
    return { runPath: envRun };
  }

  const vendorDir = opts.vendorDir ?? path.join(process.cwd(), 'vendor', 'voicevox');
  const manifestPath = path.join(vendorDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new VoicevoxNotProvisionedError(tMain('errors.voicevoxNotProvisioned', { path: manifestPath }));
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VoicevoxPaths;
  assertExists(m.runPath);
  return { runPath: m.runPath };
}
