# セグメント操作（カット/結合/分割）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セグメントのカット（有効/無効トグル）・隣接結合・再生ヘッド位置での分割を追加し、プレビュー/書き出しが無効セグメントを除外するようにする。

**Architecture:** 純関数 `segmentOps.ts`（`Segment[] → Segment[]`）＋汎用 `SET_SEGMENTS` reducer アクション。`computePreviewTimeline` が `enabled === false` を除外（preview/export 共通）。Inspector にボタン、Timeline で無効をグレー表示。

**Tech Stack:** Electron + TypeScript + React、Vitest（test/・node環境・`.test.ts`）。

spec: `docs/superpowers/specs/2026-05-27-clip2manual-phase6a-segment-ops-design.md`

---

## File Structure

- `src/renderer/state/segmentOps.ts` — **Create**: 純関数 `toggleEnabled`/`mergeWithNext`/`splitAt`（単体テスト対象）
- `tsconfig.node.json` — **Modify**: include に `segmentOps.ts` 追加
- `src/shared/previewTimeline.ts` — **Modify**: `enabled === false` を除外
- `src/renderer/state/editorReducer.ts` — **Modify**: `SET_SEGMENTS` アクション
- `src/renderer/editor/Inspector.tsx` — **Modify**: カット/分割/結合ボタン
- `src/renderer/editor/Timeline.tsx` — **Modify**: 無効セグメントのグレー表示
- 各 `test/*.test.ts`

依存順: T1（segmentOps, TDD）→ T2（previewTimeline 除外, TDD）→ T3（SET_SEGMENTS, TDD）→ T4（UI）→ T5（検証）。

---

## Task 1: `segmentOps.ts`（純関数）

**Files:**
- Create: `src/renderer/state/segmentOps.ts`
- Test: `test/segmentOps.test.ts`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: 失敗するテストを書く**

`test/segmentOps.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toggleEnabled, mergeWithNext, splitAt } from '../src/renderer/state/segmentOps';
import { type Segment, type ClickEvent } from '../src/shared/types';

function click(t: number): ClickEvent { return { x: 1, y: 1, t, button: 1 }; }
function seg(id: string, start: number, end: number, over: Partial<Segment> = {}): Segment {
  return {
    id, videoStart: start, videoEnd: end, originalText: `o-${id}`, correctedText: `c-${id}`,
    ttsAudio: `tts/${id}.wav`, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true, ...over,
  };
}

describe('toggleEnabled', () => {
  it('flips enabled of the target only', () => {
    const r = toggleEnabled([seg('seg-001', 0, 1), seg('seg-002', 1, 2)], 'seg-002');
    expect(r[0].enabled).toBe(true);
    expect(r[1].enabled).toBe(false);
  });
});

describe('mergeWithNext', () => {
  it('merges target with the following segment and nulls ttsAudio', () => {
    const a = seg('seg-001', 0, 2, { clicks: [click(0.5)] });
    const b = seg('seg-002', 2, 5, { clicks: [click(3)] });
    const r = mergeWithNext([a, b], 'seg-001');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('seg-001');
    expect(r[0].videoStart).toBe(0);
    expect(r[0].videoEnd).toBe(5);
    expect(r[0].correctedText).toBe('c-seg-001c-seg-002');
    expect(r[0].clicks).toHaveLength(2);
    expect(r[0].ttsAudio).toBeNull();
  });
  it('is a no-op on the last segment', () => {
    const segs = [seg('seg-001', 0, 2), seg('seg-002', 2, 5)];
    expect(mergeWithNext(segs, 'seg-002')).toEqual(segs);
  });
});

describe('splitAt', () => {
  it('splits at atTime: second text empty, both ttsAudio null, clicks partitioned', () => {
    const s = seg('seg-001', 0, 4, { clicks: [click(1), click(3)] });
    const r = splitAt([s], 'seg-001', 2, 'seg-NEW');
    expect(r).toHaveLength(2);
    expect(r[0].videoStart).toBe(0);
    expect(r[0].videoEnd).toBe(2);
    expect(r[0].correctedText).toBe('c-seg-001');
    expect(r[0].clicks.map((c) => c.t)).toEqual([1]);
    expect(r[0].ttsAudio).toBeNull();
    expect(r[1].id).toBe('seg-NEW');
    expect(r[1].videoStart).toBe(2);
    expect(r[1].videoEnd).toBe(4);
    expect(r[1].correctedText).toBe('');
    expect(r[1].clicks.map((c) => c.t)).toEqual([3]);
    expect(r[1].ttsAudio).toBeNull();
  });
  it('is a no-op when atTime is outside (videoStart, videoEnd)', () => {
    const s = [seg('seg-001', 0, 4)];
    expect(splitAt(s, 'seg-001', 0, 'x')).toEqual(s);
    expect(splitAt(s, 'seg-001', 4, 'x')).toEqual(s);
    expect(splitAt(s, 'seg-001', 5, 'x')).toEqual(s);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- segmentOps`
