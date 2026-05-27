// scripts/setup-ffmpeg.mjs
// 静的ビルドの ffmpeg.exe / ffprobe.exe を vendor/ffmpeg/ に取得し manifest.json を書く。
// gyan.dev の release-essentials zip（常に最新リリース）を使用。zip は Expand-Archive で展開。
import { existsSync, mkdirSync, createWriteStream, writeFileSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

const vendorDir = resolve(process.cwd(), 'vendor', 'ffmpeg');
const extractDir = join(vendorDir, 'dist');
const zipPath = join(vendorDir, 'ffmpeg.zip');

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

  let ffmpegPath = existsSync(extractDir) ? findNamed(extractDir, 'ffmpeg.exe') : null;
  let ffprobePath = existsSync(extractDir) ? findNamed(extractDir, 'ffprobe.exe') : null;
  if (!ffmpegPath || !ffprobePath) {
    await download(ZIP_URL, zipPath);
    mkdirSync(extractDir, { recursive: true });
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`,
    ], { stdio: 'inherit' });
    await rm(zipPath, { force: true });
    ffmpegPath = findNamed(extractDir, 'ffmpeg.exe');
    ffprobePath = findNamed(extractDir, 'ffprobe.exe');
  }
  if (!ffmpegPath || !ffprobePath) {
    throw new Error(`ffmpeg.exe/ffprobe.exe not found under ${extractDir} after extraction. Check the zip layout / URL.`);
  }

  writeFileSync(join(vendorDir, 'manifest.json'), JSON.stringify({ ffmpegPath, ffprobePath }, null, 2));
  console.log(`\nDone.\n  ffmpeg:  ${ffmpegPath}\n  ffprobe: ${ffprobePath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
