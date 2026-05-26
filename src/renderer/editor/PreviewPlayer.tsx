import { useState, type RefObject } from 'react';

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

  const syncAudioTime = () => {
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
          onLoadedMetadata={(e) => onDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => { onTime(e.currentTarget.currentTime); syncAudioTime(); }}
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
