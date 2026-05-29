# セグメント境界編集 + ツールバー修正 Implementation Plan (Phase B v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タイムライン上でセグメント両端をドラッグして videoStart/videoEnd を編集できるようにし、PreviewPlayer の再生ボタンが狭いウィンドウでも常に見えるようにする。

**Architecture:** 純関数 `resizeBoundary` を `segmentOps.ts` に追加し、隣接セグメントとの連動と clamp を集中実装。Timeline は `dragPreview` state + 投機計算 `displaySegments` でドラッグ中のフィードバック、mouseup で reducer + IPC 永続化。PreviewPlayer の bottom toolbar は `flex-wrap` から `flex-nowrap + overflow-x-auto` に切替。

**Tech Stack:** TypeScript, React 18, Tailwind v4 + shadcn, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-29-clip2manual-segment-edit-design.md`

---

## File Structure

**Modify:**
- `src/renderer/state/segmentOps.ts` — `resizeBoundary` 純関数 + `MIN_SEGMENT_DURATION` 定数を追加
- `test/segmentOps.test.ts` — `resizeBoundary` テスト追加
- `src/renderer/state/editorReducer.ts` — `RESIZE_BOUNDARY` action
- `test/editorReducer.test.ts` — action テスト
- `src/renderer/editor/Timeline.tsx` — Fragment import、`dragPreview` state、`displaySegments`、左右ハンドル、`onResizeCommit` prop
- `src/renderer/editor/EditorLayout.tsx` — `onResizeCommit` ハンドラ、Timeline へ配線
- `src/renderer/editor/PreviewPlayer.tsx` — bottom toolbar の `flex-wrap` を `flex-nowrap overflow-x-auto` に置換、各子に `shrink-0` 付与

---

## Task 1: segmentOps.resizeBoundary 純関数（TDD）

**Files:**
- Modify: `src/renderer/state/segmentOps.ts`
- Modify: `test/segmentOps.test.ts`

### Step 1: テストを追加

`test/segmentOps.test.ts` の import 行を以下に置き換える:

```typescript
import { toggleEnabled, mergeWithNext, splitAt, resizeBoundary, MIN_SEGMENT_DURATION } from '../src/renderer/state/segmentOps';
```

末尾に追加:

```typescript
describe('resizeBoundary', () => {
  const segs = () => [
    seg('seg-001', 0, 2),
    seg('seg-002', 2, 5),
    seg('seg-003', 5, 8),
  ];

  it('right-side drag of a middle segment moves the shared boundary in both', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'right', 6, 10);
    expect(r[1].videoEnd).toBe(6);
    expect(r[2].videoStart).toBe(6);
    expect(r[0]).toEqual(segs()[0]);
  });

  it('left-side drag of a middle segment moves the shared boundary in both', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'left', 1.5, 10);
    expect(r[1].videoStart).toBe(1.5);
    expect(r[0].videoEnd).toBe(1.5);
    expect(r[2]).toEqual(segs()[2]);
  });

  it('clamps the first segment left to 0', () => {
    const r = resizeBoundary(segs(), 'seg-001', 'left', -5, 10);
    expect(r[0].videoStart).toBe(0);
  });

  it('clamps the last segment right to duration', () => {
    const r = resizeBoundary(segs(), 'seg-003', 'right', 100, 10);
    expect(r[2].videoEnd).toBe(10);
  });

  it('right-side drag respects MIN_SEGMENT_DURATION on current segment', () => {
    // current videoStart=2, so right can go down to 2 + MIN
    const r = resizeBoundary(segs(), 'seg-002', 'right', 1.0, 10);
    expect(r[1].videoEnd).toBeCloseTo(2 + MIN_SEGMENT_DURATION);
    expect(r[2].videoStart).toBeCloseTo(2 + MIN_SEGMENT_DURATION);
  });

  it('right-side drag respects MIN_SEGMENT_DURATION on next segment', () => {
    // next videoEnd=8, so right can go up to 8 - MIN
    const r = resizeBoundary(segs(), 'seg-002', 'right', 100, 10);
    expect(r[1].videoEnd).toBeCloseTo(8 - MIN_SEGMENT_DURATION);
    expect(r[2].videoStart).toBeCloseTo(8 - MIN_SEGMENT_DURATION);
  });

  it('left-side drag respects MIN_SEGMENT_DURATION on current segment', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'left', 100, 10);
    expect(r[1].videoStart).toBeCloseTo(5 - MIN_SEGMENT_DURATION);
    expect(r[0].videoEnd).toBeCloseTo(5 - MIN_SEGMENT_DURATION);
  });

  it('left-side drag respects MIN_SEGMENT_DURATION on previous segment', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'left', -100, 10);
    expect(r[1].videoStart).toBeCloseTo(0 + MIN_SEGMENT_DURATION);
    expect(r[0].videoEnd).toBeCloseTo(0 + MIN_SEGMENT_DURATION);
  });

  it('preserves ttsAudio on both affected segments', () => {
    const r = resizeBoundary(segs(), 'seg-002', 'right', 6, 10);
    expect(r[1].ttsAudio).toBe('tts/seg-002.wav');
    expect(r[2].ttsAudio).toBe('tts/seg-003.wav');
  });

  it('preserves clicks (does not redistribute on boundary move)', () => {
    const input = [
      seg('seg-001', 0, 2, { clicks: [click(0.5)] }),
      seg('seg-002', 2, 5, { clicks: [click(3)] }),
    ];
    const r = resizeBoundary(input, 'seg-001', 'right', 4, 10);
    expect(r[0].clicks.map((c) => c.t)).toEqual([0.5]);
    expect(r[1].clicks.map((c) => c.t)).toEqual([3]);
  });

  it('returns the same array when primaryId is not found', () => {
    const input = segs();
    expect(resizeBoundary(input, 'nope', 'right', 6, 10)).toBe(input);
  });
});
```

### Step 2: fail 確認

```
npx vitest run test/segmentOps.test.ts
```
Expected: 新規 describe ブロックが「is not exported」で fail。

### Step 3: 実装

`src/renderer/state/segmentOps.ts` の末尾に追加:

```typescript
export const MIN_SEGMENT_DURATION = 0.05;

