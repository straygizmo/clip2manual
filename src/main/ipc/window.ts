import { ipcMain, nativeImage, app } from 'electron';
import * as path from 'node:path';
import { getMainWindow } from '../index';

function resolveOverlayPath(): string {
  // 開発時は repo の resources/icons、パッケージ後は process.resourcesPath/icons
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icons', 'recording-overlay.png');
  }
  return path.join(app.getAppPath(), 'resources', 'icons', 'recording-overlay.png');
}

export function registerWindowIpc(): void {
  ipcMain.handle('window:recordingStarted', () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false as const };
    const icon = nativeImage.createFromPath(resolveOverlayPath());
    win.setOverlayIcon(icon, 'recording');
    win.minimize();
    // 多重登録を避けるためまず全部外してから 1 回登録する
    win.removeAllListeners('restore');
    win.once('restore', () => {
      const w = getMainWindow();
      if (w && !w.isDestroyed()) w.webContents.send('window:autoStop');
    });
    return { ok: true as const };
  });

  ipcMain.handle('window:recordingStopped', () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false as const };
    win.setOverlayIcon(null, '');
    win.removeAllListeners('restore');
    return { ok: true as const };
  });
}
