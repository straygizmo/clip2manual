# フェーズ4ラウンド2（タイミング調整付きTTSプレビュー）設計

- 日付: 2026-05-27
- 対象: 中央プレビューで「映像を音声に合わせる」を再現し、各セグメントの TTS 音声に映像を同期させて再生する。元音声 ↔ TTS のトグル付き。
- 位置づけ: フェーズ4の**ラウンド2**。ラウンド1（生成基盤）で各セグメントの `tts/<id>.wav` 生成・個別試聴ができるようになった。本ラウンドは**プレビュー上での同期再生差し替え＋タイミング調整**を実装する。書き出し（FFmpeg 焼き込み・多重化）は**フェーズ7**。
- 関連: `2026-05-27-clip2manual-phase4-tts-generation-design.md`（ラウンド1）、`2026-05-26-clip2manual-design.md`（全体設計）

## 背景と目的

ラウンド1で TTS クリップを生成・個別試聴できるようになったが、中央プレビューは依然として元ナレーション(raw.webm + narration.webm)を再生する。ユーザーは「プレビューでマニュアルの仕上がりを確認したい」。

本製品の核は「映像を音声に合わせる（音声長に映像を合わせ、フリーズ保持/末尾小休止）」。本ラウンドはこれを**プレビューで**再現する。TTS クリップは元映像区間と長さが違うため、各セグメントの表示時間を音声に合わせて伸縮（フリーズ/小休止）する必要がある。タイミング計算のロジックは純関数として切り出し、**フェーズ7の書き出しでも再利用**する。

## 確定方針（ブレスト）

- 今ラウンド=**タイミング調整あり**（「映像を音声に合わせる」をプレビューで再現）。FFmpeg 焼き込みはフェーズ7。
- アーキテクチャ=Approach A: **純粋なタイムライン関数** + **音声クロック駆動のコントローラ**。
- TTS未生成/空のセグメント=その映像区間を**無音**で再生（プレビューは全生成前でも使える）。
- トグル=プレビュー内に **元音声 ↔ TTS**。モードは一時的UI状態（非永続）。
- TTSモードの再生=先頭（または選択中セグメント）から**通しで再生**。TTSモード内の細かいスクラブは先送り（元音声モードは従来どおりスクラブ可）。
- リップル合成オーバーレイは対象外（フェーズ5）。
- `TAIL_PAUSE` ≈ 0.3秒（調整可能な定数）。

## スコープ

含む:
- 純関数 `computePreviewTimeline(segments, clipDurations)` → `PreviewSlot[]`
- `TtsPreviewController`: クリップのデコード（`c2m://`→`decodeAudioData`）、タイムライン構築、Web Audio スケジュール、映像要素の駆動（区間再生→末尾フリーズ→次スロット）、クロック/コールバック
- PreviewPlayer の 元音声 ↔ TTS トグルとコントローラ配線
- 再生中セグメントのタイムラインハイライト
- TTS未生成セグメントの無音再生、デコード失敗時のフォールバック

含まない（後続フェーズ）:
- 書き出し（FFmpeg 焼き込み・音声多重化）= フェーズ7
- クリック強調（リップル）合成プレビュー = フェーズ5
- 区間削除・結合・分割・トリム = フェーズ6
- TTSモード内の細かいスクラブ（任意位置シーク）
- enabled=false（カット）の扱い（編集はフェーズ6。本ラウンドは全セグメント有効前提）

## タイミングモデル（`src/renderer/editor/previewTimeline.ts`、純関数）

```ts
export interface PreviewSlot {
  segmentId: string;
  slotStart: number;     // プレビュータイムライン上の開始秒
  slotDuration: number;  // このスロットの長さ（秒）
  videoStart: number;    // 元映像の開始秒
  videoEnd: number;      // 元映像の終了秒
  clipDuration: number;  // TTS クリップ長（秒）。未生成は 0
}
export const TAIL_PAUSE = 0.3;
export function computePreviewTimeline(
  segments: Segment[],
  clipDurations: Map<string, number>,
): PreviewSlot[];
export function previewTotalDuration(slots: PreviewSlot[]): number;
```

各セグメント（順序どおり）について:
- `videoSpan = max(0, videoEnd - videoStart)`
- `clipDuration = clipDurations.get(id) ?? 0`
- `slotDuration = max(clipDuration, videoSpan) + TAIL_PAUSE`
- `slotStart` は累積和。

これで両ケースを統一: TTSが映像より長ければ末尾フレームをフリーズ保持、短ければ音声終了後に映像が終わり末尾に小休止。未生成（clipDuration=0）はその映像区間を無音再生。純粋で単体テスト可能。

