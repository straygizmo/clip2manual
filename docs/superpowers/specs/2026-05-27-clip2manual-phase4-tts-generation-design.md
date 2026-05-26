# フェーズ4ラウンド1（VOICEVOX TTS 生成基盤）設計

- 日付: 2026-05-27
- 対象: 各セグメントの `correctedText` を VOICEVOX で音声合成し、`tts/seg-NNN.wav` として保存・試聴できるようにする。声/速度の選択（既定値＋個別上書き＋全適用）と、エンジンの最小プロビジョニング＋ライフサイクル管理を含む。
- 位置づけ: ロードマップのフェーズ4「TTS＋音声差し替え＋タイミング調整＋再TTS」を**複数ラウンドに分割**し、その**第1ラウンド（生成基盤）**。タイムライン同期プレビュー（元音声↔TTS切替）と「映像を音声に合わせる」タイミング調整は後続ラウンド（後者は書き出し＝フェーズ7と密結合）。
- 関連: `2026-05-26-clip2manual-design.md`（全体設計）、`2026-05-26-clip2manual-phase3-text-editing-design.md`（手動テキスト編集）

## 背景と目的

フェーズ3で `correctedText` が手動編集可能になった。次は「正しいテキスト」を VOICEVOX 音声に変換する。本ラウンドはその**生成基盤**を作る：エンジンに接続して合成し、セグメントごとに wav を保存し、声/速度を選び、個別/一括で生成・再生成し、生成クリップを試聴できる状態までを到達点とする。タイムラインに沿った同期再生差し替えやタイミング調整はこのラウンドでは作らない。

## 確定した方針（ブレスト結果）

- **第1ラウンドの範囲**: 生成基盤のみ（同期プレビュー・タイミング調整は後続）。
- **エンジン調達**: 最小プロビジョニング（whisper と同パターン）。
- **エンジンライフサイクル**: Approach A = 遅延起動・セッション中保持（初回TTS要求時に起動、`/version` で準備完了をポーリング、終了時に停止）。
- **声の選択**: プロジェクト既定値＋セグメント個別上書き＋「全セグメントに適用」。
- **合成対象**: `correctedText`。空のセグメントはスキップ（エラーにしない）。
- **試聴**: 既存 `c2m://` プロトコルで `tts/seg-NNN.wav` を `<audio>` 再生（再生成時はクエリでキャッシュバスト）。
- **話者リスト**: エンジンの `/speakers` から動的取得（「キャラ（スタイル）」表示）。
- **バッチ生成**: 最初のエラーで停止し、失敗セグメントを報告（シンプル優先）。
- **ライセンス**: VOICEVOX は話者ごとのクレジット表記が必要 → 本ラウンドでは**アプリ内に表示**（書き出し時の焼き込みはフェーズ7）。

## スコープ

含む:
- VOICEVOX ENGINE（Windows CPU版）の取得スクリプト＋vendor配置＋manifest
- エンジンの起動/準備待ち/再利用/停止（遅延起動）
- TTSクライアント（`/audio_query`→`/synthesis`、速度は `speedScale`）
- 話者リスト取得（`/speakers`）
- セグメント単位の生成/再生成、全セグメント一括生成（進捗＋キャンセル）
- 生成 wav の `tts/seg-NNN.wav` 保存と `ttsAudio` 設定・永続化
- Inspector: 話者ドロップダウン・速度・[生成/再生成]・試聴・生成済み表示
- ツールバー: 既定の話者/速度・[全セグメントに適用]・[全セグメント生成]・エンジン状態表示
- 声/速度・既定値の永続化（再オープンで保持）
- 話者クレジットのアプリ内表示

含まない（後続ラウンド/フェーズ）:
- タイムライン同期プレビュー（元音声↔TTS 切替、Web Audio スケジュール）
- 「映像を音声に合わせる」タイミング調整（フリーズ/末尾休止）
- 書き出し（FFmpeg）・クレジット焼き込み（フェーズ7）
- GPU/DirectML 版エンジン、初回ウィザードによる自動取得（フェーズ8）
- 空 `correctedText` を無音として尺に反映する処理

## エンジン調達（プロビジョニング）

`scripts/setup-voicevox.mjs`（新規、`npm run setup:voicevox`）が pinned バージョンの VOICEVOX ENGINE（Windows CPU）を `vendor/voicevox/` に取得・展開し、`vendor/voicevox/manifest.json`（`{ runPath }`）を書く。`vendor/` は既に gitignore 済み。

