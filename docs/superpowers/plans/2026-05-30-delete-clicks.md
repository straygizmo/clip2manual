# UI からのクリック削除 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Timeline の「クリック」行 ◆ をシングルクリックで選択し、`Delete`/`Backspace` で当該クリックを `Segment.clicks` から取り除く。プレビュー（RippleCanvas）と書き出し（ripple burn-in）に即時反映、永続化は既存 `updateSegments` で行う。

**Architecture:** 削除ロジックは純関数 `deleteClick(segments, key)` として `segmentOps.ts` に追加。Timeline は ◆ の `onClick` で選択し、既存 `handleKeyDown` を `Delete/Backspace/Esc` に拡張する。EditorLayout はハンドラを橋渡しする薄い接続のみ。reducer / IPC / Inspector / PreviewPlayer は変更しない。

**Tech Stack:** React 18 + TypeScript / Tailwind v4 + shadcn / Vitest（純関数のみ、`environment: 'node'`）

**Spec:** `docs/superpowers/specs/2026-05-30-delete-clicks-design.md`

---

## ファイル構成

**新規:** なし

**変更:**
- `src/renderer/state/segmentOps.ts` — 純関数 `deleteClick` と型 `ClickKey` を追加
- `test/segmentOps.test.ts` — `deleteClick` のシナリオテストを追加
- `src/renderer/editor/Timeline.tsx` — 選択ステート / ◆ の `onClick` / `handleKeyDown` 拡張 / 余白クリックでの解除 / `useEffect` での segments 変化時の自動解除 / Props に `onDeleteClick` を追加
- `src/renderer/editor/EditorLayout.tsx` — `onDeleteClick` を実装して Timeline に渡す
- `src/shared/i18n/locales/ja.json` / `en.json` — `timeline.deleteClickHint` を追加

**変更しない:** `editorReducer.ts`, IPC（`window.api.updateSegments` は既存）, `Inspector.tsx`, `PreviewPlayer.tsx`, `RippleCanvas.tsx`, `StepperToolbar.tsx`, ripple 書き出し

---

## Task 1: `deleteClick` 純関数と型

**Files:**
- Modify: `src/renderer/state/segmentOps.ts`
- Modify: `test/segmentOps.test.ts`

- [ ] **Step 1: 失敗テストを書く**

`test/segmentOps.test.ts` の末尾に以下の `describe` ブロックを追加:

```ts
describe('deleteClick', () => {
  it('removes the matching click from the target segment only', () => {
    const a = seg('seg-001', 0, 2, { clicks: [click(0.5), click(1.0)] });
    const b = seg('seg-002', 2, 5, { clicks: [click(3.0)] });
    const r = deleteClick([a, b], { segmentId: 'seg-001', t: 0.5, x: 1, y: 1 });
    expect(r[0].clicks).toHaveLength(1);
    expect(r[0].clicks[0].t).toBe(1.0);
    expect(r[1].clicks).toHaveLength(1);
  });

  it('returns the same reference when segmentId does not exist', () => {
    const segs = [seg('seg-001', 0, 2, { clicks: [click(0.5)] })];
    const r = deleteClick(segs, { segmentId: 'seg-XXX', t: 0.5, x: 1, y: 1 });
    expect(r).toBe(segs);
  });

  it('returns the same reference when no click matches the key', () => {
    const segs = [seg('seg-001', 0, 2, { clicks: [click(0.5)] })];
    const r = deleteClick(segs, { segmentId: 'seg-001', t: 9.9, x: 1, y: 1 });
    expect(r).toBe(segs);
  });

  it('does not modify other segments', () => {
    const a = seg('seg-001', 0, 2, { clicks: [click(0.5)] });
    const b = seg('seg-002', 2, 5, { clicks: [click(3.0)] });
    const r = deleteClick([a, b], { segmentId: 'seg-001', t: 0.5, x: 1, y: 1 });
    expect(r[1]).toBe(b);
  });
});
```

Also update the import at the top of the file to include `deleteClick`:

```ts
import { toggleEnabled, mergeWithNext, splitAt, resizeBoundary, deleteClick, MIN_SEGMENT_DURATION } from '../src/renderer/state/segmentOps';
```

- [ ] **Step 2: テスト実行 — 失敗を確認**

Run: `npm test -- test/segmentOps.test.ts`
Expected: FAIL — `deleteClick` is not exported.

- [ ] **Step 3: `deleteClick` を実装**

Append to `src/renderer/state/segmentOps.ts`:

```ts
export interface ClickKey {
  segmentId: string;
  t: number;
  x: number;
  y: number;
}

/** 指定セグメントの clicks から (t, x, y) が一致するクリックを 1 件削除する。
 *  該当 segmentId が無い、もしくは一致クリックが無い場合は input をそのまま（参照同一で）返す。 */
export function deleteClick(segments: Segment[], key: ClickKey): Segment[] {
  const i = segments.findIndex((s) => s.id === key.segmentId);
  if (i < 0) return segments;
  const seg = segments[i];
  const nextClicks = seg.clicks.filter((c) => !(c.t === key.t && c.x === key.x && c.y === key.y));
  if (nextClicks.length === seg.clicks.length) return segments;
  const next = segments.slice();
  next[i] = { ...seg, clicks: nextClicks };
  return next;
}
```

- [ ] **Step 4: テスト実行 — 4 件 PASS を確認**

Run: `npm test -- test/segmentOps.test.ts`
Expected: PASS (既存 + 新規 4 件)

- [ ] **Step 5: コミット**

```powershell
git add src/renderer/state/segmentOps.ts test/segmentOps.test.ts
git commit -m "feat(state): add deleteClick segment op + tests"
```

---

## Task 2: i18n キー追加

**Files:**
- Modify: `src/shared/i18n/locales/ja.json`
- Modify: `src/shared/i18n/locales/en.json`

- [ ] **Step 1: ja.json に `deleteClickHint` を追加**

In `src/shared/i18n/locales/ja.json`, modify the `"timeline"` block to add the new key (insert AFTER `"splitOnDoubleClick"`):

Before:
```json
  "timeline": {
    "video": "映像",
    "segment": "セグメント",
    "click": "クリック",
    "splitOnDoubleClick": "ダブルクリックで分割",
    "time": "時刻"
  },
```

After:
```json
  "timeline": {
    "video": "映像",
    "segment": "セグメント",
    "click": "クリック",
    "splitOnDoubleClick": "ダブルクリックで分割",
    "deleteClickHint": "クリックで選択 / Delete で削除",
    "time": "時刻"
  },
```

- [ ] **Step 2: en.json に同じキーを英訳で追加**

In `src/shared/i18n/locales/en.json` apply the same insertion:

Before:
```json
  "timeline": {
    "video": "Video",
    "segment": "Segment",
    "click": "Click",
    "splitOnDoubleClick": "Double-click to split",
    "time": "Time"
  },
```

After:
```json
  "timeline": {
    "video": "Video",
    "segment": "Segment",
    "click": "Click",
    "splitOnDoubleClick": "Double-click to split",
    "deleteClickHint": "Click to select, Delete to remove",
    "time": "Time"
  },
```

- [ ] **Step 3: localeKeys テストで PASS を確認**

Run: `npm test -- test/localeKeys.test.ts`
Expected: PASS（ja/en キー集合 + placeholder 一致）

- [ ] **Step 4: コミット**

```powershell
git add src/shared/i18n/locales/ja.json src/shared/i18n/locales/en.json
git commit -m "feat(i18n): add timeline.deleteClickHint"
```

---

## Task 3: Timeline に選択ステート + ◆ クリック + キー処理を追加

**Files:**
- Modify: `src/renderer/editor/Timeline.tsx`

このタスクは Timeline.tsx 1 ファイル内の以下 6 箇所を編集します。順番に。

### Step 1: 既存の Props 型に `onDeleteClick` を追加

Find:
```ts
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
  onResizeCommit?: (primaryId: string, side: 'left' | 'right', newTime: number) => void;
}
```

Replace with:
```ts
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
  onResizeCommit?: (primaryId: string, side: 'left' | 'right', newTime: number) => void;
  onDeleteClick?: (key: { segmentId: string; t: number; x: number; y: number }) => void;
}
```

### Step 2: 関数シグネチャの分解に `onDeleteClick` を追加

Find:
```ts
export function Timeline({
  duration, currentTime, segments, selectedId, playingId, playing,
  onSelect, onSeek, onSplitAtClick, onResizeCommit,
}: Props) {
```

Replace with:
```ts
export function Timeline({
  duration, currentTime, segments, selectedId, playingId, playing,
  onSelect, onSeek, onSplitAtClick, onResizeCommit, onDeleteClick,
}: Props) {
```

### Step 3: 選択ステートと自動解除 effect を追加

Find the line:
```ts
  const [pxPerSec, setPxPerSec] = useState(0);
```

