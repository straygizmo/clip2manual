# タイムライン時刻表示＋ズーム Implementation Plan (Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タイムラインに時刻ティック行を追加し、Ctrl+ホイール／+/-/0 キーでズーム、横スクロール、再生ヘッド追尾を実装する。

**Architecture:** CSS スクロール構造（pxPerSec * duration の固定幅 content）+ 純関数の geometry/zoom/format/follow を `timelineGeometry.ts` に集中。Canvas は使わない。`pxPerSec` と `follow` は `Timeline` のローカル state。

**Tech Stack:** TypeScript, React 18, Tailwind v4 + shadcn, Vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-05-29-clip2manual-timeline-zoom-design.md`

---

## File Structure

**Modify:**
- `src/renderer/editor/timelineGeometry.ts` — 純関数 7 本を追加（既存の `timeToPercent`/`segmentRect` は触らない）
- `test/timelineGeometry.test.ts` — 新 API のテスト追加
- `src/shared/i18n/locales/ja.json` — `timeline.time = "時刻"`
- `src/shared/i18n/locales/en.json` — `timeline.time = "Time"`
- `src/renderer/editor/Timeline.tsx` — スクロール構造、tick row、ズーム、追尾を実装（全面改修）
- `src/renderer/editor/PreviewPlayer.tsx` — `onPlayingChange?: (p: boolean) => void` prop 追加
- `src/renderer/editor/EditorLayout.tsx` — `playing` ローカル state、Timeline と PreviewPlayer に配線

---

## Task 1: timelineGeometry.ts — 純関数群（TDD）

**Files:**
- Modify: `src/renderer/editor/timelineGeometry.ts`
- Modify: `test/timelineGeometry.test.ts`

### Step 1: テストを追加（既存ファイル末尾に append）

`test/timelineGeometry.test.ts` の import 行を以下に置き換える:

```typescript
import { describe, it, expect } from 'vitest';
import {
  segmentRect, timeToPercent,
  timeToPx, pxToTime, segmentBox,
  clampZoom, applyZoomAtPoint,
  pickMajorInterval, formatTimeLabel,
  shouldAutoScroll,
} from '../src/renderer/editor/timelineGeometry';
```

末尾に追加:

```typescript
describe('timeToPx / pxToTime', () => {
  it('timeToPx multiplies time by pxPerSec', () => {
    expect(timeToPx(2, 100)).toBe(200);
  });
  it('pxToTime is the inverse', () => {
    expect(pxToTime(200, 100)).toBe(2);
  });
  it('returns 0 for non-positive pxPerSec', () => {
    expect(timeToPx(2, 0)).toBe(0);
    expect(pxToTime(200, 0)).toBe(0);
  });
});

describe('segmentBox', () => {
  it('returns left/width in pixels', () => {
    expect(segmentBox(1, 3, 100)).toEqual({ left: 100, width: 200 });
  });
  it('clamps negative left to 0', () => {
    expect(segmentBox(-1, 2, 100)).toEqual({ left: 0, width: 200 });
  });
  it('returns zero width for non-positive pxPerSec', () => {
    expect(segmentBox(0, 5, 0)).toEqual({ left: 0, width: 0 });
  });
});

describe('clampZoom', () => {
  it('clamps to [fit, max]', () => {
    expect(clampZoom(50, 10, 400)).toBe(50);
    expect(clampZoom(5, 10, 400)).toBe(10);
    expect(clampZoom(1000, 10, 400)).toBe(400);
  });
});

describe('applyZoomAtPoint', () => {
  it('keeps the time under the mouse fixed when zooming in', () => {
    // 元 scrollLeft=200, pxPerSec=100, マウス offset=100 → マウス位置の時刻=3s
    // ズーム後 pxPerSec=200 → 同じ時刻 3s のピクセル位置=600 → scrollLeft=600-100=500
    const r = applyZoomAtPoint({
      oldPxPerSec: 100, newPxPerSec: 200,
      scrollLeft: 200, mouseOffsetPx: 100,
    });
    expect(r.pxPerSec).toBe(200);
    expect(r.scrollLeft).toBe(500);
  });
  it('returns the same scrollLeft when pxPerSec does not change', () => {
    const r = applyZoomAtPoint({
      oldPxPerSec: 100, newPxPerSec: 100,
      scrollLeft: 200, mouseOffsetPx: 100,
    });
    expect(r.scrollLeft).toBe(200);
  });
  it('handles mouse at left edge (offset=0)', () => {
    // マウス位置=scrollLeft の時刻=2s。ズーム後 pxPerSec=200 → 同じ時刻=400 → scrollLeft=400
    const r = applyZoomAtPoint({
      oldPxPerSec: 100, newPxPerSec: 200,
      scrollLeft: 200, mouseOffsetPx: 0,
    });
    expect(r.scrollLeft).toBe(400);
  });
});