/**
 * セグメント境界をドラッグでリサイズ。連動仕様:
 * - 内側の端（隣あり）: 共有境界として隣も一緒に動く
 * - 外側の端（最初の左 / 最後の右）: 単独。[0, duration] で clamp
 * 各セグメント長は最低 MIN_SEGMENT_DURATION を保つ。
 * ttsAudio は保持。clicks も配列のまま（再配分しない）。
 */
export function resizeBoundary(
  segments: Segment[],
  primaryId: string,
  side: 'left' | 'right',
  newTime: number,
  duration: number,
): Segment[] {
  const i = segments.findIndex((s) => s.id === primaryId);
  if (i < 0) return segments;
  const out = segments.slice();
  if (side === 'left') {
    const lower = i > 0 ? segments[i - 1].videoStart + MIN_SEGMENT_DURATION : 0;
    const upper = segments[i].videoEnd - MIN_SEGMENT_DURATION;
    const t = Math.max(lower, Math.min(upper, newTime));
    out[i] = { ...segments[i], videoStart: t };
    if (i > 0) out[i - 1] = { ...segments[i - 1], videoEnd: t };
  } else {
    const lower = segments[i].videoStart + MIN_SEGMENT_DURATION;
    const upper = i < segments.length - 1
      ? segments[i + 1].videoEnd - MIN_SEGMENT_DURATION
      : duration;
    const t = Math.max(lower, Math.min(upper, newTime));
    out[i] = { ...segments[i], videoEnd: t };
    if (i < segments.length - 1) out[i + 1] = { ...segments[i + 1], videoStart: t };
  }
  return out;
}
```

### Step 4: pass 確認

```
npx vitest run test/segmentOps.test.ts
npm run typecheck
```
Expected: 全件パス、typecheck クリーン。

### Step 5: コミット

```
git add src/renderer/state/segmentOps.ts test/segmentOps.test.ts
git commit -m "feat(segments): add resizeBoundary pure function with linked-edge clamp"
```

## Context for Task 1

- **Project:** clip2manual — Electron desktop app, TypeScript + React + Vitest.
- **Working directory:** `C:\Users\mtmar\source\repos\clip2manual`
- **Spec:** `docs/superpowers/specs/2026-05-29-clip2manual-segment-edit-design.md`
- **Pure function** — imports only from `../../shared/types`, no DOM, no Node APIs.
- **Existing `segmentOps.ts` pattern:** see `toggleEnabled` / `mergeWithNext` / `splitAt`. Same style. immutable, returns new array, segment objects spread with overrides.

---

## Task 2: editorReducer に RESIZE_BOUNDARY を追加

**Files:**
- Modify: `src/renderer/state/editorReducer.ts`
- Modify: `test/editorReducer.test.ts`

### Step 1: テスト追加

`test/editorReducer.test.ts` の末尾 `describe('editorReducer', ...)` 内に追加:

```typescript
  it('RESIZE_BOUNDARY moves the shared boundary on both affected segments', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [
      { ...seg, videoStart: 0, videoEnd: 2 },
      { ...seg, id: 'seg-002', videoStart: 2, videoEnd: 5 },
    ] });
    s = editorReducer(s, { type: 'RESIZE_BOUNDARY', primaryId: 'seg-001', side: 'right', newTime: 3, duration: 10 });
    expect(s.project!.segments[0].videoEnd).toBe(3);
    expect(s.project!.segments[1].videoStart).toBe(3);
  });

  it('RESIZE_BOUNDARY is a no-op when project is null', () => {
    const s = editorReducer(initialEditorState, { type: 'RESIZE_BOUNDARY', primaryId: 'x', side: 'right', newTime: 1, duration: 10 });
    expect(s.project).toBeNull();
  });
