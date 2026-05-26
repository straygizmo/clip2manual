# clip2manual フェーズ2 設計ドキュメント — 文字起こし + セグメントタイムライン

- 日付: 2026-05-26
- ステータス: 設計確定（実装計画作成前）
- 親設計: `docs/superpowers/specs/2026-05-26-clip2manual-design.md`
- 前提: フェーズ1（録画基盤）は `master` にマージ済み。録画すると
  `Videos/clip2manual/rec-*/` に `assets/raw.webm` / `assets/narration.webm` /
  `assets/clicks.json` と `project.json`（`segments` は空配列）が生成される。

## 目的

録画済みプロジェクトのナレーション音声をローカルの whisper.cpp で文字起こしし、
得られたセグメントを NLE 型エディタのタイムラインに表示する。これがフェーズ3以降
（LLM補正・TTS・強調合成・編集・書き出し）が差し込まれる UI と編集データの土台になる。

## 確定した判断（ブレインストーミングでの決定）

| 項目 | 決定 |
|------|------|
| whisper の入手 | セットアップ用 DL スクリプト → gitignore した `vendor/whisper/`。設定/環境変数で上書き可 |
| 文字起こしモデル | ggml-small（日本語、約470MB）。後段の LLM 補正が誤りを直す前提で実用的な既定値 |
| UI 範囲 | NLE 3 ペインの骨組みを構築。文字起こしテキストはこのフェーズでは読み取り専用 |
| 音声変換 | narration.webm を Web Audio で 16kHz モノラル WAV に**遅延変換**（既存録画にも対応） |
| 文字起こし起動 | エディタ上の明示ボタン（再実行可）。進捗表示・キャンセル対応 |
| プレビュー音声 | 元ナレーション（narration.webm）を再生。TTS 差し替えはフェーズ4 |
| 最近の録画一覧 | ホーム画面に含める（`Videos/clip2manual/` 配下の rec-* を列挙） |
| clicks 割当 | クリック時刻を含むセグメントへ。含むものが無ければ時間的に最近傍のセグメントへ |

## ① 全体フロー

```
録画 (既存・変更なし)
  └→ rec-*/ : assets/raw.webm, assets/narration.webm, assets/clicks.json, project.json(segments=[])

[プロジェクトを開く]  ← ホームの「最近の録画」一覧 or フォルダ選択ダイアログ
        │
[文字起こし] ボタン（エディタ）
   1. (renderer) assets/narration.wav が無ければ：narration.webm のバイトを取得
      → Web Audio (OfflineAudioContext) でデコード → 16kHz モノラル Float32
      → 16bit PCM WAV にエンコード → assets/narration.wav として保存
   2. (main) whisper.cpp を子プロセス実行（narration.wav を入力）。進捗を逐次通知
   3. (main) whisper の JSON を Segment[] に変換し、clicks を時間で各セグメントへ割当
      → project.json に保存
   4. (renderer) タイムライン／インスペクタに反映
```

設計原則：
- 重い映像（raw.webm）は IPC に乗せず、`c2m://` カスタムプロトコルでディスクから配信する。
- whisper は main がファイルパスで直接読む（大きな IPC 転送をしない）。
- WAV 変換のみ音声バイトを renderer 経由でやり取りする（音声は映像より小さく許容範囲）。
- 録画フロー自体は変更しない。

## ② whisper.cpp の入手と解決

- `scripts/setup-whisper.mjs`（`npm run setup:whisper` で実行）
  - 固定バージョンの whisper.cpp Windows ビルド済みバイナリ（zip）と ggml-small モデルを
    `vendor/whisper/` に取得する。
  - zip 展開は PowerShell `Expand-Archive`（npm 追加依存なし）。Node 20 の `fetch` で取得。
  - チェックサム（SHA-256）検証。既に存在すれば再取得しない（冪等）。
  - バイナリ名は固定バージョンに合わせて解決する（`whisper-cli.exe` 等、リリース版に追従）。
- `vendor/` は `.gitignore` に追加（バイナリ・モデルはコミットしない）。
- `src/main/whisperPaths.ts`：解決順は
  環境変数 `C2M_WHISPER_BIN` / `C2M_WHISPER_MODEL` → アプリ設定 → 既定 `vendor/whisper/`。
  未導入の場合は構造化エラーを返し、UI が「whisper セットアップ未完了」を案内できるようにする。

## ③ モジュール構成（疎結合）

