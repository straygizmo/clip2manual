// src/main/ipc/transcription.ts
import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { projectSession } from '../projectSession';
import { assetPath } from '../projectStore';
import { resolveWhisper } from '../whisperPaths';
import { vendorDir } from '../provision/vendorDirs';
import { transcribe } from '../transcription/transcriptionService';
import { SpawnWhisperRunner } from '../transcription/whisperRunner';
import { type ClickEvent } from '../../shared/types';

let currentAbort: AbortController | null = null;

export function registerTranscriptionIpc(): void {
  ipcMain.handle('transcription:run', async (event) => {
    const { dir, project } = projectSession.getCurrent();
    const { binPath, modelPath } = resolveWhisper({ vendorDir: vendorDir('whisper') });

    const clicksRaw = await fs.readFile(assetPath(dir, 'assets/clicks.json'), 'utf8');
    const clicks = JSON.parse(clicksRaw) as ClickEvent[];
    const defaultVoice = {
      speaker: project.settings.tts.defaultSpeaker,
      speed: project.settings.tts.defaultSpeed,
    };

    currentAbort = new AbortController();
    try {
      const segments = await transcribe({
        runner: new SpawnWhisperRunner(),
        binPath,
        modelPath,
        audioPath: assetPath(dir, 'assets/narration.wav'),
        outDir: path.join(dir, 'assets'),
        language: 'ja',
        clicks,
        defaultVoice,
        onProgress: (pct) => event.sender.send('transcription:progress', pct),
        signal: currentAbort.signal,
      });
      await projectSession.updateSegments(segments);
      return { segments };
    } finally {
      currentAbort = null;
    }
  });

  ipcMain.handle('transcription:cancel', () => {
    currentAbort?.abort();
    return { ok: true as const };
  });
}
