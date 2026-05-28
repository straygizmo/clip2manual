import * as fs from 'node:fs';
import * as path from 'node:path';
import { tMain } from './i18n';

export class FfmpegNotProvisionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegNotProvisionedError';
  }
}

export interface FfmpegPaths {
  ffmpegPath: string;
  ffprobePath: string;
}

function assertExists(p: string): void {
  if (!fs.existsSync(p)) {
    throw new FfmpegNotProvisionedError(tMain('errors.ffmpegFileNotFound', { path: p }));
  }
}

/**
 * ffmpeg/ffprobe のパスを解決する。
 * 優先順: 環境変数 C2M_FFMPEG / C2M_FFPROBE → vendor/ffmpeg/manifest.json。
 */
export function resolveFfmpeg(opts: { vendorDir?: string } = {}): FfmpegPaths {
  const envFf = process.env.C2M_FFMPEG;
  const envProbe = process.env.C2M_FFPROBE;
  if (envFf && envProbe) {
    assertExists(envFf);
    assertExists(envProbe);
    return { ffmpegPath: envFf, ffprobePath: envProbe };
  }

  const vendorDir = opts.vendorDir ?? path.join(process.cwd(), 'vendor', 'ffmpeg');
  const manifestPath = path.join(vendorDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new FfmpegNotProvisionedError(tMain('errors.ffmpegNotProvisioned', { path: manifestPath }));
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FfmpegPaths;
  assertExists(m.ffmpegPath);
  assertExists(m.ffprobePath);
  return { ffmpegPath: m.ffmpegPath, ffprobePath: m.ffprobePath };
}
