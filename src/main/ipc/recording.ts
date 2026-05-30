// src/main/ipc/recording.ts
import { ipcMain, screen, app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ClickHook } from '../clickHook';
import { initProjectDir, saveProject, assetPath } from '../projectStore';
import { buildClickLog } from '../../shared/clickLog';
import { type CaptureGeometry } from '../../shared/coordinateTransform';
import { createProject, type ProjectSource } from '../../shared/types';
import { resolveFfmpeg, FfmpegNotProvisionedError } from '../ffmpegPaths';
import { runFfmpeg } from '../export/ffmpegRunner';

/**
 * MediaRecorder が出力する WebM には Cues（シーク用インデックス）が無いため、
 * <video> 要素は buffered 範囲外への seek を黙って失敗させ、TTS プレビューや
 * タイムラインクリックなど任意位置への seek が壊れる。ffmpeg -c copy で再 mux
 * すると Cues が付与されシーク可能になる。ffmpeg 未配備時はスキップして従来動作。
 */
async function tryAddWebmCues(filePath: string): Promise<void> {
  let ffmpegPath: string;
  try {
    ffmpegPath = resolveFfmpeg().ffmpegPath;
  } catch (err) {
    if (err instanceof FfmpegNotProvisionedError) return; // 配備前は素通り
    throw err;
  }
  const indexedPath = filePath + '.indexed.webm';
  try {
    await runFfmpeg(ffmpegPath, ['-y', '-i', filePath, '-c', 'copy', indexedPath]);
    await fs.rename(indexedPath, filePath);
  } catch (err) {
    // 録画自体は保存済みなので、再 mux 失敗は致命ではない。Cues 無しのままで継続。
    console.warn(`[recording] failed to add WebM cues for ${filePath}: ${String(err)}`);
    try { await fs.unlink(indexedPath); } catch { /* 既に無ければ無視 */ }
  }
}

interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

let clickHook: ClickHook | null = null;
let t0Ms = 0;

export function registerRecordingIpc(): void {
  ipcMain.handle('recording:start', () => {
    if (clickHook) clickHook.stop(); // defensive: release any lingering hook before starting a new one
    clickHook = new ClickHook();
    clickHook.start();
    t0Ms = Date.now();
    return { ok: true };
  });

  ipcMain.handle('recording:stop', async (_e, payload: StopPayload) => {
    const rawEvents = clickHook ? clickHook.stop() : [];
    clickHook = null;

    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor;
    // uiohook は物理ピクセルで座標を返す前提。DIP の bounds をスケール倍して物理空間に合わせる。
    // （実機での整合は手動検証で確認し、必要なら係数を調整する。）
    const geometry: CaptureGeometry = {
      displayOriginX: display.bounds.x * sf,
      displayOriginY: display.bounds.y * sf,
      displayWidth: display.bounds.width * sf,
      displayHeight: display.bounds.height * sf,
      videoWidth: payload.videoWidth,
      videoHeight: payload.videoHeight,
    };
    const clicks = buildClickLog(rawEvents, t0Ms, geometry);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const projectDir = path.join(app.getPath('videos'), 'clip2manual', `rec-${stamp}`);
    await initProjectDir(projectDir);
    // NOTE: phase 1 transfers the whole recording through IPC as ArrayBuffers. For longer
    // recordings, a later phase should hand off via a temp file path instead of copying bytes over IPC.
    const rawPath = assetPath(projectDir, 'assets/raw.webm');
    const narrationPath = assetPath(projectDir, 'assets/narration.webm');
    await fs.writeFile(rawPath, Buffer.from(payload.video));
    await fs.writeFile(narrationPath, Buffer.from(payload.audio));
    await fs.writeFile(assetPath(projectDir, 'assets/clicks.json'), JSON.stringify(clicks, null, 2));
    // 任意位置シークを可能にするため Cues を付与（失敗は無視）
    await tryAddWebmCues(rawPath);
    await tryAddWebmCues(narrationPath);

    const source: ProjectSource = {
      video: 'assets/raw.webm',
      narration: 'assets/narration.webm',
      clickLog: 'assets/clicks.json',
      display: {
        width: payload.videoWidth,
        height: payload.videoHeight,
        scaleFactor: sf,
        originX: display.bounds.x,
        originY: display.bounds.y,
      },
    };
    const project = createProject({ name: path.basename(projectDir), source });
    await saveProject(projectDir, project);

    return { projectDir, clickCount: clicks.length };
  });
}
