# フェーズ7ラウンドA（MVP書き出し：FFmpeg）設計

- 日付: 2026-05-27
- 対象: プロジェクトを「映像を音声に合わせる」リタイミング済み映像＋TTS音声の **MP4（H.264 + AAC, 元解像度）** として書き出す。FFmpeg プロビジョニング・書き出しUI・進捗・話者クレジットを含む。**リップル焼き込みは含まない（ラウンド7b）**。
- 位置づけ: ロードマップのフェーズ7「書き出し（ExportService → FFmpeg）」を**2ラウンドに分割**したその**ラウンドA（MVP書き出し）**。リップル合成焼き込みはラウンド7b。
- 関連: `2026-05-27-clip2manual-phase4r2-timed-preview-design.md`（同期プレビュー＝`computePreviewTimeline` 再利用元）、`2026-05-26-clip2manual-design.md`（全体設計）

## 背景と目的

フェーズ4r2でプレビュー上の「映像を音声に合わせる」を実装し、`computePreviewTimeline(segments, clipDurations) → PreviewSlot[]`（各スロット長 = max(クリップ長, 映像区間長) + `TAIL_PAUSE`）という純粋なタイミングモデルができた。本ラウンドはこれを**書き出しでも再利用**し、プレビューと同じタイミングで MP4 を生成する。

書き出しは FFmpeg を子プロセスとして main で実行する（whisper/VOICEVOX と同じ構成）。FFmpeg は whisper/VOICEVOX と同様 `vendor/` に取得する（Windows 静的ビルドの zip）。

## 確定方針（ブレスト）

- 今ラウンド=**MVP書き出しのみ**（リタイミング映像＋TTS音声→MP4）。リップル焼き込みは7b。
- リタイミング戦略=Approach A: **セグメントごとの中間クリップ生成＋concat**（各ステップが単純・デバッグ容易、FFmpeg引数を純関数化して単体テスト可能）。
- FFmpeg は `setup:ffmpeg` スクリプトで `vendor/ffmpeg/` に取得（Windows 静的ビルド zip、`Expand-Archive` で展開）。`ffmpeg.exe` ＋ `ffprobe.exe`。
- `previewTimeline.ts` を `src/shared/` に移動し renderer/main 双方で共有。
- 音声=**TTSのみ**（未生成セグメントはその映像区間を無音で）。
- 出力=**保存ダイアログ**で場所/ファイル名を選択（既定 `<プロジェクト名>.mp4`）。
- クレジット=**MP4 メタデータ（comment）に話者クレジットを埋め込み**＋完了ダイアログに表示（映像上への焼き込みは7b以降で検討）。
- 出力=MP4（H.264 + AAC、元解像度、fps はソースに合わせる）。

## スコープ

含む:
- FFmpeg/ffprobe の取得スクリプト＋vendor配置＋manifest、`ffmpegPaths` 解決
- `previewTimeline.ts` の `shared/` への移動（renderer 参照更新）
- FFmpeg 引数を組み立てる純関数群（`ffargs.ts`）＋単体テスト
- `exportService`（ffprobeでクリップ長取得→スロット計算→セグメントごと映像/音声中間クリップ→concat→mux→出力、進捗、temp掃除、キャンセル）
- IPC（`export:dialog` / `export:run`＋`export:progress`＋`export:cancel`）、preload、型
- 書き出しUI（ツールバーの「書き出し」ボタン、保存ダイアログ、進捗、キャンセル、完了表示）
- 話者クレジットのメタデータ埋め込み＋完了表示

含まない（後続）:
- **リップル（クリック強調）の映像焼き込み**＝ラウンド7b
- 映像上へのクレジット焼き込み（7b以降）
- 区間削除/結合/分割/トリム（フェーズ6。書き出しは現在の segments をそのまま使う）
- 解像度/品質/コーデックのユーザー設定（既定値のみ）
- GPU エンコード、複数フォーマット出力
- 元音声での書き出し（TTSマニュアルが目的）

## アーキテクチャ

書き出しは main プロセスで FFmpeg 子プロセスを実行（whisper の `SpawnWhisperRunner` 構成を踏襲）。renderer はIPCで起動・進捗購読・キャンセル。

### 共有タイミング
`src/renderer/editor/previewTimeline.ts` を `src/shared/previewTimeline.ts` へ移動（純粋・`Segment` 依存のみ）。renderer 側 import（`PreviewPlayer`/`ttsPreview`/テスト）を更新。main の export がこれを使う。