Insert RIGHT BELOW it:
```ts
  type SelectedClick = { segmentId: string; t: number; x: number; y: number };
  const [selectedClick, setSelectedClick] = useState<SelectedClick | null>(null);
  // segments が外部から書き換わったら（削除/分割/結合/カット/編集など）選択解除
  useEffect(() => { setSelectedClick(null); }, [segments]);
```

### Step 4: `handleKeyDown` を Delete/Backspace/Esc に対応させる

Find:
```ts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const center = el.clientWidth / 2;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); applyZoom(pxPerSec * Math.SQRT2, center); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); applyZoom(pxPerSec / Math.SQRT2, center); }
    else if (e.key === '0') { e.preventDefault(); applyZoom(fitPxPerSec(), center); }
  };
```

Replace with:
```ts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const center = el.clientWidth / 2;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); applyZoom(pxPerSec * Math.SQRT2, center); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); applyZoom(pxPerSec / Math.SQRT2, center); }
    else if (e.key === '0') { e.preventDefault(); applyZoom(fitPxPerSec(), center); }
    else if (e.key === 'Escape') { if (selectedClick) { e.preventDefault(); setSelectedClick(null); } }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedClick && onDeleteClick) {
        e.preventDefault();
        onDeleteClick(selectedClick);
        // 削除直後の解除は segments 変化を待つ useEffect が行うが、Backspace の Electron 既定動作などを抑止するためここでも null 化
        setSelectedClick(null);
      }
    }
  };
```

### Step 5: 余白クリックで選択解除（既存 `onContentClick` を拡張）

Find:
```ts
  const onContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    onSeek(Math.max(0, Math.min(duration, pxToTime(x, pxPerSec))));
  };
```

Replace with:
```ts
  const onContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setSelectedClick(null);
    onSeek(Math.max(0, Math.min(duration, pxToTime(x, pxPerSec))));
  };
```

### Step 6: ◆ に `onClick` と選択ハイライトを追加

Find:
```tsx
            {/* クリック行 */}
            {contentRow(allClicks.map((c, i) => (
              <div
                key={`${c.segmentId}-${i}`}
                className="absolute size-4 cursor-pointer"
                style={{ top: ROW_H / 2 - 8, left: timeToPx(c.t, pxPerSec) - 8 }}
                title={t('timeline.splitOnDoubleClick')}
                onDoubleClick={(e) => { e.stopPropagation(); onSplitAtClick?.(c.segmentId, c.t); }}
              >
                <div className="size-2 rotate-45 bg-click-marker" style={{ margin: '4px' }} />
              </div>
            )))}
```

Replace with:
```tsx
            {/* クリック行 */}
            {contentRow(allClicks.map((c, i) => {
              const isSelected =
                !!selectedClick
                && selectedClick.segmentId === c.segmentId
                && selectedClick.t === c.t
                && selectedClick.x === c.x
                && selectedClick.y === c.y;
              return (
                <div
                  key={`${c.segmentId}-${i}`}
                  className={cn(
                    'absolute size-4 cursor-pointer rounded-sm',
                    isSelected && 'ring-2 ring-amber-300',
                  )}
                  style={{ top: ROW_H / 2 - 8, left: timeToPx(c.t, pxPerSec) - 8 }}
                  title={`${t('timeline.splitOnDoubleClick')} / ${t('timeline.deleteClickHint')}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedClick({ segmentId: c.segmentId, t: c.t, x: c.x, y: c.y });
                  }}
                  onDoubleClick={(e) => { e.stopPropagation(); onSplitAtClick?.(c.segmentId, c.t); }}
                >
                  <div className="size-2 rotate-45 bg-click-marker" style={{ margin: '4px' }} />
                </div>
              );
            }))}
