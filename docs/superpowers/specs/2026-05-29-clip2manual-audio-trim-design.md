# 音声トリム機能 設計（Phase B）

- **日付**: 2026-05-29
- **対象**: TTS 音声の手動 in/out トリム + タイムライン上の音声トラック可視化
- **依存**: Phase A（タイムラインズーム）、Phase 4r2（TtsPreviewController）、Phase 7（exportService）、Phase 字幕（pickSubtitle）
- **状態**: 設計確定。plan はこのあとに作成
- **背景**: フェーズ4r2 完了後にユーザーが「TTS音声の区切りが実際の時間より大幅に長いため映像が止まったように見える」と報告。Phase A で時刻表示・ズームを入れ、Phase B で音声長を編集可能にする本筋対応

## ゴール

TTS の前後無音などで実音声より長い WAV が生成される場合に、ユーザーがタイムライン上で WAV の長さを視認し、両端のトリムハンドルで再生区間を縮めて、映像のフリーズ時間を減らせるようにする。

- タイムラインに「ナレーション」「TTS」の 2 行を追加し、各セグメントを時刻軸上に厳密に表示
- TTS 行に左右トリムハンドル、ドラッグで in/out オフセットを編集
- トリム結果が prview 再生・MP4 書き出し・字幕タイミングに反映

## 非ゴール（後フェーズ）

- 波形表示（必要が出たら別途）
- 中間カット（複数 in/out 区間）
- VOICEVOX の `prePhonemeLength`/`postPhonemeLength`/`pauseLength` 自動 0 化（並行採用可だが本フェーズ対象外）
- ドラッグでの TTS 開始位置移動（slot 内オフセット）
- ナレーション行の単独再生
- Undo / Redo
- 端のドラッグトリム（Phase 6b、映像区間の編集）

## 確定方針

| 観点 | 方針 |
|---|---|
| トリム方式 | 非破壊（in/out オフセットを Segment に保存、WAV はそのまま） |
| 2 行構成 | 上＝ナレーション（`[videoStart, videoEnd]`）、下＝TTS（`[videoStart, videoStart + effectiveClipDuration]`） |
| はみ出し可視化 | TTS が `videoEnd` を超えるとブロックの「はみ出し部分」をオレンジで強調 |
| 表示形式 | ブロック（波形なし） |
| 編集 UI | TTS ブロック両端のトリムハンドル（drag-only、Inspector からの数値入力は本フェーズ対象外） |
| 全長の出所 | `Segment.clipFullDuration` を TTS 生成時に WAV ヘッダから読み出して保存 |
| 永続化 | `audioStart` / `audioEnd` / `clipFullDuration` を Segment に追加し project.json に書く |
| 再生成時 | TTS 再生成すると `clipFullDuration` を新値で上書き、`audioStart`/`audioEnd` は `undefined` にリセット |
| 古いプロジェクト | `clipFullDuration` 未定義のセグメントはトリム UI 非表示、再生は従来どおり |
| 最小トリム長 | `MIN_TRIM_DURATION = 0.05` 秒 |
| ドラッグ中の再生 | mousedown で再生停止、mouseup 後に TTS モードなら controller を再 load |

## アーキテクチャ

```
src/shared/
  types.ts             ← Segment に audioStart, audioEnd, clipFullDuration を追加 + validate 正規化
  audioTrim.ts         ← 新規: effectiveClipDuration / dragTrim 純関数
  wav.ts               ← parseWavDuration 純関数を追加（既存 encodeWav と並べる）

src/renderer/
  editor/Timeline.tsx          ← ナレーション行 + TTS 行 + トリムハンドル
  editor/timelineGeometry.ts   ← （既存 helpers 流用、必要なら helper 追加）
  state/editorReducer.ts       ← SET_SEGMENT_AUDIO_TRIM action
  audio/ttsPreview.ts          ← effective duration を反映、AudioBufferSourceNode.start(when, offset, duration)

src/main/
  voicevox/ttsService.ts       ← 保存後に WAV duration を読んで Segment に clipFullDuration をセット
  export/ffargs.ts             ← segmentAudioArgs に optional audioStart/audioDuration
  export/exportService.ts      ← effective duration をスロットに渡し、ffargs に in/duration を渡す
```

## データモデル

### `Segment` 拡張

```ts
export interface Segment {
  id: string;
  videoStart: number;
  videoEnd: number;
  originalText: string;
  correctedText: string;
  ttsAudio: string | null;
  voice: SegmentVoice;
  clicks: ClickEvent[];
  enabled: boolean;
  audioStart?: number;          // 再生区間の開始（秒、0 以上、< audioEnd）
  audioEnd?: number;            // 再生区間の終了（秒、<= clipFullDuration）
  clipFullDuration?: number;    // WAV の真の全長（秒）
}
```

