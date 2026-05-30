import { contextBridge, ipcRenderer } from 'electron';
import type { Segment, ProjectSettings } from '../shared/types';

export interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

// main 側 createWindow が additionalArguments で渡す --c2m-locale を読み取り、
// renderer 側 i18n 初期化に同期的に提供する。
const localeArg = process.argv.find((a) => a.startsWith('--c2m-locale='));
const locale = localeArg ? localeArg.slice('--c2m-locale='.length) : 'ja';

contextBridge.exposeInMainWorld('api', {
  locale,
  startRecording: () => ipcRenderer.invoke('recording:start'),
  stopRecording: (payload: StopPayload) => ipcRenderer.invoke('recording:stop', payload),

  openProjectDialog: () => ipcRenderer.invoke('project:openDialog'),
  openProject: (projectDir: string) => ipcRenderer.invoke('project:open', projectDir),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  trashProject: (projectDir: string) => ipcRenderer.invoke('project:trash', projectDir),
  renameProject: (projectDir: string, newName: string) => ipcRenderer.invoke('project:rename', projectDir, newName),
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
  exportDialog: () => ipcRenderer.invoke('export:dialog'),
  runExport: (outPath: string) => ipcRenderer.invoke('export:run', outPath),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb: (percent: number) => void) => {
    const listener = (_e: unknown, percent: number) => cb(percent);
    ipcRenderer.on('export:progress', listener);
    return () => { ipcRenderer.removeListener('export:progress', listener); };
  },
  setupStatus: () => ipcRenderer.invoke('setup:status'),
  runSetup: () => ipcRenderer.invoke('setup:install'),
  cancelSetup: () => ipcRenderer.invoke('setup:cancel'),
  onSetupProgress: (cb: (p: { tool: string; percent: number }) => void) => {
    const listener = (_e: unknown, p: { tool: string; percent: number }) => cb(p);
    ipcRenderer.on('setup:progress', listener);
    return () => { ipcRenderer.removeListener('setup:progress', listener); };
  },
  onSetupStatusChanged: (cb: (s: { whisper: boolean; voicevox: boolean; ffmpeg: boolean }) => void) => {
    const listener = (_e: unknown, s: { whisper: boolean; voicevox: boolean; ffmpeg: boolean }) => cb(s);
    ipcRenderer.on('setup:statusChanged', listener);
    return () => { ipcRenderer.removeListener('setup:statusChanged', listener); };
  },
  listCaptureSources: () => ipcRenderer.invoke('capture:listSources'),
  prepareCapture: (sourceId: string) => ipcRenderer.invoke('capture:prepare', sourceId),
  notifyRecordingStarted: () => ipcRenderer.invoke('window:recordingStarted'),
  notifyRecordingStopped: () => ipcRenderer.invoke('window:recordingStopped'),
  onWindowAutoStop: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('window:autoStop', listener);
    return () => { ipcRenderer.removeListener('window:autoStop', listener); };
  },
});