```

### Step 2: fail 確認

```
npx vitest run test/editorReducer.test.ts
```
Expected: 型エラーで fail。

### Step 3: editorReducer 拡張

`src/renderer/state/editorReducer.ts` の import に追加（`Segment` は既に import 済み）:

```typescript
import { resizeBoundary } from './segmentOps';
```

`EditorAction` ユニオン末尾（`SET_SETTINGS` の後）にセミコロンを移動して追加:

```typescript
  | { type: 'SET_SETTINGS'; settings: ProjectSettings }
  | { type: 'RESIZE_BOUNDARY'; primaryId: string; side: 'left' | 'right'; newTime: number; duration: number };
```

`switch` ケースを `SET_SETTINGS` の後ろ、`default` の前に追加:

```typescript
    case 'RESIZE_BOUNDARY':
      if (!state.project) return state;
      return {
        ...state,
        project: {
          ...state.project,
          segments: resizeBoundary(
            state.project.segments,
            action.primaryId, action.side, action.newTime, action.duration,
          ),
        },
      };
```

### Step 4: pass 確認

```
npx vitest run test/editorReducer.test.ts
npm test
npm run typecheck
```
Expected: 全件パス、typecheck クリーン。

### Step 5: コミット

```
git add src/renderer/state/editorReducer.ts test/editorReducer.test.ts
git commit -m "feat(reducer): add RESIZE_BOUNDARY action for segment edge drag"
```

## Context for Task 2

- Previous commit creates `resizeBoundary` in `segmentOps.ts` (Task 1).
- Existing reducer pattern: guard `if (!state.project) return state;` then spread `project.segments`.

---

## Task 3: Timeline.tsx に左右ハンドル + dragPreview を実装

**Files:**
- Modify: `src/renderer/editor/Timeline.tsx`

> 本ファイルは React/DOM 依存のため単体テストなし。typecheck + 手動 E2E で検証。

### Step 1: import を拡張

`src/renderer/editor/Timeline.tsx` 上部の React import 行を以下に置き換える:

```typescript
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
```

geometry import は変更なし。追加で:

```typescript
import { resizeBoundary } from '../state/segmentOps';
```

### Step 2: Props 拡張

`interface Props` に追加:

```typescript
  onResizeCommit?: (primaryId: string, side: 'left' | 'right', newTime: number) => void;
