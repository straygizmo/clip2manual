import * as fs from 'node:fs';
import * as path from 'node:path';

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
    throw new VoicevoxNotProvisionedError(`VOICEVOX file not found: ${p}. Run: npm run setup:voicevox`);
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
    throw new VoicevoxNotProvisionedError(
      `VOICEVOX is not provisioned (${manifestPath} not found). Run: npm run setup:voicevox`,
    );
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VoicevoxPaths;
  assertExists(m.runPath);
  return { runPath: m.runPath };
}
