// src/main/ipc/index.ts
import { registerRecordingIpc } from './recording';
import { registerProjectIpc } from './project';
import { registerTranscriptionIpc } from './transcription';
import { registerTtsIpc } from './tts';
import { registerExportIpc } from './export';
import { registerSetupIpc } from './setup';

export function registerIpc(): void {
  registerRecordingIpc();
  registerProjectIpc();
  registerTranscriptionIpc();
  registerTtsIpc();
  registerExportIpc();
  registerSetupIpc();
}