Expected: FAIL（未作成）

- [ ] **Step 3: 実装**

`src/renderer/state/segmentOps.ts`:

```ts
import { type Segment } from '../../shared/types';

/** 指定セグメントの enabled をトグルする（他は不変）。 */
export function toggleEnabled(segments: Segment[], id: string): Segment[] {
  return segments.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
}

/** 指定セグメントを次のセグメントと結合する。最後のセグメントなら変化なし。 */
export function mergeWithNext(segments: Segment[], id: string): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0 || i >= segments.length - 1) return segments;
  const a = segments[i];
  const b = segments[i + 1];
  const merged: Segment = {
    ...a,
    videoEnd: b.videoEnd,
    originalText: a.originalText + b.originalText,
    correctedText: a.correctedText + b.correctedText,
    clicks: [...a.clicks, ...b.clicks],
    ttsAudio: null,
  };
  return [...segments.slice(0, i), merged, ...segments.slice(i + 2)];
}

/** 指定セグメントを atTime で2つに分割する。atTime が (videoStart, videoEnd) 外なら変化なし。
 *  first はテキストを保持、second は correctedText='' と newId。clicks は時刻で分配。両片 ttsAudio=null。 */
export function splitAt(segments: Segment[], id: string, atTime: number, newId: string): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0) return segments;
  const seg = segments[i];
  if (atTime <= seg.videoStart || atTime >= seg.videoEnd) return segments;
  const first: Segment = {
    ...seg,
    videoEnd: atTime,
    clicks: seg.clicks.filter((c) => c.t < atTime),
    ttsAudio: null,
  };
  const second: Segment = {
    ...seg,
    id: newId,
    videoStart: atTime,
    correctedText: '',
    clicks: seg.clicks.filter((c) => c.t >= atTime),
    ttsAudio: null,
  };
  return [...segments.slice(0, i), first, second, ...segments.slice(i + 1)];
}
```

- [ ] **Step 4: tsconfig.node に追加**

`tsconfig.node.json` の `include` 配列、`"src/renderer/state/editorReducer.ts",` の行の直後に追加:

```json
    "src/renderer/state/editorReducer.ts",
    "src/renderer/state/segmentOps.ts",
```

- [ ] **Step 5: パス確認**

Run: `npm test -- segmentOps`
Expected: PASS（5件）
Run: `npm run typecheck` → PASS

- [ ] **Step 6: コミット**

```bash
git add src/renderer/state/segmentOps.ts test/segmentOps.test.ts tsconfig.node.json
git commit -m "feat: add pure segment ops (toggleEnabled/mergeWithNext/splitAt)"
```

---

## Task 2: `computePreviewTimeline` が無効セグメントを除外

**Files:**
- Modify: `src/shared/previewTimeline.ts`
- Test: `test/previewTimeline.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`test/previewTimeline.test.ts` の `describe('computePreviewTimeline', ...)` ブロック末尾（最後の `it` の後）に追記:

```ts
  it('excludes disabled (enabled === false) segments', () => {
    const slots = computePreviewTimeline(
      [{ ...seg('seg-001', 0, 2), enabled: false }, seg('seg-002', 2, 4)],
      new Map(),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].segmentId).toBe('seg-002');
  });
