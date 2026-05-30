import { registerRecordingIpc } from './recording';
import { registerProjectIpc } from './project';
import { registerTranscriptionIpc } from './transcription';
import { registerTtsIpc } from './tts';
import { registerExportIpc } from './export';
import { registerSetupIpc } from './setup';
import { registerWindowIpc } from './window';
import { registerCaptureSourcesIpc } from './captureSources';

export function registerIpc(): void {
  registerRecordingIpc();
  registerProjectIpc();
  registerTranscriptionIpc();
  registerTtsIpc();
  registerExportIpc();
  registerSetupIpc();
  registerWindowIpc();
  registerCaptureSourcesIpc();
}
