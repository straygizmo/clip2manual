import { useRef, useState, useEffect, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { type Segment } from '../../shared/types';
import { TtsPreviewController } from '../audio/ttsPreview';
import { RippleCanvas } from './RippleCanvas';
import { Button } from '@/components/ui/button';
import { Play, Pause, Download, X } from 'lucide-react';

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  videoUrl: string;
  audioUrl: string;
  segments: Segment[];
  projectDir: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
  onActiveSegment: (id: string | null) => void;
  exportRunning: boolean;
  exportPercent: number;
  onExport: () => void;
  onCancelExport: () => void;
  /** Pass a fresh object to imperatively switch mode (e.g. on TTS generation start). */
  requestedMode?: { mode: 'original' | 'tts' } | null;
}

/**
 * 元音声モード: 映像(c2m:raw.webm)を主時計に narration を従わせて再生（従来どおり）。
 * TTSモード: TtsPreviewController が TTS を Web Audio でスケジュールし映像を駆動する。
 */
export function PreviewPlayer({
  videoRef, audioRef, videoUrl, audioUrl, segments, projectDir, onTime, onDuration, onActiveSegment,
  exportRunning, exportPercent, onExport, onCancelExport, requestedMode,
}: Props) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<'original' | 'tts'>('original');
  const [ttsLoading, setTtsLoading] = useState(false);
  const resolvingDuration = useRef(false);
  const modeGen = useRef(0);

  // コールバックを最新参照で呼ぶ（コントローラは一度だけ生成する）
  const onActiveRef = useRef(onActiveSegment);
  onActiveRef.current = onActiveSegment;
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  const controllerRef = useRef<TtsPreviewController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new TtsPreviewController({
      onActiveSegment: (id) => onActiveRef.current(id),
      onTime: (t) => onTimeRef.current(t),
      onEnded: () => setPlaying(false),
    });
  }
  useEffect(() => () => { controllerRef.current?.dispose(); controllerRef.current = null; }, []);

  // MediaRecorder 製 WebM は duration メタが無く Infinity になるため、末尾シークで実尺を確定する。
  const resolveDuration = (v: HTMLVideoElement) => {
    if (Number.isFinite(v.duration) && v.duration > 0) {
      onDuration(v.duration);
      return;
    }
    resolvingDuration.current = true;
    const onDurationChange = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return;
      v.removeEventListener('durationchange', onDurationChange);
      onDuration(v.duration);
      resolvingDuration.current = false;
      v.currentTime = 0;
    };
    v.addEventListener('durationchange', onDurationChange);
    v.currentTime = 1e101;
  };

  const syncAudioTime = () => {
    if (resolvingDuration.current) return;
    const v = videoRef.current;
    const a = audioRef.current;
    if (v && a && Number.isFinite(v.currentTime) && Math.abs(a.currentTime - v.currentTime) > 0.15) {
      a.currentTime = v.currentTime;
    }
  };

  const inTts = () => mode === 'tts';

  const toggleOriginal = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    if (v.paused) {
      if (a && Number.isFinite(v.currentTime)) { a.currentTime = v.currentTime; void a.play(); }
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      a?.pause();
      setPlaying(false);
    }
  };

  const toggleTts = async () => {
    const c = controllerRef.current;
    const v = videoRef.current;
    if (!c || !v) return;
    if (playing) {
      c.pause();
      setPlaying(false);
    } else {
      const started = await c.play(v); // play 中に中断されたら false
      setPlaying(started);
    }
  };

  const togglePlay = () => { if (inTts()) void toggleTts(); else toggleOriginal(); };

  const switchMode = async (next: 'original' | 'tts') => {
    if (next === mode) return;
    const gen = ++modeGen.current; // load の await 中に別の切替が来たら無効化
    videoRef.current?.pause();
    audioRef.current?.pause();
    controllerRef.current?.stop();
    setPlaying(false);
    if (next === 'tts') {
      setTtsLoading(true);
      try { await controllerRef.current?.load(segments, projectDir); } finally { setTtsLoading(false); }
    }
    if (gen !== modeGen.current) return; // 後続の切替が優先
    setMode(next);
  };

  const switchModeRef = useRef(switchMode);
  switchModeRef.current = switchMode;
  useEffect(() => {
    if (!requestedMode) return;
    void switchModeRef.current(requestedMode.mode);
  }, [requestedMode]);

  const missing = mode === 'tts' && !ttsLoading && (controllerRef.current?.missingClips() ?? false);
  const clicks = segments.flatMap((s) => s.clicks);

  return (
    <div className="flex h-full flex-col bg-preview-bg">
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div className="relative inline-block max-h-full max-w-full">
          <video
            ref={videoRef}
            src={videoUrl}
            className="block max-h-full max-w-full"
            onLoadedMetadata={(e) => resolveDuration(e.currentTarget)}
            onTimeUpdate={(e) => {
              if (inTts() || resolvingDuration.current) return;
              onTime(e.currentTarget.currentTime);
              syncAudioTime();
            }}
            onPlay={() => { if (inTts()) return; if (audioRef.current) void audioRef.current.play(); setPlaying(true); }}
            onPause={() => { if (inTts()) return; audioRef.current?.pause(); setPlaying(false); }}
            onSeeked={() => { if (inTts()) return; syncAudioTime(); }}
          />
          <RippleCanvas videoRef={videoRef} clicks={clicks} />
        </div>
        <audio ref={audioRef} src={audioUrl} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 bg-muted px-3 py-2 text-foreground">
        <Button size="sm" onClick={togglePlay} disabled={ttsLoading}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}{playing ? t('preview.pause') : t('preview.play')}</Button>
        <span className="text-xs text-muted-foreground">{t('preview.audioLabel')}</span>
        <Button size="sm" variant={mode === 'original' ? 'default' : 'secondary'} onClick={() => void switchMode('original')} disabled={mode === 'original' || ttsLoading}>{t('preview.modeOriginal')}</Button>
        <Button size="sm" variant={mode === 'tts' ? 'default' : 'secondary'} onClick={() => void switchMode('tts')} disabled={mode === 'tts' || ttsLoading}>{t('preview.modeTts')}</Button>
        {ttsLoading && <span className="text-xs text-muted-foreground">{t('preview.ttsLoading')}</span>}
        {missing && <span className="text-xs text-amber-500">{t('preview.missingTtsHint')}</span>}
        <div className="ml-auto flex items-center gap-2">
          {exportRunning && (
            <Button variant="ghost" size="sm" onClick={onCancelExport}>
              <X className="size-4" />{t('common.cancel')}
            </Button>
          )}
          <Button size="sm" onClick={onExport} disabled={exportRunning}>
            <Download className="size-4" />
            {exportRunning ? t('preview.exporting', { percent: exportPercent }) : t('preview.export')}
          </Button>
        </div>
      </div>
    </div>
  );
}
