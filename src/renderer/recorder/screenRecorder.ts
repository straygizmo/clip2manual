export interface RecordingResult {
  videoBlob: Blob;
  audioBlob: Blob;
  videoWidth: number;
  videoHeight: number;
}

export class ScreenRecorder {
  private videoRecorder?: MediaRecorder;
  private audioRecorder?: MediaRecorder;
  private videoChunks: Blob[] = [];
  private audioChunks: Blob[] = [];
  private videoStream?: MediaStream;
  private audioStream?: MediaStream;
  private videoSettings?: MediaTrackSettings;

  async start(): Promise<void> {
    this.videoStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      this.videoStream.getTracks().forEach((t) => t.stop());
      this.videoStream = undefined;
      throw err;
    }
    this.videoSettings = this.videoStream.getVideoTracks()[0].getSettings();

    this.videoChunks = [];
    this.audioChunks = [];
    this.videoRecorder = new MediaRecorder(this.videoStream, { mimeType: 'video/webm;codecs=vp9' });
    this.videoRecorder.ondataavailable = (e) => { if (e.data.size) this.videoChunks.push(e.data); };
    this.audioRecorder = new MediaRecorder(this.audioStream, { mimeType: 'audio/webm;codecs=opus' });
    this.audioRecorder.ondataavailable = (e) => { if (e.data.size) this.audioChunks.push(e.data); };

    this.videoRecorder.start();
    this.audioRecorder.start();
  }

  async stop(): Promise<RecordingResult> {
    if (!this.videoRecorder || !this.audioRecorder) {
      throw new Error('ScreenRecorder.stop() called before start()');
    }
    const stopOne = (r: MediaRecorder) =>
      new Promise<void>((resolve) => { r.onstop = () => resolve(); r.stop(); });
    await Promise.all([stopOne(this.videoRecorder), stopOne(this.audioRecorder)]);
    this.videoStream?.getTracks().forEach((t) => t.stop());
    this.audioStream?.getTracks().forEach((t) => t.stop());
    return {
      videoBlob: new Blob(this.videoChunks, { type: 'video/webm' }),
      audioBlob: new Blob(this.audioChunks, { type: 'audio/webm' }),
      videoWidth: this.videoSettings?.width ?? 0,
      videoHeight: this.videoSettings?.height ?? 0,
    };
  }
}
