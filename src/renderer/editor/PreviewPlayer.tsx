import { useRef, useState, useEffect, useImperativeHandle, forwardRef, type RefObject } from 'react';
import { type Segment } from '../../shared/types';
import { TtsPreviewController } from '../audio/ttsPreview';
import { RippleCanvas } from './RippleCanvas';

export interface PreviewPlayerHandle {
  togglePlay: () => void;
  switchMode: (next: 'original' | 'tts') => Promise<void>;
  /** 渡された segments で TTS コントローラを再 load する。auto-switch 後に
   *  TTS 音声ファイルが生成された直後に呼び、空 buffers の slot を破棄する。 */
  reloadTts: (segments: Segment[]) => Promise<void>;
}

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
  /** Pass a fresh object to imperatively switch mode (e.g. on TTS generation start). */
  requestedMode?: { mode: 'original' | 'tts' } | null;
  /** 字幕表示テキスト。null/空文字で非表示。EditorLayout 側で pickSubtitle 結果が渡される。 */
  subtitleText: string | null;
  /** TTS モード進捗のフォワード（EditorLayout が pickSubtitle 引数に使う）。 */
  onSlotProgress: (hint: { slotId: string; offsetInSlot: number; visibleDuration: number } | null) => void;
  /** 再生状態が変化したら通知（Timeline の追尾再開エッジ判定用）。 */
  onPlayingChange?: (playing: boolean) => void;
  onModeChange?: (mode: 'original' | 'tts') => void;
  onTtsLoadingChange?: (loading: boolean) => void;
  onMissingChange?: (missing: boolean) => void;
}

/**
 * 元音声モード: 映像(c2m:raw.webm)を主時計に narration を従わせて再生（従来どおり）。
 * TTSモード: TtsPreviewController が TTS を Web Audio でスケジュールし映像を駆動する。
 */