```

（このテストファイルの既存 `seg(id, start, end)` ヘルパは `enabled: true` のフル `Segment` を返すので、`{ ...seg(...), enabled: false }` で上書きする。）

- [ ] **Step 2: 失敗確認**

Run: `npm test -- previewTimeline`
Expected: FAIL（現状は無効も含めるので 2 スロットになる）

- [ ] **Step 3: 実装**

`src/shared/previewTimeline.ts` の `computePreviewTimeline` のループ先頭に除外を追加。現在:

```ts
  for (const seg of segments) {
    const videoSpan = Math.max(0, seg.videoEnd - seg.videoStart);
```

を次に変更:

```ts
  for (const seg of segments) {
    if (seg.enabled === false) continue; // カット（無効）セグメントは出力に含めない
    const videoSpan = Math.max(0, seg.videoEnd - seg.videoStart);
```

- [ ] **Step 4: パス確認**

Run: `npm test -- previewTimeline`
Expected: PASS（既存＋追加分）
Run: `npm run typecheck` → PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/previewTimeline.ts test/previewTimeline.test.ts
git commit -m "feat: exclude disabled segments from the preview/export timeline"
```

---

## Task 3: reducer `SET_SEGMENTS`

**Files:**
- Modify: `src/renderer/state/editorReducer.ts`
- Test: `test/editorReducer.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`test/editorReducer.test.ts` の `describe('editorReducer', ...)` 末尾に追記:

```ts
  it('SET_SEGMENTS replaces segments and updates selection when selectId given', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg, { ...seg, id: 'seg-002' }] });
    s = editorReducer(s, { type: 'SET_SEGMENTS', segments: [{ ...seg, id: 'seg-002' }], selectId: 'seg-002' });
    expect(s.project!.segments).toHaveLength(1);
    expect(s.project!.segments[0].id).toBe('seg-002');
    expect(s.selectedSegmentId).toBe('seg-002');
  });

  it('SET_SEGMENTS without selectId keeps the current selection', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg] });
    s = editorReducer(s, { type: 'SELECT_SEGMENT', id: 'seg-001' });
    s = editorReducer(s, { type: 'SET_SEGMENTS', segments: [{ ...seg, correctedText: 'x' }] });
    expect(s.selectedSegmentId).toBe('seg-001');
    expect(s.project!.segments[0].correctedText).toBe('x');
  });
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- editorReducer`
Expected: FAIL（アクション未実装）

- [ ] **Step 3: アクション型を追加**

`src/renderer/state/editorReducer.ts` の `EditorAction` ユニオン末尾（`TTS_ERROR` 行）を変更し、追加する。現在の末尾:

```ts
  | { type: 'TTS_ERROR'; error: string };
```

を次に:

```ts
  | { type: 'TTS_ERROR'; error: string }
  | { type: 'SET_SEGMENTS'; segments: Segment[]; selectId?: string };
```

- [ ] **Step 4: ハンドラを実装**

`switch` 内、`case 'TTS_ERROR':` の `return` 文の直後に追加:

```ts
    case 'SET_SEGMENTS':
      if (!state.project) return state;
      return {
        ...state,
        project: { ...state.project, segments: action.segments },
        selectedSegmentId: action.selectId ?? state.selectedSegmentId,
      };
