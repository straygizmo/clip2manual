import type React from 'react';
import { type Segment } from '../../shared/types';
import { segmentRect, timeToPercent } from './timelineGeometry';
import { cn } from '@/lib/utils';

interface Props {
  duration: number;
  currentTime: number;
  segments: Segment[];
  selectedId: string | null;
  playingId: string | null;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onSplitAtClick?: (segmentId: string, t: number) => void;
}

const ROW_H = 28;

export function Timeline({
  duration, currentTime, segments, selectedId, playingId,
  onSelect, onSeek, onSplitAtClick,
}: Props) {
  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, ratio)) * duration);
  };

  const row = (label: string, children: React.ReactNode) => (
    <div className="flex items-center" style={{ height: ROW_H }}>
      <div className="w-[90px] shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="relative flex-1 bg-timeline-track" style={{ height: ROW_H }} onClick={seekFromEvent}>
        {children}
      </div>
    </div>
  );

  const allClicks = segments.flatMap((s) =>
    s.clicks.map((c) => ({ ...c, segmentId: s.id })),
  );

  return (
    <div className="relative bg-timeline-bg p-2">
      {row('映像', null)}
      {row('セグメント', segments.map((s) => {
        const r = segmentRect(s.videoStart, s.videoEnd, duration);
        return (
          <div
            key={s.id}
            onClick={(e) => { e.stopPropagation(); onSelect(s.id); }}
            title={s.correctedText}
            className={cn(
              'absolute box-border cursor-pointer overflow-hidden whitespace-nowrap rounded-sm border border-segment-border px-1 text-[11px] text-foreground',
              s.id === playingId
                ? 'bg-segment-playing ring-2 ring-amber-300'
                : s.id === selectedId
                  ? 'bg-segment-selected'
                  : s.ttsAudio
                    ? 'bg-segment-generated'
                    : 'bg-segment',
              s.enabled === false && 'opacity-35',
            )}
            style={{ top: 3, height: ROW_H - 6, left: `${r.left}%`, width: `${r.width}%` }}
          >
            {s.correctedText}
          </div>
        );
      }))}
      {row('クリック', allClicks.map((c, i) => (
        <div
          key={`${c.segmentId}-${i}`}
          className="absolute size-4 cursor-pointer"
          style={{ top: ROW_H / 2 - 8, left: `calc(${timeToPercent(c.t, duration)}% - 8px)` }}
          title="ダブルクリックで分割"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); onSplitAtClick?.(c.segmentId, c.t); }}
        >
          <div
            className="size-2 rotate-45 bg-click-marker"
            style={{ margin: '4px' }}
          />
        </div>
      )))}
      {/* 再生ヘッド */}
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-playhead"
        style={{ left: `calc(90px + (100% - 90px) * ${timeToPercent(currentTime, duration) / 100})` }}
      />
    </div>
  );
}