export const PreviewPlayer = forwardRef<PreviewPlayerHandle, Props>(function PreviewPlayer({
  videoRef, audioRef, videoUrl, audioUrl, segments, projectDir, onTime, onDuration, onActiveSegment,
  requestedMode, subtitleText, onSlotProgress,
  onPlayingChange, onModeChange, onTtsLoadingChange, onMissingChange,
}, ref) {
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
  const onSlotProgressRef = useRef(onSlotProgress);
  onSlotProgressRef.current = onSlotProgress;
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

  const notifyPlaying = (p: boolean) => {
    setPlaying(p);
    onPlayingChangeRef.current?.(p);
  };

  const controllerRef = useRef<TtsPreviewController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new TtsPreviewController({
      onActiveSegment: (id) => onActiveRef.current(id),
      onTime: (t) => onTimeRef.current(t),
      onSlotProgress: (h) => onSlotProgressRef.current(h),
      onEnded: () => notifyPlaying(false),
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

  // 元音声モードの再生/一時停止は video 要素だけを叩き、音声側は <video> 要素の
  // onPlay/onPause ハンドラで一本化する。以前は toggleOriginal でも a.play() を
  // 呼んでいたため、video の onPlay で再度 a.play() が走り二重呼び出しで前者が
  // AbortError を出して無音になるケースがあった（pause→resume で再現）。
  const toggleOriginal = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const toggleTts = async () => {
    const c = controllerRef.current;
    const v = videoRef.current;
    if (!c || !v) return;
    if (playing) {
      c.pause();
      notifyPlaying(false);
    } else {
      const started = await c.play(v); // play 中に中断されたら false
      notifyPlaying(started);
    }
  };

  const togglePlay = () => { if (inTts()) void toggleTts(); else toggleOriginal(); };

  const switchMode = async (next: 'original' | 'tts') => {
    if (next === mode) return;
    const gen = ++modeGen.current; // load の await 中に別の切替が来たら無効化
    videoRef.current?.pause();
    audioRef.current?.pause();
    // ctx.close() を await することで、後続の <audio> 再生時に音声デバイスが
    // 確実に解放されている状態にする（元音声モードの無音バグ対策）。
    await controllerRef.current?.stop();
    notifyPlaying(false);
    if (next === 'tts') {
      setTtsLoading(true);
      try { await controllerRef.current?.load(segments, projectDir); } finally { setTtsLoading(false); }
    }
    if (gen !== modeGen.current) return; // 後続の切替が優先
    setMode(next);
  };

  useImperativeHandle(ref, () => ({
    togglePlay,
    switchMode,
    reloadTts: async (segs: Segment[]) => {
      await controllerRef.current?.load(segs, projectDir);
    },
  }), [mode, playing, segments, projectDir]);

  const switchModeRef = useRef(switchMode);
  switchModeRef.current = switchMode;
  useEffect(() => {
    if (!requestedMode) return;
    void switchModeRef.current(requestedMode.mode);
  }, [requestedMode]);

  // TTS スロットに影響する segment 属性（境界・enabled・ttsAudio）が変わったら、
  // コントローラを reload してスロットと buffers を最新化する。controller の
  // loadGen により先行 load との race は無効化されるので安全。playing 中は
  // 中断しないよう skip（次回 pause / play で追従する）。
  const ttsRelevantSig = segments
    .map((s) => `${s.id}:${s.videoStart}:${s.videoEnd}:${s.enabled !== false ? 1 : 0}:${s.ttsAudio ?? ''}`)
    .join('|');
  useEffect(() => {
    if (mode !== 'tts') return;
    if (playing) return;
    void controllerRef.current?.load(segments, projectDir);
    // segments は ttsRelevantSig 経由でだけ依存する（テキスト編集等で発火しないため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsRelevantSig, mode, projectDir]);

  useEffect(() => { onModeChange?.(mode); }, [mode, onModeChange]);
  useEffect(() => { onTtsLoadingChange?.(ttsLoading); }, [ttsLoading, onTtsLoadingChange]);
  useEffect(() => {
    const m = mode === 'tts' && !ttsLoading && (controllerRef.current?.missingClips() ?? false);
    onMissingChange?.(m);
  }, [mode, ttsLoading, segments, onMissingChange]);

  // 元音声モードの再生中は rAF で 60fps に currentTime を通知して playhead を
  // なめらかに動かす。<video>.ontimeupdate の発火間隔は ~250ms とまばらで、
  // 既定では赤バーが「とびとび」に見える。
  useEffect(() => {
    if (mode !== 'original' || !playing) return;
    const v = videoRef.current;
    if (!v) return;
    let rafId = 0;
    const tick = () => {
      if (v.paused) return;
      onTimeRef.current(v.currentTime);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [mode, playing]);

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
              // 一時停止中は state.currentTime を真実源にする：MediaRecorder 製 WebM は
              // 任意 seek が暗黙的に失敗することがあり、その場合 onTimeUpdate が「動画の実位置（=0）」
              // を返してユーザーのクリック位置を 0 に上書きしてしまう。
              if (e.currentTarget.paused) return;
              onTime(e.currentTarget.currentTime);
              syncAudioTime();
            }}
            onPlay={(e) => {
              if (inTts()) return;
              const a = audioRef.current;
              if (a && Number.isFinite(e.currentTarget.currentTime)) {
                // 念のため currentTime を video に揃えてから（一時停止中の微小ドリフト対策）
                // play する。catch しないと未捕捉拒否がコンソールに残ることがある。
                if (Math.abs(a.currentTime - e.currentTarget.currentTime) > 0.05) {
                  a.currentTime = e.currentTarget.currentTime;
                }
                void a.play().catch(() => { /* 再生不可は無視 */ });
              }
              notifyPlaying(true);
            }}
            onPause={() => { if (inTts()) return; audioRef.current?.pause(); notifyPlaying(false); }}
            onSeeked={() => { if (inTts()) return; syncAudioTime(); }}
          />
          <RippleCanvas videoRef={videoRef} clicks={clicks} />
          {subtitleText && (
            <div
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-pre-wrap break-words rounded px-3 py-1 text-center font-semibold text-white"
              style={{
                bottom: '8%',
                maxWidth: '80%',
                background: 'rgba(0, 0, 0, 0.55)',
                fontSize: 'clamp(14px, 3.5vh, 32px)',
                lineHeight: 1.3,
                textShadow: '0 0 2px black, 0 0 3px black',
                fontFamily: 'system-ui, -apple-system, "Yu Gothic UI", "Meiryo", sans-serif',
              }}
            >
              {subtitleText}
            </div>
          )}
        </div>
        <audio ref={audioRef} src={audioUrl} />
      </div>
    </div>
  );
});
