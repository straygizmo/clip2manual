import { useRef, useState, useEffect, type RefObject } from 'react';
import { type Segment } from '../../shared/types';
import { TtsPreviewController } from '../audio/ttsPreview';

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
}

/**
 * 元音声モード: 映像(c2m:raw.webm)を主時計に narration を従わせて再生（従来どおり）。
 * TTSモード: TtsPreviewController が TTS を Web Audio でスケジュールし映像を駆動する。
 */
export function PreviewPlayer({
  videoRef, audioRef, videoUrl, audioUrl, segments, projectDir, onTime, onDuration, onActiveSegment,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<'original' | 'tts'>('original');
  const [ttsLoading, setTtsLoading] = useState(false);
  const resolvingDuration = useRef(false);
  const modeGen = useRef(0);

  // onActiveSegment を最新参照で呼ぶ（コントローラは一度だけ生成する）
  const onActiveRef = useRef(onActiveSegment);
  onActiveRef.current = onActiveSegment;

  const controllerRef = useRef<TtsPreviewController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new TtsPreviewController({
      onActiveSegment: (id) => onActiveRef.current(id),
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
    if (v && a && Math.abs(a.currentTime - v.currentTime) > 0.15) a.currentTime = v.currentTime;
  };

  const inTts = () => mode === 'tts';

  const toggleOriginal = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    if (v.paused) {
      if (a) { a.currentTime = v.currentTime; void a.play(); }
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

  const missing = mode === 'tts' && !ttsLoading && (controllerRef.current?.missingClips() ?? false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000' }}>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ maxWidth: '100%', maxHeight: '100%' }}
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
        <audio ref={audioRef} src={audioUrl} />
      </div>
      <div style={{ padding: 8, background: '#222', color: '#fff', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={togglePlay} disabled={ttsLoading}>{playing ? '⏸ 一時停止' : '▶ 再生'}</button>
        <span style={{ fontSize: 12, color: '#bbb' }}>音声:</span>
        <button onClick={() => void switchMode('original')} disabled={mode === 'original'}>元音声</button>
        <button onClick={() => void switchMode('tts')} disabled={mode === 'tts'}>TTS</button>
        {ttsLoading && <span style={{ fontSize: 12, color: '#bbb' }}>TTS読み込み中…</span>}
        {missing && <span style={{ fontSize: 12, color: '#caa' }}>TTS未生成のセグメントは無音で再生されます</span>}
      </div>
    </div>
  );
}
