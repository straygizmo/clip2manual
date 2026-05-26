import { app, BrowserWindow, session, desktopCapturer } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { registerAssetScheme, registerAssetProtocol } from './assetProtocol';
import { stopVoicevoxEngine } from './ipc/tts';

registerAssetScheme(); // app ready より前に呼ぶ

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // audio: 'loopback' is ignored by the renderer (it calls getDisplayMedia with audio:false);
  // narration is captured separately via getUserMedia (the microphone) in ScreenRecorder.
  registerIpc();
  registerAssetProtocol();
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        // TODO phase-2+: allow the user to choose which display/window to capture.
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch((err) => {
        console.error('Failed to enumerate screen sources for display media', err);
        // Resolve with no video so the renderer's getDisplayMedia rejects instead of hanging.
        callback({});
      });
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopVoicevoxEngine();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