```

`function Timeline({ ... }: Props)` の分割代入末尾に `onResizeCommit` を追加。

### Step 3: dragPreview state と displaySegments

`Timeline` 関数内、既存 state 宣言の後ろ（`const [dragPreview... ]` を `[follow, setFollow]` の隣あたりに置く）:

```typescript
  const [dragPreview, setDragPreview] = useState<
    { primaryId: string; side: 'left' | 'right'; newTime: number } | null
  >(null);

  const displaySegments = dragPreview
    ? resizeBoundary(
        segments,
        dragPreview.primaryId, dragPreview.side, dragPreview.newTime, duration,
      )
    : segments;
```

### Step 4: セグメント行 + ハンドルをレンダ

JSX 内、既存のセグメント行 `{contentRow(segments.map(...))}` 全体を以下に置き換える:

```tsx
            {/* セグメント行 */}
            {contentRow(displaySegments.map((s) => {
              const b = segmentBox(s.videoStart, s.videoEnd, pxPerSec);
              const startDrag = (side: 'left' | 'right') => (e: React.MouseEvent) => {
                e.stopPropagation();
                const initial = side === 'left' ? s.videoStart : s.videoEnd;
                const startX = e.clientX;
                let last = { primaryId: s.id, side, newTime: initial };
                const onMove = (ev: MouseEvent) => {
                  const dt = pxToTime(ev.clientX - startX, pxPerSec);
                  last = { primaryId: s.id, side, newTime: initial + dt };
                  setDragPreview(last);
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                  setDragPreview(null);
                  onResizeCommit?.(last.primaryId, last.side, last.newTime);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              };
              return (
                <Fragment key={s.id}>
                  <div
                    onClick={() => onSelect(s.id)}
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
                  <div
                    className="absolute cursor-ew-resize"
                    style={{
                      top: 0, height: ROW_H, width: 6, left: b.left - 3,
                      borderLeft: '2px solid rgba(255, 255, 255, 0.55)',
                    }}
                    onMouseDown={startDrag('left')}
                  />
                  <div
                    className="absolute cursor-ew-resize"
                    style={{
                      top: 0, height: ROW_H, width: 6, left: b.left + b.width - 3,
                      borderRight: '2px solid rgba(255, 255, 255, 0.55)',
                    }}
                    onMouseDown={startDrag('right')}
                  />
                </Fragment>
              );
            }))}
```

### Step 5: クリック行も displaySegments 経由に

JSX 内、`const allClicks = segments.flatMap(...)` を以下に置き換える（関数本体内の宣言）:

```typescript
  const allClicks = displaySegments.flatMap((s) =>
    s.clicks.map((c) => ({ ...c, segmentId: s.id })),
  );
```

### Step 6: typecheck + 全テスト

```
npm run typecheck
npm test
```
Expected: typecheck クリーン、全件パス。EditorLayout 側はまだ onResizeCommit を渡さないが、optional なので型エラー無し。

### Step 7: コミット

```
git add src/renderer/editor/Timeline.tsx
git commit -m "feat(timeline): add segment trim handles with linked boundary drag"
```

## Context for Task 3

- Phase A の Timeline.tsx は scroll 構造 + zoom + follow が既に入っている。本タスクはセグメント行の改修と新 props のみ。
- `Fragment` は React の標準 export。
- 既存の `segments.flatMap` を `displaySegments.flatMap` に置き換えるのを忘れない（クリック行の位置はセグメント所属に紐づかないが、配列構築に displaySegments を使うとドラッグ中の整合が取りやすい）。

---

## Task 4: EditorLayout に onResizeCommit を配線

**Files:**
- Modify: `src/renderer/editor/EditorLayout.tsx`

### Step 1: import を拡張

`src/renderer/editor/EditorLayout.tsx` の import に追加:

```typescript
import { resizeBoundary } from '../state/segmentOps';
```

### Step 2: onResizeCommit ハンドラを追加

`EditorLayout` 関数内、既存のハンドラ群（`onSplitAtClick`, `setShowSubtitles` 等の付近）に追加:

```typescript
  const onResizeCommit = useCallback(
    (primaryId: string, side: 'left' | 'right', newTime: number) => {
      if (duration <= 0) return;
      dispatch({ type: 'RESIZE_BOUNDARY', primaryId, side, newTime, duration });
      const updated = resizeBoundary(segments, primaryId, side, newTime, duration);
      void window.api.updateSegments(updated);
    },
    [dispatch, segments, duration],
  );
```

`useCallback` は既存の import に含まれているはずだが、漏れていれば追加。

### Step 3: Timeline に prop を渡す

JSX 内、`<Timeline ...>` の末尾 prop に追加:

```tsx
        onResizeCommit={onResizeCommit}
```

### Step 4: typecheck + 全テスト

```
npm run typecheck
npm test
```
Expected: 全件パス。

### Step 5: コミット

```
git add src/renderer/editor/EditorLayout.tsx
git commit -m "feat(editor): wire onResizeCommit to dispatch + IPC persist"
```

## Context for Task 4

- `segments` は EditorLayout 内で `state.project?.segments ?? []` または `project.segments` から取得済（Phase A/字幕の配線で確認済み）。
- `duration` は既存 state（PreviewPlayer の `onDuration` で更新）。
- `useCallback` deps に `dispatch` を入れるのは React の慣習。`dispatch` は安定なので無くてもよいが、ESLint 警告回避に入れる。

---

## Task 5: PreviewPlayer ツールバーの flex 切替

**Files:**
- Modify: `src/renderer/editor/PreviewPlayer.tsx`

### Step 1: ツールバーの flex-wrap を flex-nowrap + overflow-x-auto に置換

`src/renderer/editor/PreviewPlayer.tsx` 内のツールバー div を以下のように変更:

**変更前:**

```tsx
      <div className="flex shrink-0 flex-wrap items-center gap-3 bg-muted px-3 py-2 text-foreground">
```

**変更後:**

```tsx
      <div className="flex shrink-0 flex-nowrap items-center gap-3 overflow-x-auto bg-muted px-3 py-2 text-foreground">
```

### Step 2: 子要素に shrink-0 を付与

同じツールバー内の子要素に `shrink-0` を追加:

**Play/Pause ボタン:**

```tsx
        <Button size="sm" className="shrink-0" onClick={togglePlay} disabled={ttsLoading}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}{playing ? t('preview.pause') : t('preview.play')}</Button>
