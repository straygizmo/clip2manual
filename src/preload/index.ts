import { contextBridge, ipcRenderer } from 'electron';

export interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

contextBridge.exposeInMainWorld('api', {
  startRecording: () => ipcRenderer.invoke('recording:start'),
  stopRecording: (payload: StopPayload) => ipcRenderer.invoke('recording:stop', payload),
});
