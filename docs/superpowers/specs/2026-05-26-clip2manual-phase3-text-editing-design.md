# フェーズ3（テキスト編集 — 手動編集のみ）設計

- 日付: 2026-05-26
- 対象: セグメントの `correctedText` を手動で編集し `project.json` に保存する機能
- 位置づけ: ロードマップのフェーズ3「LLM補正＋テキスト編集・差分」のうち、**手動編集のみ**を実装する。LLM補正・差分ハイライトは後続ラウンドに分離。これにより後続のTTS差し替え（フェーズ4）が「正しいテキスト」を入力にできるようにする。
- 関連: `2026-05-26-clip2manual-design.md`（全体設計）、`2026-05-26-clip2manual-phase2-design.md`（文字起こし＋タイムライン）

## 背景と目的

フェーズ2で文字起こし結果が `Segment[]` としてタイムラインに並ぶようになった。各 `Segment` は
`originalText`（文字起こしの記録）と `correctedText`（編集対象、現状は `originalText` と同値で初期化）を
持つが、UI（Inspector）は読み取り専用で編集手段が無い。

TTSで元音声を差し替える前に、文字起こしの誤りを直せる必要がある。ユーザー要望により、補正は
**LLMだけに頼らず手動で編集できる**ことを最優先とする。本ラウンドは手動編集を提供し、LLM補正は
別ラウンドに切り出す。

採用アプローチ: **Approach A（blur時オートセーブ＋既存 `updateSegments` 再利用）**。
理由: 既存のアトミック保存をそのまま使え、新規IPCは1つで済み、dirty状態管理が不要で、
非技術者向けの「勝手に保存される」体験に合う。

## スコープ

含む:
- Inspector で `correctedText` を編集できる（テキストエリア）
- 編集を `project.json` に永続化（再オープンで保持）
- 元の文字起こし（`originalText`）を読み取り専用で並記
- 「元に戻す」（`correctedText` を `originalText` に戻す）
- 「編集済み」表示（`correctedText !== originalText` のとき）

含まない（後続）:
- LLM補正（プロバイダ抽象化・APIキー管理）
- 差分（diff）ハイライト表示 — 並記のみとする（YAGNI）
- TTS生成・音声差し替え・タイミング調整（フェーズ4）
- セグメントの結合/分割/トリム/区間削除（フェーズ6）

## データモデル

スキーマ変更なし（`src/shared/types.ts`）。
- `Segment.correctedText: string` を編集可能にするだけ。
- `Segment.originalText` は不変（文字起こしの記録）。
- `project.version` 変更なし。
- 空文字の `correctedText` は許容する（セグメントを空にできる）。後続TTSでの空文字の扱いは本ラウンド対象外。

## コンポーネントと変更点

### レデューサ（`src/renderer/state/editorReducer.ts`）
新アクション:

```ts
| { type: 'EDIT_SEGMENT_TEXT'; id: string; text: string }
```

- ハンドラは `state.project.segments` の該当 `id` の `correctedText` を不変更新する。
- `state.project` が `null`、または `id` が見つからない場合は no-op（状態をそのまま返す）。
- 「元に戻す」は専用アクションを設けず、`EDIT_SEGMENT_TEXT` に `text = originalText` を渡して実現する。

### IPC（`src/main/ipc/project.ts`）
新ハンドラ:

```ts
ipcMain.handle('project:updateSegments', (_e, segments: Segment[]) =>
  projectSession.updateSegments(segments));
```

- `projectSession.updateSegments`（既存）はセグメントを差し替えて `saveProject` でアトミック保存
  （`.tmp` 書き込み→`rename`）する。**このメソッドは変更せず再利用**する。

### preload / 型（`src/preload/index.ts`, `src/renderer/global.d.ts`）
`project.updateSegments(segments: Segment[]): Promise<void>` を公開・型付けする
（既存の `project` 名前空間に追加）。

### Inspector（`src/renderer/editor/Inspector.tsx`）
読み取り専用の補正表示を以下に置き換える:
- 元の文字起こし（`originalText`）: 読み取り専用ブロック（ラベル「元の文字起こし」）
- 補正テキスト（`correctedText`）: 編集可能な `<textarea>`
- 「元に戻す」ボタン
- 「編集済み」バッジ: `correctedText !== originalText` のとき表示
- 保存失敗時のインライン表示（後述）

## データフロー

テキストエリアは**ストア制御**（store を単一の真実とする）:

1. `onChange` → `EDIT_SEGMENT_TEXT` を dispatch（メモリ内のみ更新、IPCは呼ばない）。
2. `onBlur`（および「元に戻す」実行後）→ `window.api.project.updateSegments(state.project.segments)`
   を呼び、`project.json` に永続化する。

- セグメント切替・エディタを閉じる操作はテキストエリアを blur させるため、その時点でディスクに書き出される。
- 再オープン時は既存の `loadProject` 経由で保存済み `correctedText` が読み込まれる。
- キーストローク単位のオートセーブはしない（Approach B不採用）。dirty状態管理・保存ボタンも設けない（Approach C不採用）。

## エラー処理

- `updateSegments` はディスクエラーやプロジェクト未オープン時に throw しうる。
- Inspector は永続化呼び出しを try/catch で囲み、**メモリ内の編集は保持**（テキストを失わない）したうえで、
  ローカルのコンポーネント状態で「保存に失敗しました」をインライン表示する。
- 専用のレデューサ分岐は追加しない（UIローカルで完結）。

## テスト

- **単体（既存 Vitest 構成に適合）**: `editorReducer` の `EDIT_SEGMENT_TEXT`
  - 該当セグメントの `correctedText` のみ更新する
  - `originalText` および他セグメントは不変
  - 未知の `id` / `project === null` で no-op
- **手動E2E**: セグメント編集→blur→別セグメントへ切替→プロジェクト再オープンで編集テキストが保持される。
  「元に戻す」で `originalText` に戻る。「編集済み」バッジが正しく切り替わる。

## 未解決・先送り

- LLM補正（プロバイダ抽象化・APIキーの safeStorage 保存・「補正」ボタン）は次ラウンド。
- 差分ハイライト表示は必要になった時点で検討。
- 空 `correctedText` の TTS 時の扱い（無音にするかスキップするか）はフェーズ4で決める。
