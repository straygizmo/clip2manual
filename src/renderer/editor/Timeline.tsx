import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { type Segment } from '../../shared/types';
import {
  segmentBox, timeToPx, pxToTime,
  pickMajorInterval, formatTimeLabel,
  clampZoom, applyZoomAtPoint,
  shouldAutoScroll,
} from './timelineGeometry';
import { cn } from '@/lib/utils';

interface Props {
  duration: number;
  currentTime: number;
  segments: Segment[];
  selectedId: string | null;
  playingId: string | null;
  playing: boolean;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onSplitAtClick?: (segmentId: string, t: number) => void;
}

const ROW_H = 28;
const LABEL_W = 90;
const MAX_PX_PER_SEC = 400;

export function Timeline({
  duration, currentTime, segments, selectedId, playingId, playing,
  onSelect, onSeek, onSplitAtClick,
}: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pxPerSec, setPxPerSec] = useState(0);

  // 初回（duration が確定したら）Fit で初期化
  useLayoutEffect(() => {
    if (pxPerSec === 0 && scrollRef.current && duration > 0) {
      setPxPerSec(scrollRef.current.clientWidth / duration);
    }
  }, [duration, pxPerSec]);

  const programmaticScroll = useRef(false);

  const [follow, setFollow] = useState(true);

  // 追尾実行
  useEffect(() => {
    if (!follow || !scrollRef.current || pxPerSec <= 0) return;
    const el = scrollRef.current;
    const playheadPx = timeToPx(currentTime, pxPerSec);
    const target = shouldAutoScroll({
      playheadPx, viewLeft: el.scrollLeft,
      viewWidth: el.clientWidth, margin: 40,
    });
    if (target !== null) {
      programmaticScroll.current = true;
      el.scrollLeft = target;
      requestAnimationFrame(() => { programmaticScroll.current = false; });
    }
  }, [currentTime, pxPerSec, follow]);

  // 再生立ち上がりエッジで follow=true 再開
  const prevPlaying = useRef(playing);
  useEffect(() => {
    if (playing && !prevPlaying.current) setFollow(true);
    prevPlaying.current = playing;
  }, [playing]);

  // 手動スクロール検出
  const handleScroll = () => {
    if (programmaticScroll.current) return;
    setFollow(false);
  };

  const fitPxPerSec = () => {
    const el = scrollRef.current;
    if (!el || duration <= 0) return 0;
    return el.clientWidth / duration;
  };

  const applyZoom = (next: number, mouseOffsetPx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const fit = fitPxPerSec();
    const clamped = clampZoom(next, fit, MAX_PX_PER_SEC);
    const r = applyZoomAtPoint({
      oldPxPerSec: pxPerSec, newPxPerSec: clamped,
      scrollLeft: el.scrollLeft, mouseOffsetPx,
    });
    programmaticScroll.current = true;
    setPxPerSec(r.pxPerSec);
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft = r.scrollLeft;
      programmaticScroll.current = false;
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const el = scrollRef.current!;
    const offset = e.clientX - el.getBoundingClientRect().left;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    applyZoom(pxPerSec * factor, offset);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const center = el.clientWidth / 2;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); applyZoom(pxPerSec * Math.SQRT2, center); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); applyZoom(pxPerSec / Math.SQRT2, center); }
    else if (e.key === '0') { e.preventDefault(); applyZoom(fitPxPerSec(), center); }
  };

  const contentWidth = duration > 0 && pxPerSec > 0 ? duration * pxPerSec : 0;

  // ticks（マイナーは線のみ、メジャーはラベル付き）
  const ticks: { t: number; major: boolean }[] = [];
  if (duration > 0 && pxPerSec > 0) {
    const major = pickMajorInterval(pxPerSec);
    const minor = major / 5;
    const last = Math.floor(duration / minor) * minor;
    for (let n = 0; n <= last / minor + 1e-6; n++) {
      const tt = n * minor;
      const isMajor = Math.abs((tt / major) - Math.round(tt / major)) < 1e-6;
      ticks.push({ t: tt, major: isMajor });
    }
  }

  const allClicks = segments.flatMap((s) =>
    s.clicks.map((c) => ({ ...c, segmentId: s.id })),
  );

  const onContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    onSeek(Math.max(0, Math.min(duration, pxToTime(x, pxPerSec))));
  };

  // ラベル列 1 行ぶん
  const labelCell = (text: string) => (
    <div className="flex items-center text-xs text-muted-foreground" style={{ height: ROW_H, paddingLeft: 4 }}>{text}</div>
  );

  // コンテンツ 1 行ぶんの枠（中身は children）
  const contentRow = (children: React.ReactNode) => (
    <div className="relative bg-timeline-track" style={{ height: ROW_H }}>{children}</div>
  );

  return (
    <div
      className="relative bg-timeline-bg p-2 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
    >
      <div className="grid" style={{ gridTemplateColumns: `${LABEL_W}px 1fr` }}>
        {/* 左: ラベル列 */}
        <div>
          {labelCell(t('timeline.time'))}
          {labelCell(t('timeline.video'))}
          {labelCell(t('timeline.segment'))}
          {labelCell(t('timeline.click'))}
        </div>

        {/* 右: スクロール領域。content 幅 = duration * pxPerSec */}
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-hidden"
          onScroll={handleScroll}
        >
          <div className="relative" style={{ width: contentWidth }} onClick={onContentClick}>
            {/* 時刻行 */}
            {contentRow(ticks.map((tk, i) => (
              <div
                key={i}
                className="pointer-events-none absolute top-0"
                style={{
                  left: timeToPx(tk.t, pxPerSec),
                  height: tk.major ? '100%' : '50%',
                  borderLeft: tk.major
                    ? '1px solid hsl(var(--muted-foreground) / 0.5)'
                    : '1px solid hsl(var(--muted-foreground) / 0.25)',
                }}
              >
                {tk.major && (
                  <span
                    className="absolute bottom-0 text-[10px] text-muted-foreground"
                    style={{ left: 2 }}
                  >
                    {formatTimeLabel(tk.t)}
                  </span>
                )}
              </div>
            )))}

            {/* 映像行（現状は空、将来用） */}
            {contentRow(null)}

            {/* セグメント行 */}
            {contentRow(segments.map((s) => {
              const b = segmentBox(s.videoStart, s.videoEnd, pxPerSec);
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
                  style={{ top: 3, height: ROW_H - 6, left: b.left, width: b.width }}
                >
                  {s.correctedText}
                </div>
              );
            }))}

            {/* クリック行 */}
            {contentRow(allClicks.map((c, i) => (
              <div
                key={`${c.segmentId}-${i}`}
                className="absolute size-4 cursor-pointer"
                style={{ top: ROW_H / 2 - 8, left: timeToPx(c.t, pxPerSec) - 8 }}
                title={t('timeline.splitOnDoubleClick')}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => { e.stopPropagation(); onSplitAtClick?.(c.segmentId, c.t); }}
              >
                <div className="size-2 rotate-45 bg-click-marker" style={{ margin: '4px' }} />
              </div>
            )))}

            {/* 再生ヘッド（content 内・content と一緒にスクロールする） */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-playhead"
              style={{ left: timeToPx(currentTime, pxPerSec) }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
