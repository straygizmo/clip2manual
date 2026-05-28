// src/main/ipc/tts.ts
import { ipcMain } from 'electron';
import { projectSession } from '../projectSession';
import { resolveVoicevox } from '../voicevox/voicevoxPaths';
import { vendorDir } from '../provision/vendorDirs';
import { VoicevoxEngine, defaultEngineDeps } from '../voicevox/engine';
import { synthesize, fetchSpeakers, flattenSpeakers, type SynthesizeInput } from '../voicevox/ttsClient';
import { generateTts, type TtsClient } from '../voicevox/ttsService';

let engine: VoicevoxEngine | null = null;
let currentAbort: AbortController | null = null;

/** 未プロビジョニング時は resolveVoicevox が VoicevoxNotProvisionedError を投げ、レンダラに伝わる。 */
function getEngine(): VoicevoxEngine {
  if (!engine) {
    const { runPath } = resolveVoicevox({ vendorDir: vendorDir('voicevox') });
    engine = new VoicevoxEngine(defaultEngineDeps(runPath));
  }
  return engine;
}

const client: TtsClient = {
  synthesize: (baseUrl: string, input: SynthesizeInput) => synthesize(baseUrl, input),
};

/** アプリ終了時にエンジンを停止する。 */
export function stopVoicevoxEngine(): void {
  engine?.stop();
  engine = null;
}

export function registerTtsIpc(): void {
  ipcMain.handle('tts:speakers', async () => {
    const baseUrl = await getEngine().ensureRunning();
    return flattenSpeakers(await fetchSpeakers(baseUrl));
  });

  ipcMain.handle('tts:generateSegment', async (_e, id: string) => {
    const { dir, project } = projectSession.getCurrent();
    const updated = await generateTts({
      engine: getEngine(), client, outDir: dir, segments: project.segments, onlyId: id,
    });
    await projectSession.updateSegments(updated);
    return { segments: updated };
  });

  ipcMain.handle('tts:generateAll', async (event) => {
    const { dir, project } = projectSession.getCurrent();
    currentAbort = new AbortController();
    try {
      const updated = await generateTts({
        engine: getEngine(), client, outDir: dir, segments: project.segments,
        onProgress: (done, total) => event.sender.send('tts:progress', Math.round((done / total) * 100)),
        signal: currentAbort.signal,
      });
      await projectSession.updateSegments(updated);
      return { segments: updated };
    } finally {
      currentAbort = null;
    }
  });

  ipcMain.handle('tts:cancel', () => {
    currentAbort?.abort();
    return { ok: true as const };
  });
}
