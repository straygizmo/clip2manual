import { useEffect, useRef, useState } from 'react';
import { ScreenRecorder } from '../recorder/screenRecorder';
import { useEditor } from '../state/editorStore';
import type { RecentProject } from '../global';

export function HomeScreen() {
  const { dispatch } = useEditor();
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('録画していません');
  const [recent, setRecent] = useState<RecentProject[]>([]);

  const refreshRecent = () => { void window.api.recentProjects().then(setRecent); };
  useEffect(refreshRecent, []);

  async function open(projectDir: string) {
    const { project } = await window.api.openProject(projectDir);
    dispatch({ type: 'OPEN_PROJECT', projectDir, project });
  }

  async function onStart() {
    const recorder = new ScreenRecorder();
    try {
      await recorder.start();
      await window.api.startRecording();
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
        video, audio, videoWidth: result.videoWidth, videoHeight: result.videoHeight,
      });
      setRecording(false);
      recorderRef.current = null;
      setStatus(`保存しました（クリック ${res.clickCount} 件）。エディタを開きます…`);
      await open(res.projectDir);
    } catch (err) {
      setRecording(false);
      recorderRef.current = null;
      setStatus(`保存に失敗しました: ${String(err)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto' }}>
      <h1>clip2manual</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={recording ? onStop : onStart}>
          {recording ? '■ 停止して保存' : '● 録画開始'}
        </button>
        <button onClick={() => window.api.openProjectDialog().then((r) => r && dispatch({ type: 'OPEN_PROJECT', projectDir: r.projectDir, project: r.project }))}>
          フォルダから開く
        </button>
      </div>
      <p>{status}</p>

      <h2 style={{ fontSize: 16 }}>最近の録画</h2>
      {recent.length === 0 ? (
        <p style={{ color: '#888' }}>まだ録画がありません。</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {recent.map((r) => (
            <li key={r.projectDir} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <button onClick={() => open(r.projectDir)} style={{ marginRight: 8 }}>開く</button>
              {r.name}
              <span style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>{new Date(r.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