- いずれも optional。`undefined` は「未設定（=トリム未適用）」を意味する
- `validateProject` で `typeof === 'number' && > 0` でない値は `undefined` に正規化（型ガード、後方互換）

### `audioTrim.ts` 純関数

```ts
import { type Segment } from './types';

export const MIN_TRIM_DURATION = 0.05;

/** 実効再生長（秒）。トリム未設定または不正値は WAV 全長を返す。 */
export function effectiveClipDuration(
  segment: Segment, fullClipDuration: number,
): number {
  const s = Math.max(0, segment.audioStart ?? 0);
  const e = Math.min(fullClipDuration, segment.audioEnd ?? fullClipDuration);
  return Math.max(0, e - s);
}

/** トリムハンドルのドラッグ。最小長と全長で clamp。 */
export function dragTrim(input: {
  side: 'left' | 'right';
  dxPx: number;
  pxPerSec: number;
  currentStart: number;
  currentEnd: number;
  fullClipDuration: number;
  minDuration?: number;
}): { audioStart: number; audioEnd: number } {
  const minDur = input.minDuration ?? MIN_TRIM_DURATION;
  const ds = input.dxPx / input.pxPerSec;
  if (input.side === 'left') {
    const next = Math.max(0, Math.min(input.currentEnd - minDur, input.currentStart + ds));
    return { audioStart: next, audioEnd: input.currentEnd };
  }
  const next = Math.max(input.currentStart + minDur, Math.min(input.fullClipDuration, input.currentEnd + ds));
  return { audioStart: input.currentStart, audioEnd: next };
}
```

### `wav.ts` 拡張

```ts
/** WAV (RIFF/fmt/data) の総再生秒数。canonical PCM のみ対応で十分。 */
export function parseWavDuration(buf: Buffer): number;
```

WAV ヘッダ仕様: 24..27=sampleRate (LE uint32)、22..23=numChannels (LE uint16)、34..35=bitsPerSample (LE uint16)、`data` チャンクサイズ＝ファイル末尾の `data` タグ直後の uint32（オフセット可変）。RIFF 内をスキャンして `data` chunk を見つける。

**duration = dataSize / (sampleRate * numChannels * bitsPerSample / 8)**

## TTS 生成への組み込み

`ttsService.generateTts` の WAV 書き込み直後に `parseWavDuration` を呼び、Segment に書き込む:

```ts
const wav = await opts.client.synthesize(...);
const rel = `tts/${s.id}.wav`;
await fs.writeFile(path.join(opts.outDir, rel), wav);
const fullDur = parseWavDuration(wav);
const idx = updated.findIndex((u) => u.id === s.id);
updated[idx] = {
  ...updated[idx],
  ttsAudio: rel,
  clipFullDuration: fullDur,
  audioStart: undefined,           // 再生成でトリムを必ずリセット
  audioEnd: undefined,
};
```

## プレビュー再生への反映

### `effectiveClipDuration` を経由

```ts
// renderer/audio/ttsPreview.ts: load()
this.segments = segments; // 新規メンバー
const durations = new Map<string, number>();
for (const seg of segments) {
  if (!seg.ttsAudio) continue;
  try {
    const buf = await ctx.decodeAudioData(...);
    this.buffers.set(seg.id, buf);
    const full = seg.clipFullDuration ?? buf.duration;
    durations.set(seg.id, effectiveClipDuration(seg, full));
  } catch { /* 無音区間 */ }
}
this.slots = computePreviewTimeline(segments, durations);
```

`computePreviewTimeline` 本体は変更なし（呼出し側で effective を渡す）。

### sub-range スケジューリング

```ts
// play() 内、各 slot
const buf = this.buffers.get(slot.segmentId);
const seg = this.segments.find((s) => s.id === slot.segmentId);
if (!buf || !seg) continue;
const aStart = seg.audioStart ?? 0;
const effective = slot.clipDuration; // = effective
if (effective <= 0) continue;
const clipEnd = slot.slotStart + effective;
if (from >= clipEnd) continue;
const src = ctx.createBufferSource();
src.buffer = buf;
src.connect(ctx.destination);
const when = this.startCtxTime + slot.slotStart;
if (when >= ctx.currentTime) {
  src.start(when, aStart, effective);
} else {
  const localOffset = from - slot.slotStart;
  src.start(ctx.currentTime, aStart + localOffset, effective - localOffset);
}
this.sources.push(src);
```

