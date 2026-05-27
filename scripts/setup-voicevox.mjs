// scripts/setup-voicevox.mjs
// VOICEVOX ENGINE（Windows CPU）を vendor/voicevox/ に取得・展開し manifest.json を書く。
// 配布物は単一パートの 7z（.7z.001）。PowerShell の Expand-Archive は 7z 非対応のため、
// スタンドアロンの 7zr.exe を取得して展開する。
import { existsSync, mkdirSync, createWriteStream, writeFileSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const VOICEVOX_VERSION = '0.25.2';
const ENGINE_URL = `https://github.com/VOICEVOX/voicevox_engine/releases/download/${VOICEVOX_VERSION}/voicevox_engine-windows-cpu-${VOICEVOX_VERSION}.7z.001`;
const SEVENZR_URL = 'https://www.7-zip.org/a/7zr.exe';

const vendorDir = resolve(process.cwd(), 'vendor', 'voicevox');
const engineRoot = join(vendorDir, 'engine');
const archivePath = join(vendorDir, 'engine.7z.001');
const sevenZrPath = join(vendorDir, '7zr.exe');

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function findNamed(dir, target) {
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

async function main() {
  mkdirSync(vendorDir, { recursive: true });

  let runPath = existsSync(engineRoot) ? findNamed(engineRoot, 'run.exe') : null;
  if (!runPath) {
    if (!existsSync(sevenZrPath)) await download(SEVENZR_URL, sevenZrPath);
    await download(ENGINE_URL, archivePath);
    mkdirSync(engineRoot, { recursive: true });
    try {
      // 7zr x: .7z.001 を指定すると（分割でも）まとめて展開する。
      execFileSync(sevenZrPath, ['x', archivePath, `-o${engineRoot}`, '-y'], { stdio: 'inherit' });
    } finally {
      // 展開の成否に関わらず大容量アーカイブを残さない（再試行時のディスク圧迫を防ぐ）。
      await rm(archivePath, { force: true });
    }
    runPath = findNamed(engineRoot, 'run.exe');
  }
  if (!runPath) {
    throw new Error(
      `run.exe not found under ${engineRoot} after extraction. ` +
      `Check the release asset name/format for VOICEVOX ENGINE ${VOICEVOX_VERSION}.`,
    );
  }

  writeFileSync(join(vendorDir, 'manifest.json'), JSON.stringify({ runPath }, null, 2));
  console.log(`\nDone.\n  run: ${runPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
