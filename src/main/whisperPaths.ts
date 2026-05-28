import * as fs from 'node:fs';
import * as path from 'node:path';
import { tMain } from './i18n';

export class WhisperNotProvisionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhisperNotProvisionedError';
  }
}

export interface WhisperPaths {
  binPath: string;
  modelPath: string;
}

function assertExists(p: string): void {
  if (!fs.existsSync(p)) {
    throw new WhisperNotProvisionedError(tMain('errors.whisperFileNotFound', { path: p }));
  }
}

/**
 * whisper のバイナリとモデルのパスを解決する。
 * 優先順: 環境変数(C2M_WHISPER_BIN / C2M_WHISPER_MODEL) → vendor/whisper/manifest.json。
 * 設定画面による上書きはフェーズ8で追加予定。
 */
export function resolveWhisper(opts: { vendorDir?: string } = {}): WhisperPaths {
  const envBin = process.env.C2M_WHISPER_BIN;
  const envModel = process.env.C2M_WHISPER_MODEL;
  if (envBin && envModel) {
    assertExists(envBin);
    assertExists(envModel);
    return { binPath: envBin, modelPath: envModel };
  }

  const vendorDir = opts.vendorDir ?? path.join(process.cwd(), 'vendor', 'whisper');
  const manifestPath = path.join(vendorDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new WhisperNotProvisionedError(tMain('errors.whisperNotProvisioned', { path: manifestPath }));
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as WhisperPaths;
  assertExists(m.binPath);
  assertExists(m.modelPath);
  return { binPath: m.binPath, modelPath: m.modelPath };
}
