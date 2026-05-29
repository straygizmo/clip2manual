# セグメント境界編集 + ツールバー修正 設計（Phase B v2）

- **日付**: 2026-05-29
- **対象**: タイムライン上でセグメントの端をドラッグし videoStart/videoEnd を編集 + PreviewPlayer ツールバーの再生ボタン可視性修正
- **依存**: Phase A（タイムラインズーム）、Phase 6a（segmentOps cut/merge/split）
- **状態**: 設計確定。plan はこのあとに作成
- **背景**: Whisper の出力セグメント自体が発話と完全に一致しないため、ユーザーがセグメントの長さを自由に調整できる必要がある。調整後に TTS を再生成すれば映像とのミスマッチが大幅に減る。
- **Phase B 旧設計について**: TTS WAV の in/out トリム（`audioStart`/`audioEnd`/`clipFullDuration`）は `feat/audio-trim` ブランチで実装したが、ユーザーの再評価で「TTS に無音はないので不要」と判明し、ブランチを破棄。本 spec が **新しい Phase B** となる。`docs/superpowers/specs/2026-05-29-clip2manual-audio-trim-design.md` は廃止済み設計の参考資料として残置。

## ゴール

- セグメント行の左右端にドラッグハンドルを追加し、videoStart/videoEnd を編集可能にする
- 内側の端は隣接セグメントの共有境界として連動、外側の端は `[0, duration]` で clamp
- PreviewPlayer の下部ツールバーが狭いウィンドウでも再生ボタンが常に見えるようにする

## 非ゴール（後フェーズ）

- 隣を 1 個飛ばしで押す smash 編集
- 複数セグメントの一括選択ドラッグ
- クリック時刻へのスナップ
- ドラッグ取り消し（Esc）
- Undo / Redo
- 波形表示
- ナレーション行（旧 Phase B 由来 — 不採用）

## 確定方針

| 観点 | 方針 |
|---|---|
| 編集方式 | セグメント行のブロック両端に 6px ドラッグハンドル |
| 隣接の挙動 | **連動**: 内側の端を動かすと隣の共有境界も同期 |
| 外側の端（最初の左 / 最後の右） | ドラッグ可、`[0, duration]` で clamp |
| 最小セグメント長 | `MIN_SEGMENT_DURATION = 0.05` 秒 |
| TTS 保持 | `ttsAudio` は **保持**（再生成はユーザー手動） |
| clicks 維持 | 再配分しない。`c.t` 時刻のままセグメント所属配列に残す |
| 永続化 | ドラッグ中は dispatch のみ。`mouseup` で 1 回だけ `updateSegments` IPC |
| 投機描画 | `dragPreview` から `displaySegments` を `resizeBoundary` で計算 |
| ツールバー | `flex-wrap` → `flex-nowrap overflow-x-auto`、各子に `shrink-0` |

## アーキテクチャ

```
src/renderer/
  state/segmentOps.ts          ← resizeBoundary 純関数 + MIN_SEGMENT_DURATION 追加
  state/editorReducer.ts       ← RESIZE_BOUNDARY action
  editor/Timeline.tsx          ← 左右ハンドル + dragPreview + displaySegments
  editor/EditorLayout.tsx      ← onResizeCommit ハンドラ
  editor/PreviewPlayer.tsx     ← ツールバー flex-nowrap + overflow-x-auto + 子に shrink-0
```

データモデル変更なし（既存 `Segment.videoStart`/`videoEnd` を編集するだけ）。

## 純関数 API（`segmentOps.ts`）

既存ファイル末尾に追加:

```ts
export const MIN_SEGMENT_DURATION = 0.05;

/**
 * セグメント境界をドラッグでリサイズ。連動仕様:
 * - 内側の端（隣あり）: 共有境界として隣も一緒に動く
 * - 外側の端（最初の左 / 最後の右）: 単独。`[0, duration]` で clamp
 * 各セグメント長は最低 MIN_SEGMENT_DURATION を保つ。
 * ttsAudio は保持。clicks も配列のまま（再配分しない）。
 */
export function resizeBoundary(
  segments: Segment[],
  primaryId: string,
  side: 'left' | 'right',
  newTime: number,
  duration: number,
): Segment[];
```

**ロジック:**

```ts
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
```

不変ルール:
- `primaryId` 未存在 → そのまま返す
- 返り値は新配列、各要素は元か `{...s, ...}` の新オブジェクト
- 入力 `segments` は変更しない（immutable）

## Reducer アクション

`EditorAction` ユニオン末尾に追加:

```ts
| { type: 'RESIZE_BOUNDARY'; primaryId: string; side: 'left' | 'right'; newTime: number; duration: number };
```

`switch` ケース:

```ts
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

`resizeBoundary` は `segmentOps.ts` から import する（既存パターン）。

## Timeline UI

### ドラッグ state + 投機描画

`Timeline` 関数内に追加（既存 state 宣言群の後ろ）:

```tsx
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

`displaySegments` をセグメント行・クリック行のレンダリングに使う（既存 `segments` を置換）。

### Props 拡張

```ts
interface Props {
  // 既存...
  onResizeCommit?: (primaryId: string, side: 'left' | 'right', newTime: number) => void;
}
```

### ハンドルとマウスダウン

`Fragment` 用に React の import を追加（既存 import 行を更新）:

```ts
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
```

セグメント行を以下に置き換える（`displaySegments.map` 内で本体 + 2 ハンドル）:

```tsx
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

### クリック行

クリック行も `displaySegments` 経由で（既存 `segments.flatMap` を `displaySegments.flatMap` に置換）。クリックマーカー自体は `c.t` で位置が決まるので、境界が動いても位置は変わらない（仕様どおり）。

## EditorLayout 配線

`onResizeCommit` を追加（既存ハンドラ群の付近）:

```ts
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

