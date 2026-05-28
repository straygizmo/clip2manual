import type { Project, Segment, ProjectSettings, SpeakerOption } from '../shared/types';

export interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

export interface RecentProject {
  projectDir: string;
  name: string;
  createdAt: string;
}

export interface OpenedProject {
  projectDir: string;
  project: Project;
}

declare global {
  interface Window {
    api: {
      startRecording: () => Promise<{ ok: boolean }>;
      stopRecording: (payload: StopPayload) => Promise<{ projectDir: string; clickCount: number }>;
      openProjectDialog: () => Promise<OpenedProject | null>;
      openProject: (projectDir: string) => Promise<OpenedProject>;
      recentProjects: () => Promise<RecentProject[]>;
      updateSegments: (segments: Segment[]) => Promise<{ ok: true }>;
      readAsset: (rel: string) => Promise<ArrayBuffer>;
      writeAsset: (rel: string, data: ArrayBuffer) => Promise<{ ok: true }>;
      assetExists: (rel: string) => Promise<boolean>;
      runTranscription: () => Promise<{ segments: Segment[] }>;
      cancelTranscription: () => Promise<{ ok: true }>;
      onTranscriptionProgress: (cb: (percent: number) => void) => () => void;
      updateSettings: (settings: ProjectSettings) => Promise<{ ok: true }>;
      ttsSpeakers: () => Promise<SpeakerOption[]>;
      ttsGenerateSegment: (id: string) => Promise<{ segments: Segment[] }>;
      ttsGenerateAll: () => Promise<{ segments: Segment[] }>;
      cancelTts: () => Promise<{ ok: true }>;
      onTtsProgress: (cb: (percent: number) => void) => () => void;
      exportDialog: () => Promise<string | null>;
      runExport: (outPath: string) => Promise<{ ok: true; outPath: string; credit: string }>;
      cancelExport: () => Promise<{ ok: true }>;
      onExportProgress: (cb: (percent: number) => void) => () => void;
      setupStatus: () => Promise<{ whisper: boolean; voicevox: boolean; ffmpeg: boolean }>;
      runSetup: () => Promise<{ whisper: boolean; voicevox: boolean; ffmpeg: boolean }>;
      cancelSetup: () => Promise<{ ok: true }>;
      onSetupProgress: (cb: (p: { tool: string; percent: number }) => void) => () => void;
      onSetupStatusChanged: (cb: (s: { whisper: boolean; voicevox: boolean; ffmpeg: boolean }) => void) => () => void;
    };
  }
}

export {};
