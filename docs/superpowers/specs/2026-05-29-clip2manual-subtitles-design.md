# 字幕表示機能 設計

- **日付**: 2026-05-29
- **対象フェーズ**: 字幕表示（フェーズ番号は付与せず、フェーズ6b 等とは独立）
- **依存**: フェーズ2（whisper 文字起こし）、フェーズ4（VOICEVOX TTS）、フェーズ7b（per-slot ffmpeg + ripple 焼き込み）
- **状態**: 設計確定。実装計画（plan）はこのあとに作成

## ゴール

文字起こし結果をプレビューおよび書き出し（MP4）で字幕として表示する。

- プレビューでは映像上にHTMLレイヤとしてオーバーレイ
- 書き出しでは ffmpeg の `overlay` フィルタで PNG を焼き込み
- どちらも単一のプロジェクト設定 `showSubtitles` で切替

## 非ゴール（後フェーズ）

- 手動の字幕テキスト編集UI（既存 Inspector の `correctedText` 編集が字幕にもそのまま反映される）
- 字幕の位置・色・サイズの調整UI
- ワード単位字幕（whisper の word timestamps を使う）
- ソフト字幕トラック（MOV_TEXT / SRT）の付与
- フェーズ6b の `videoStart`/`videoEnd` ドラッグトリム導入後の再評価（タイミング規則の見直しは6b完了時に行う）

## 確定方針

| 観点 | 方針 |
|---|---|
| 表示テキスト | `correctedText.trim() || originalText.trim()`。両方空なら字幕なし |
| プレビュー TTSモード のタイミング | スロット先頭からの経過 `< visibleDuration` の間表示。`visibleDuration = clipDuration > 0 ? clipDuration : videoSpan` |
| プレビュー 元音声モード のタイミング | 現在再生時刻 `t ∈ [videoStart, videoEnd)` のセグメントを表示 |
| 書き出しのタイミング | スロット内の `[0, visibleDuration)`、同じ式で計算。TTS未生成の場合も映像区間長の間は字幕を表示 |
| `enabled === false` | `computePreviewTimeline` で除外済 → 字幕も自動的に出ない |
| ON/OFF 設定 | `ProjectSettings.showSubtitles: boolean`、デフォルト `true` |
| 設定UI | EditorLayout のツールバーにチェックボックス1つ |
| 書き出し焼き込み方式 | sharp + SVG→PNG オーバーレイ（リップル方式と一致） |
| プレビュー描画方式 | HTML/CSS の `<div>` オーバーレイ |
| フォント（書き出し用） | Noto Sans JP Regular を vendor 同梱、SVG 内に base64 `@font-face` で埋め込み |

## 全体アーキテクチャ

```
shared/
  types.ts                   ← ProjectSettings に showSubtitles を追加
  subtitleSelect.ts          ← 新規: pickSubtitle(...) 純関数

renderer/
  editor/PreviewPlayer.tsx   ← 字幕オーバーレイ <div> を追加、pickSubtitle で内容決定
  editor/EditorLayout.tsx    ← ツールバーに「字幕」チェックボックス
  audio/ttsPreview.ts        ← onActiveSegment に offsetInSlot を追加 (拡張)

main/
  export/
    subtitleWrap.ts          ← 新規: wrapJapanese(...) 純関数
    subtitleSvg.ts           ← 新規: subtitleSvg(...) 純関数（SVG文字列を返す）
    subtitleFrames.ts        ← 新規: generateSubtitleFrameForSlot(...) I/O
    fontPaths.ts             ← 新規: 開発/本番のフォント絶対パス解決
    ffargs.ts                ← segmentVideoArgs に optional subtitle を追加
    exportService.ts         ← 設定参照 + per-slot で subtitle PNG を生成

vendor/
  fonts/
    NotoSansJP-Regular.otf   ← 同梱（OFL 1.1）
    LICENSE                  ← OFL ライセンス文
```

## データモデル

### `ProjectSettings` 拡張

```ts
export interface ProjectSettings {
  highlightStyle: HighlightStyle;
  timingMode: TimingMode;
  llm: LLMSettings;
  tts: TTSSettings;
  showSubtitles: boolean;        // ← 追加
}
```

- `createProject` のデフォルトで `showSubtitles: true`
- `validateProject` は型を厳密に検証しない（既存方針どおり）。読込み直後の正規化フェーズで `typeof p.settings.showSubtitles !== 'boolean'` のとき `true` をセット → 既存プロジェクトとの後方互換

### Segment は変更なし

`originalText` / `correctedText` をそのまま字幕に使う。専用フィールドは追加しない。

## 純関数 API

### `src/shared/subtitleSelect.ts`

