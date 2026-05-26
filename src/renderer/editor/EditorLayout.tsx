import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/editorStore';
import { PreviewPlayer } from './PreviewPlayer';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { decodeToWav } from '../audio/decodeToWav';
import { projectAssetUrl } from './assetUrl';

export function EditorLayout() {
  const { state, dispatch } = useEditor();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);

  // 進捗イベントの購読
  useEffect(() => {
    const unsub = window.api.onTranscriptionProgress((p) =>
      dispatch({ type: 'TRANSCRIPTION_PROGRESS', percent: p }),
    );
    return unsub;
  }, [dispatch]);

  const project = state.project;
  if (!project) return null;
  const segments = project.segments;
  const selectedIndex = segments.findIndex((s) => s.id === state.selectedSegmentId);
  const selected = selectedIndex >= 0 ? segments[selectedIndex] : null;

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
    if (audioRef.current) audioRef.current.currentTime = t;
    dispatch({ type: 'SET_CURRENT_TIME', time: t });
  };

  async function runTranscription() {
    dispatch({ type: 'TRANSCRIPTION_START' });
    try {
      if (!(await window.api.assetExists('assets/narration.wav'))) {
        const webm = await window.api.readAsset('assets/narration.webm');
        const wav = await decodeToWav(webm);
        await window.api.writeAsset('assets/narration.wav', wav);
      }
      const { segments: result } = await window.api.runTranscription();
      dispatch({ type: 'TRANSCRIPTION_DONE', segments: result });
    } catch (err) {
      dispatch({ type: 'TRANSCRIPTION_ERROR', error: String(err) });
    }
  }

  const tx = state.transcription;

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr auto', height: '100vh' }}>
      {/* ツールバー */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', background: '#2a2a2a', color: '#fff' }}>
        <button onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}>← ホーム</button>
        <strong>{project.meta.name}</strong>
        <button onClick={runTranscription} disabled={tx.status === 'running'}>
          {tx.status === 'running' ? `文字起こし中… ${tx.percent}%` : '文字起こし'}
        </button>
        {tx.status === 'running' && <button onClick={() => window.api.cancelTranscription()}>キャンセル</button>}
        {tx.status === 'error' && <span style={{ color: '#f88' }}>失敗: {tx.error}</span>}
      </div>

      {/* 中央＝プレビュー / 右＝インスペクタ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', minHeight: 0 }}>
        <PreviewPlayer
          videoRef={videoRef}
          audioRef={audioRef}
          videoUrl={projectAssetUrl('assets/raw.webm', state.projectDir ?? '')}
          audioUrl={projectAssetUrl('assets/narration.webm', state.projectDir ?? '')}
          onTime={(t) => dispatch({ type: 'SET_CURRENT_TIME', time: t })}
          onDuration={setDuration}
        />
        <div style={{ borderLeft: '1px solid #ddd', overflow: 'auto' }}>
          <Inspector segment={selected} index={selectedIndex} />
        </div>
      </div>

      {/* 下＝タイムライン */}
      <Timeline
        duration={duration}
        currentTime={state.currentTime}
        segments={segments}
        selectedId={state.selectedSegmentId}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onSeek={seek}
      />
    </div>
  );
}