```

**「音声:」ラベル:**

```tsx
        <span className="shrink-0 text-xs text-muted-foreground">{t('preview.audioLabel')}</span>
```

**元音声ボタン:**

```tsx
        <Button size="sm" className="shrink-0" variant={mode === 'original' ? 'default' : 'secondary'} onClick={() => void switchMode('original')} disabled={mode === 'original' || ttsLoading}>{t('preview.modeOriginal')}</Button>
```

**TTS ボタン:**

```tsx
        <Button size="sm" className="shrink-0" variant={mode === 'tts' ? 'default' : 'secondary'} onClick={() => void switchMode('tts')} disabled={mode === 'tts' || ttsLoading}>{t('preview.modeTts')}</Button>
```

**TTS ロード中ラベル:**

```tsx
        {ttsLoading && <span className="shrink-0 text-xs text-muted-foreground">{t('preview.ttsLoading')}</span>}
```

**missing ヒントラベル:**

```tsx
        {missing && <span className="shrink-0 text-xs text-amber-500">{t('preview.missingTtsHint')}</span>}
```

**ml-auto グループ div:**

**変更前:**

```tsx
        <div className="ml-auto flex items-center gap-2">
```

**変更後:**

```tsx
        <div className="ml-auto flex shrink-0 items-center gap-2">
