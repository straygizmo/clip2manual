# Split-at-Click-Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-click a click-marker diamond in the timeline to split the segment at that click's `t`, auto-selecting the new (after-) piece so the user can immediately type its description.

**Architecture:** Three small renderer-side edits: extend Timeline's marker render with a 16px hit-pad + `onDoubleClick` plumbed through a new optional `onSplitAtClick(segmentId, t)` prop; wire EditorLayout to that prop with a 3-line handler that calls the existing pure `splitAt` and dispatches `SET_SEGMENTS` with the new id as `selectId`; align Inspector's existing "分割" button to also select the new piece for consistency. No data model, no IPC, no new tests (existing `segmentOps.test.ts` covers the math).

**Tech Stack:** React 18 / TypeScript / Tailwind v4 / shadcn (no new deps)

**Branch:** `feat/split-at-click-markers` (master 起点、spec commit `0e4306e` already present)

**Spec:** `docs/superpowers/specs/2026-05-28-clip2manual-split-at-click-markers-design.md`

---

## File Structure

変更:
- `src/renderer/editor/Timeline.tsx` — Props に optional `onSplitAtClick`、`allClicks` に segmentId を持たせ、各マーカーを 16px ヒットパッド + 中央の 8px 菱形 + `onDoubleClick` 構造に
- `src/renderer/editor/EditorLayout.tsx` — `onSplitAtClick` ハンドラを定義し `Timeline` に渡す
- `src/renderer/editor/Inspector.tsx` — 既存 `onSplit` の selectId を新ID側に揃える（1行）

新規: なし
テスト: なし（既存 `test/segmentOps.test.ts` が `splitAt` の数学を網羅、本機能は描画＋既存純関数の合成のみ）

## 共通検証コマンド

各タスクで実装後に:
```
npm run typecheck
npm run build
npm test
```
`npm run dev` は GUI を起動して止まらないので**実行しない**（手動E2Eは最後にまとめて）。

---

## Task 1: Timeline にダブルクリック分割トリガーを追加

**Files:**
- Modify: `src/renderer/editor/Timeline.tsx`

- [ ] **Step 1: ファイルの現状を確認**

`Timeline.tsx` の現在の構造を読む（行数把握）:
```bash
wc -l src/renderer/editor/Timeline.tsx
```
予想: 72 行前後。

- [ ] **Step 2: Props 型に `onSplitAtClick` を追加**

`Timeline.tsx` の `interface Props { ... }` を以下に置換（既存のフィールドは保持し、末尾に追加）:

```ts
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
```

- [ ] **Step 3: 関数シグネチャに `onSplitAtClick` を追加**

`export function Timeline(...)` の引数分割を更新:

```ts
export function Timeline({
  duration, currentTime, segments, selectedId, playingId,
  onSelect, onSeek, onSplitAtClick,
}: Props) {
```

- [ ] **Step 4: `allClicks` を segmentId 付きに置換**

ファイル内の以下の行:
```ts
const allClicks = segments.flatMap((s) => s.clicks);
```
を以下に置換:
```ts
const allClicks = segments.flatMap((s) =>
  s.clicks.map((c) => ({ ...c, segmentId: s.id })),
);
```

- [ ] **Step 5: クリックマーカーの JSX を「ヒットパッド+菱形+onDoubleClick」に置換**

現在のクリックマーカー JSX（`{row('クリック', allClicks.map((c, i) => (...)))}` の中身）は以下のはず:

```tsx
<div
  key={i}
  className="absolute size-2 rotate-45 bg-click-marker"
  style={{ top: ROW_H / 2 - 4, left: `calc(${timeToPercent(c.t, duration)}% - 4px)` }}
/>
```

これを以下に置換:

```tsx
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
```

ポイント:
- 外側 `size-4`（16px）= ヒットパッド、`cursor-pointer` で発見性、`title` でツールチップ。
- `onClick` で `stopPropagation` を呼ぶことで、シングルクリック時に親のトラック `onClick={seekFromEvent}` が発火して再生ヘッドが動くのを防ぐ（マーカー上クリックは無反応で意図どおり）。
- `onDoubleClick` で分割。`onSplitAtClick?.(...)` の optional chaining で props 未指定時は何も起きない。
- 内側 `size-2` （8px）+ `margin: 4px` で見た目の菱形は中央に維持。

- [ ] **Step 6: 検証**