```ts
export interface SubtitleSelectInput {
  segments: Segment[];
  showSubtitles: boolean;
  mode: 'original' | 'tts';
  // original: 映像の現在時刻（秒）。tts: 現在スロットIDとスロット内オフセット（秒）
  cursor:
    | { kind: 'original'; videoTime: number }
    | { kind: 'tts'; slotId: string; offsetInSlot: number; visibleDuration: number };
}

export function pickSubtitle(input: SubtitleSelectInput): string | null;
```

ルール:
- `showSubtitles === false` → 常に null
- `mode === 'original'`: `enabled !== false` かつ `videoTime ∈ [videoStart, videoEnd)` のセグメントを探し、テキスト導出。空なら null
- `mode === 'tts'`: `slotId` と一致するセグメントを探す。`offsetInSlot >= visibleDuration` なら null（フリーズ・tail中）、それ未満ならテキスト導出。`visibleDuration` は呼出し側（コントローラ hint）で `clipDuration > 0 ? clipDuration : videoSpan` として算出済み
- テキスト導出: `correctedText.trim() || originalText.trim()`、空なら null

### `src/main/export/subtitleWrap.ts`

```ts
export function wrapJapanese(text: string, maxCols: number, maxLines: number): string[];
```

- `Intl.Segmenter('ja', { granularity: 'grapheme' })` でグラフェム配列にする
- 1行に積めるだけ詰め、超えたら次行（半角は1幅、全角・絵文字は2幅で重み付け）
- `maxLines` を超えたら最終行末尾を「…」で打切り
- 空文字なら空配列

### `src/main/export/subtitleSvg.ts`

```ts
export interface SubtitleSvgInput {
  text: string;
  videoW: number;
  videoH: number;
  fontBase64: string;  // 呼び出し側でキャッシュした OTF を base64 化したもの
}

export function subtitleSvg(input: SubtitleSvgInput): string | null;
```

- `text.trim() === ''` なら null
- `fontSize = Math.round(videoH * 0.045)`
- `maxCols ≈ Math.floor((videoW * 0.8) / (fontSize * 0.6))`
- `wrapJapanese(text, maxCols, 3)` で行リストを得る
- SVG（`viewBox="0 0 videoW videoH"`）の `<defs><style>` で `@font-face { font-family: 'NotoSansJP'; src: url(data:font/otf;base64,${fontBase64}) }`
- 中央下部に `<rect>` 半透明黒（角丸、行数に応じて高さ調整）、`<text text-anchor="middle">` + `<tspan>` 行ごと
- `<text>` は `fill="white" stroke="black" stroke-width="${fontSize * 0.08}" paint-order="stroke fill"` で縁取り

### `src/main/export/subtitleFrames.ts`

```ts
export interface GenerateSubtitleFrameInput {
  slot: PreviewSlot;
  text: string;
  videoW: number;
  videoH: number;
  fontBase64: string;
  outDir: string;
  signal?: AbortSignal;
}

export interface SubtitleFrameOutput {
  pngPath: string;
  durationSec: number;
}

export async function generateSubtitleFrameForSlot(
  input: GenerateSubtitleFrameInput,
): Promise<SubtitleFrameOutput | null>;
```

- `text.trim() === ''` または `slot.videoEnd === slot.videoStart && slot.clipDuration === 0` のとき null
- `durationSec = slot.clipDuration > 0 ? slot.clipDuration : (slot.videoEnd - slot.videoStart)`（プレビュー側の `visibleDuration` と同一式）
- `subtitleSvg(...)` → null なら null、文字列なら sharp で 1枚 PNG として出力
- abort 対応

### `src/main/export/fontPaths.ts`

```ts
export function resolveSubtitleFontPath(): string;
export function loadSubtitleFontBase64(): Promise<string>;
```

- 開発: `<repo>/vendor/fonts/NotoSansJP-Regular.otf`
- 本番: `process.resourcesPath/fonts/NotoSansJP-Regular.otf`
- base64 はプロセス内で1回読込→キャッシュ（モジュールローカル変数）

## ffmpeg 引数の拡張

### `segmentVideoArgs` のシグネチャ

```ts
export function segmentVideoArgs(input: {
  rawPath: string;
  slot: PreviewSlot;
  outPath: string;
  fps: number;
  ripple?: { pattern: string; fps: number };
  subtitle?: { pngPath: string; durationSec: number };
}): string[];
```

### filter chain の組み立て

| ripple | subtitle | filter |
|---|---|---|
| なし | なし | `-vf tpadChain`（既存パス、変更なし） |
| あり | なし | `[0:v] tpadChain [vbase]; [vbase][1:v] overlay=shortest=1 [vout]`（既存パス） |
| なし | あり | `[0:v] tpadChain [vbase]; [vbase][1:v] overlay=0:0:enable='lt(t,${dur})' [vout]` |
| あり | あり | `[0:v] tpadChain [vbase]; [vbase][1:v] overlay=shortest=1 [vrip]; [vrip][2:v] overlay=0:0:enable='lt(t,${dur})' [vout]` |

