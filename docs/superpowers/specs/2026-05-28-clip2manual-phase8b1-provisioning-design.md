# フェーズ8b-1（アプリ内プロビジョニング基盤）設計

- 日付: 2026-05-28
- 対象: whisper / VOICEVOX / ffmpeg をアプリ内で `userData` に自動ダウンロード・展開できる基盤と、依存関係の状態表示＋「未取得をダウンロード」トリガをホーム画面に追加する。
- 位置づけ: ロードマップのフェーズ8「初回ウィザード+設定+インストーラ」を分割。Phase 8 を 8b（自動取得+ウィザード）/8a（インストーラ）/8c（設定）に分け、さらに 8b を **8b-1（プロビジョニング基盤＋最小トリガ。本spec）** と **8b-2（初回ウィザードの本格フロー＋既定の声選択）** に分割したその 8b-1。
- 関連: `scripts/setup-whisper.mjs`/`setup-voicevox.mjs`/`setup-ffmpeg.mjs`（移植元のロジック）、`whisperPaths.ts`/`voicevoxPaths.ts`/`ffmpegPaths.ts`（resolve*）、`2026-05-26-clip2manual-design.md`（全体設計）

## 背景と目的

現状、whisper/VOICEVOX/ffmpeg は開発時に `npm run setup:*` スクリプトで `vendor/<tool>/` にダウンロードし `manifest.json` を書く。`resolve*` 関数は `環境変数 → process.cwd()/vendor/<tool>/manifest.json` の順で解決する。これは `npm run dev` では動くが、**パッケージ済みアプリでは破綻する**（`process.cwd()` は不定で、`vendor/` は同梱されない＝gitignore）。

本ラウンドは、アプリ自身が依存バイナリを `userData/vendor/<tool>/` に**ダウンロード・展開**できる基盤を作り、`resolve*` がそこを参照するようにする。UI は最小限（ホーム画面に状態表示＋未取得ダウンロードボタン）。本格的な初回ウィザード（自動ゲート・ステップ送り・既定の声選択）は 8b-2。

LLM補正は未実装のため、APIキー入力はフェーズ8の対象外（別途 LLM 機能を作る場合に検討）。

## 確定方針（ブレスト）

- アプローチ=A（実行時に `userData/vendor` へダウンロード＋トリガUI）。同梱（インストーラ埋め込み）はしない（VOICEVOX が約1GB+ で巨大、かつ 8a の領域）。
- `resolve*` 解決順 = 環境変数 → `userData/vendor/<tool>` → `cwd/vendor/<tool>`（dev フォールバック。既存 `setup:*` スクリプトは引き続き機能）。
- アプリ内プロビジョニングは既存スクリプトの URL/ロジックを移植（URL は当面スクリプトと2箇所にピン留め）。dev `setup:*` スクリプトは残す。
- UI は最小（ホームの状態表示＋ダウンロードボタン）。初回ゲート・既定の声は 8b-2。

## スコープ

含む:
- ベンダーディレクトリ解決（`userData/vendor` 優先・`cwd/vendor` フォールバック）。純関数 `pickVendorDir`（単体テスト対象）＋ electron 結合の薄いラッパ。
- `resolve*` 呼び出し側（ipc/transcription・ipc/tts・ipc/export）を userData 対応の vendorDir 渡しに更新。
- プロビジョニングエンジン（main）: `download`（進捗）・`extractZip`（PowerShell）・`findNamed` 共有ヘルパ＋ `installWhisper`/`installVoicevox`/`installFfmpeg`（userData へ取得・展開・manifest）。`checkStatus`。
- IPC: `setup:status` / `setup:install`（進捗イベント・キャンセル）/ `setup:cancel`、preload、型。
- 最小UI: ホーム画面に依存関係の状態（whisper/VOICEVOX/ffmpeg の ✓/✗）と「未取得をダウンロード」ボタン＋進捗。
- 単体テスト（`pickVendorDir`・`checkStatus` 集約・進捗計算）。

含まない（後続）:
- 本格的な初回ウィザード（起動時の自動ゲート・ステップ送り・既定の声選択）= 8b-2。
- インストーラ/electron-builder = 8a。
- 設定画面 = 8c。
- LLM APIキー（LLM補正が未実装のため）。
- 個別ツールの選択ダウンロードや再取得/修復の高度UI（最小は「未取得をまとめて取得」）。

## アーキテクチャ

### ベンダーパス解決（`src/main/provision/paths.ts`）

```ts
/** userData/vendor/<tool> に manifest があればそれを、無ければ cwd/vendor/<tool> を返す（純粋・テスト対象）。 */
export function pickVendorDir(
  userBase: string, cwdBase: string, tool: string,
  manifestExists: (dir: string) => boolean,
): string;

/** electron app に結合した薄いラッパ（テスト対象外）。 */
export function vendorDir(tool: 'whisper' | 'voicevox' | 'ffmpeg'): string;
// = pickVendorDir(join(app.getPath('userData'),'vendor'), join(process.cwd(),'vendor'), tool, (d)=>existsSync(join(d,'manifest.json')))

/** userData 側の取得先（install の書き込み先・常に userData）。 */
export function userVendorDir(tool: string): string; // join(app.getPath('userData'),'vendor',tool)
```

- `resolve*` 自体は現行のまま（`opts.vendorDir` を受け、env → そのdir の manifest）。呼び出し側が `resolve*({ vendorDir: vendorDir(tool) })` を渡すよう変更する。env 上書き（`C2M_*`）は従来どおり最優先。
- 更新する呼び出し側: `ipc/transcription.ts`（`resolveWhisper`）、`ipc/tts.ts`（`resolveVoicevox`）、`ipc/export.ts`（`resolveFfmpeg`）。