## 再生コントローラ（`src/renderer/audio/ttsPreview.ts`）

`TtsPreviewController` は `AudioContext` を保持する。

- `load(segments, projectDir)`: 各 `ttsAudio` を `c2m://` URL で fetch → `arrayBuffer()` → `decodeAudioData` で `AudioBuffer` 化（キャッシュ）。デコード長から `clipDurations` を得て `computePreviewTimeline` でスロット構築。デコード失敗のクリップは「無し」（clipDuration=0、無音区間）として扱う。
- `play(videoEl, fromSlotIndex=0)`: `startTime = ctx.currentTime - slots[from].slotStart` を基準に、各スロットのクリップ source を `startTime + slot.slotStart` に `start()` でスケジュール。rAF ループ:
  - `previewTime = ctx.currentTime - startTime`
  - アクティブスロットを特定。`offset = previewTime - slot.slotStart`
  - `offset < videoSpan` の間は映像を `[videoStart, videoEnd]` でネイティブ再生（ドリフトが閾値超なら `currentTime` 補正）。`offset >= videoSpan` は `videoEnd` で一時停止＝フリーズ。
  - スロット境界で次スロットの `videoStart` にシークして再生。
  - `onActiveSegment(segmentId)` / `onTime(previewTime)` を通知。末尾で停止。
- `pause()` / `stop()`: スケジュール済み source を停止・破棄、rAF 解除。映像も一時停止。

音声が master clock。映像はスロット内ではネイティブ再生（滑らか）、区間外はフリーズ。Web Audio と映像/DOM を扱うため本コントローラは手動E2Eで検証（純タイミングは別途単体テスト）。

## UI（PreviewPlayer / EditorLayout / Timeline）

- `PreviewPlayer.tsx`: **元音声 ↔ TTS トグル**を追加。
  - 元音声モード: 現状の挙動（映像 master + narration.webm follower、スクラブ可）。
  - TTSモード: narration `<audio>` をミュート/不使用にし、`TtsPreviewController` で映像を駆動＋TTSをスケジュール。再生/一時停止はコントローラを操作。先頭（または選択中セグメントのスロット）から通し再生。
- `EditorLayout.tsx`: `segments`/`projectDir` をプレビューへ渡す。コントローラの `onActiveSegment` で更新するローカル状態 `playingId` を保持し、Timeline へ渡す。TTS未生成があれば小さなヒント表示（例「TTS未生成のセグメントは無音で再生されます」）。
- `Timeline.tsx`: `playingId` を受け取り、再生中セグメントをハイライト（選択ハイライトとは別表現）。

## エラー処理・エッジ

- クリップのデコード失敗 → そのセグメントは clipDuration=0（無音の映像区間）として扱い、クラッシュさせない。
- 生成済みクリップが皆無 → TTSモードでも全区間を無音映像として通し再生できる（ヒント表示）。
- `AudioContext` の autoplay suspend → 再生ボタン（ユーザー操作）で `resume()`。
- WebM の duration=Infinity 問題: 既存 PreviewPlayer のロジックで実尺確定済み。スロットの境界は **セグメントデータ（videoStart/videoEnd 秒）**に基づくため video.duration には依存しない。

## テスト

- 単体（Vitest node 環境）: `computePreviewTimeline` / `previewTotalDuration`
  - `slotDuration = max(clip, videoSpan) + TAIL_PAUSE`、`slotStart` の累積、未生成（clip=0）→ `videoSpan`、順序維持、合計長、空入力。
- 手動E2E（実機）: TTSモードに切替→再生→各セグメントで映像が区間再生後に末尾フリーズしつつ VOICEVOX 音声が流れる→次セグメントへ前進→再生中セグメントがハイライト→元音声トグルで従来再生に戻る。TTS未生成セグメントが無音で流れる。
- `TtsPreviewController` と PreviewPlayer は Web Audio/映像/DOM 依存のため手動E2Eで検証（テスト基盤なし）。

## 完了の定義

- `computePreviewTimeline` の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機で TTSモードに切替→通し再生でき、各セグメントの映像が音声長に合わせてフリーズ/小休止し、再生中セグメントがハイライトされ、元音声トグルで従来再生に戻る。

## 未解決・先送り

- TTSモード内の任意位置スクラブ（再タイミング空間でのシーク）。
- enabled/カット連動（フェーズ6）。
- 書き出し（FFmpeg）でのタイミング焼き込み・音声多重化（フェーズ7、`computePreviewTimeline` を再利用予定）。
- TAIL_PAUSE の値や末尾小休止の有無は実機の体感で調整。
