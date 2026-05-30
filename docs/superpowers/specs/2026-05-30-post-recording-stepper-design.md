# 録画後の導線改善 — Stepper UI 設計

- 日付: 2026-05-30
- 対象: 録画完了後にエディタを開いてから「文字起こし → 編集 → 音声生成 → 書き出し」へ進む導線
- 関連: `src/renderer/editor/EditorLayout.tsx`, `src/renderer/editor/TimelineToolbar.tsx`

## 1. 背景と問題

現状の `EditorLayout` 上部ツールバー（高さ 48px・1 段）には以下のコントロールが横並びで等価に配置されている。

```
[← ホーム] [プロジェクト名] | [文字起こし] | [話者▼][速度─][全適用] | [字幕☐] | [全セグメント生成]
```

問題点:

1. **順序が読み取れない**: 文字起こし → 音声生成という暗黙のパイプラインがあるのに、ボタンが等価に並ぶため初見ユーザーには順序が分からない。
2. **空状態の手掛かりが無い**: 録画直後は `project.segments` が空で、タイムラインに何も無い状態。次に何をすべきかのヒントが UI 内に無い。
3. **文字起こしの再実行が壊す**: 文字起こしは原則 1 回で済むのに、ボタンは常に押せる。再実行するとユーザーが編集した `correctedText` が上書きされ得る。

## 2. 要件

- 録画後にエディタを開いた初見ユーザーが、ボタンを上から順に押すだけでマニュアル動画が完成する導線にする。
- 文字起こしは原則 1 回。完了後は永続的に Disabled にし、再実行不可とする（再実行したい場合はプロジェクトを作り直す）。
- 編集ステップは明示的な完了ボタンを設けず、「全セグメント生成」を押した時点で暗黙に完了扱いとする。
- 既存の `editorReducer` / IPC / `Inspector` には手を入れない。変更は UI レイヤに限定する。

## 3. 設計概要 — 案 B「チップ + アクティブステップ詳細」

採用レイアウトは案 B（チップ列 + アクティブステップ操作パネルの 2 段）。

```
Row 1 (44px): [← ホーム] [プロジェクト名] | ステップチップ列 | [字幕☐]
Row 2 (40px): アクティブステップの操作パネル
```

ステップは 4 つ:

```
① 文字起こし ─→ ② 編集 ─→ ③ 音声生成 ─→ ④ 書き出し
```

各チップは「番号・ラベル・状態アイコン」を表示する。状態は `locked`（○） / `active`（●） / `running`（●＋スピナー） / `done`（✓） / `error`（✕）。

`active|running` のうち最小のステップがアクティブステップ。Row 2 にはアクティブステップ専用の操作パネルを表示する。ユーザーはチップをクリックして別ステップに切り替えられる（`locked` チップは押せない。Step 1 チップは `done` 後 Disabled）。

## 4. コンポーネント構成

新規:

- `src/renderer/editor/StepperToolbar.tsx` — 上述 2 段の本体。Row 1 のチップ列と Row 2 のパネルをまとめて描画する。
- `src/renderer/editor/stepperState.ts` — ステップ派生純関数。テスト可能な単位で切り出す。

既存への変更:

- `EditorLayout.tsx` — 現状の上部 `<div className="flex flex-wrap ...">` ブロック（行 213–298）を `<StepperToolbar ... />` 呼び出しに置換。既存の各ハンドラ（`runTranscription`, `generateAll`, `doExport`, `setDefaultVoice`, `applyDefaultToAll`, `setShowSubtitles`, `loadSpeakers`）はそのまま props として渡す。
- `editorReducer.ts` / `Inspector.tsx` / `TimelineToolbar.tsx` / IPC: 変更なし。
- `TimelineToolbar.tsx` 下部の `[書き出し]` ボタンは**残す**（プレビュー直後に押せて便利。Step 4 と同じハンドラ）。

### 4.1 `stepperState.ts` API

```ts
export type StepStatus = 'locked' | 'active' | 'running' | 'done' | 'error';

export interface StepInputs {
  segments: Segment[];
  transcription: { status: 'idle' | 'running' | 'error'; error: string | null };
  tts: { status: 'idle' | 'running' | 'error'; error: string | null };
  export: { status: 'idle' | 'running' | 'done' | 'error' };
}

export function deriveStepStatuses(input: StepInputs): [StepStatus, StepStatus, StepStatus, StepStatus];
export function activeStep(statuses: [StepStatus, StepStatus, StepStatus, StepStatus]): 1 | 2 | 3 | 4;
```

`deriveStepStatuses` のロジック:

| Step | `locked` 条件 | `active` 条件 | `running` 条件 | `done` 条件 | `error` 条件 |
|---|---|---|---|---|---|
| ① 文字起こし | （無し） | segments 空 | `transcription.status === 'running'` | segments 非空 | `transcription.status === 'error'` |
| ② 編集 | segments 空 | segments 非空かつ TTS クリップ持ちセグメントが 1 つも無い | （無し） | TTS クリップ持ちセグメントが 1 つ以上 | （無し） |
| ③ 音声生成 | segments 空 | segments 非空（編集中も active 扱い） | `tts.status === 'running'` | enabled な全セグメントが TTS クリップ持ち | `tts.status === 'error'` |
| ④ 書き出し | enabled な全セグメントが TTS クリップ持ちではない | 上記が満たされる | `export.status === 'running'` | `export.status === 'done'` | `export.status === 'error'` |