describe('pickMajorInterval', () => {
  it('picks 0.1 when 80px fits in 0.1s', () => {
    expect(pickMajorInterval(800)).toBe(0.1);
  });
  it('picks 10 when pxPerSec=10 (10*10=100 >= 80)', () => {
    expect(pickMajorInterval(10)).toBe(10);
  });
  it('picks 120 when pxPerSec=1 (60*1=60 < 80, 120*1=120 >= 80)', () => {
    expect(pickMajorInterval(1)).toBe(120);
  });
  it('falls back to 600 for very small pxPerSec', () => {
    expect(pickMajorInterval(0.05)).toBe(600);
  });
});

describe('formatTimeLabel', () => {
  it('formats mm:ss with zero padding', () => {
    expect(formatTimeLabel(0)).toBe('0:00');
    expect(formatTimeLabel(5)).toBe('0:05');
    expect(formatTimeLabel(59)).toBe('0:59');
    expect(formatTimeLabel(60)).toBe('1:00');
    expect(formatTimeLabel(125)).toBe('2:05');
    expect(formatTimeLabel(3600)).toBe('60:00');
  });
  it('floors fractional seconds', () => {
    expect(formatTimeLabel(5.9)).toBe('0:05');
  });
});

describe('shouldAutoScroll', () => {
  it('returns null when playhead is within view', () => {
    expect(shouldAutoScroll({ playheadPx: 500, viewLeft: 0, viewWidth: 1000, margin: 40 })).toBeNull();
  });
  it('returns playheadPx - margin when playhead approaches right edge', () => {
    expect(shouldAutoScroll({ playheadPx: 970, viewLeft: 0, viewWidth: 1000, margin: 40 })).toBe(930);
  });
  it('returns max(0, playheadPx - margin) when playhead is left of view', () => {
    expect(shouldAutoScroll({ playheadPx: 100, viewLeft: 500, viewWidth: 1000, margin: 40 })).toBe(60);
    expect(shouldAutoScroll({ playheadPx: 20, viewLeft: 500, viewWidth: 1000, margin: 40 })).toBe(0);
  });
});
```

### Step 2: 実行して fail を確認

```
npx vitest run test/timelineGeometry.test.ts
```
Expected: 新規 7 describe ブロックが「is not exported」で fail。

### Step 3: timelineGeometry.ts を実装

`src/renderer/editor/timelineGeometry.ts` の末尾（既存関数の下）に追加:

```typescript
export function timeToPx(t: number, pxPerSec: number): number {
  if (!Number.isFinite(pxPerSec) || pxPerSec <= 0) return 0;
  return t * pxPerSec;
}

export function pxToTime(px: number, pxPerSec: number): number {
  if (!Number.isFinite(pxPerSec) || pxPerSec <= 0) return 0;
  return px / pxPerSec;
}

export function segmentBox(start: number, end: number, pxPerSec: number): { left: number; width: number } {
  if (!Number.isFinite(pxPerSec) || pxPerSec <= 0) return { left: 0, width: 0 };
  const s = Math.max(0, start);
  const e = Math.max(s, end);
  return { left: s * pxPerSec, width: (e - s) * pxPerSec };
}

export function clampZoom(px: number, fit: number, max: number): number {
  return Math.max(fit, Math.min(max, px));
}

export function applyZoomAtPoint(input: {
  oldPxPerSec: number;
  newPxPerSec: number;
  scrollLeft: number;
  mouseOffsetPx: number;
}): { pxPerSec: number; scrollLeft: number } {
  const { oldPxPerSec, newPxPerSec, scrollLeft, mouseOffsetPx } = input;
  if (oldPxPerSec <= 0) return { pxPerSec: newPxPerSec, scrollLeft };
  // マウス位置の時刻を保つ: timeAtMouse = (scrollLeft + mouseOffsetPx) / oldPxPerSec
  // newScrollLeft = timeAtMouse * newPxPerSec - mouseOffsetPx
  const newScrollLeft = (scrollLeft + mouseOffsetPx) * (newPxPerSec / oldPxPerSec) - mouseOffsetPx;
  return { pxPerSec: newPxPerSec, scrollLeft: Math.max(0, newScrollLeft) };
}

