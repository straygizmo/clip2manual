import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { userVendorDir } from './vendorDirs';
import { download, extractZip, findNamed } from './download';
import { apportionPercent } from './status';

// 既存 scripts/setup-*.mjs から移植（URL は当面ピン留め。404 時は更新）

// whisper.cpp v1.8.4 — scripts/setup-whisper.mjs と同一
const WHISPER_VERSION = 'v1.8.4';
const WHISPER_BIN_URL = `https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`;
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';

// VOICEVOX ENGINE 0.25.2 Windows CPU — scripts/setup-voicevox.mjs と同一
// 配布物は単一パートの .7z.001。7zr が .001 を指定すれば全体を展開する。
const VOICEVOX_VERSION = '0.25.2';
const VOICEVOX_ENGINE_URL = `https://github.com/VOICEVOX/voicevox_engine/releases/download/${VOICEVOX_VERSION}/voicevox_engine-windows-cpu-${VOICEVOX_VERSION}.7z.001`;
const SEVENZR_URL = 'https://www.7-zip.org/a/7zr.exe';

// gyan.dev release-essentials — scripts/setup-ffmpeg.mjs と同一
const FFMPEG_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

type OnProgress = (percent: number) => void;

/**
 * whisper-cli.exe + ggml-small.bin を取得し manifest { binPath, modelPath } を書く。
 * whisper-cli.exe を優先（main.exe は v1.7+ で deprecated スタブ）。
 * バイナリが既にあれば bin ダウンロードをスキップする（setup-whisper.mjs と同じ動作）。
 */
export async function installWhisper(onProgress: OnProgress, signal?: AbortSignal): Promise<void> {
  const dir = userVendorDir('whisper');
  const binDir = join(dir, 'bin');
  const modelPath = join(dir, 'ggml-small.bin');
  const zipPath = join(dir, 'whisper-bin-x64.zip');
  mkdirSync(dir, { recursive: true });

  // Step 0/2: model
  if (!existsSync(modelPath)) {
    await download(WHISPER_MODEL_URL, modelPath, (p) => onProgress(apportionPercent(0, 2, p)), signal);
  } else {
    onProgress(apportionPercent(0, 2, 100));
  }

  // Step 1/2: binary zip — skip if exe is already present (matches setup-whisper.mjs)
  let exePath: string | null = existsSync(binDir) ? findWhisperExe(binDir) : null;
  if (!exePath) {
    try {
      await download(WHISPER_BIN_URL, zipPath, (p) => onProgress(apportionPercent(1, 2, p)), signal);
      mkdirSync(binDir, { recursive: true });
      extractZip(zipPath, binDir);
    } finally {
      await rm(zipPath, { force: true });
    }
    exePath = findWhisperExe(binDir);
  } else {
    onProgress(apportionPercent(1, 2, 100));
  }

  if (!exePath) throw new Error('whisper executable not found after extraction');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ binPath: exePath, modelPath }, null, 2));
  onProgress(100);
}

/** whisper-cli.exe を優先し、なければ main.exe（setup-whisper.mjs の findExe と同一ロジック）。 */
function findWhisperExe(dir: string): string | null {
  return findNamed(dir, 'whisper-cli.exe') ?? findNamed(dir, 'main.exe');
}

/**
 * VOICEVOX ENGINE (Windows CPU) を 7zr で展開し manifest { runPath } を書く。
 * 配布物は単一パートの .7z.001（scripts/setup-voicevox.mjs コメント: 「単一パートの 7z」）。
 * 7zr は .001 を指定するだけで全体を展開するため、追加パートのダウンロードは不要。
 * run.exe が既にあれば ダウンロード・展開をスキップする（setup-voicevox.mjs と同じ動作）。
 */
export async function installVoicevox(onProgress: OnProgress, signal?: AbortSignal): Promise<void> {
  const dir = userVendorDir('voicevox');
  const engineRoot = join(dir, 'engine');
  const archivePath = join(dir, 'engine.7z.001');
  const sevenZr = join(dir, '7zr.exe');
  mkdirSync(dir, { recursive: true });

  // Skip extraction if run.exe already present (matches setup-voicevox.mjs)
  let runPath: string | null = existsSync(engineRoot) ? findNamed(engineRoot, 'run.exe') : null;
  if (!runPath) {
    if (!existsSync(sevenZr)) await download(SEVENZR_URL, sevenZr, undefined, signal);
    await download(VOICEVOX_ENGINE_URL, archivePath, (p) => onProgress(Math.round(p * 0.9)), signal);
    mkdirSync(engineRoot, { recursive: true });
    try {
      execFileSync(sevenZr, ['x', archivePath, `-o${engineRoot}`, '-y'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } finally {
      // 展開の成否に関わらず大容量アーカイブを残さない（setup-voicevox.mjs と同じ）
      await rm(archivePath, { force: true });
    }
    runPath = findNamed(engineRoot, 'run.exe');
  }

  if (!runPath) throw new Error('run.exe not found after extraction');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ runPath }, null, 2));
  onProgress(100);
}

/**
 * ffmpeg.exe + ffprobe.exe を取得し manifest { ffmpegPath, ffprobePath } を書く。
 * 既に dist/ 以下に両 exe があればダウンロードをスキップする（setup-ffmpeg.mjs と同じ動作）。
 */
export async function installFfmpeg(onProgress: OnProgress, signal?: AbortSignal): Promise<void> {
  const dir = userVendorDir('ffmpeg');
  const extractDir = join(dir, 'dist');
  const zipPath = join(dir, 'ffmpeg.zip');
  mkdirSync(dir, { recursive: true });

  // Skip download if both executables already present (matches setup-ffmpeg.mjs)
  let ffmpegPath: string | null = existsSync(extractDir) ? findNamed(extractDir, 'ffmpeg.exe') : null;
  let ffprobePath: string | null = existsSync(extractDir) ? findNamed(extractDir, 'ffprobe.exe') : null;
  if (!ffmpegPath || !ffprobePath) {
    try {
      await download(FFMPEG_ZIP_URL, zipPath, (p) => onProgress(Math.round(p * 0.9)), signal);
      mkdirSync(extractDir, { recursive: true });
      extractZip(zipPath, extractDir);
    } finally {
      await rm(zipPath, { force: true });
    }
    ffmpegPath = findNamed(extractDir, 'ffmpeg.exe');
    ffprobePath = findNamed(extractDir, 'ffprobe.exe');
  } else {
    onProgress(90);
  }

  if (!ffmpegPath || !ffprobePath) throw new Error('ffmpeg/ffprobe not found after extraction');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ffmpegPath, ffprobePath }, null, 2));
  onProgress(100);
}