```
scripts/
  setup-whisper.mjs              バイナリ＋モデルの取得（gitignore された vendor/ へ）
src/main/
  ipc/
    recording.ts                 既存の recording:start / recording:stop（ipc.ts から移設）
    project.ts                   project:openDialog / project:open / project:recent
    transcription.ts             transcription:run / transcription:cancel / 進捗イベント
    index.ts                     registerIpc() で上記を合成
  projectSession.ts              現在開いているプロジェクト（dir + Project）の保持・保存
  assetProtocol.ts               c2m:// プロトコル登録（プロジェクト資産をストリーム配信）
  whisperPaths.ts                バイナリ/モデルの解決
  transcription/
    transcriptionService.ts      whisper 子プロセスの実行・進捗・キャンセル
    whisperRunner.ts             spawn を注入可能にする薄いラッパ（テスト容易化）
    mapSegments.ts               whisper JSON → Segment[]、clicks 割当（純粋関数）
src/shared/
  types.ts                       validateProject 追加（軽量スキーマ検証）
  wav.ts                         Float32 PCM → 16bit WAV バイト（純粋関数）
src/renderer/
  state/editorStore.tsx          React context + useReducer（project / 選択 / 再生位置 / 進捗）
  home/HomeScreen.tsx            録画開始＋「最近の録画」一覧→開く
  editor/EditorLayout.tsx        CSS グリッド：上ツールバー / 中央プレビュー / 右インスペクタ / 下タイムライン
  editor/PreviewPlayer.tsx       <video>（c2m:// で raw.webm）＋元ナレーション音声、再生・シーク・現在時刻
  editor/Timeline.tsx            映像トラック＋セグメント帯＋クリックマーカー、選択・シーク・再生ヘッド
  editor/Inspector.tsx           選択セグメントの index / 時間範囲 / 文字起こし（読み取り専用）
  audio/decodeToWav.ts           Web Audio: webm → 16kHz モノラル → shared/wav でエンコード
src/preload/
  index.ts                       新規 IPC チャネルを公開（型付き api）
```

`ipc.ts` はフェーズ2で `src/main/ipc/` 配下に分割する。`registerIpc()` が各モジュールの登録関数を
呼ぶ構成にして、チャネルが増えても見通しを保つ。

## ④ IPC / プロトコル契約

| チャネル | 種別 | 入力 → 出力 |
|---------|------|------------|
| `recording:start` / `recording:stop` | invoke | 既存のまま |
| `project:openDialog` | invoke | （なし）→ ディレクトリ選択（`Videos/clip2manual` 起点）→ `{ projectDir, project } \| null` |
| `project:open` | invoke | `projectDir` → `{ projectDir, project }`（loadProject＋validateProject） |
| `project:recent` | invoke | （なし）→ `Videos/clip2manual/` 配下の rec-* 一覧 `{ projectDir, name, createdAt }[]` |
| `asset:read` | invoke | `rel` → `ArrayBuffer`（現在のプロジェクト相対パス） |
| `asset:write` | invoke | `{ rel, data: ArrayBuffer }` → `{ ok }` |
| `asset:exists` | invoke | `rel` → `boolean` |
| `transcription:run` | invoke | （なし）→ `{ segments }`（完了時。現在開いているプロジェクトを対象） |
| `transcription:progress` | event(main→renderer) | `{ percent }` |
| `transcription:cancel` | invoke | （なし）→ `{ ok }` |
| `c2m://asset/<rel>` | protocol | 現在のプロジェクトの資産をストリーム配信（`<video>` の src 等に使用） |

`projectSession.ts` が「現在のプロジェクト」を保持し、`asset:*` と `c2m://` と
`transcription:run` の保存先がそれを参照する。

## ⑤ 主要ロジックの定義

### whisper 実行（transcriptionService）
- 引数：`whisper-cli -m <model> -f <narration.wav> -l ja -oj -of <out> --print-progress`。
- 出力 `out.json` の各要素 `offsets.from` / `offsets.to`（ミリ秒）を秒に変換して使用する。
- 進捗：stderr の `progress = NN%` 行を正規表現で拾い `transcription:progress` を送出。
- キャンセル：`transcription:cancel` で子プロセスを kill。
- `whisperRunner` を注入可能にし、実バイナリ起動なしで引数組み立て＋JSON パースを単体テストする。

### Segment 生成（mapSegments、純粋関数）
- 採番：`seg-001`, `seg-002`, …（ゼロ埋め3桁）。
- 各セグメント：
  - `videoStart` / `videoEnd` = whisper 区間（秒）。
  - `originalText` = `correctedText` = 認識テキスト（補正はフェーズ3。両方に同値を入れておく）。
  - `ttsAudio` = `null`、`voice` = プロジェクト設定の既定（speaker/speed）、`enabled` = `true`。
  - `clicks` = 下記ルールで割り当てた `ClickEvent[]`。
