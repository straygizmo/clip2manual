import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor } from '../state/editorStore';
import { PreviewPlayer } from './PreviewPlayer';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { decodeToWav } from '../audio/decodeToWav';
import { projectAssetUrl } from './assetUrl';
import { type SpeakerOption } from '../../shared/types';

export function EditorLayout() {
  const { state, dispatch } = useEditor();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [speakers, setSpeakers] = useState<SpeakerOption[]>([]);
  const speakersLoading = useRef(false);
  const [ttsNonce, setTtsNonce] = useState(0);
  const [exportState, setExportState] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; percent: number; message: string }>(
    { status: 'idle', percent: 0, message: '' },
  );
  const [playingId, setPlayingId] = useState<string | null>(null);
  const handleActiveSegment = useCallback((id: string | null) => setPlayingId(id), []);

  // 文字起こし・TTS 進捗イベントの購読
  useEffect(() => {
    const unsubTx = window.api.onTranscriptionProgress((p) =>
      dispatch({ type: 'TRANSCRIPTION_PROGRESS', percent: p }),
    );
    const unsubTts = window.api.onTtsProgress((p) =>
      dispatch({ type: 'TTS_PROGRESS', percent: p }),
    );
    const unsubExport = window.api.onExportProgress((p) =>
      setExportState((s) => (s.status === 'running' ? { ...s, percent: p } : s)),
    );
    return () => { unsubTx(); unsubTts(); unsubExport(); };
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

  // 話者一覧を遅延取得する（初回TTS操作時にエンジンが起動する）。
  async function loadSpeakers() {
    if (speakersLoading.current || speakers.length > 0) return;
    speakersLoading.current = true;
    try {
      setSpeakers(await window.api.ttsSpeakers());
    } catch {
      // 取得失敗時はフォールバック option のままにする
    } finally {
      speakersLoading.current = false;
    }
  }

  async function generateSegment(id: string) {
    dispatch({ type: 'TTS_START' });
    try {
      void loadSpeakers(); // クレジット表示用に一覧も取得
      const { segments: result } = await window.api.ttsGenerateSegment(id);
      dispatch({ type: 'TTS_GENERATED', segments: result });
      setTtsNonce((n) => n + 1);
    } catch (err) {
      dispatch({ type: 'TTS_ERROR', error: String(err) });
    }
  }

  async function generateAll() {
    dispatch({ type: 'TTS_START' });
    try {
      void loadSpeakers();
      const { segments: result } = await window.api.ttsGenerateAll();
      dispatch({ type: 'TTS_GENERATED', segments: result });
      setTtsNonce((n) => n + 1);
    } catch (err) {
      dispatch({ type: 'TTS_ERROR', error: String(err) });
    }
  }

  async function doExport() {
    const outPath = await window.api.exportDialog();
    if (!outPath) return;
    setExportState({ status: 'running', percent: 0, message: '' });
    try {
      const res = await window.api.runExport(outPath);
      setExportState({ status: 'done', percent: 100, message: `書き出し完了: ${res.outPath}（${res.credit}）` });
    } catch (err) {
      setExportState({ status: 'error', percent: 0, message: String(err) });
    }
  }

  function setDefaultVoice(voice: { speaker: number; speed: number }) {
    dispatch({ type: 'SET_DEFAULT_VOICE', voice });
    // 直後の state は未更新なので settings をその場で組み立てて保存する
    void window.api.updateSettings({
      ...project!.settings,
      tts: { defaultSpeaker: voice.speaker, defaultSpeed: voice.speed },
    });
  }

  function applyDefaultToAll() {
    const v = { speaker: project!.settings.tts.defaultSpeaker, speed: project!.settings.tts.defaultSpeed };
    const updated = segments.map((s) => ({ ...s, voice: { ...v } }));
    dispatch({ type: 'APPLY_DEFAULT_VOICE_TO_ALL' });
    void window.api.updateSegments(updated);
  }

  const tx = state.transcription;
  const tts = state.tts;
  const ttsBusy = tts.status === 'running';
  const defaultSpeaker = project.settings.tts.defaultSpeaker;
  const defaultSpeed = project.settings.tts.defaultSpeed;
  const defaultOptions = speakers.length > 0
    ? speakers
    : [{ speaker: defaultSpeaker, label: `話者 ${defaultSpeaker}` }];

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr auto', height: '100vh' }}>
      {/* ツールバー */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', background: '#2a2a2a', color: '#fff', flexWrap: 'wrap' }}>
        <button onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}>← ホーム</button>
        <strong>{project.meta.name}</strong>
        <button onClick={runTranscription} disabled={tx.status === 'running'}>
          {tx.status === 'running' ? `文字起こし中… ${tx.percent}%` : '文字起こし'}
        </button>
        {tx.status === 'running' && <button onClick={() => window.api.cancelTranscription()}>キャンセル</button>}
        {tx.status === 'error' && <span style={{ color: '#f88' }}>失敗: {tx.error}</span>}

        <span style={{ marginLeft: 12, fontSize: 12, color: '#bbb' }}>既定の声</span>
        <select
          value={defaultSpeaker}
          onMouseDown={loadSpeakers}
          onChange={(e) => setDefaultVoice({ speaker: Number(e.target.value), speed: defaultSpeed })}
          disabled={ttsBusy}
        >
          {defaultOptions.map((o) => (
            <option key={o.speaker} value={o.speaker}>{o.label}</option>
          ))}
        </select>
        <input
          type="range" min={0.5} max={2} step={0.05} value={defaultSpeed}
          onChange={(e) => setDefaultVoice({ speaker: defaultSpeaker, speed: Number(e.target.value) })}
          disabled={ttsBusy}
          title={`速度 ${defaultSpeed.toFixed(2)}`}
        />
        <button onClick={applyDefaultToAll} disabled={ttsBusy}>全セグメントに適用</button>

        <button onClick={generateAll} disabled={ttsBusy}>
          {ttsBusy ? `生成中… ${tts.percent}%` : '全セグメント生成'}
        </button>
        {ttsBusy && <button onClick={() => window.api.cancelTts()}>キャンセル</button>}
        {ttsBusy && tts.percent === 0 && <span style={{ fontSize: 12, color: '#bbb' }}>（初回はエンジン起動に時間がかかります）</span>}
        {tts.status === 'error' && <span style={{ color: '#f88' }}>TTS失敗: {tts.error}</span>}
        <button onClick={doExport} disabled={exportState.status === 'running'}>
          {exportState.status === 'running' ? `書き出し中… ${exportState.percent}%` : '書き出し'}
        </button>
        {exportState.status === 'running' && <button onClick={() => window.api.cancelExport()}>キャンセル</button>}
        {exportState.status === 'done' && <span style={{ fontSize: 12, color: '#9c9' }}>{exportState.message}</span>}
        {exportState.status === 'error' && <span style={{ color: '#f88' }}>書き出し失敗: {exportState.message}</span>}
      </div>

      {/* 中央＝プレビュー / 右＝インスペクタ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', minHeight: 0 }}>
        <PreviewPlayer
          videoRef={videoRef}
          audioRef={audioRef}
          videoUrl={projectAssetUrl('assets/raw.webm', state.projectDir ?? '')}
          audioUrl={projectAssetUrl('assets/narration.webm', state.projectDir ?? '')}
          segments={segments}
          projectDir={state.projectDir ?? ''}
          onTime={(t) => dispatch({ type: 'SET_CURRENT_TIME', time: t })}
          onDuration={setDuration}
          onActiveSegment={handleActiveSegment}
        />
        <div style={{ borderLeft: '1px solid #ddd', overflow: 'auto' }}>
          <Inspector
            segment={selected}
            index={selectedIndex}
            speakers={speakers}
            projectDir={state.projectDir ?? ''}
            ttsNonce={ttsNonce}
            busy={ttsBusy}
            onLoadSpeakers={loadSpeakers}
            onGenerate={generateSegment}
          />
        </div>
      </div>

      {/* 下＝タイムライン */}
      <Timeline
        duration={duration}
        currentTime={state.currentTime}
        segments={segments}
        selectedId={state.selectedSegmentId}
        playingId={playingId}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onSeek={seek}
      />
    </div>
  );
}
