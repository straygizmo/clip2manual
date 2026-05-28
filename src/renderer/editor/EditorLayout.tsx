import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor } from '../state/editorStore';
import { PreviewPlayer } from './PreviewPlayer';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { decodeToWav } from '../audio/decodeToWav';
import { projectAssetUrl } from './assetUrl';
import { type SpeakerOption } from '../../shared/types';
import { splitAt } from '../state/segmentOps';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, FileText, Mic, X } from 'lucide-react';
import { toast } from 'sonner';

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
      toast.success('書き出し完了', { description: res.outPath });
    } catch (err) {
      setExportState({ status: 'error', percent: 0, message: String(err) });
      toast.error('書き出しに失敗しました', { description: String(err) });
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
    <div className="grid h-screen grid-rows-[48px_1fr_auto]">
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-2 bg-toolbar px-3 text-foreground">
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}>
          <ArrowLeft className="size-4" />ホーム
        </Button>
        <span className="font-semibold">{project.meta.name}</span>

        <Separator orientation="vertical" className="h-6" />

        <Button variant="secondary" size="sm" onClick={runTranscription} disabled={tx.status === 'running'}>
          <FileText className="size-4" />
          {tx.status === 'running' ? `文字起こし中… ${tx.percent}%` : '文字起こし'}
        </Button>
        {tx.status === 'running' && (
          <Button variant="ghost" size="sm" onClick={() => window.api.cancelTranscription()}>
            <X className="size-4" />キャンセル
          </Button>
        )}
        {tx.status === 'error' && <span className="text-xs text-destructive">失敗: {tx.error}</span>}

        <Separator orientation="vertical" className="h-6" />

        <span className="text-xs text-muted-foreground">既定の声</span>
        <Select
          value={String(defaultSpeaker)}
          onValueChange={(v) => setDefaultVoice({ speaker: Number(v), speed: defaultSpeed })}
          disabled={ttsBusy}
          onOpenChange={(o) => { if (o) loadSpeakers(); }}
        >
          <SelectTrigger className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {defaultOptions.map((o) => (
              <SelectItem key={o.speaker} value={String(o.speaker)}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Slider
          className="w-32"
          min={0.5}
          max={2}
          step={0.05}
          value={[defaultSpeed]}
          onValueChange={([v]) => setDefaultVoice({ speaker: defaultSpeaker, speed: v })}
          disabled={ttsBusy}
        />
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{defaultSpeed.toFixed(2)}x</span>
        <Button variant="secondary" size="sm" onClick={applyDefaultToAll} disabled={ttsBusy}>
          全セグメントに適用
        </Button>

        <Separator orientation="vertical" className="h-6" />

        <Button variant="secondary" size="sm" onClick={generateAll} disabled={ttsBusy}>
          <Mic className="size-4" />
          {ttsBusy ? `生成中… ${tts.percent}%` : '全セグメント生成'}
        </Button>
        {ttsBusy && (
          <Button variant="ghost" size="sm" onClick={() => window.api.cancelTts()}>
            <X className="size-4" />キャンセル
          </Button>
        )}
        {ttsBusy && tts.percent === 0 && (
          <span className="text-xs text-muted-foreground">（初回はエンジン起動に時間がかかります）</span>
        )}
        {tts.status === 'error' && <span className="text-xs text-destructive">TTS失敗: {tts.error}</span>}
      </div>

      {/* 中央＝プレビュー / 右＝インスペクタ */}
      <div className="grid min-h-0 grid-cols-[1fr_320px]">
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
          exportRunning={exportState.status === 'running'}
          exportPercent={exportState.percent}
          onExport={doExport}
          onCancelExport={() => window.api.cancelExport()}
          requestedMode={requestedMode}
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

      {/* 下＝タイムライン */}
      <Timeline
        duration={duration}
        currentTime={state.currentTime}
        segments={segments}
        selectedId={state.selectedSegmentId}
        playingId={playingId}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onSeek={seek}
        onSplitAtClick={onSplitAtClick}
      />
    </div>
  );
}