**既知の主要リスク（実装で解決）**: VOICEVOX の Windows 配布物は**分割 `.7z`**で、PowerShell の `Expand-Archive` では展開できない（whisper の単一 zip と異なる）。展開ステップが必要 — 例: スタンドアロン `7zr.exe` を取得して使う、または Node の 7z ライブラリを使う。**実ダウンロードに対して検証して URL/形式/展開手順を確定する**こと。エンジンは大容量（約1GB+、ONNXモデル含む）で初回取得は時間がかかる。URLが404/形式変更時は pinned バージョンを最新リリースに更新する（whisper と同じ運用）。

解決順（`voicevoxPaths.ts`、`whisperPaths.ts` を踏襲）: 環境変数 `C2M_VOICEVOX_RUN` → vendor manifest。

## モジュール構成（main プロセス）

| ファイル | 責務 |
|---------|------|
| `scripts/setup-voicevox.mjs` | エンジン取得・展開・manifest 生成 |
| `src/main/voicevox/voicevoxPaths.ts` | run パス解決（env→manifest） |
| `src/main/voicevox/engine.ts` | `VoicevoxEngine`: `ensureRunning()`/`stop()`。起動済み検出・再利用、子プロセス起動、`/version` ポーリング |
| `src/main/voicevox/ttsClient.ts` | HTTP クライアント（baseUrl 注入）: `fetchSpeakers()`, `synthesize({text,speaker,speed})` |
| `src/main/voicevox/ttsService.ts` | 合成オーケストレーション: エンジン確保→合成→`tts/seg-NNN.wav` 書き込み→rel パス返却。バッチ＋進捗。空テキストskip |
| `src/main/ipc/tts.ts` | IPC: `tts:speakers`, `tts:generateSegment`, `tts:generateAll`(進捗+`tts:cancel`) |

- `engine.ts` の spawn/HTTP と `ttsClient` の fetch は**注入可能なインターフェース**にし、単体テストで実エンジン不要にする（`whisperRunner` の注入パターンを踏襲）。
- `engine.ts` は既に `:50021` で応答するエンジンがあれば spawn せず再利用する（ポート衝突・二重起動回避）。
- `engine.stop()` はアプリの `before-quit` で呼ぶ。

## VOICEVOX 合成フロー

1セグメントの合成（`ttsClient.synthesize`）:
1. `POST /audio_query?text=<correctedText>&speaker=<speaker>` → クエリ JSON 取得。
2. クエリ JSON の `speedScale` を `segment.voice.speed` に設定。
3. `POST /synthesis?speaker=<speaker>`（body=クエリ JSON）→ wav バイト列取得。
4. `ttsService` が `tts/seg-NNN.wav`（NNN はセグメント連番に対応）へ書き込み、相対パスを返す。

話者リスト（`ttsClient.fetchSpeakers` → `/speakers`）は `[{ name, styles:[{id,name}] }]` 構造。レンダラ向けに `{ speaker: <styleId>, label: "<キャラ>（<スタイル>）" }` の配列へ平坦化するヘルパを用意（単体テスト対象）。

## データモデルとデータフロー

スキーマ変更なし（`src/shared/types.ts`）:
- `Segment.ttsAudio: string | null` … 生成 wav の相対パス（例 `tts/seg-001.wav`）。
- `Segment.voice: { speaker, speed }` … セグメント個別の声。
- `ProjectSettings.tts: { defaultSpeaker, defaultSpeed }` … プロジェクト既定の声。

データフロー（生成）: Inspector/ツールバーの操作→IPC `tts:generate*`→`ttsService.generate`→`engine.ensureRunning()`（初回は spawn＋準備待ち）→`ttsClient.synthesize`→`tts/seg-NNN.wav` 書き込み→`projectSession` が該当セグメントの `ttsAudio` を設定して project.json 保存→結果（更新後segments）をレンダラへ返却→reducer 反映→試聴可能。一括生成は segments を反復（空skip）、進捗イベント送出、キャンセル可。