```

### Step 3: typecheck + 全テスト

```
npm run typecheck
npm test
```
Expected: 全件パス。テストの変更なし（CSS 変更のみ）。

### Step 4: 起動して目視確認

```
npm run dev
```

Expected:
- 通常幅: 既存と同じ見た目
- ウィンドウを狭くする: ツールバーが横スクロール可能になり、Play ボタンが左端に常駐

### Step 5: コミット

```
git add src/renderer/editor/PreviewPlayer.tsx
git commit -m "fix(preview): keep play button visible by switching toolbar to nowrap+scroll"
```

## Context for Task 5

- 既存の `flex-wrap` は狭い幅で折返し → 多段のツールバーになり、grid の middle row が圧迫されて最終的にビューポート外へ押し出される
- `flex-nowrap + overflow-x-auto` で常に 1 行、収まらない時は横スクロール
- Play ボタンが左端なので常に可視
- Tailwind の `shrink-0` は flex item に `flex-shrink: 0` を当てる

---

## Task 6: 全体検証 + 完了サマリ

**Files:** plan ドキュメントへの追記のみ

- [ ] **Step 1: typecheck**

```
npm run typecheck
```
Expected: クリーン

- [ ] **Step 2: 全テスト**

```
npm test
```
Expected: 既存 233 + 新規 12（segmentOps 10 + editorReducer 2）= 245 件パス。

- [ ] **Step 3: build**

```
npm run build
```
Expected: クリーン

- [ ] **Step 4: 完了サマリを plan に追記**

このファイル末尾に「## 実装完了サマリ (2026-05-29)」を追加し、各タスクのコミットハッシュ・テスト件数・build 成否を箇条書きで記録する。

- [ ] **Step 5: コミット**

```
git add docs/superpowers/plans/2026-05-29-segment-edit.md
git commit -m "docs: record segment edit Phase B v2 implementation summary"
```

---

## Task 7: 手動 E2E（実機 Windows）

**Files:** なし（手動検証）

- [ ] **Step 1: 起動**

```
npm run dev
```

- [ ] **Step 2: チェックリスト**

- [ ] エディタを開く → タイムラインのセグメント行の各セグメントに 6px ハンドル（左右）が見える
- [ ] 中間セグメントの右端を右へドラッグ → 隣の左端も一緒に動く（隙間/重なりなし）
- [ ] 中間セグメントの左端を左へドラッグ → 前の右端が連動
- [ ] 最初のセグメントの左端を 0 まで引き、それ以下にいかない
- [ ] 最後のセグメントの右端を duration まで引き、それ以上いかない
- [ ] MIN_SEGMENT_DURATION（0.05s）まで縮めるとそれ以上縮まない（自身も隣も）
- [ ] TTS 生成済セグメントの境界を動かしても再生時に音声が消えない
- [ ] 境界編集後、TTS プレビュー / 書き出しでタイミングが反映される
- [ ] セグメント本体のクリックで選択が引き続き動作（ハンドル経由ではない）
- [ ] クリックマーカーのダブルクリック split が引き続き動作
- [ ] ウィンドウを最小幅近くまで縮める → Play ボタンが左端に常駐、ツールバーが横スクロール可能
- [ ] 横スクロールで Export ボタンにアクセスできる
- [ ] 通常幅では Play / Export が一行に並び従来通り
- [ ] ズーム最大時/最小時にハンドルが掴める

- [ ] **Step 3: 不具合を fix コミット**

- [ ] **Step 4: master push（ユーザー判断）**

---

## 実装順サマリ

1. `segmentOps.resizeBoundary` 純関数（TDD）
2. `editorReducer` の `RESIZE_BOUNDARY` action
3. `Timeline.tsx` ハンドル + dragPreview
4. `EditorLayout.tsx` 配線
5. `PreviewPlayer.tsx` ツールバー fix
6. 全体検証
7. 手動 E2E