- subtitle は静止画なので `-loop 1` 付き `-i` で入力（`-framerate` は不要）
- `dur` は浮動小数を `toFixed(3)` で文字列化

## プレビュー側の繋ぎ込み

### `TtsPreviewController` 拡張

- 既存 `onActiveSegment(id)` は遷移時のみ発火する設計なので、字幕用には別途継続的な hint コールバックを追加する
- 新コールバック: `onSlotProgress?: (hint: { slotId: string; offsetInSlot: number; visibleDuration: number } | null) => void`
  - rAF tick 内で毎フレーム呼ぶ。停止/フリーズ・tail突入時など対象スロットが無いときは `null`
  - `visibleDuration = clipDuration > 0 ? clipDuration : videoSpan`（コントローラ側で算出）
- 既存呼び出し側は新フィールドを設定しなければ動作不変

### `PreviewPlayer.tsx`

- `<video>` を `relative` 親に内包し、その内側に絶対配置の `<div className="subtitle-overlay">{text}</div>`
- text は親（`EditorLayout`）から prop で受け取るか、`PreviewPlayer` 内で `pickSubtitle` を呼ぶ
  - 推奨: `EditorLayout` で `subtitleText` を state として持ち、`PreviewPlayer` に prop で渡す（既存の `playingId` と同じパターン）
- 元音声モード: `onTime`（currentTime）と `segments`、`showSubtitles` から `pickSubtitle({mode:'original', cursor:{kind:'original', videoTime}})` を計算
- TTSモード: 新コールバック `onSlotProgress(hint)` で受け取った `slotId/offsetInSlot/visibleDuration` を `pickSubtitle({mode:'tts', cursor:{kind:'tts', ...}})` に渡す。`hint === null` のときは null（字幕非表示）
- `showSubtitles === false` のときは `pickSubtitle` を呼ばずに常に非表示

### スタイル（Tailwind v4 + shadcn 既存色を流用）

```css
.subtitle-overlay {
  position: absolute;
  left: 50%;
  bottom: 8%;
  transform: translateX(-50%);
  max-width: 80%;
  padding: 0.25em 0.6em;
  border-radius: 0.25rem;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  font-family: system-ui, -apple-system, "Yu Gothic UI", "Meiryo", sans-serif;
  font-size: clamp(14px, 3.5vh, 32px);
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  text-shadow: 0 0 2px black, 0 0 3px black;
  pointer-events: none;
  white-space: pre-wrap;
  word-break: break-word;
}
```

## 書き出しサービスの繋ぎ込み

### `runExport` の追加処理

1. `fontBase64 = await loadSubtitleFontBase64()` をループ前に1回（`opts.segments` 内に有効な字幕がある場合のみ）
2. スロットループ内で:
   - `settings.showSubtitles === false` なら subtitle 引数を渡さない（既存パスに分岐）
   - `text = (seg.correctedText || seg.originalText).trim()`、空ならスキップ
   - `await generateSubtitleFrameForSlot({...})` → null でなければ `segmentVideoArgs` に渡す
3. 進捗カウンタ `total` は不変（per-slot ffmpeg 呼び出し回数は1のまま、フィルタチェーン拡張のみ）

### `ExportOptions` の追加

```ts
export interface ExportOptions {
  // ... 既存
  showSubtitles: boolean;
  generateSubtitleFrame?: (
    input: GenerateSubtitleFrameInput,
  ) => Promise<SubtitleFrameOutput | null>;  // テスト用
}
```

呼出し元 `src/main/ipc/export.ts` は `project.settings.showSubtitles` を渡す。

## 設定UI

- 場所: `EditorLayout.tsx` のツールバー、既存のデフォルト話者・速度UI付近に `<label>` + チェックボックス
- ハンドラ: 既存の `updateSettings` パターンに合わせ、`window.api.updateSettings({ ...project.settings, showSubtitles: next })`
- i18n キー: `editor.showSubtitles` / `editor.showSubtitlesTooltip`

## エッジケース挙動

| ケース | 挙動 |
|---|---|
| `correctedText` も `originalText` も空 | 字幕なし（PNG生成スキップ・プレビュー非表示） |
| `enabled === false`（カット） | 自動的に出ない（`computePreviewTimeline` で除外） |
| TTS未生成 & 元音声モード | プレビュー: `[videoStart, videoEnd]`／書き出し: 映像区間長を `durationSec` に使用 |
| TTS未生成 & TTSプレビューモード | 無音スロット中も映像区間長で字幕表示 |
| 長文（10行など） | 3行で打切り＋末尾「…」 |
| 絵文字・半角英数混在 | グラフェム単位ラップで崩れない |
| `showSubtitles=false` | プレビュー非表示／書き出し時PNG生成スキップ |
| 既存プロジェクト（`showSubtitles` 未定義） | 読込み時に `true` で正規化 |