### プロビジョニング
`scripts/setup-ffmpeg.mjs`（新規、`npm run setup:ffmpeg`）が pinned バージョンの Windows 静的 FFmpeg（zip）を `vendor/ffmpeg/` に取得・展開し、`ffmpeg.exe`/`ffprobe.exe` を探して `manifest.json`（`{ ffmpegPath, ffprobePath }`）を書く。`vendor/` は gitignore。zip は `Expand-Archive`（追加依存なし）。**URLが404/構成変更時は pinned バージョン/URLを更新**（whisperと同じ運用）。

`src/main/ffmpegPaths.ts`: 解決順 = 環境変数 `C2M_FFMPEG`/`C2M_FFPROBE` → vendor manifest（`whisperPaths`/`voicevoxPaths` を踏襲、`FfmpegNotProvisionedError`）。

### モジュール構成（`src/main/export/`）

| ファイル | 責務 |
|---------|------|
| `ffargs.ts`（純関数・単体テスト対象） | FFmpeg/ffprobe の引数配列を組み立てる＋出力パース |
| `ffmpegRunner.ts` | `spawn` を抽象化（`FfmpegRunner` IF＋`SpawnFfmpegRunner`）。テストで差し替え |
| `exportService.ts` | パイプライン統括（ffprobe→slots→中間クリップ→concat→mux→出力、進捗、temp掃除、abort） |
| `src/main/ipc/export.ts` | IPC（dialog/run/progress/cancel） |

### `ffargs.ts`（純関数）の主な関数

```ts
/** ffprobe で長さ（秒）を得る引数。stdout を Number で解釈する。 */
export function probeDurationArgs(file: string): string[];
export function parseProbeDuration(stdout: string): number;

/** raw 映像のスロット区間を切り出し、末尾フレームを slotDuration までフリーズして均一H.264で書き出す。 */
export function segmentVideoArgs(input: { rawPath: string; slot: PreviewSlot; outPath: string; fps: number }): string[];

/** スロットの音声 = TTSクリップ（あれば）→無音で slotDuration まで pad。無ければ slotDuration の無音。 */
export function segmentAudioArgs(input: { clipPath: string | null; slotDuration: number; outPath: string }): string[];

/** concat デマルチプレクサ用（同一パラメータの中間クリップを連結）。 */
export function concatArgs(input: { listFile: string; outPath: string }): string[];

/** 映像トラック＋音声トラックを多重化し、メタデータ comment（クレジット）を付けて MP4 出力。 */
export function muxArgs(input: { videoPath: string; audioPath: string; outPath: string; comment: string }): string[];
```

- `segmentVideoArgs`: `-ss <videoStart> -to <videoEnd> -i raw` で区間切り出し → `tpad=stop_mode=clone:stop_duration=<slotDuration - videoSpan>` で末尾フレームをフリーズ（音声長>映像なら静止保持、短ければ末尾小休止を統一表現）→ `-r <fps>` 等で**全クリップ均一**の H.264 中間に encode（concat デマルチプレクサがストリームコピーで連結できるよう、解像度/fps/pix_fmt/コーデックを揃える）。
- `segmentAudioArgs`: TTSクリップを `-af apad` で slotDuration まで無音 pad（または `-t <slotDuration>`）。クリップ無しは `anullsrc` で slotDuration の無音。均一フォーマット（例: PCM/AAC 中間）で出力。
- `concatArgs`: `-f concat -safe 0 -i list.txt -c copy out`。
- `muxArgs`: `-i video -i audio -c:v copy -c:a aac -metadata comment="<credit>" -movflags +faststart out.mp4`（映像は中間が既にH.264ならコピー、音声をAACに）。

### `exportService.ts`

`export(opts)`:
1. `ffprobe` で各セグメントの `tts/<id>.wav` 長を取得（無ければ 0）→ `clipDurations`。
2. `computePreviewTimeline(segments, clipDurations)` → slots。
3. raw のfpsを ffprobe で取得（または既定 30）。
4. temp ディレクトリ（プロジェクト配下 `export-tmp/` 等）に、slot ごとに `segmentVideoArgs`/`segmentAudioArgs` で中間クリップ生成（runner.run）。各完了で onProgress を進める。
5. `concatArgs` で映像トラック・音声トラックを連結。
6. `muxArgs` で MP4 出力。
7. temp 掃除。abort シグナルで子プロセス kill＋temp 掃除。
- runner は注入可能（`FfmpegRunner`）。引数組み立て（`ffargs`）は純粋＝単体テスト。spawn＋ファイル orchestration は手動E2E。

