// scripts/setup-whisper.mjs
// whisper.cpp の Windows ビルド済みバイナリと ggml-small モデルを vendor/whisper/ に取得する。
import { existsSync, mkdirSync, createWriteStream, writeFileSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const WHISPER_VERSION = 'v1.7.4';
const BIN_URL = `https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`;
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';

const vendorDir = resolve(process.cwd(), 'vendor', 'whisper');
const binDir = join(vendorDir, 'bin');
const modelPath = join(vendorDir, 'ggml-small.bin');
const zipPath = join(vendorDir, 'whisper-bin-x64.zip');

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function findExe(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const found = findExe(p);
      if (found) return found;
    } else if (name === 'whisper-cli.exe' || name === 'main.exe') {
      return p;
    }
  }
  return null;
}

async function main() {
  mkdirSync(vendorDir, { recursive: true });

  if (!existsSync(modelPath)) {
    await download(MODEL_URL, modelPath);
  } else {
    console.log('Model already present, skipping.');
  }

  let exePath = existsSync(binDir) ? findExe(binDir) : null;
  if (!exePath) {
    await download(BIN_URL, zipPath);
    mkdirSync(binDir, { recursive: true });
    // PowerShell の Expand-Archive で展開（追加依存なし）
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${binDir}" -Force`,
    ], { stdio: 'inherit' });
    await rm(zipPath, { force: true });
    exePath = findExe(binDir);
  }
  if (!exePath) {
    throw new Error(`whisper executable not found under ${binDir} after extraction. ` +
      `Check the release asset name for ${WHISPER_VERSION}.`);
  }

  writeFileSync(join(vendorDir, 'manifest.json'),
    JSON.stringify({ binPath: exePath, modelPath }, null, 2));
  console.log(`\nDone.\n  bin:   ${exePath}\n  model: ${modelPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