### トリム編集中の挙動

- mousedown でドラッグ開始 → 既にプレビュー再生中なら controller.stop()
- ドラッグ中はローカル state で audioStart/audioEnd を更新（描画反映）
- mouseup で確定 → `dispatch SET_SEGMENT_AUDIO_TRIM` + `window.api.updateSegments`
- mouseup 後、TTS モード継続中（mousedown 前は再生中だった等）の自動再ロードは行わない。次回 toggle TTS / Play で load() が呼ばれて反映される

## 書き出しへの反映

### `ffargs.segmentAudioArgs` 拡張

```ts
export function segmentAudioArgs(input: {
  clipPath: string | null;
  slotDuration: number;
  outPath: string;
  audioStart?: number;
  audioDuration?: number;
}): string[] {
  const { clipPath, slotDuration, outPath, audioStart, audioDuration } = input;
  if (clipPath) {
    const ss = (audioStart !== undefined && audioStart > 0) ? ['-ss', String(audioStart)] : [];
    const dur = (audioDuration !== undefined) ? ['-t', String(audioDuration)] : [];
    return [
      '-y',
      ...ss, ...dur,
      '-i', clipPath,
      '-af', 'apad',
      '-t', String(slotDuration),
      '-c:a', 'pcm_s16le', '-ar', AUDIO_RATE, '-ac', '2',
      outPath,
    ];
  }
  return [
    '-y',
    '-f', 'lavfi',
    '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
    '-t', String(slotDuration),
    '-c:a', 'pcm_s16le',
    outPath,
  ];
}
```

`-ss` と `-t` は `-i` より前（入力オプション）に置く。これにより入力が effective 長で EOF になり、`apad` が `slotDuration` まで無音で埋める（既存挙動と整合）。

### `exportService.runExport`

```ts
import { effectiveClipDuration } from '../../shared/audioTrim';

for (const s of opts.segments) {
  if (!s.ttsAudio) continue;
  const full = parseProbeDuration(await opts.runProbe(probeDurationArgs(path.join(opts.projectDir, s.ttsAudio))));
  clipDurations.set(s.id, effectiveClipDuration(s, full));
}

// per-slot:
const seg = opts.segments.find((s) => s.id === slot.segmentId);
const aStart = seg?.audioStart ?? 0;
const aDur = slot.clipDuration;
await opts.runFfmpeg(segmentAudioArgs({
  clipPath, slotDuration: slot.slotDuration, outPath: aOut,
  audioStart: aStart > 0 ? aStart : undefined,
  audioDuration: aDur > 0 ? aDur : undefined,
}));
```

## タイムライン UI

### 行構成

既存 4 行（時刻 / 映像 / セグメント / クリック）の **セグメント行の直下** に 2 行追加:

1. **ナレーション行**（`timeline.narration` キー、ja=「ナレーション」/ en=「Narration」）: 各セグメントの `[videoStart, videoEnd]` を別色（暗グレー）ブロックで描画。テキスト・選択 UI なし。
2. **TTS 行**（`timeline.tts` キー、ja=「TTS」/ en=「TTS」）: 各セグメントの `[videoStart, videoStart + effectiveClipDuration]` をブロック描画。`effectiveClipDuration > videoSpan` の場合、`videoEnd` 以降の領域をオレンジ色で塗り分け、ハンドルはブロック全体の両端に配置。

最終的な行順:

```
時刻 / 映像 / セグメント / ナレーション / TTS / クリック
```

### TTS ブロックの構造

```tsx
<div className="tts-block" style={{ left, width, height }}>
  <div className="tts-fit" style={{ width: fitWidth }} />
  {overflow > 0 && <div className="tts-overflow" style={{ left: fitWidth, width: overflowWidth }} />}
  <div className="trim-handle trim-handle-left" />
  <div className="trim-handle trim-handle-right" />
</div>
```

- `fitWidth = min(effectiveClipDuration, videoSpan) * pxPerSec`
- `overflowWidth = max(0, effectiveClipDuration - videoSpan) * pxPerSec`
- ハンドル: 幅 6px、フルハイト、`cursor-ew-resize`、`pointer-events: auto`
- ブロック本体: `pointer-events: none` だがハンドルだけは反応（あるいはブロックをクリックでセグメント選択も可）

### ドラッグハンドラ