- clicks 割当ルール（決定的）：
  - クリック時刻 `t` が `[videoStart, videoEnd)` に含まれるセグメントへ割り当てる。
  - どのセグメントにも含まれない（無音の隙間／末尾）場合は、時間的に最も近いセグメント
    （`t` から各セグメント区間までの距離が最小のもの）へ割り当てる。
  - セグメントが 0 件の場合は割り当てない（クリックは保持されない＝この状態は文字起こし前のみ）。

### validateProject（types.ts、軽量）
- `version` の一致確認に加え、`meta` / `settings` / `segments`（配列）の存在と最低限の型を検証する。
- フルの JSON-Schema ライブラリは導入しない。壊れた／旧形式ファイルを開いたときに
  分かりやすいエラーにすることが目的。

### WAV エンコード（shared/wav.ts、純粋関数）
- 入力：16kHz・モノラルの Float32 サンプル。出力：16bit PCM の WAV バイト列（44byte ヘッダ＋データ）。
- `decodeToWav.ts`（renderer）が `OfflineAudioContext` で 16kHz モノラルにリサンプル後、本関数で
  エンコードして `asset:write` で `assets/narration.wav` に保存する。

## ⑥ エディタ UI（NLE 3 ペイン骨組み）

```
ツールバー: ● 録画/ホーム | 文字起こし(進捗) | プロジェクト名
─────────────────────────────────┬──────────────────────────
                                  │ インスペクタ
       プレビュー（中央）            │ ・選択セグメント番号
  raw.webm を <video> 再生         │ ・時間範囲 (start–end)
  ＋元ナレーション音声              │ ・文字起こしテキスト（読み取り専用）
  再生 / 一時停止 / シーク          │
─────────────────────────────────┴──────────────────────────
 タイムライン
  [映像        ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ ]   再生ヘッド同期・クリックでシーク
  [セグメント   ▮▮ ▮▮▮ ▮▮  ▮▮▮▮ ▮▮ ]   クリックで選択 → インスペクタ更新
  [クリック     ◆      ◆    ◆      ]   クリックマーカー（表示のみ）
```

- 状態管理：`editorStore.tsx`（context + useReducer）。保持する状態は
  `{ projectDir, project, selectedSegmentId, currentTime, transcription: { status, percent } }`。
  新規 npm 依存は追加しない。
- タイムラインの長さ：`<video>` の `duration`（loadedmetadata）を採用。セグメント帯は
  `videoStart/videoEnd` を幅にスケールして配置する。
- プレビュー：映像（c2m:// 経由の raw.webm）と元ナレーション音声を同期再生。リップル合成はフェーズ5。

## ⑦ テスト方針

- 単体（Vitest、Electron 不要）：
  - `mapSegments`：時刻変換、採番、clicks 割当（境界・隙間・末尾・空セグメント）。
  - `wav`：ヘッダ正当性、サンプル数、モノラル16kの長さ。
  - `validateProject`：正常／版違い／必須欠落／型不正。
  - 進捗パース：stderr 行 → percent。
  - `whisperRunner` を偽実装に差し替え、引数組み立て＋JSON パースを検証。
- 手動 E2E（フェーズ1同様、実機確認）：
  1. `npm run setup:whisper` でバイナリ＋モデルを取得。
  2. 既存の rec-* プロジェクトを開く。
  3. 文字起こし実行 → 進捗表示 → タイムラインに日本語セグメントが並ぶ。
  4. セグメント選択 → インスペクタにテキスト表示。
  5. プレビューが映像＋元音声で再生・シークできる。
  6. project.json に segments が保存され、開き直しても保持される。

## ⑧ 非対象（YAGNI・後フェーズ）

- テキスト編集・元/修正の差分表示（フェーズ3）
- LLM 補正（フェーズ3）
- TTS 生成・音声差し替え・タイミング調整・再 TTS（フェーズ4）
- クリック強調（リップル）のプレビュー合成描画（フェーズ5）
- 区間削除・セグメント結合/分割/トリム（フェーズ6）
- 書き出し（フェーズ7）
- 初回ウィザード・設定画面・VOICEVOX 自動取得・インストーラ（フェーズ8）
- 録画の長尺対応（ArrayBuffer→一時ファイル受け渡し）はフェーズ1からの先送りのまま

## ⑨ フェーズ1からの先送り項目への対応

- スキーマ未検証 → 本フェーズで `validateProject`（軽量）を追加し、任意フォルダを開く動線に備える。
- 録画全体の ArrayBuffer IPC → 本フェーズでは未対応（録画フロー不変）。文字起こしは main が
  ファイルパスで読むため大きな IPC 転送は発生しない。

## 関連

- 親設計: `docs/superpowers/specs/2026-05-26-clip2manual-design.md`
- フェーズ1計画: `docs/superpowers/plans/2026-05-26-phase1-recording-foundation.md`