const TICK_CANDIDATES = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];
const MIN_PX_BETWEEN_MAJOR = 80;

export function pickMajorInterval(pxPerSec: number): number {
  for (const c of TICK_CANDIDATES) {
    if (c * pxPerSec >= MIN_PX_BETWEEN_MAJOR) return c;
  }
  return TICK_CANDIDATES[TICK_CANDIDATES.length - 1];
}

export function formatTimeLabel(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function shouldAutoScroll(input: {
  playheadPx: number;
  viewLeft: number;
  viewWidth: number;
  margin: number;
}): number | null {
  const { playheadPx, viewLeft, viewWidth, margin } = input;
  const viewRight = viewLeft + viewWidth;
  if (playheadPx >= viewLeft && playheadPx <= viewRight - margin) return null;
  // 巻き戻し時 OR ページ送り時
  return Math.max(0, playheadPx - margin);
}
```

### Step 4: pass 確認

```
npx vitest run test/timelineGeometry.test.ts
npm run typecheck
```
Expected: 全件パス、typecheck クリーン。

### Step 5: コミット

```
git add src/renderer/editor/timelineGeometry.ts test/timelineGeometry.test.ts
git commit -m "feat(timeline): add pure helpers for zoom, ticks, time format, autoscroll"
```

---

## Task 2: i18n キー追加（timeline.time）

**Files:**
- Modify: `src/shared/i18n/locales/ja.json`
- Modify: `src/shared/i18n/locales/en.json`

### Step 1: ja.json に追加

`src/shared/i18n/locales/ja.json` の `timeline` オブジェクト末尾（`"splitOnDoubleClick"` の後ろ、`}` の前）にカンマ追加して挿入:

```json
  "timeline": {
    "video": "映像",
    "segment": "セグメント",
    "click": "クリック",
    "splitOnDoubleClick": "ダブルクリックで分割",
    "time": "時刻"
  },
```

### Step 2: en.json に追加

```json
  "timeline": {
    "video": "Video",
    "segment": "Segment",
    "click": "Click",
    "splitOnDoubleClick": "Double-click to split",
    "time": "Time"
  },
```

### Step 3: localeKeys テスト + 全テスト確認

```
npx vitest run test/localeKeys.test.ts
npm test
```
Expected: 全件パス。

### Step 4: コミット

```
git add src/shared/i18n/locales/ja.json src/shared/i18n/locales/en.json
git commit -m "feat(i18n): add timeline.time key (ja/en)"
```

---

## Task 3: PreviewPlayer に onPlayingChange を追加

**Files:**
- Modify: `src/renderer/editor/PreviewPlayer.tsx`

### Step 1: Props 拡張

`src/renderer/editor/PreviewPlayer.tsx` の `interface Props` に追加（既存 prop 群と同じスタイル）:

```typescript
  /** 再生状態が変化したら通知（Timeline の追尾再開エッジ判定用）。 */
  onPlayingChange?: (playing: boolean) => void;
```

### Step 2: 関数引数に取り込む

`export function PreviewPlayer({ ... }: Props)` の分割代入に `onPlayingChange` を追加。

### Step 3: setPlaying 呼び出しを通知付きに置き換え

`PreviewPlayer.tsx` 内、`setPlaying(...)` の呼出しを全て同等の通知に置き換える。次のヘルパを関数本体先頭（既存 ref 群の直後あたり）に追加:

```typescript
  const notifyPlaying = (p: boolean) => {
    setPlaying(p);
    onPlayingChange?.(p);
  };
