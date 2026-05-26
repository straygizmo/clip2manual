import { useRef, useState } from 'react';
import { ScreenRecorder } from './recorder/screenRecorder';

export default function App() {
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('録画していません');

  async function onStart() {
    recorderRef.current = new ScreenRecorder();
    await window.api.startRecording();
    await recorderRef.current.start();
    setRecording(true);
    setStatus('録画中…');
  }

  async function onStop() {
    const result = await recorderRef.current!.stop();
    const video = await result.videoBlob.arrayBuffer();
    const audio = await result.audioBlob.arrayBuffer();
    const res = await window.api.stopRecording({
      video,
      audio,
      videoWidth: result.videoWidth,
      videoHeight: result.videoHeight,
    });
    setRecording(false);
    setStatus(`保存しました: ${res.projectDir}（クリック ${res.clickCount} 件）`);
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
