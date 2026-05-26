import { useRef, useState } from 'react';
import { ScreenRecorder } from './recorder/screenRecorder';

export default function App() {
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('録画していません');

  async function onStart() {
    const recorder = new ScreenRecorder();
    try {
      await recorder.start();              // screen + mic permission happens here
      await window.api.startRecording();   // start the click hook + t0 only after streams are live
      recorderRef.current = recorder;
      setRecording(true);
      setStatus('録画中…');
    } catch (err) {
      recorderRef.current = null;
      setRecording(false);
      setStatus(`録画開始に失敗しました: ${String(err)}`);
    }
  }

  async function onStop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      const result = await recorder.stop();
      const video = await result.videoBlob.arrayBuffer();
      const audio = await result.audioBlob.arrayBuffer();
      const res = await window.api.stopRecording({
        video,
        audio,
        videoWidth: result.videoWidth,
        videoHeight: result.videoHeight,
      });
      setRecording(false);
      recorderRef.current = null;
      setStatus(`保存しました: ${res.projectDir}（クリック ${res.clickCount} 件）`);
    } catch (err) {
      setRecording(false);
      recorderRef.current = null;
      setStatus(`保存に失敗しました: ${String(err)}`);
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>clip2manual</h1>
      <button onClick={recording ? onStop : onStart}>
        {recording ? '■ 停止して保存' : '● 録画開始'}
      </button>
      <p>{status}</p>
    </div>
  );
}