### プロビジョニングエンジン（`src/main/provision/`）

| ファイル | 責務 |
|---------|------|
| `download.ts` | `download(url, dest, onProgress?)`（fetch→ストリーム、`content-length` から進捗）、`extractZip(zip, dest)`（PowerShell `Expand-Archive`）、`findNamed(dir, name)` |
| `installers.ts` | `installWhisper(onProgress)` / `installVoicevox(onProgress)` / `installFfmpeg(onProgress)`（`userVendorDir` へ取得・展開・manifest 書き込み。既存 `setup:*` の URL/手順を移植。VOICEVOX は 7zr で展開） |
| `status.ts` | `checkStatus()` → `{ whisper, voicevox, ffmpeg: boolean }`（各 `resolve*({vendorDir: vendorDir(tool)})` を try し、成功で provisioned） |

- 進捗: `download` は `content-length` があれば `(received/total)` を百分率で通知。複数ファイル（whisper の bin+model など）は合算 or ステップ按分（実装で按分。純粋な按分計算は単体テスト）。
- 展開: zip は PowerShell `Expand-Archive`（whisper/ffmpeg）、VOICEVOX は `7zr.exe`（無ければ取得）で `.7z.001` を展開（既存スクリプトと同方針）。
- ダウンロード/展開は fs+child_process+ネットワーク依存＝手動E2Eで検証。URL/手順は `setup-*.mjs` から移植。

### IPC（`src/main/ipc/setup.ts`）

- `setup:status` → `checkStatus()`。
- `setup:install` → 未取得ツールを順に install、各ツールの進捗を `event.sender.send('setup:progress', { tool, percent })` で通知。`AbortController` 保持。失敗時はどのツールで失敗したかを添えて reject。完了後 `checkStatus()` を返す。
- `setup:cancel` → abort（進行中ダウンロードを中断、部分ファイルを掃除）。
- preload にフラット公開（`setupStatus`/`runSetup`/`cancelSetup`/`onSetupProgress`）、`global.d.ts` 型追加。

### 最小UI（`HomeScreen.tsx`）

- ホーム画面に「依存関係」セクション: `setupStatus()` の結果で whisper/VOICEVOX/ffmpeg を ✓（取得済み）/✗（未取得）表示。
- いずれか未取得なら「未取得をダウンロード」ボタン → `runSetup()` 実行、`onSetupProgress` で `<tool> 取得中… NN%` を表示、完了で再 `setupStatus()`。
- ダウンロードには数百MB〜1GB超のため時間がかかる旨の注記。キャンセルボタン。
- 全取得済みなら簡潔に「準備完了」表示（または非表示）。

## データフロー

ホーム表示時に `setup:status` で各ツールの解決可否を取得→未取得を表示。ユーザーが「未取得をダウンロード」→ `setup:install` が main で未取得ツールを順に `userData/vendor/<tool>` へ取得・展開・manifest 書き込み、進捗を通知→完了で状態更新。以降、録画/文字起こし(whisper)/TTS(voicevox)/書き出し(ffmpeg) は `resolve*` が `userData/vendor` を見つけて動作する。

## エラー処理・エッジ

- ダウンロード失敗（404/ネットワーク）→ どのツールかを添えてエラー表示、再試行可。URL 変更時は `setup-*.mjs` と同様 URL/バージョンを更新（移植元と2箇所）。
- 展開失敗 → エラー＋部分ファイル掃除。
- キャンセル → 進行中 abort＋部分ファイル掃除、状態は変えない。
- オフライン → fetch 失敗で明確なエラー。
- env 上書き（`C2M_*`）が設定されていれば常にそれを使う（解決順最優先）。
- dev で `cwd/vendor` に既に取得済み → `checkStatus` は ✓ を返し、ダウンロード不要（既存 dev ワークフロー不変）。
- userData/vendor と cwd/vendor の両方に manifest がある場合 → `pickVendorDir` は userData を優先。

## テスト

- 単体（Vitest node 環境）:
  - `pickVendorDir`: userData に manifest あり→userData、無し→cwd（`manifestExists` を注入）。
  - `checkStatus`: 各 resolve の成否（注入/一時 manifest）を集約して `{whisper,voicevox,ffmpeg}` を返す。
  - 進捗按分計算（複数ファイル/ツールの百分率）— 純関数として切り出してテスト。
- 手動E2E（実機）: `userData/vendor` を空にして `npm run dev`→ホームに3ツール ✗ →「未取得をダウンロード」→各ツールの進捗→完了で ✓ → 録画/文字起こし/TTS生成/書き出しが動作。途中キャンセルで中断・部分ファイルが残らない。env 上書きや既存 `cwd/vendor` の dev 経路も壊れない。
- ダウンロード/展開そのものは手動E2Eで検証（ネットワーク/子プロセス依存）。

## 完了の定義

- `pickVendorDir`・`checkStatus`・進捗按分の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機で、空の `userData/vendor` から「未取得をダウンロード」で3ツールを取得でき、以降 録画/文字起こし/TTS/書き出しが動作する。dev（cwd/vendor・env 上書き）経路が壊れない。

## 未解決・先送り

- 本格的な初回ウィザード（起動時ゲート・ステップ送り・既定の声選択）= 8b-2。
- インストーラ（electron-builder NSIS、uiohook-napi の asar unpack 等）= 8a。
- 設定画面 = 8c。
- URL の二重管理（`setup-*.mjs` とアプリ内）の一本化は将来のリファクタ。
- 進捗の精度（content-length 無し時の不定表示）・並列ダウンロード・再開（resume）は最小実装では非対応。