`<Timeline>` に prop で渡す:

```tsx
onResizeCommit={onResizeCommit}
```

import 追加:

```ts
import { resizeBoundary } from '../state/segmentOps';
```

## ツールバー可視性修正（PreviewPlayer）

`src/renderer/editor/PreviewPlayer.tsx` の下部ツールバー1か所を変更:

**変更前:**
```tsx
<div className="flex shrink-0 flex-wrap items-center gap-3 bg-muted px-3 py-2 text-foreground">
```

**変更後:**
```tsx
<div className="flex shrink-0 flex-nowrap items-center gap-3 overflow-x-auto bg-muted px-3 py-2 text-foreground">
```

加えて、各子要素（Button、span、label、ml-auto div）に `shrink-0` を付与し、テキスト圧縮による意図しない縮小を抑制:

- `<Button>{Play/Pause}</Button>` → `className="shrink-0"` を追加
- `<span>音声:</span>` → `className="shrink-0 text-xs ..."`
- 元音声 / TTS ボタン → `shrink-0` 追加
- ttsLoading / missing の span → `shrink-0` 追加
- `<div className="ml-auto flex items-center gap-2">` → `flex shrink-0` に変更

具体的な diff は plan で示す。

挙動:
- 通常幅: 既存と同じ見た目（1 行に収まる）
- 狭い幅: 横スクロール可能になり、Play は左端常駐、Export は右にスクロールでアクセス可

## エッジケース

| ケース | 挙動 |
|---|---|
| ハンドルを境界外へ大きくドラッグ | `resizeBoundary` 内で MIN_SEGMENT_DURATION で clamp |
| 最初/最後の外側端を 0/duration 外へ | 0 / duration で clamp |
| TTS 生成済みセグメントの境界編集 | `ttsAudio` 保持、`clipFullDuration` 等の他フィールドも変更なし |
| `enabled=false` のセグメント | ハンドル反応する（カット中でも境界編集は意図的に可能） |
| `duration === 0`（動画未読込） | `onResizeCommit` がガードして no-op |
| ズーム最小時にハンドルが密集 | `b.width < 12px` で左右ハンドル視覚的に重なるが、6px ヒット領域で個別に掴める。連動仕様なのでどちらでも結果同じ |
| ドラッグ中の TTS preview 再生 | 再生継続（resize は videoStart/videoEnd のみ、controller は次回 load で再計算） |
| `primaryId` 未存在（消えたセグメント等） | `resizeBoundary` がそのまま返す → no-op |
| `clicks` が境界を跨いだ | 配列は元のまま。再生時のリップル位置は `c.t` 基準なので正しく描画される |

## テスト戦略

### 単体テスト

| ファイル | 対象 |
|---|---|
| `test/segmentOps.test.ts`（既存追加） | `resizeBoundary`: 中間左端／中間右端／最初の左／最後の右／MIN clamp／隣 segment 制約／ttsAudio 保持／clicks 維持／primaryId 未存在 |
| `test/editorReducer.test.ts`（既存追加） | `RESIZE_BOUNDARY` action がセグメントを更新する／`project===null` で no-op |

Timeline.tsx の UI 改修、PreviewPlayer のツールバー CSS 変更は単体テストなし（既存方針どおり、typecheck + 手動 E2E）。

### 手動 E2E

- 中間セグメントの右端ドラッグ → 隣の左端が連動、隙間/重なりなし
- 最初のセグメントの左端を 0 まで引き、それ以下にいかない
- 最後のセグメントの右端を duration まで引き、それ以上いかない
- MIN_SEGMENT_DURATION（0.05s）まで縮めるとそれ以上縮まない
- TTS 生成済セグメントの境界を動かしても ttsAudio が消えない（再生はそのまま動く）
- セグメント境界編集後にプレビューやエクスポートで映像と TTS のタイミングが反映される
- ウィンドウを最小幅に縮めても Play ボタンが見える、横スクロールで Export にアクセス可
- ズーム最大時/最小時にハンドルが掴める
- 既存挙動の回帰なし: segment クリック選択、splitAt、再生、ズーム、追尾

### 既存テストへの影響

- `Segment` 型は変更なし → 既存 segment-related テストはそのまま通る
- `segmentOps` の既存 `toggleEnabled`/`mergeWithNext`/`splitAt` テストは無変更
- 新 reducer action は既存 action と独立

## 実装順（後続 plan のヒント）

1. `segmentOps.resizeBoundary` + `MIN_SEGMENT_DURATION` 純関数（TDD）
2. `editorReducer` の `RESIZE_BOUNDARY` action（TDD）
3. `Timeline.tsx`: dragPreview + displaySegments + 左右ハンドル + onMouseDown
4. `EditorLayout.tsx`: `onResizeCommit` + Timeline へ配線
5. `PreviewPlayer.tsx` ツールバー: `flex-wrap` → `flex-nowrap overflow-x-auto`、各子に `shrink-0`
6. typecheck・全テスト・ビルド・手動 E2E

## 関連スペック

- `docs/superpowers/specs/2026-05-27-clip2manual-phase6a-segment-ops-design.md` — 既存 segment ops（cut/merge/split）
- `docs/superpowers/specs/2026-05-29-clip2manual-timeline-zoom-design.md` — Timeline のスクロール/ズーム基盤
- `docs/superpowers/specs/2026-05-28-clip2manual-split-at-click-markers-design.md` — クリック位置での分割（既存挙動を維持）
- `docs/superpowers/specs/2026-05-29-clip2manual-audio-trim-design.md` — 廃止済み旧 Phase B（参考）
