import { useRef, useState, type RefObject } from 'react';

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  videoUrl: string;
  audioUrl: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
}

/** 映像(c2m:raw.webm)を主時計に、ナレーション音声(narration.webm)を従わせて同期再生する。 */
export function PreviewPlayer({ videoRef, audioRef, videoUrl, audioUrl, onTime, onDuration }: Props) {
  const [playing, setPlaying] = useState(false);
  // MediaRecorder 製の WebM は Duration メタデータを持たず、video.duration が
  // Infinity になる（末尾まで再生/シークするまで確定しない）。読み込み時に一度
  // 末尾へシークして実尺を確定させる。その間は時刻通知・音声同期を抑止する。
  const resolvingDuration = useRef(false);

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
    v.currentTime = 1e101; // 末尾へ飛ばして duration を確定させる
  };

  const syncAudioTime = () => {
    if (resolvingDuration.current) return;
    const v = videoRef.current;
    const a = audioRef.current;
    if (v && a && Math.abs(a.currentTime - v.currentTime) > 0.15) a.currentTime = v.currentTime;
  };

  const togglePlay = () => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000' }}>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          onLoadedMetadata={(e) => resolveDuration(e.currentTarget)}
          onTimeUpdate={(e) => {
            if (resolvingDuration.current) return;
            onTime(e.currentTarget.currentTime);
            syncAudioTime();
          }}
          onPlay={() => { if (audioRef.current) void audioRef.current.play(); setPlaying(true); }}
          onPause={() => { audioRef.current?.pause(); setPlaying(false); }}
          onSeeked={syncAudioTime}
        />
        <audio ref={audioRef} src={audioUrl} />
      </div>
      <div style={{ padding: 8, background: '#222', color: '#fff' }}>
        <button onClick={togglePlay}>{playing ? '⏸ 一時停止' : '▶ 再生'}</button>
      </div>
    </div>
  );
}
