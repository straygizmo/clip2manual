// src/main/ipc/transcription.ts
import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { projectSession } from '../projectSession';
import { assetPath } from '../projectStore';
import { resolveWhisper } from '../whisperPaths';
import { resolveFfmpeg } from '../ffmpegPaths';
import { vendorDir } from '../provision/vendorDirs';
import { transcribe } from '../transcription/transcriptionService';
import { clampSegmentsToDuration } from '../transcription/mapSegments';
import { SpawnWhisperRunner } from '../transcription/whisperRunner';
import { detectSilenceMs } from '../transcription/silenceDetect';
import { runProbe } from '../export/ffmpegRunner';
import { probeDurationArgs, parseProbeDuration } from '../export/ffargs';
import { type ClickEvent } from '../../shared/types';

let currentAbort: AbortController | null = null;

export function registerTranscriptionIpc(): void {
  ipcMain.handle('transcription:run', async (event) => {
    const { dir, project } = projectSession.getCurrent();
    const { binPath, modelPath } = resolveWhisper({ vendorDir: vendorDir('whisper') });
    const { ffmpegPath, ffprobePath } = resolveFfmpeg({ vendorDir: vendorDir('ffmpeg') });

    const clicksRaw = await fs.readFile(assetPath(dir, 'assets/clicks.json'), 'utf8');
    const clicks = JSON.parse(clicksRaw) as ClickEvent[];
    const defaultVoice = {
      speaker: project.settings.tts.defaultSpeaker,
      speed: project.settings.tts.defaultSpeed,
    };

    currentAbort = new AbortController();
    try {
      const rawSegments = await transcribe({
        runner: new SpawnWhisperRunner(),
        binPath,
        modelPath,
        audioPath: assetPath(dir, 'assets/narration.wav'),
        outDir: path.join(dir, 'assets'),
        language: 'ja',
        clicks,
        defaultVoice,
        silenceDetector: (audioPath, signal) =>
          detectSilenceMs({ ffmpegPath, audioPath, signal }),
        onProgress: (pct) => event.sender.send('transcription:progress', pct),
        signal: currentAbort.signal,
      });
      // narration の長さは raw.webm を僅かに超えることがあり、whisper の最終トークン
      // タイムスタンプが videoEnd を越えてしまう。raw.webm を ffprobe して clamp する。
      let videoDuration = 0;
      try {
        videoDuration = parseProbeDuration(
          await runProbe(ffprobePath, probeDurationArgs(assetPath(dir, 'assets/raw.webm'))),
        );
      } catch {
        // probe 失敗時はクランプ無し（従来動作）。
      }
      const segments = clampSegmentsToDuration(rawSegments, videoDuration);
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