```

(`cn` is already imported at the top of the file — no import change needed.)

### Step 7: typecheck + 既存テストの回帰なしを確認

Run: `npm run typecheck`
Expected: 0 errors

Run: `npm test`
Expected: PASS（既存 280+件 + Task 1 で増えた 4 件）

### Step 8: コミット

```powershell
git add src/renderer/editor/Timeline.tsx
git commit -m "feat(timeline): click-to-select + Delete/Esc on click markers"
```

---

## Task 4: EditorLayout で `onDeleteClick` ハンドラを接続

**Files:**
- Modify: `src/renderer/editor/EditorLayout.tsx`

- [ ] **Step 1: `deleteClick` import を追加**

Find:
```ts
import { splitAt, resizeBoundary, toggleEnabled, mergeWithNext } from '../state/segmentOps';
```

Replace with:
```ts
import { splitAt, resizeBoundary, toggleEnabled, mergeWithNext, deleteClick } from '../state/segmentOps';
```

- [ ] **Step 2: `onDeleteClick` ハンドラを宣言**

Find the block:
```ts
  const onToggleCut = (id: string) => applySegments(toggleEnabled(segments, id), id);
  const onMergeNext = (id: string) => applySegments(mergeWithNext(segments, id), id);
  const onSplitAtPlayhead = (id: string) => {
    const newId = `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next = splitAt(segments, id, state.currentTime, newId);
    if (next === segments) return;
    applySegments(next, newId);
  };
```

Insert RIGHT BELOW it:
```ts
  const onDeleteClick = (key: { segmentId: string; t: number; x: number; y: number }) => {
    const next = deleteClick(segments, key);
    if (next === segments) return;
    dispatch({ type: 'SET_SEGMENTS', segments: next });
    void window.api.updateSegments(next);
  };
```

(`SET_SEGMENTS` without `selectId` keeps the current selection — same shape as other ops that don't change segment selection.)

- [ ] **Step 3: Timeline に prop を渡す**

Find:
```tsx
        <Timeline
          duration={duration}
          currentTime={state.currentTime}
          segments={segments}
          selectedId={state.selectedSegmentId}
          playingId={playingId}
          playing={playing}
          onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
          onSeek={seek}
          onSplitAtClick={onSplitAtClick}
          onResizeCommit={onResizeCommit}
        />
```

Replace with:
```tsx
        <Timeline
          duration={duration}
          currentTime={state.currentTime}
          segments={segments}
          selectedId={state.selectedSegmentId}
          playingId={playingId}
          playing={playing}
          onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
          onSeek={seek}
          onSplitAtClick={onSplitAtClick}
          onResizeCommit={onResizeCommit}
          onDeleteClick={onDeleteClick}
        />
```

- [ ] **Step 4: typecheck + 既存テスト**

Run: `npm run typecheck`
Expected: 0 errors

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```powershell
git add src/renderer/editor/EditorLayout.tsx
git commit -m "feat(editor): wire onDeleteClick handler into Timeline"
```

---

## Task 5: 手動 E2E

**Files:**（変更なし、確認のみ）

- [ ] **Step 1: dev 起動**

Run: `npm run dev`
Expected: アプリ起動。

- [ ] **Step 2: 既存プロジェクトを開く（クリックを含むもの）**

Expected: タイムラインのクリック行に橙色の ◆ が表示される。

- [ ] **Step 3: ◆ を 1 つシングルクリック**

Expected: その ◆ に黄色のリング (`ring-2 ring-amber-300`) が出る。セグメント行のシークは起きない。

- [ ] **Step 4: `Delete` キー押下**

Expected: 該当 ◆ が消える。プロジェクトファイル（`segments.json`）も書き換わる（タスクマネージャやファイル更新時刻で確認可、必須ではない）。

- [ ] **Step 5: 別 ◆ を選択し `Backspace` で削除**

Expected: 同様に削除。

- [ ] **Step 6: ◆ を選択して `Esc` 押下**

Expected: 選択解除（リングが消える）。削除は起きない。

- [ ] **Step 7: ◆ を選択して別の行/余白を単クリック**

Expected: 選択解除。シーク（または該当行クリック）動作は従来通り。

- [ ] **Step 8: ◆ をダブルクリック**

Expected: 従来通りそのクリック時刻でセグメントが分割される。分割直後は選択が解除されている。

- [ ] **Step 9: プレビュー再生**

Expected: 削除済みクリックのリップルがプレビューに出ない。残ったクリックは出る。

- [ ] **Step 10: 書き出し**

Expected: MP4 にも削除済みクリックのリップルは焼き込まれない。

- [ ] **Step 11: typecheck + 全テスト最終確認**

Run: `npm run typecheck && npm test`
Expected: PASS。

- [ ] **Step 12: 必要なら最終調整コミット**

E2E 中に細かい修正があれば `fix(...)`/`style(...)` でコミット。なければスキップ。

---

## DRY / YAGNI チェック

- 削除ロジックは `segmentOps.ts` の `deleteClick` 1 箇所に集約。EditorLayout は薄いラッパー。Timeline は UI のみ。
- 複数選択 / undo / 確認ダイアログ / ソフトデリート / 右クリックメニューは作らない（spec §11）。
- Selection state は Timeline ローカルに置く（editorReducer に増やさない）。

## ロールバック

すべて純関数追加 + UI 配線のみで IPC/ストレージモデルへの影響なし。`git revert` でクリーンに巻き戻せる。
