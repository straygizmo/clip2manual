# 手動テキスト編集（フェーズ3 — 手動編集のみ）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inspector で各セグメントの `correctedText` を手動編集し、blur時に `project.json` へ自動保存できるようにする。

**Architecture:** レンダラのレデューサに `EDIT_SEGMENT_TEXT` を追加してメモリ内編集を行い、テキストエリアの blur 時に新規IPC `project:updateSegments` 経由で既存の `projectSession.updateSegments`（アトミック保存）を呼ぶ。Inspector を読み取り専用から編集可能UIへ変更する。スキーマ変更・新規依存なし。

**Tech Stack:** Electron + TypeScript + React、Vitest（テストは `test/`・node環境・`.test.ts` のみ。Reactコンポーネントの単体テスト基盤は無いため UI は typecheck/build + 手動E2E で検証）。

---

## File Structure

- `src/renderer/state/editorReducer.ts` — **Modify**: `EDIT_SEGMENT_TEXT` アクションとハンドラを追加（純ロジック、唯一の新規単体テスト対象）
- `test/editorReducer.test.ts` — **Modify**: `EDIT_SEGMENT_TEXT` のテストを追加
- `src/main/ipc/project.ts` — **Modify**: `project:updateSegments` ハンドラを追加（既存 `projectSession.updateSegments` を再利用）
- `src/preload/index.ts` — **Modify**: `updateSegments` をフラットに公開（既存APIの流儀に合わせる）
- `src/renderer/global.d.ts` — **Modify**: `updateSegments` を型付け
- `src/renderer/editor/Inspector.tsx` — **Modify**: 読み取り専用表示を編集可能UI（textarea・元に戻す・編集済みバッジ・保存失敗表示）に置き換え

> 注: 公開メソッドは既存の `window.api.openProject` などと同じく**フラット**にする（`window.api.updateSegments`）。IPCチャンネル名のみ `project:` 名前空間を使う（`project:open` などに合わせる）。

---

## Task 1: レデューサに `EDIT_SEGMENT_TEXT` を追加

**Files:**
- Modify: `src/renderer/state/editorReducer.ts`
- Test: `test/editorReducer.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/editorReducer.test.ts` の `describe('editorReducer', ...)` ブロック末尾（最後の `it` の後、閉じ `});` の前）に追記する:

```ts
  it('EDIT_SEGMENT_TEXT updates correctedText of the matching segment only', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, {
      type: 'TRANSCRIPTION_DONE',
      segments: [seg, { ...seg, id: 'seg-002', originalText: 'b', correctedText: 'b' }],
    });
    s = editorReducer(s, { type: 'EDIT_SEGMENT_TEXT', id: 'seg-002', text: 'edited' });
    const segs = s.project!.segments;
    expect(segs[0].correctedText).toBe('a'); // 他セグメントは不変
    expect(segs[1].correctedText).toBe('edited'); // 該当セグメントのみ更新
    expect(segs[1].originalText).toBe('b'); // originalText は不変
  });

  it('EDIT_SEGMENT_TEXT is a no-op for an unknown id', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg] });
    s = editorReducer(s, { type: 'EDIT_SEGMENT_TEXT', id: 'nope', text: 'x' });
    expect(s.project!.segments[0].correctedText).toBe('a');
  });

  it('EDIT_SEGMENT_TEXT is a no-op when no project is open', () => {
    const s = editorReducer(initialEditorState, { type: 'EDIT_SEGMENT_TEXT', id: 'seg-001', text: 'x' });
    expect(s.project).toBeNull();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- editorReducer`
Expected: FAIL（`EDIT_SEGMENT_TEXT` がアクション型に無く tsc/実行でエラー、または該当 case 未実装で `correctedText` が更新されない）

- [ ] **Step 3: アクション型を追加**

`src/renderer/state/editorReducer.ts` の `EditorAction` ユニオンに1行追加する。`SET_CURRENT_TIME` の行の直後に挿入:

```ts
  | { type: 'SET_CURRENT_TIME'; time: number }
  | { type: 'EDIT_SEGMENT_TEXT'; id: string; text: string }
```

