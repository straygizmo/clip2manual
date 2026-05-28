import { ipcMain } from 'electron';
import { checkStatus, type ProvisionStatus } from '../provision/status';
import { type Tool } from '../provision/paths';
import { vendorDir } from '../provision/vendorDirs';
import { resolveWhisper } from '../whisperPaths';
import { resolveVoicevox } from '../voicevox/voicevoxPaths';
import { resolveFfmpeg } from '../ffmpegPaths';
import { installWhisper, installVoicevox, installFfmpeg } from '../provision/installers';

let currentAbort: AbortController | null = null;

function status(): ProvisionStatus {
  return checkStatus({
    whisper: () => { resolveWhisper({ vendorDir: vendorDir('whisper') }); },
    voicevox: () => { resolveVoicevox({ vendorDir: vendorDir('voicevox') }); },
    ffmpeg: () => { resolveFfmpeg({ vendorDir: vendorDir('ffmpeg') }); },
  });
}

const installers: Record<Tool, (onP: (p: number) => void, signal?: AbortSignal) => Promise<void>> = {
  whisper: installWhisper,
  voicevox: installVoicevox,
  ffmpeg: installFfmpeg,
};

export function registerSetupIpc(): void {
  ipcMain.handle('setup:status', () => status());

  ipcMain.handle('setup:install', async (event) => {
    const st = status();
    const missing = (Object.keys(st) as Tool[]).filter((t) => !st[t]);
    currentAbort = new AbortController();
    try {
      for (const tool of missing) {
        try {
          await installers[tool]((percent) => event.sender.send('setup:progress', { tool, percent }), currentAbort.signal);
        } catch (err) {
          throw new Error(`${tool}: ${String(err)}`);
        }
      }
      return status();
    } finally {
      currentAbort = null;
    }
  });

  ipcMain.handle('setup:cancel', () => {
    currentAbort?.abort();
    return { ok: true as const };
  });
}
