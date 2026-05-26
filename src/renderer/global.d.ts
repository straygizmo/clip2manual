export interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

declare global {
  interface Window {
    api: {
      startRecording: () => Promise<{ ok: boolean }>;
      stopRecording: (payload: StopPayload) => Promise<{ projectDir: string; clickCount: number }>;
    };
  }
}

export {};