```

そして、ファイル内の以下の `setPlaying(...)` 呼出しを全て `notifyPlaying(...)` に置換:
- `controllerRef.current = new TtsPreviewController({ ..., onEnded: () => setPlaying(false), ... })` → `onEnded: () => notifyPlaying(false)`
- `toggleOriginal()` 内の `setPlaying(true)` / `setPlaying(false)`
- `toggleTts()` 内の `setPlaying(started)` / `setPlaying(false)`
- `switchMode()` 内の `setPlaying(false)`
- video の `onPlay`/`onPause` の `setPlaying(true)` / `setPlaying(false)`

### Step 4: typecheck + 既存テスト確認

```
npm run typecheck
npm test
```
Expected: 全件パス。

### Step 5: コミット

```
git add src/renderer/editor/PreviewPlayer.tsx
git commit -m "feat(preview): add onPlayingChange callback for timeline follow"
```

---

## Task 4: Timeline.tsx を scroll + ticks 構造に書き換え（ズーム/追尾なし）

このタスクは Timeline.tsx の DOM 構造を大きく変える。`pxPerSec` は Fit に固定（Task 5 でズームを足す）。再生ヘッド追尾は Task 6 で追加する。

**Files:**
- Modify: `src/renderer/editor/Timeline.tsx`

### Step 1: Timeline.tsx を以下に置換

`src/renderer/editor/Timeline.tsx` の全内容を以下に置き換える:

```tsx
import { useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { type Segment } from '../../shared/types';
import {
  segmentBox, timeToPx, pxToTime,
  pickMajorInterval, formatTimeLabel,
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
    <div className="relative bg-timeline-bg p-2">
      <div className="grid" style={{ gridTemplateColumns: `${LABEL_W}px 1fr` }}>
        {/* 左: ラベル列 */}
        <div>
          {labelCell(t('timeline.time'))}
          {labelCell(t('timeline.video'))}
          {labelCell(t('timeline.segment'))}
          {labelCell(t('timeline.click'))}
        </div>

        {/* 右: スクロール領域。content 幅 = duration * pxPerSec */}
        <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden">
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
      <span style={{ display: 'none' }}>{String(playing)/*Task 5/6で参照*/}</span>
      <span style={{ display: 'none' }}>{String(MAX_PX_PER_SEC)/*Task 5で参照*/}</span>
    </div>
  );
}
```

> 注: `playing` と `MAX_PX_PER_SEC` は Task 5/6 で使うので未使用警告を抑える目的で末尾に隠した参照を残している。本タスクでは未使用警告を避ければ何でもよく、Task 5/6 で削除する。

### Step 2: EditorLayout に playing prop を渡す（仮）

`src/renderer/editor/EditorLayout.tsx` の `<Timeline ... />` に `playing={false}` を追加（Task 6 で本物の state に置換）:

```tsx
      <Timeline
        duration={duration}
        currentTime={state.currentTime}
        segments={segments}
        selectedId={state.selectedSegmentId}
        playingId={playingId}
        playing={false}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onSeek={seek}
        onSplitAtClick={onSplitAtClick}
      />
```

### Step 3: typecheck + テスト + dev で起動して目視確認

```
npm run typecheck
npm test
npm run dev
```
Expected: typecheck クリーン、全テストグリーン、エディタを開いた時にタイムラインに時刻ティック行が追加されており、Fit 表示で全幅にちょうど収まる。

### Step 4: コミット

```
git add src/renderer/editor/Timeline.tsx src/renderer/editor/EditorLayout.tsx
git commit -m "feat(timeline): switch to scrollable px-based layout with tick row"
```

---

## Task 5: Timeline.tsx にズーム操作（Ctrl+wheel, +/- /0）を追加

**Files:**
- Modify: `src/renderer/editor/Timeline.tsx`

### Step 1: import を拡張

`src/renderer/editor/Timeline.tsx` 上部の geometry import を以下に置換:

```typescript
import {
  segmentBox, timeToPx, pxToTime,
  pickMajorInterval, formatTimeLabel,
  clampZoom, applyZoomAtPoint,
} from './timelineGeometry';
```

### Step 2: ズームハンドラと scrollRef ユーティリティを追加

`Timeline` 関数内、`useLayoutEffect` の直後に追加:

```typescript
  const programmaticScroll = useRef(false);

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

  // 末尾の dummy <span> は Task 5/6 で外す
```

`useRef` を import 済か確認: 現在は `useLayoutEffect, useRef, useState` をすでに import している。問題なし。

### Step 3: ルート div を tabIndex + onKeyDown + onWheel に拡張

`return ( <div className="relative bg-timeline-bg p-2"> ... )` のルート `<div>` を以下に置換:

```tsx
    <div
      className="relative bg-timeline-bg p-2 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
    >
