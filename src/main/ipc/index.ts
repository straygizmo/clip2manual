// src/main/ipc/index.ts
import { registerRecordingIpc } from './recording';
import { registerProjectIpc } from './project';
import { registerTranscriptionIpc } from './transcription';

export function registerIpc(): void {
  registerRecordingIpc();
  registerProjectIpc();
  registerTranscriptionIpc();
}
