// src/main/ipc/export.ts
import { ipcMain, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { projectSession } from '../projectSession';
import { resolveFfmpeg } from '../ffmpegPaths';
import { runExport } from '../export/exportService';
import { runFfmpeg, runProbe } from '../export/ffmpegRunner';

const CREDIT = 'Audio synthesized with VOICEVOX (https://voicevox.hps.info/).';
let currentAbort: AbortController | null = null;

export function registerExportIpc(): void {
  ipcMain.handle('export:dialog', async () => {
    const { project } = projectSession.getCurrent();
    const res = await dialog.showSaveDialog({
      defaultPath: `${project.meta.name}.mp4`,
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return res.filePath;
  });

  ipcMain.handle('export:run', async (event, outPath: string) => {
    const { dir, project } = projectSession.getCurrent();
    const { ffmpegPath, ffprobePath } = resolveFfmpeg();
    const tmpDir = path.join(dir, 'export-tmp');
    currentAbort = new AbortController();
    try {
      await runExport({
        segments: project.segments,
        projectDir: dir,
        outPath,
        tmpDir,
        credit: CREDIT,
        runFfmpeg: (args) => runFfmpeg(ffmpegPath, args, currentAbort!.signal),
        runProbe: (args) => runProbe(ffprobePath, args),
        onProgress: (p) => event.sender.send('export:progress', p),
        signal: currentAbort.signal,
      });
      return { ok: true as const, outPath, credit: CREDIT };
    } finally {
      currentAbort = null;
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  ipcMain.handle('export:cancel', () => {
    currentAbort?.abort();
    return { ok: true as const };
  });
}