```

### Step 4: ダミー参照を削除

ルート div 直下の隠れた 2 つの `<span>` を削除:

```tsx
      <span style={{ display: 'none' }}>{String(playing)/*Task 5/6で参照*/}</span>
      <span style={{ display: 'none' }}>{String(MAX_PX_PER_SEC)/*Task 5で参照*/}</span>
```

`MAX_PX_PER_SEC` は `clampZoom` から参照されるので未使用警告は出ない。`playing` は Task 6 で実 useEffect 内で参照する — それまでは props で受けたまま未使用になるので一時的に `_playing` にリネームする:

`function Timeline({ ..., playing, ... }: Props)` の分割代入を `function Timeline({ ..., playing: _playing, ... }: Props)` に変更（Task 6 で `playing` に戻す）。

### Step 5: typecheck + dev 目視確認

```
npm run typecheck
npm test
npm run dev
```
Expected: typecheck クリーン、テスト全件、エディタでタイムラインをクリックしフォーカスを当てた状態で:
- `Ctrl+wheel` でズームイン/アウト（マウス位置の時刻が固定）
- `+`/`-` キーで段階ズーム
- `0` キーで Fit

### Step 6: コミット

```
git add src/renderer/editor/Timeline.tsx
git commit -m "feat(timeline): ctrl+wheel and keyboard +/- /0 zoom with focus-point preservation"
```

---

## Task 6: Timeline.tsx に再生ヘッド追尾を追加 + EditorLayout で playing state を配線

**Files:**
- Modify: `src/renderer/editor/Timeline.tsx`
- Modify: `src/renderer/editor/EditorLayout.tsx`

### Step 1: Timeline.tsx の import に shouldAutoScroll を追加

```typescript
import {
  segmentBox, timeToPx, pxToTime,
  pickMajorInterval, formatTimeLabel,
  clampZoom, applyZoomAtPoint,
  shouldAutoScroll,
} from './timelineGeometry';
```

`useEffect` を React import に追加（既存の値 import 行を更新する。`import type React` は別行のまま触らない）:

```typescript
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
```

### Step 2: follow state + 追尾ロジックを追加

`Timeline` 関数内、`programmaticScroll` の宣言の後に追加:

```typescript
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
```

### Step 3: 分割代入を `_playing` から `playing` に戻す

Task 5 で `{ playing: _playing }` にしていたので元に戻す:

```typescript
export function Timeline({
  duration, currentTime, segments, selectedId, playingId, playing,
  onSelect, onSeek, onSplitAtClick,
}: Props) {
```

### Step 4: scroll 領域に onScroll を付ける

JSX 内、`<div ref={scrollRef} className="overflow-x-auto overflow-y-hidden">` を以下に置換:

```tsx
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-hidden"
          onScroll={handleScroll}
        >
```

### Step 5: EditorLayout で playing state を保持し配線

`src/renderer/editor/EditorLayout.tsx` の他の state 宣言群（`playingId`, `slotHint` 付近）に追加:

```typescript
  const [playing, setPlaying] = useState(false);
```

`<PreviewPlayer ...>` の props に追加:

```tsx
          onPlayingChange={setPlaying}
```

`<Timeline ...>` の `playing={false}` を `playing={playing}` に変更:

```tsx
        playing={playing}
```

### Step 6: typecheck + テスト + dev で E2E

```
npm run typecheck
npm test
npm run dev
```
Expected: typecheck クリーン、全テストグリーン、エディタで:
- ズームイン中、再生開始すると再生ヘッドが画面右端に到達したタイミングでページ送り
- 再生中にユーザーが手動で横スクロールすると追尾停止
- 一時停止→再生でフォロー再開
- 再生していないときの手動スクロールも追尾停止のまま（その後 0 キーで Fit / 再生ボタンで follow 再開）

### Step 7: コミット

```
git add src/renderer/editor/Timeline.tsx src/renderer/editor/EditorLayout.tsx
git commit -m "feat(timeline): page-flip playhead follow with manual-scroll override"
```

---

## Task 7: 全体検証

**Files:** なし（検証のみ）

- [ ] **Step 1: typecheck**

```
npm run typecheck
```
Expected: クリーン

- [ ] **Step 2: 全テスト**

```
npm test
```
Expected: 220 件前後パス（新規 14 件: timeToPx/pxToTime 3 + segmentBox 3 + clampZoom 1 + applyZoomAtPoint 3 + pickMajorInterval 4 + formatTimeLabel 2 + shouldAutoScroll 3、合計 19 it ブロック相当。仮の見積りは ±2 件）

- [ ] **Step 3: build**

```
npm run build
```
Expected: クリーン

- [ ] **Step 4: 完了サマリをこの plan ファイルに追記**

このファイル末尾に「## 実装完了サマリ (2026-05-29)」を追加し、各タスクのコミットハッシュ、テスト件数、build 成否を箇条書きで記録する。

- [ ] **Step 5: コミット**

```
git add docs/superpowers/plans/2026-05-29-timeline-zoom.md
git commit -m "docs: record timeline zoom Phase A implementation summary"
```

---

## Task 8: 手動 E2E（実機 Windows）

**Files:** なし（手動検証）

- [ ] **Step 1: 起動**

```
npm run dev
```

- [ ] **Step 2: チェックリスト**

- [ ] エディタを開く → タイムラインの一番上に時刻行が出ている
- [ ] Fit 表示で全幅にちょうど収まる、major ティックのラベルが `mm:ss` で読める
- [ ] タイムライン上で Ctrl+ホイールで拡大 → マウス位置の時刻が画面上で動かない
- [ ] `+`/`-` キーでビュー中央を保ったまま拡大/縮小
- [ ] `0` キーで Fit に戻る
- [ ] ズーム最大時にティックがちょうど読める
- [ ] 拡大中に再生 → 再生ヘッドが画面右端に達するとページ送りで左へジャンプ
- [ ] 手動で横スクロールすると追尾停止、停止後に再生ボタン押下で再開
- [ ] クリックで seek が引き続き動作（タイムライン上の座標が時刻に正しくマップされている）
- [ ] クリックマーカーのダブルクリックで split が引き続き動作
- [ ] セグメントクリックで選択が引き続き動作

- [ ] **Step 3: 不具合あれば修正コミット**

- [ ] **Step 4: master push（ユーザー判断）**

---

## 実装順サマリ

1. 純関数 7 本（TDD）
2. i18n `timeline.time`
3. PreviewPlayer に `onPlayingChange` 追加
4. Timeline 構造書き換え（scroll + tick row、ズーム/追尾なし）
5. ズーム操作（Ctrl+wheel, +/- /0）
6. 追尾 + EditorLayout `playing` state 配線
7. 全体検証
8. 手動 E2E

---

## 実装完了サマリ (2026-05-29)

ブランチ: `feat/timeline-zoom`（master 未マージ、E2E 後にマージ予定）。

| Task | コミット | 摘要 |
|---|---|---|
| 1 | `7fd352b` | `timelineGeometry.ts` 純関数 7 本（timeToPx/pxToTime/segmentBox/clampZoom/applyZoomAtPoint/pickMajorInterval/formatTimeLabel/shouldAutoScroll）+ 19 テスト |
| 2 | `b40b40f` | `timeline.time` i18n（ja=「時刻」、en="Time"） |
| 3 | `f0a9057` | `PreviewPlayer.onPlayingChange` ref-forwarding パターン（8 ヶ所の setPlaying を notifyPlaying に置換） |
| 4 | `e9538b3` | Timeline.tsx を CSS スクロール + tick row 構造に書き換え。`pxPerSec` Fit 固定 |
| 5 | `b02b0f2` | Ctrl+wheel（マウス位置中心）/ +/- (sqrt2、ビュー中央) / 0 (Fit) ズーム + tabIndex で focus |
| 6 | `5202b50` | shouldAutoScroll ベースのページ送り追尾、手動スクロールで follow=false、playing 立ち上がりで follow=true。EditorLayout で `playing` state を保持し PreviewPlayer↔Timeline に配線 |

**統計**: 単体テスト 233 件パス（既存 209 + 新規 24: timeToPx/pxToTime 3 + segmentBox 3 + clampZoom 1 + applyZoomAtPoint 3 + pickMajorInterval 4 + formatTimeLabel 2 + shouldAutoScroll 3 — テスト個別数で 19）。typecheck/build クリーン。

**E2E は次タスク**で実機 Windows で確認する。