- [ ] **Step 4: ハンドラを実装**

同ファイルの `switch` 内、`case 'SET_CURRENT_TIME':` の `return` 文の直後に `case` を追加する:

```ts
    case 'EDIT_SEGMENT_TEXT':
      if (!state.project) return state;
      return {
        ...state,
        project: {
          ...state.project,
          segments: state.project.segments.map((s) =>
            s.id === action.id ? { ...s, correctedText: action.text } : s,
          ),
        },
      };
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test -- editorReducer`
Expected: PASS（既存テスト＋追加3件すべて green）

- [ ] **Step 6: コミット**

```bash
git add src/renderer/state/editorReducer.ts test/editorReducer.test.ts
git commit -m "feat: add EDIT_SEGMENT_TEXT action to editor reducer"
```

---

## Task 2: `project:updateSegments` IPC・preload・型を追加

**Files:**
- Modify: `src/main/ipc/project.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`

> このコードベースに IPC ハンドラの単体テストは無い（`src/main/ipc/*` は未テスト）。永続化の中核 `projectSession.updateSegments` は `test/projectSession.test.ts` で既に検証済みのため、本タスクは typecheck + build で検証する。

- [ ] **Step 1: main プロセスにハンドラを追加**

`src/main/ipc/project.ts` 冒頭の import 群に Segment 型を追加（`projectSession` の import の下）:

```ts
import { projectSession } from '../projectSession';
import { type Segment } from '../../shared/types';
```

`registerProjectIpc()` 内、`ipcMain.handle('project:open', ...)` の行の直後にハンドラを追加:

```ts
  ipcMain.handle('project:updateSegments', async (_e, segments: Segment[]) => {
    await projectSession.updateSegments(segments);
    return { ok: true as const };
  });
```

- [ ] **Step 2: preload で公開**

`src/preload/index.ts` の先頭 import 行の直後に型 import を追加:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { Segment } from '../shared/types';
```

`exposeInMainWorld('api', { ... })` の `recentProjects:` 行の直後に追加:

```ts
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  updateSegments: (segments: Segment[]) => ipcRenderer.invoke('project:updateSegments', segments),
```

- [ ] **Step 3: renderer の型に追加**

`src/renderer/global.d.ts` の `api` インターフェース内、`recentProjects:` 行の直後に追加（`Segment` は既に import 済み）:

```ts
      recentProjects: () => Promise<RecentProject[]>;
      updateSegments: (segments: Segment[]) => Promise<{ ok: true }>;
```

- [ ] **Step 4: typecheck と build を確認**

Run: `npm run typecheck`
Expected: PASS（エラーなし）

Run: `npm run build`
Expected: PASS（main/preload/renderer すべてバンドル成功）

- [ ] **Step 5: コミット**

```bash
git add src/main/ipc/project.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat: add project:updateSegments IPC to persist segment edits"
```

---

## Task 3: Inspector を編集可能UIに変更

**Files:**
- Modify: `src/renderer/editor/Inspector.tsx`

> Reactコンポーネントの単体テスト基盤が無いため、本タスクは typecheck + build + 手動E2E（Task 4）で検証する。
>
> **stale-closure 注意**: 「元に戻す」は dispatch 直後に保存するが、`dispatch` 後の `state` は同じイベント内では未更新のため、保存対象の `segments` を**その場で計算して渡す**こと（下記 `revert` 参照）。`onBlur` は別イベントで発火し再レンダリング後のため `state.project.segments` を直接渡してよい。

- [ ] **Step 1: Inspector.tsx を全置換**

`src/renderer/editor/Inspector.tsx` の内容を以下で置き換える:

```tsx
import { useState } from 'react';
import { type Segment } from '../../shared/types';
import { useEditor } from '../state/editorStore';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