`activeStep` は `[s1, s2, s3, s4]` を走査して最小の `active|running` インデックスを返す。全て `done|locked` の場合は 4 を返す（書き出し済みでも Step 4 をアクティブにしておくと再書き出ししやすい）。

### 4.2 各ステップのパネル中身

| Step | パネル要素 |
|---|---|
| ① 文字起こし | `[▶ 文字起こしを実行]` ボタン / 進捗% / `[キャンセル]` / `tx.status === 'error'` 時はエラー文。`done` 時は「✓ 完了しました。タイムラインで内容を確認・編集してください」のテキストヒント |
| ② 編集 | 「タイムラインのセグメントをクリックしてテキストを編集できます。完了したら ③ 音声生成 に進んでください。」のヒントテキストのみ |
| ③ 音声生成 | デフォルト話者 `[▼]` / 速度スライダー（0.5–2.0） / `[デフォルトを全適用]` / `[▶ 全セグメント生成]` / 進捗% / `[キャンセル]` / 初回エンジン起動ヒント / エラー文 |
| ④ 書き出し | `[▶ MP4 書き出し]` / 進捗% / `[キャンセル]` / 完了時はファイルパスとクレジット |

字幕チェックボックスは Row 1 右端に残す（プレビュー設定であり、パイプラインの一部ではないため）。

### 4.3 Props 概形

```ts
interface StepperToolbarProps {
  // state
  segments: Segment[];
  transcription: TranscriptionState;
  tts: TtsState;
  exportState: { status: 'idle' | 'running' | 'done' | 'error'; percent: number; message: string };
  showSubtitles: boolean;
  defaultSpeaker: number;
  defaultSpeed: number;
  speakers: SpeakerOption[];
  projectName: string;

  // handlers
  onHome(): void;
  onTranscribe(): void;
  onCancelTranscription(): void;
  onSetDefaultVoice(v: { speaker: number; speed: number }): void;
  onApplyDefaultToAll(): void;
  onLoadSpeakers(): void;
  onGenerateAll(): void;
  onCancelTts(): void;
  onExport(): void;
  onCancelExport(): void;
  onSetShowSubtitles(v: boolean): void;
}
```

## 5. 振る舞いの詳細

- **アクティブステップ自動追従**: アクティブステップが派生で変わると Row 2 のパネルも自動的に切り替わる。手動チップクリックでの切替は React のローカル state で記憶し、派生アクティブステップが**前進**したら自動でそこへスナップする。後退（既に done のステップへの手動戻り）はユーザー操作優先で維持する。
- **Step 1 のワンショット性**: `transcription.status` が `running|error` 以外で `segments.length > 0` のとき、Step 1 チップは `done` 表示 + Disabled、Step 1 のパネルは完了ヒントのみ表示。再実行手段はエディタ内に存在させない。
- **Step 3 のアクティブ判定**: 1 件でも `ttsClipPath` を持つセグメントがある時点で Step 2 は `done` になるが、Step 3 自体は「全 enabled が持つ」まで `active` を維持する。Inspector からの単発再生成にも自然に追従する。
- **エラー表示**: `error` 状態のチップは赤系統で表示し、Row 2 のパネルにエラーメッセージを残す。エラー後にユーザーが再操作（Step 1 なら不可、Step 3/4 なら再実行可）すると `running` へ戻る。

## 6. テスト方針

- **`stepperState.ts`**: Vitest で `deriveStepStatuses` を表テスト。最低限のシナリオ:
  - 初期状態（segments 空）
  - 文字起こし中
  - 文字起こしエラー
  - 文字起こし完了直後（編集中）
  - 一部セグメントのみ TTS 生成済（Inspector 単発生成）
  - TTS 全生成中
  - TTS 全完了
  - 書き出し中
  - 書き出し完了
- **`StepperToolbar` コンポーネント**: 上記シナリオを props として渡し、`activeStep` の判定とパネルの中身（active ステップの操作要素が出ているか）を React Testing Library で確認。
- **`EditorLayout`**: 既存のスモークテストが回帰なく通ること。
- **E2E（手動）**: 「録画 → 文字起こし → テキスト編集 → 全生成 → 書き出し」のゴールデンパスが、ボタンを上から順に押すだけで完走できることを確認。

## 7. 影響範囲とリスク

- 既存の `runTranscription` / `generateAll` / `doExport` 等の挙動・IPC は変更しないため、機能面のリグレッションリスクは低い。
- 上部ツールバーが 48px から ~84px に増える。`grid-rows-[48px_1fr_auto]` → `grid-rows-[84px_1fr_auto]` への変更が必要。
- Step 1 が永続 Disabled になることで「もう一度文字起こししたい」というユーザーは戸惑う可能性。Step 1 パネルの完了ヒントに「やり直すには新規プロジェクトを作成してください」と明記して緩和する。
- 多言語対応（ja/en）が必要。新規 i18n キー: `stepper.step1Label/step2Label/step3Label/step4Label`, `stepper.step1Hint`, `stepper.step2Hint`, `stepper.step1RestartNote` 等。

## 8. YAGNI で意図的に外したもの

- Step 4 後の「動画を開く」「フォルダを開く」ボタン: 既存のトースト + パスメッセージで十分なので追加しない。
- ステップ間の `>` アロー以外の装飾的進捗バー。
- ステップ 1 の確認付き再実行（プロジェクト作り直しで代替）。