## テスト戦略

### 単体テスト（Vitest）

| ファイル | テスト対象 |
|---|---|
| `src/shared/subtitleSelect.test.ts` | original/tts モード、境界、空テキスト、`showSubtitles=false`、enabled除外、TTS未生成時 |
| `src/main/export/subtitleWrap.test.ts` | 1行・複数行、3行打切り、絵文字、空文字、半角英数混在 |
| `src/main/export/subtitleSvg.test.ts` | 空テキストでnull、サイズ計算、行数=`<tspan>`数、`@font-face` 含む |
| `src/main/export/ffargs.test.ts`（既存追加） | subtitle なし／subtitle のみ／ripple + subtitle／ripple のみ の4ケース、`-loop 1` と `enable='lt(t,...)'` の確認 |
| `src/main/export/exportService.test.ts`（既存追加） | スロットループで `generateSubtitleFrame` が呼ばれる、`showSubtitles=false` でスキップ、空テキストスロットでスキップ |

### 手動E2E（実機 Windows）

- プレビュー 元音声モード: 字幕が `[videoStart, videoEnd]` で出る／出ない
- プレビュー TTSモード: 字幕がTTS読み上げ中だけ出て、フリーズ・tailで消える
- プレビュー: 設定UIで OFF にすると消える
- 書き出し: MP4 に字幕が焼き込まれている（Noto Sans JP で表示）
- 書き出し: 長文が3行で折返し、4行目以降は「…」
- 書き出し: 設定 OFF で字幕なしのMP4が出る

### 既存テストへの影響

- `computePreviewTimeline` / `segmentOps` 等は変更なし → 既存テストは無修正で通過
- `ProjectSettings` の追加フィールドにより `createProject` のスナップショット系テストがあれば追従

## 実装順（後続 plan のヒント）

1. `ProjectSettings.showSubtitles` + 正規化 + `createProject` デフォルト
2. `subtitleSelect.ts`（純関数 + TDD）
3. `TtsPreviewController` の `onActiveSegment` 拡張
4. `PreviewPlayer` に字幕オーバーレイ + 設定UI（ツールバー）
5. `subtitleWrap.ts` / `subtitleSvg.ts`（純関数 + TDD）
6. Noto Sans JP 同梱（`vendor/fonts/`, `electron-builder` 設定, ライセンス）
7. `fontPaths.ts` + `subtitleFrames.ts`（I/O、sharp）
8. `ffargs.ts` の `segmentVideoArgs` に subtitle 引数を追加（TDD）
9. `exportService.ts` の繋ぎ込み + `ExportOptions` に `showSubtitles`
10. i18n（ja/en）
11. 単体テスト全件パス、typecheck、build
12. 手動E2E

## ライセンス・クレジット

- Noto Sans JP は SIL Open Font License 1.1 の下で再配布可能
- `vendor/fonts/LICENSE` にライセンス全文同梱
- 既存のクレジット表記（ffmpeg/whisper.cpp/VOICEVOX 等）と並べて "Noto Sans JP — © Google, OFL 1.1" を追加
- フェーズ8のクレジット欄に追記する場合は、その時点で再度追記

## 既知のリスクと対応

| リスク | 対応 |
|---|---|
| `librsvg` の `@font-face` data URI サポート | sharp 公式 docs と既存ベンチで動作確認済の前提だが、実装初期に最小SVGで動作確認をする（spike） |
| SVG文字列のサイズ肥大化（フォント≈5MB×4/3 base64） | プロセス内キャッシュ + per-slot 1回生成のため I/O 上の負荷は微小。メモリは1コピー保持 |
| 4K動画でPNGサイズが大きい | 字幕PNGは 1スロット1枚かつ静止画なので合計枚数 ≈ スロット数。リップル PNG 列に比べれば小さい |
| Windows 環境差（フォントレンダリング） | base64 埋込みで fontconfig 非依存にする → OS差異を最小化 |

## 関連スペック

- `docs/superpowers/specs/2026-05-28-clip2manual-phase7b-ripple-burn-in-design.md` — per-slot ripple PNG/overlay の前例
- `docs/superpowers/specs/2026-05-27-clip2manual-phase7a-export-design.md` — 書き出しパイプライン基礎
- `docs/superpowers/specs/2026-05-27-clip2manual-phase4r2-timed-preview-design.md` — `TtsPreviewController` の経路