export function Inspector({ segment, index }: { segment: Segment | null; index: number }) {
  const { state, dispatch } = useEditor();
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!segment) {
    return <div style={{ padding: 12, color: '#888' }}>セグメントを選択してください</div>;
  }

  const edited = segment.correctedText !== segment.originalText;

  const persist = async (segments: Segment[]) => {
    try {
      await window.api.updateSegments(segments);
      setSaveError(null);
    } catch (err) {
      setSaveError(String(err));
    }
  };

  const onBlur = () => {
    if (state.project) void persist(state.project.segments);
  };

  const revert = () => {
    if (!state.project) return;
    const segments = state.project.segments.map((s) =>
      s.id === segment.id ? { ...s, correctedText: s.originalText } : s,
    );
    dispatch({ type: 'EDIT_SEGMENT_TEXT', id: segment.id, text: segment.originalText });
    void persist(segments);
  };

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <h3 style={{ marginTop: 0 }}>
        セグメント {index + 1}（{segment.id}）
        {edited && (
          <span style={{ marginLeft: 8, fontSize: 11, color: '#0a7', border: '1px solid #0a7', borderRadius: 4, padding: '1px 5px' }}>
            編集済み
          </span>
        )}
      </h3>
      <div style={{ color: '#666', marginBottom: 8 }}>
        {fmt(segment.videoStart)} – {fmt(segment.videoEnd)}
      </div>

      <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>元の文字起こし（読み取り専用）</div>
      <div style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
        {segment.originalText || '（無音/空）'}
      </div>

      <div style={{ color: '#666', fontSize: 12, marginTop: 8, marginBottom: 4 }}>補正テキスト</div>
      <textarea
        value={segment.correctedText}
        onChange={(e) => dispatch({ type: 'EDIT_SEGMENT_TEXT', id: segment.id, text: e.target.value })}
        onBlur={onBlur}
        rows={4}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', padding: 8, borderRadius: 4 }}
      />

      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={revert} disabled={!edited}>元に戻す</button>
        {saveError && <span style={{ color: '#c00', fontSize: 12 }}>保存に失敗しました</span>}
      </div>

      <div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>クリック {segment.clicks.length} 件</div>
    </div>
  );
}
```

> `useEditor()` は `{ state, dispatch }` を返す（`src/renderer/state/editorStore.tsx`）。テキストエリアの `value` は `segment.correctedText`（EditorLayout が store からレンダリングごとに導出して渡すため store と同期している）。

- [ ] **Step 2: typecheck と build を確認**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/renderer/editor/Inspector.tsx
git commit -m "feat: make segment corrected text editable in the inspector"
```

---

## Task 4: 全体検証（手動E2E＋最終チェック）

**Files:** なし（検証のみ）

- [ ] **Step 1: 全自動テスト・typecheck・build が green であることを確認**

Run: `npm test`
Expected: PASS（既存＋追加分すべて）

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 2: 手動E2E（実機）**

Run: `npm run dev`

手順と期待結果:
1. ホーム画面から録画済みプロジェクト（`rec-*`、文字起こし済みのもの）を開く。必要なら「文字起こし」を実行してセグメントを生成する。
2. タイムラインでセグメントを選択 → Inspector に「元の文字起こし（読み取り専用）」と編集可能な「補正テキスト」が表示される。
3. 補正テキストを編集 → テキストエリアからフォーカスを外す（別セグメント選択 or 画面の別所をクリック）。
4. 別セグメントへ切替 → 元のセグメントに戻ると編集内容が保持されている。
5. **再オープン検証**: 「← ホーム」→ 同じプロジェクトを開き直す → 編集した補正テキストが残っている（＝`project.json` に保存済み）。
6. 「編集済み」バッジが `correctedText !== originalText` のとき表示され、一致時は消える。
7. 「元に戻す」を押すと補正テキストが元の文字起こしに戻り、バッジが消え、再オープンしても元に戻ったまま。

- [ ] **Step 3: 手動E2Eの結果を記録**

実機で確認できた項目／できなかった項目を簡潔に記録する（メモリ更新や報告に使う）。問題があれば systematic-debugging で対処する。

---

## 完了の定義

- `EDIT_SEGMENT_TEXT` の単体テスト（3件）が通る
- `npm test` / `npm run typecheck` / `npm run build` がすべて green
- Inspector で補正テキストを編集 → 再オープンで保持されることを実機で確認
- 「元に戻す」「編集済み」バッジが期待どおり動作