### IPC（`src/main/ipc/export.ts`）
- `export:dialog` → `dialog.showSaveDialog`（既定パス = プロジェクト名 .mp4）→ 出力パス。
- `export:run`（出力パス）→ `exportService.export` を実行、`event.sender.send('export:progress', percent)`。`AbortController` 保持。
- `export:cancel` → abort。
- preload にフラット公開（`exportDialog`/`runExport`/`cancelExport`/`onExportProgress`）、`global.d.ts` 型追加。

### 書き出しUI（`EditorLayout.tsx` ツールバー）
- 「書き出し」ボタン → `exportDialog` で保存先選択 → `runExport` → 進捗表示（％）＋キャンセル。完了で出力パスとクレジットを表示（任意で「フォルダを開く」）。
- 進捗スライス（`export` 状態: idle/running/error、percent）を reducer に追加（`transcription`/`tts` と同形）、または EditorLayout ローカル状態。簡潔さ優先でローカル状態でも可。
- TTS未生成セグメントがある場合は警告表示しつつ実行可（無音）。

## データフロー

renderer「書き出し」→`export:dialog`で保存先→`export:run`→main `exportService`：ffprobe→`computePreviewTimeline`→セグメント中間クリップ（映像/音声）→concat→mux→MP4出力。進捗は `export:progress` で renderer に通知。プレビューと同じ `computePreviewTimeline` を使うため、出力タイミング＝プレビューの体感と一致。

## エラー処理・エッジ

- 未プロビジョニング（manifest 無し）→「FFmpeg が未取得です。`npm run setup:ffmpeg` を実行してください」。
- 任意の FFmpeg ステップが非0終了 → stderr 末尾と該当セグメントを添えて失敗。temp 掃除。
- キャンセル → 子プロセス kill＋temp 掃除、UIは idle に戻す。
- 必要アセット欠落（raw.webm 等）→ 明確なエラー。
- TTS 完全未生成 → 警告のうえ全編無音で書き出し可（ブロックしない）。
- WebM の duration=Infinity 問題は ffmpeg の `-ss/-to`（時間指定切り出し）に影響しない（フレーム単位の時間指定）。

## テスト

- 単体（Vitest node 環境）:
  - `ffargs`: 各 builder が期待する引数（`-ss/-to`、`tpad` の `stop_duration` 計算、`apad`/`anullsrc`、concat、mux のメタデータ/コーデック）を含むことを検証。`parseProbeDuration`（"12.34\n"→12.34、不正→例外/NaN処理）。
  - `ffmpegPaths`: env→manifest 解決（`whisperPaths` テスト踏襲）。
  - `computePreviewTimeline`: 移動後も既存テストが通る（import パス更新）。
- 手動E2E（実機）: `npm run setup:ffmpeg`→`npm run dev`→TTS生成済みプロジェクトで「書き出し」→保存先選択→進捗→MP4生成。生成物を再生し、各セグメントで映像が音声長に合わせてフリーズ/小休止し TTS が同期、解像度が元と同じ、メタデータ/完了表示にクレジット。キャンセルで中断・temp が残らない。
- spawn＋実FFmpeg＋実アセットは注入境界の外＝手動E2Eで検証。

## 完了の定義

- `ffargs`/`ffmpegPaths`/（移動後）`computePreviewTimeline` の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機で `setup:ffmpeg` 後、TTS生成済みプロジェクトを MP4 に書き出せ、再生すると映像が音声に合い TTS が同期、クレジットが付く。キャンセル・未取得・未生成の各経路が壊れない。

## 未解決・先送り

- FFmpeg 静的ビルドの正確なURL/zip構成・`tpad`/concat の細部・均一中間フォーマットのコーデック選定は実FFmpegに対して plan/実装で確定（主要リスク）。
- リップル焼き込み（7b、本パイプラインに overlay ステージを挿入。リップルフレーム生成＋FFmpeg overlay）。
- 映像上クレジット焼き込み、解像度/品質設定、GPUエンコード。
- 進捗の精度（ステップ粗粒度 vs ffmpeg stderr の time= パース）は実装で調整。
