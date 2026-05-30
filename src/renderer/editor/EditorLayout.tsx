import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor } from '../state/editorStore';
import { PreviewPlayer, type PreviewPlayerHandle } from './PreviewPlayer';
import { Timeline } from './Timeline';
import { TimelineToolbar } from './TimelineToolbar';
import { Inspector } from './Inspector';
import { StepperToolbar } from './StepperToolbar';
import { decodeToWav } from '../audio/decodeToWav';
import { projectAssetUrl } from './assetUrl';
import { type Segment, type SpeakerOption } from '../../shared/types';
import { splitAt, resizeBoundary, toggleEnabled, mergeWithNext, deleteClick } from '../state/segmentOps';
import { pickSubtitle } from '../../shared/subtitleSelect';
import { toast } from 'sonner';

export function EditorLayout() {
  const { t } = useTranslation();
  const { state, dispatch } = useEditor();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewRef = useRef<PreviewPlayerHandle>(null);
  const [duration, setDuration] = useState(0);
  const [speakers, setSpeakers] = useState<SpeakerOption[]>([]);
  const speakersLoading = useRef(false);
  const [ttsNonce, setTtsNonce] = useState(0);
  const [exportState, setExportState] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; percent: number; message: string }>(
    { status: 'idle', percent: 0, message: '' },
  );
  const [playingId, setPlayingId] = useState<string | null>(null);
  const handleActiveSegment = useCallback((id: string | null) => setPlayingId(id), []);
  const [playing, setPlaying] = useState(false);
  const [previewMode, setPreviewMode] = useState<'original' | 'tts'>('original');
  const [ttsPreviewLoading, setTtsPreviewLoading] = useState(false);
  const [missingClips, setMissingClips] = useState(false);
  const [slotHint, setSlotHint] = useState<{ slotId: string; offsetInSlot: number; visibleDuration: number } | null>(null);
  const onSlotProgress = useCallback((h: { slotId: string; offsetInSlot: number; visibleDuration: number } | null) => setSlotHint(h), []);
  const [requestedMode, setRequestedMode] = useState<{ mode: 'original' | 'tts' } | null>(null);

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
  const showSubtitles = project.settings.showSubtitles;
  const subtitleText = pickSubtitle(
    slotHint
      ? { segments, showSubtitles, cursor: { kind: 'tts', ...slotHint } }
      : { segments, showSubtitles, cursor: { kind: 'original', videoTime: state.currentTime } },
  );

  function setShowSubtitles(next: boolean) {
    const settings = { ...project!.settings, showSubtitles: next };
    dispatch({ type: 'SET_SETTINGS', settings });
    void window.api.updateSettings(settings);
  }

  const selectedIndex = segments.findIndex((s) => s.id === state.selectedSegmentId);
  const selected = selectedIndex >= 0 ? segments[selectedIndex] : null;

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
    if (audioRef.current) audioRef.current.currentTime = t;
    dispatch({ type: 'SET_CURRENT_TIME', time: t });
  };

  const onSplitAtClick = (segmentId: string, t: number) => {
    const newId = `seg-${Date.now()}`;
    const next = splitAt(segments, segmentId, t, newId);
    if (next === segments) return; // no-op（c.t == videoStart 等の境界）
    dispatch({ type: 'SET_SEGMENTS', segments: next, selectId: newId });
    void window.api.updateSegments(next);
  };

  const applySegments = (next: Segment[], selectId: string) => {
    dispatch({ type: 'SET_SEGMENTS', segments: next, selectId });
    void window.api.updateSegments(next);
  };

  const onToggleCut = (id: string) => applySegments(toggleEnabled(segments, id), id);
  const onMergeNext = (id: string) => applySegments(mergeWithNext(segments, id), id);
  const onSplitAtPlayhead = (id: string) => {
    const newId = `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next = splitAt(segments, id, state.currentTime, newId);
    if (next === segments) return;
    applySegments(next, newId);
  };
  const onDeleteClick = (key: { segmentId: string; t: number; x: number; y: number }) => {
    const next = deleteClick(segments, key);
    if (next === segments) return;
    dispatch({ type: 'SET_SEGMENTS', segments: next });
    void window.api.updateSegments(next);
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
    setRequestedMode({ mode: 'tts' });
    try {
      void loadSpeakers();
      const { segments: result } = await window.api.ttsGenerateAll();
      dispatch({ type: 'TTS_GENERATED', segments: result });
      setTtsNonce((n) => n + 1);
      // PreviewPlayer 側の reactive useEffect が ttsAudio の変化を検知して
      // 自動でコントローラを再 load する（auto-switch 時の空 buffers 問題対策）。
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
      setExportState({
        status: 'done',
        percent: 100,
        message: t('editor.exportDoneMessage', { path: res.outPath, credit: res.credit }),
      });
      toast.success(t('editor.exportSuccess'), { description: res.outPath });
    } catch (err) {
      setExportState({ status: 'error', percent: 0, message: String(err) });
      toast.error(t('editor.exportFailed'), { description: String(err) });
    }
  }

  const onResizeCommit = useCallback(
    (primaryId: string, side: 'left' | 'right', newTime: number) => {
      if (duration <= 0) return;
      const updated = resizeBoundary(segments, primaryId, side, newTime, duration);
      dispatch({ type: 'SET_SEGMENTS', segments: updated });
      void window.api.updateSegments(updated);
    },
    [dispatch, segments, duration],
  );

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

  return (
    <div className="grid h-screen grid-rows-[88px_1fr_auto]">
      <StepperToolbar
        projectName={project.meta.name}
        segments={segments}
        transcription={{ status: tx.status, error: tx.error, percent: tx.percent }}
        tts={{ status: tts.status, error: tts.error, percent: tts.percent }}
        exportState={exportState}
        showSubtitles={showSubtitles}
        defaultSpeaker={defaultSpeaker}
        defaultSpeed={defaultSpeed}
        speakers={speakers}
        onHome={() => dispatch({ type: 'CLOSE_PROJECT' })}
        onTranscribe={runTranscription}
        onCancelTranscription={() => window.api.cancelTranscription()}
        onSetDefaultVoice={setDefaultVoice}
        onApplyDefaultToAll={applyDefaultToAll}
        onLoadSpeakers={loadSpeakers}
        onGenerateAll={generateAll}
        onCancelTts={() => window.api.cancelTts()}
        onExport={doExport}
        onCancelExport={() => window.api.cancelExport()}
        onSetShowSubtitles={setShowSubtitles}
      />

      {/* 中央＝プレビュー / 右＝インスペクタ */}
      <div className="grid min-h-0 grid-cols-[1fr_320px]">
        <PreviewPlayer
          ref={previewRef}
          videoRef={videoRef}
          audioRef={audioRef}
          videoUrl={projectAssetUrl('assets/raw.webm', state.projectDir ?? '')}
          audioUrl={projectAssetUrl('assets/narration.webm', state.projectDir ?? '')}
          segments={segments}
          projectDir={state.projectDir ?? ''}
          onTime={(t) => dispatch({ type: 'SET_CURRENT_TIME', time: t })}
          onDuration={setDuration}
          onActiveSegment={handleActiveSegment}
          onPlayingChange={setPlaying}
          onModeChange={setPreviewMode}
          onTtsLoadingChange={setTtsPreviewLoading}
          onMissingChange={setMissingClips}
          requestedMode={requestedMode}
          subtitleText={subtitleText}
          onSlotProgress={onSlotProgress}
        />
        <div className="overflow-auto border-l border-border">
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

      {/* 下＝タイムライン（ツールバー＋本体）。relative+isolate+z-10 で <video> の OS 合成オーバーレイより前面に固定する。 */}
      <div className="relative isolate z-10 flex flex-col">
        <TimelineToolbar
          playing={playing}
          mode={previewMode}
          ttsLoading={ttsPreviewLoading}
          missingClips={missingClips}
          onTogglePlay={() => previewRef.current?.togglePlay()}
          onSwitchMode={(next) => { void previewRef.current?.switchMode(next); }}
          segments={segments}
          selected={selected}
          currentTime={state.currentTime}
          ttsBusy={ttsBusy}
          onToggleCut={onToggleCut}
          onSplitAtPlayhead={onSplitAtPlayhead}
          onMergeNext={onMergeNext}
        />
        <Timeline
          duration={duration}
          currentTime={state.currentTime}
          segments={segments}
          selectedId={state.selectedSegmentId}
          playingId={playingId}
          playing={playing}
          onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
          onSeek={seek}
          onSplitAtClick={onSplitAtClick}
          onResizeCommit={onResizeCommit}
          onDeleteClick={onDeleteClick}
        />
      </div>
    </div>
  );
}
