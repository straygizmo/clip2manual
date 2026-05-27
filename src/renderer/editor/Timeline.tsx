import type React from 'react';
import { type Segment } from '../../shared/types';
import { segmentRect, timeToPercent } from './timelineGeometry';

interface Props {
  duration: number;
  currentTime: number;
  segments: Segment[];
  selectedId: string | null;
  playingId: string | null;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
}

const ROW_H = 28;

export function Timeline({ duration, currentTime, segments, selectedId, playingId, onSelect, onSeek }: Props) {
  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, ratio)) * duration);
  };

  const row = (label: string, children: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', height: ROW_H }}>
      <div style={{ width: 90, fontSize: 12, color: '#aaa', flexShrink: 0 }}>{label}</div>
      <div style={{ position: 'relative', flex: 1, height: ROW_H, background: '#1b1b1b' }} onClick={seekFromEvent}>
        {children}
      </div>
    </div>
  );

  const allClicks = segments.flatMap((s) => s.clicks);

  return (
    <div style={{ position: 'relative', padding: 8, background: '#111' }}>
      {row('映像', null)}
      {row('セグメント', segments.map((s) => {
        const r = segmentRect(s.videoStart, s.videoEnd, duration);
        return (
          <div
            key={s.id}
            onClick={(e) => { e.stopPropagation(); onSelect(s.id); }}
            title={s.correctedText}
            style={{
              position: 'absolute', top: 3, height: ROW_H - 6,
              left: `${r.left}%`, width: `${r.width}%`,
              background: s.id === playingId ? '#2e8b57' : s.id === selectedId ? '#4a90d9' : '#3a3a3a',
              border: '1px solid #555', borderRadius: 3, overflow: 'hidden',
              fontSize: 11, color: '#fff', whiteSpace: 'nowrap', cursor: 'pointer', padding: '0 4px',
              boxSizing: 'border-box',
            }}
          >
            {s.correctedText}
          </div>
        );
      }))}
      {row('クリック', allClicks.map((c, i) => (
        <div key={i} style={{
          position: 'absolute', top: ROW_H / 2 - 4, width: 8, height: 8,
          left: `calc(${timeToPercent(c.t, duration)}% - 4px)`,
          background: '#e0a030', transform: 'rotate(45deg)',
        }} />
      )))}
      {/* 再生ヘッド */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        left: `calc(90px + (100% - 90px) * ${timeToPercent(currentTime, duration) / 100})`,
        width: 2, background: '#e54', pointerEvents: 'none',
      }} />
    </div>
  );
}