永続化:
- セグメントの声編集・TTS結果 → フェーズ3で追加した `project:updateSegments`（既存 `projectSession.updateSegments` のアトミック保存）を再利用。
- プロジェクト既定の声（`settings.tts`） → 新規 IPC `project:updateSettings` ＋ `projectSession.updateSettings` を追加（再オープンで既定値を保持）。
- 「全セグメントに適用」→ 全セグメントの `voice` を既定値にして segments 保存。

## レンダラ（Inspector・ツールバー・状態）

reducer アクション追加:
- `SET_SEGMENT_VOICE { id, voice }` … 該当セグメントの `voice` を更新。
- `SET_DEFAULT_VOICE { voice }` … `settings.tts` を更新。
- `APPLY_DEFAULT_VOICE_TO_ALL` … 全セグメントの `voice` を既定値に。
- `TTS_GENERATED { segments }` … 生成結果の反映。生成系IPC（単体/一括とも）は main 側で `ttsAudio` を設定・保存した**更新後の segments** を返し、レンダラはこのアクションで一括差し替えする（フェーズ2の `TRANSCRIPTION_DONE` と同じ流儀）。単体生成専用の部分更新アクションは設けない。
- TTS生成の進捗スライス（`transcription` スライスと同形: `status/percent/error`）。

Inspector（選択中セグメント、フェーズ3の編集UIに追加）:
- 話者ドロップダウン（`tts:speakers` をエディタ表示時に取得して保持、「キャラ（スタイル）」表示）。
- 速度入力。
- [生成 / 再生成] ボタン。
- `ttsAudio` がある場合の試聴 `<audio>`（`projectAssetUrl('tts/seg-NNN.wav', dir)`、再生成時は世代カウンタ/タイムスタンプをクエリに付けてキャッシュバスト）。
- 生成済み/未生成インジケータ。

ツールバー:
- 既定の話者/速度、[全セグメントに適用]、[全セグメント生成]（進捗＋キャンセル）、エンジン状態（「エンジン起動中…」）。

話者クレジット: 生成に使った話者のクレジットをアプリ内に表示（例: Inspector かフッタ）。

## エラー処理

- 未プロビジョニング（manifest 無し）: 「VOICEVOX エンジンが未取得です。`npm run setup:voicevox` を実行してください」。
- エンジン起動タイムアウト/spawn失敗/ポート問題: 明示的にエラー表示。`:50021` に既存エンジンがあれば検出して再利用（spawn しない）。
- 合成 HTTP エラー（不正な話者・エンジン500等）: バッチは**最初のエラーで停止**し、失敗したセグメントを報告。
- 空 `correctedText`: スキップ（エラーにしない、クリップ未生成・`ttsAudio` は null のまま）。

## テスト

単体（node 環境・実エンジン不要、エンジン/HTTPは注入）:
- `ttsClient.synthesize`: モック fetch に対し、`/audio_query`→`/synthesis` の順で呼び `speedScale` を注入し wav Buffer を返すことを検証。
- `ttsService`: 注入したエンジン（baseUrl 返却）＋注入クライアントで、tmp ディレクトリに wav を書き `ttsAudio` を設定し、空テキストをスキップすることを検証。
- 新 reducer アクション（`SET_SEGMENT_VOICE`/`SET_DEFAULT_VOICE`/`APPLY_DEFAULT_VOICE_TO_ALL`/`SET_SEGMENT_TTS`）。
- `voicevoxPaths` の解決（env→manifest）。`whisperPaths` テストを踏襲。
- 話者平坦化ヘルパ。

手動E2E（実機）: `npm run setup:voicevox`→`npm run dev`→文字起こし済み `rec-*` を開く→1セグメント生成→試聴→話者/速度変更→再生成→[全セグメント生成]→再オープンで `ttsAudio` 保持。エンジン spawn＋実HTTPは注入境界の外＝手動E2Eで検証。

## 完了の定義

- 上記の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機で `setup:voicevox` 後、セグメントの生成・再生成・一括生成・試聴ができ、再オープンで `ttsAudio`・声設定が保持される。
- 話者クレジットがアプリ内に表示される。

## 未解決・先送り

- 7z 展開の具体手順は実ダウンロードに対して plan/実装で確定（主要リスク）。
- タイムライン同期プレビュー（元音声↔TTS）・「映像を音声に合わせる」タイミング調整は次ラウンド。
- 書き出し時のクレジット焼き込み・音声多重化はフェーズ7。
- 自動取得ウィザード・GPU版はフェーズ8。
