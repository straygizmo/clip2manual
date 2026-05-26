import type { Project, Segment } from '../shared/types';

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
      readAsset: (rel: string) => Promise<ArrayBuffer>;
      writeAsset: (rel: string, data: ArrayBuffer) => Promise<{ ok: true }>;
      assetExists: (rel: string) => Promise<boolean>;
      runTranscription: () => Promise<{ segments: Segment[] }>;
      cancelTranscription: () => Promise<{ ok: true }>;
      onTranscriptionProgress: (cb: (percent: number) => void) => () => void;
    };
  }
}

export {};