```tsx
function onHandleMouseDown(side: 'left'|'right', seg: Segment, e: React.MouseEvent) {
  e.stopPropagation();
  const startX = e.clientX;
  const initialStart = seg.audioStart ?? 0;
  const initialEnd = seg.audioEnd ?? seg.clipFullDuration!;
  const full = seg.clipFullDuration!;
  // ドラッグ中は再生停止（renderer 側で onTrimDragStart を呼ぶ）
  onTrimDragStart?.();
  let lastTrim = { audioStart: initialStart, audioEnd: initialEnd };
  const onMove = (ev: MouseEvent) => {
    lastTrim = dragTrim({
      side, dxPx: ev.clientX - startX, pxPerSec,
      currentStart: initialStart, currentEnd: initialEnd, fullClipDuration: full,
    });
    setDragPreview({ id: seg.id, ...lastTrim });
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    onTrimCommit(seg.id, lastTrim.audioStart, lastTrim.audioEnd);
    setDragPreview(null);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
```

`dragPreview` は Timeline ローカル state（`{ id, audioStart, audioEnd } | null`）。レンダ時に `effectiveStart`/`effectiveEnd` を `dragPreview?.id === seg.id ? dragPreview : seg.audioStart/End` から選ぶ。

`onTrimCommit` は EditorLayout から渡される:

```ts
const onTrimCommit = (id: string, audioStart: number, audioEnd: number) => {
  dispatch({ type: 'SET_SEGMENT_AUDIO_TRIM', id, audioStart, audioEnd });
  const updated = segments.map((s) =>
    s.id === id ? { ...s, audioStart, audioEnd } : s,
  );
  void window.api.updateSegments(updated);
};

const onTrimDragStart = () => {
  // 再生中なら止める（既存 PreviewPlayer 経由で stop を呼ぶ手段が必要）
};
```

PreviewPlayer に新 prop `onRequestStop?: () => void` を、内部は Timeline からの `onTrimDragStart` で呼ぶように EditorLayout でつなぐ（あるいは Timeline → EditorLayout → PreviewPlayer 経由）。最小実装としては、EditorLayout に「停止リクエスト」用 state（`stopNonce: number`）を持ち、PreviewPlayer が `useEffect([stopNonce])` で `controllerRef.current?.stop()` を呼ぶ、というシンプル経路にする。

### Reducer 新 action

```ts
| { type: 'SET_SEGMENT_AUDIO_TRIM'; id: string; audioStart: number; audioEnd: number }
```

```ts
case 'SET_SEGMENT_AUDIO_TRIM':
  if (!state.project) return state;
  return {
    ...state,
    project: {
      ...state.project,
      segments: state.project.segments.map((s) =>
        s.id === action.id ? { ...s, audioStart: action.audioStart, audioEnd: action.audioEnd } : s,
      ),
    },
  };
```

### スタイル

```css
.narration-block { background: hsl(var(--muted) / 0.6); }
.tts-block      { position: absolute; height: 22px; }
.tts-fit        { background: hsl(160 60% 35%); /* 緑系：映像に収まる部分 */ }
.tts-overflow   { background: hsl(20 90% 50%);  /* オレンジ：はみ出し */ position: absolute; }
.trim-handle    { position: absolute; top: 0; bottom: 0; width: 6px; cursor: ew-resize; }
.trim-handle-left  { left: 0;  background: hsl(var(--foreground) / 0.5); }
.trim-handle-right { right: 0; background: hsl(var(--foreground) / 0.5); }
```

色は shadcn テーマトークンに合わせて最終調整。

### i18n

```jsonc
"timeline": {
  ...既存,
  "narration": "ナレーション",
  "tts": "TTS"
}
```

en: `"narration": "Narration", "tts": "TTS"`

## エッジケース挙動

| ケース | 挙動 |
|---|---|
| 古いプロジェクト（trim 未設定、clipFullDuration 未設定） | ナレーション行は描画、TTS 行は ttsAudio があれば AudioBuffer.duration をフォールバックで使用。クリップ生成時のみ clipFullDuration が undefined → トリム UI は非表示（ハンドル非描画）。再生・書き出しは全長（=effective）でそのまま動く |
| `audioStart >= audioEnd` | `effectiveClipDuration` = 0、無音相当。スロット長は `videoSpan + TAIL_PAUSE` |
| `audioEnd > clipFullDuration` | clamp |
| `audioStart < 0` | clamp |
| TTS 再生成 | `clipFullDuration` 上書き、`audioStart`/`audioEnd` を `undefined` にリセット（既存トリム保持は誤再生になるため不可） |
| TTS なし（`ttsAudio === null`） | TTS 行に何も描画しない、effective = 0 |
| TTS 生成中（busy） | トリムハンドル disable |
| ドラッグ中にウィンドウ外へマウス | window 上の mouseup を購読しているので確定（mouseleave なしで OK） |
| プレビュー再生中のドラッグ開始 | 既存再生を停止（`stopNonce` 経由） |
| ズーム時のハンドル可視性 | ハンドルは固定 6px、ズームアウトでブロック幅が 12px 未満になったらハンドルを縮める（min 2px）か非表示にする |
| enabled=false のセグメント | ナレーション/TTS 行は `opacity 0.35` で描画、ハンドル無効 |

