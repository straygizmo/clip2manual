import { contextBridge, ipcRenderer } from 'electron';
import type { Segment, ProjectSettings } from '../shared/types';

export interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

contextBridge.exposeInMainWorld('api', {
  startRecording: () => ipcRenderer.invoke('recording:start'),
  stopRecording: (payload: StopPayload) => ipcRenderer.invoke('recording:stop', payload),

  openProjectDialog: () => ipcRenderer.invoke('project:openDialog'),
  openProject: (projectDir: string) => ipcRenderer.invoke('project:open', projectDir),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  updateSegments: (segments: Segment[]) => ipcRenderer.invoke('project:updateSegments', segments),

  readAsset: (rel: string) => ipcRenderer.invoke('asset:read', rel),
  writeAsset: (rel: string, data: ArrayBuffer) => ipcRenderer.invoke('asset:write', { rel, data }),
  assetExists: (rel: string) => ipcRenderer.invoke('asset:exists', rel),

  runTranscription: () => ipcRenderer.invoke('transcription:run'),
  cancelTranscription: () => ipcRenderer.invoke('transcription:cancel'),
  onTranscriptionProgress: (cb: (percent: number) => void) => {
    const listener = (_e: unknown, percent: number) => cb(percent);
    ipcRenderer.on('transcription:progress', listener);
    return () => { ipcRenderer.removeListener('transcription:progress', listener); };
  },
  updateSettings: (settings: ProjectSettings) => ipcRenderer.invoke('project:updateSettings', settings),
  ttsSpeakers: () => ipcRenderer.invoke('tts:speakers'),
  ttsGenerateSegment: (id: string) => ipcRenderer.invoke('tts:generateSegment', id),
  ttsGenerateAll: () => ipcRenderer.invoke('tts:generateAll'),
  cancelTts: () => ipcRenderer.invoke('tts:cancel'),
  onTtsProgress: (cb: (percent: number) => void) => {
    const listener = (_e: unknown, percent: number) => cb(percent);
    ipcRenderer.on('tts:progress', listener);
    return () => { ipcRenderer.removeListener('tts:progress', listener); };
  },
});
