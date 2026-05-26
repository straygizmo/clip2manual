// src/main/ipc/recording.ts
import { ipcMain, screen, app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ClickHook } from '../clickHook';
import { initProjectDir, saveProject, assetPath } from '../projectStore';
import { buildClickLog } from '../../shared/clickLog';
import { type CaptureGeometry } from '../../shared/coordinateTransform';
import { createProject, type ProjectSource } from '../../shared/types';

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
    if (clickHook) clickHook.stop();
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
    const geometry: CaptureGeometry = {
      displayOriginX: display.bounds.x * sf,
      displayOriginY: display.bounds.y * sf,
      displayWidth: display.bounds.width * sf,
      displayHeight: display.bounds.height * sf,
      videoWidth: payload.videoWidth,
      videoHeight: payload.videoHeight,
    };
    const clicks = buildClickLog(rawEvents, t0Ms, geometry);

    const projectDir = path.join(app.getPath('videos'), 'clip2manual', `rec-${Date.now()}`);
    await initProjectDir(projectDir);
    await fs.writeFile(assetPath(projectDir, 'assets/raw.webm'), Buffer.from(payload.video));
    await fs.writeFile(assetPath(projectDir, 'assets/narration.webm'), Buffer.from(payload.audio));
    await fs.writeFile(assetPath(projectDir, 'assets/clicks.json'), JSON.stringify(clicks, null, 2));

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