```
npm run typecheck
npm run build
npm test
```
Expected: 全て clean。typecheck は `c.segmentId` の型推論が効くこと、`onSplitAtClick` の optional で問題ないことを確認。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/editor/Timeline.tsx
git commit -m "feat(timeline): add double-click-to-split trigger on click markers"
```

---

## Task 2: EditorLayout から `onSplitAtClick` を Timeline に渡す

**Files:**
- Modify: `src/renderer/editor/EditorLayout.tsx`

- [ ] **Step 1: `splitAt` の import を確認**

`EditorLayout.tsx` の先頭の import 群を見て、`splitAt` を import しているか確認:
```bash
grep -n "splitAt" src/renderer/editor/EditorLayout.tsx
```

していなければ Step 2 で import 行を追加する。

- [ ] **Step 2: import を追加**

EditorLayout.tsx の他の `import` 群と同じ位置に以下を追加（既に同様の import があれば編集してまとめる）:

```ts
import { splitAt } from '../state/segmentOps';
```

- [ ] **Step 3: `onSplitAtClick` ハンドラを追加**

`EditorLayout` 関数本体内、`<Timeline ... />` の JSX より前の場所（例えば `seek` 関数定義の近く）に以下のハンドラを定義:

```ts
const onSplitAtClick = (segmentId: string, t: number) => {
  const newId = `seg-${Date.now()}`;
  const next = splitAt(segments, segmentId, t, newId);
  if (next === segments) return; // no-op（c.t == videoStart 等の境界）
  dispatch({ type: 'SET_SEGMENTS', segments: next, selectId: newId });
  void window.api.updateSegments(next);
};
```

ポイント:
- `segments` は既存の `const segments = project.segments;` を流用。
- 既存の Inspector の `applyOps` と同じパターン（`dispatch SET_SEGMENTS` + `updateSegments`）。
- no-op 時は副作用無しで戻る。

- [ ] **Step 4: `<Timeline />` に prop を渡す**

`<Timeline ... />` の Props 列に `onSplitAtClick={onSplitAtClick}` を追加:

```tsx
<Timeline
  duration={duration}
  currentTime={state.currentTime}
  segments={segments}
  selectedId={state.selectedSegmentId}
  playingId={playingId}
  onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
  onSeek={seek}
  onSplitAtClick={onSplitAtClick}
/>
```

- [ ] **Step 5: 検証**

```
npm run typecheck
npm run build
npm test
```
Expected: 全て clean。`SET_SEGMENTS` アクションが reducer 側で既存に存在することを typecheck が保証する。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/editor/EditorLayout.tsx
git commit -m "feat(editor): wire timeline marker double-click to splitAt"
```

---

## Task 3: Inspector の既存「分割」ボタンを新ID側選択に揃える

**Files:**
- Modify: `src/renderer/editor/Inspector.tsx`

新トリガー（タイムラインのマーカーダブルクリック）と既存トリガー（Inspector の「分割（再生ヘッド位置）」ボタン）で、**分割後にどちらの片を選択するか** が分かれているのは混乱の元。本タスクで既存ボタンも新ID側選択に揃える（spec の「既存 Inspector の分割ボタンとの整合」セクション）。

- [ ] **Step 1: 既存 `onSplit` の現状を確認**

```bash
grep -n "onSplit\b" src/renderer/editor/Inspector.tsx
```
Expected: 以下のような1行が見つかる:
```ts
const onSplit = () => applyOps(splitAt(segments, segment.id, state.currentTime, `seg-${Date.now()}`), segment.id);
```

- [ ] **Step 2: `onSplit` を新ID選択版に置換**

該当行を以下に置換:

```ts
const onSplit = () => {
  const newId = `seg-${Date.now()}`;
  applyOps(splitAt(segments, segment.id, state.currentTime, newId), newId);
};
```

`applyOps(next, selectId)` の `selectId` を元の `segment.id`（前片）から新ID（後片）に変更しただけ。

- [ ] **Step 3: 検証**

```
npm run typecheck
npm run build
npm test
```
Expected: 全て clean。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/editor/Inspector.tsx
git commit -m "feat(inspector): select new piece after splitAt for UX consistency"
```

---

## 完了の定義

- 全タスクのコミットが `feat/split-at-click-markers` ブランチに揃っている。
- `npm run typecheck` / `npm run build` / `npm test` がクリーン。
- **手動 E2E（要・実機、`npm run dev`）**:
  - 10クリック持つ単一セグメント上で、各クリックマーカー（菱形）を1個ずつダブルクリック → 各回1段ずつ分割される。
  - 分割直後に Inspector の選択が**後片（新ID、テキスト空）**に移り、補正テキスト入力欄が即編集可能になる。
  - マーカーをホバーすると `cursor-pointer` ＋ ツールチップ「ダブルクリックで分割」が出る。
  - マーカー上でのシングルクリックは無反応（親トラックの seek も発火しない）。
  - Inspector の「分割（再生ヘッド位置）」ボタンも分割後に後片が選択される。
  - カット中セグメントのマーカーをダブルクリックしても分割できる（両片の `enabled` を継承）。
  - 分割した複数セグメントに個別のテキストを入れ、TTS 再生成して書き出す → クリックと TTS の同期が改善されていること（本機能の本来の目的検証）。

## 非対象（後続）

- 「全クリックで分割」一括ボタン
- 分割テキストの自動分配
- 単一クリックでのマーカー選択／ハイライト
- ドラッグでの境界調整（フェーズ6b）
- 分割の Undo