## テスト戦略

### 単体テスト

| ファイル | 対象 |
|---|---|
| `test/audioTrim.test.ts`（新規） | `effectiveClipDuration`（trim 未設定/clamp/不正/0 長）、`dragTrim`（左右両側、最小長境界、全長境界） |
| `test/wav.test.ts`（既存追加） | `parseWavDuration`: 既存 `encodeWav` で作った WAV の duration が一致、不正バイトで 0 |
| `test/previewTimeline.test.ts`（既存追加） | effective duration がスロット長に反映される（呼出し側責任の確認） |
| `test/ffargs.test.ts`（既存追加） | `segmentAudioArgs` の `-ss`/`-t` あり/なし 3 パターン |
| `test/exportService.test.ts`（既存追加） | トリム済 segment で `-ss`/`-t` が ffmpeg に渡る、未トリム時は渡らない |
| `test/validateProject.test.ts`（既存追加） | `audioStart`/`audioEnd`/`clipFullDuration` の正規化（型ガード、不正値 undefined 化） |
| `test/editorReducer.test.ts`（既存追加） | `SET_SEGMENT_AUDIO_TRIM` action |
| `test/ttsService.test.ts`（既存追加） | 生成後の Segment に `clipFullDuration` が入る、再生成で `audioStart`/`audioEnd` がリセット |
| `test/localeKeys.test.ts` | ja/en の `timeline.narration` / `timeline.tts` 一致（既存テスト自動カバー） |

### 手動 E2E（実機 Windows）

- TTS 生成 → タイムラインに narration 行 + TTS 行が出る
- TTS 行が videoEnd を超える場合、オレンジで overflow が見える
- TTS 右端ハンドルをドラッグ → 短くなる、ハンドルは 6px グリップとして掴める
- 左端ハンドルもドラッグ → 先頭の無音をカット
- プレビュー TTS モードで再生 → トリムが反映され、フリーズが減る
- 書き出し → MP4 でも反映、フリーズが減る、字幕タイミングも合う
- TTS 再生成（同セグメント）→ トリムがリセットされる
- 古いプロジェクトを開く → トリム UI は出ない、再生は従来どおり
- ズーム最大時にハンドルが十分掴める / 最小時に消えるか縮む

## 既存テストへの影響

- `Segment` 型の変更は optional フィールド追加のみ。既存テストの `Segment` リテラルは値を省略してそのまま動く
- `computePreviewTimeline` 本体は不変、テスト変更なし
- `segmentAudioArgs` の追加引数は optional。既存ケースのテストはそのまま通る

## 実装順（後続 plan のヒント）

1. `Segment` 型に optional フィールド追加 + `validateProject` 正規化（TDD）
2. `audioTrim.ts` 純関数（TDD）
3. `wav.ts` に `parseWavDuration` 追加（TDD）
4. `editorReducer` の `SET_SEGMENT_AUDIO_TRIM` action（TDD）
5. `ttsService.generateTts` で `clipFullDuration` 書き込み、再生成リセット（TDD）
6. `TtsPreviewController.load`/`play` に effective + sub-range（typecheck + 手動 E2E）
7. `ffargs.segmentAudioArgs` 拡張（TDD）
8. `exportService.runExport` で effective + sub-range（TDD）
9. i18n キー追加
10. Timeline.tsx にナレーション行 / TTS 行 / ハンドル / ドラッグ
11. EditorLayout で onTrimCommit + stopNonce 配線
12. typecheck・全テスト・ビルド・手動 E2E

## 関連スペック

- `docs/superpowers/specs/2026-05-27-clip2manual-phase4r2-timed-preview-design.md` — `TtsPreviewController` の経路
- `docs/superpowers/specs/2026-05-27-clip2manual-phase7a-export-design.md` — 書き出しパイプライン
- `docs/superpowers/specs/2026-05-29-clip2manual-subtitles-design.md` — `visibleDuration` 計算の共通化（effective duration を共有）
- `docs/superpowers/specs/2026-05-29-clip2manual-timeline-zoom-design.md` — タイムラインのスクロール/ズーム基盤