```

- [ ] **Step 5: パス確認**

Run: `npm test -- editorReducer`
Expected: PASS（既存＋追加2件）
Run: `npm run typecheck` → PASS

- [ ] **Step 6: コミット**

```bash
git add src/renderer/state/editorReducer.ts test/editorReducer.test.ts
git commit -m "feat: add SET_SEGMENTS reducer action"
```

---

## Task 4: UI（Inspector ボタン ＋ Timeline グレー表示）

**Files:**
- Modify: `src/renderer/editor/Inspector.tsx`
- Modify: `src/renderer/editor/Timeline.tsx`

> Reactコンポーネントの単体テスト基盤は無い。`npm run typecheck` + `npm run build` + 手動E2E（Task 5）で検証。**まず両ファイルを読んでから**アンカーに挿入すること。アンカーが一致しなければ中断して報告。

- [ ] **Step 1: `Inspector.tsx` に import を追加**

先頭の import 群に追加（`useEditor` の import の下あたり）:

```ts
import { toggleEnabled, mergeWithNext, splitAt } from '../state/segmentOps';
```

- [ ] **Step 2: `Inspector.tsx` にハンドラを追加**

`if (!segment) { return ...; }` の早期 return より後、`return (` より前（既存の `revert`/`setVoice` などのヘルパ群と同じ領域）に追加:

```ts
  const segments = state.project?.segments ?? [];
  const isLast = segments.length > 0 && segments[segments.length - 1].id === segment.id;
  const canSplit = state.currentTime > segment.videoStart && state.currentTime < segment.videoEnd;

  const applyOps = (next: Segment[], selectId: string) => {
    dispatch({ type: 'SET_SEGMENTS', segments: next, selectId });
    void window.api.updateSegments(next);
  };
  const onToggleCut = () => applyOps(toggleEnabled(segments, segment.id), segment.id);
  const onMerge = () => applyOps(mergeWithNext(segments, segment.id), segment.id);
  const onSplit = () => applyOps(splitAt(segments, segment.id, state.currentTime, `seg-${Date.now()}`), segment.id);
```

- [ ] **Step 3: `Inspector.tsx` にボタンを追加**

レンダリング内、クリック件数を表示する行 `<div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>クリック {segment.clicks.length} 件</div>` の**直前**に挿入:

```tsx
      <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #eee' }} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onToggleCut}>{segment.enabled ? 'カット' : '有効化'}</button>
        <button onClick={onSplit} disabled={!canSplit}>分割（再生ヘッド位置）</button>
        <button onClick={onMerge} disabled={isLast}>次と結合</button>
      </div>
      {!segment.enabled && (
        <div style={{ fontSize: 12, color: '#c87', marginTop: 6 }}>カット中（プレビュー/書き出しで除外）</div>
      )}
```

- [ ] **Step 4: `Timeline.tsx` で無効セグメントをグレー表示**

セグメント `<div>` の `style` に `opacity` を追加する。現在のセグメント `<div>` の style に含まれる行:

```ts
              background: s.id === playingId ? '#2e8b57' : s.id === selectedId ? '#4a90d9' : '#3a3a3a',
```

の直後（同じ style オブジェクト内）に追加:

```ts
              opacity: s.enabled === false ? 0.35 : 1,
```

- [ ] **Step 5: 検証**

Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS
Run: `npm test` → PASS

- [ ] **Step 6: コミット**

```bash
git add src/renderer/editor/Inspector.tsx src/renderer/editor/Timeline.tsx
git commit -m "feat: add cut/split/merge buttons and grey disabled segments"
```

---

## Task 5: 全体検証（手動E2E＋最終チェック）

**Files:** なし（検証のみ）

- [ ] **Step 1: 自動チェック green**

Run: `npm test` → PASS
Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS

- [ ] **Step 2: 手動E2E（実機GUI）**

Run: `npm run dev`

手順と期待結果（文字起こし済み・できれば TTS生成済みのプロジェクトで）:
1. セグメントを選択 → インスペクタに「カット」「分割（再生ヘッド位置）」「次と結合」ボタンが出る。
2. **カット** → タイムラインで該当セグメントがグレーになり、ラベルが「有効化」に。プレビュー再生で飛ばされ、書き出しにも含まれない（TTSモード/書き出しで確認）。**有効化**で戻る。
3. 再生ヘッドをセグメント内に置く → **分割** で2つになる。第2片はテキスト空・両片「未生成」。再オープンで保持。両片を生成できる。
4. セグメント選択 → **次と結合** で次と1つになり、テキスト結合・「未生成」（ttsAudioクリア）。最後のセグメントでは「次と結合」無効。再生ヘッドが外なら「分割」無効。
5. 各操作後、再オープンしても結果が保持される（永続化）。

- [ ] **Step 3: 結果を記録**

確認項目／問題を記録。問題があれば systematic-debugging で対処（特に分割の newId 一意性、結合後の選択、enabled 除外がプレビュー/書き出し双方に効くか）。

---

## 完了の定義

- `segmentOps`・`SET_SEGMENTS`・`computePreviewTimeline`（除外）の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機でカット（除外/復帰）・分割・結合ができ、プレビューと書き出しがカットを尊重し、結合/分割後に再生成でき、再オープンで保持される。
