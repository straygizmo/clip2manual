# 音声トリム機能 Implementation Plan (Phase B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TTS WAV の in/out オフセットを Segment に持たせ、タイムライン上のドラッグハンドルで編集することで preview/export/字幕の長さに反映する。

**Architecture:** 非破壊オフセット（audioStart/audioEnd を Segment に追加、WAV はそのまま）。`effectiveClipDuration` 純関数を全経路（preview スロット / export ffmpeg / 字幕 visibleDuration）で共通利用。TTS 生成時に `clipFullDuration` を WAV ヘッダから読み取って保存。Timeline に「ナレーション」「TTS」の 2 行を追加し、TTS ブロック両端の 6px ハンドルをドラッグ。

**Tech Stack:** TypeScript, Electron, React 18, Tailwind v4 + shadcn, Web Audio API, Vitest, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-05-29-clip2manual-audio-trim-design.md`

---

## File Structure

**Create:**
- `src/shared/audioTrim.ts` — `effectiveClipDuration` / `dragTrim` 純関数 + `MIN_TRIM_DURATION` 定数
- `test/audioTrim.test.ts`

**Modify:**
- `src/shared/types.ts` — `Segment` に `audioStart` / `audioEnd` / `clipFullDuration` を追加、`validateProject` 正規化
- `src/shared/wav.ts` — `parseWavDuration` 関数を追加
- `test/wav.test.ts` — `parseWavDuration` テスト追加
- `test/validateProject.test.ts` — 新 3 フィールドの正規化テスト
- `src/renderer/state/editorReducer.ts` — `SET_SEGMENT_AUDIO_TRIM` action
- `test/editorReducer.test.ts` — action テスト
- `src/main/voicevox/ttsService.ts` — 生成後 `parseWavDuration` で `clipFullDuration` を書き込み、`audioStart`/`audioEnd` を undefined にリセット
- `test/ttsService.test.ts` — `clipFullDuration` セット + 再生成リセットのテスト
- `src/renderer/audio/ttsPreview.ts` — `effectiveClipDuration` 経由でスロット長計算、`AudioBufferSourceNode.start(when, offset, duration)` で sub-range 再生、`stop()` 用 nonce 経路
- `src/main/export/ffargs.ts` — `segmentAudioArgs` に optional `audioStart` / `audioDuration` 追加
- `test/ffargs.test.ts` — `-ss`/`-t` あり/なし のテスト
- `src/main/export/exportService.ts` — `effectiveClipDuration` で clipDurations、`segmentAudioArgs` に in/duration を渡す
- `test/exportService.test.ts` — トリム済み segment テスト
- `src/shared/i18n/locales/ja.json` / `en.json` — `timeline.narration` / `timeline.tts` キー
- `src/renderer/editor/Timeline.tsx` — narration 行 + TTS 行 + ハンドル + ドラッグ
- `src/renderer/editor/EditorLayout.tsx` — `onTrimCommit` ハンドラ + `stopNonce` state（PreviewPlayer 停止リクエスト）
- `src/renderer/editor/PreviewPlayer.tsx` — `stopNonce` を prop 受け取り、`useEffect` で controller.stop()

---

## Task 1: Segment 型拡張 + validateProject 正規化

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `test/validateProject.test.ts`

- [ ] **Step 1: テストを追加**

`test/validateProject.test.ts` の末尾、`describe('validateProject', ...)` 内に追加:

```typescript
  it('normalizes per-segment audioStart/audioEnd/clipFullDuration to numbers or undefined', () => {
    const segs = [
      // 値あり
      { ...valid.segments[0] ?? makeSeg('seg-1'), audioStart: 0.5, audioEnd: 2.0, clipFullDuration: 3.0 },
      // 不正値（負数・0・文字列）
      { ...makeSeg('seg-2'), audioStart: -1, audioEnd: 0, clipFullDuration: 'x' as unknown as number },
      // 未定義
      makeSeg('seg-3'),
    ];
    const out = validateProject({ ...valid, segments: segs });
    expect(out.segments[0].audioStart).toBe(0.5);
    expect(out.segments[0].audioEnd).toBe(2.0);
    expect(out.segments[0].clipFullDuration).toBe(3.0);
    expect(out.segments[1].audioStart).toBeUndefined();
    expect(out.segments[1].audioEnd).toBeUndefined();
    expect(out.segments[1].clipFullDuration).toBeUndefined();
    expect(out.segments[2].audioStart).toBeUndefined();
    expect(out.segments[2].audioEnd).toBeUndefined();
    expect(out.segments[2].clipFullDuration).toBeUndefined();
  });
```

ファイル上部、`valid` 定義の下にヘルパを追加:

```typescript
function makeSeg(id: string) {
  return {
    id, videoStart: 0, videoEnd: 1, originalText: '', correctedText: '',
    ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}
```

- [ ] **Step 2: 実行して fail を確認**

```
npx vitest run test/validateProject.test.ts
```
Expected: 新規テストが fail（Segment 型に新フィールドがない、validateProject が segment レベルで正規化していない）。

- [ ] **Step 3: types.ts の Segment 拡張**

`src/shared/types.ts` の `Segment` インターフェースを以下に置き換える:

```typescript
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
  /** TTS WAV 上の再生開始オフセット（秒）。undefined = 0 と等価（未トリム）。 */
  audioStart?: number;
  /** TTS WAV 上の再生終了オフセット（秒）。undefined = clipFullDuration と等価（未トリム）。 */
  audioEnd?: number;
  /** TTS 生成時に保存した WAV の総再生秒。古いプロジェクトでは undefined。 */
  clipFullDuration?: number;
}
```

- [ ] **Step 4: validateProject に segment レベルの正規化を追加**

`src/shared/types.ts` の `validateProject` を以下に置き換える:

```typescript
export function validateProject(value: unknown): Project {
  if (typeof value !== 'object' || value === null) {
    throw new Error('project.json is not an object');
  }
  const p = value as Record<string, unknown>;
  if (p.version !== CURRENT_PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${String(p.version)}`);
  }
  if (typeof p.meta !== 'object' || p.meta === null) {
    throw new Error('project.json is missing "meta"');
  }
  if (typeof p.settings !== 'object' || p.settings === null) {
    throw new Error('project.json is missing "settings"');
  }
  if (!Array.isArray(p.segments)) {
    throw new Error('project.json "segments" must be an array');
  }
  const settings = p.settings as Record<string, unknown>;
  const normalizedSettings = {
    ...settings,
    showSubtitles: typeof settings.showSubtitles === 'boolean' ? settings.showSubtitles : true,
  };
  const normalizedSegments = (p.segments as unknown[]).map((seg) => {
    if (typeof seg !== 'object' || seg === null) return seg;
    const s = seg as Record<string, unknown>;
    return {
      ...s,
      audioStart: typeof s.audioStart === 'number' && s.audioStart >= 0 ? s.audioStart : undefined,
      audioEnd: typeof s.audioEnd === 'number' && s.audioEnd > 0 ? s.audioEnd : undefined,
      clipFullDuration: typeof s.clipFullDuration === 'number' && s.clipFullDuration > 0 ? s.clipFullDuration : undefined,
    };
  });
  return {
    ...(value as Project),
    settings: normalizedSettings as ProjectSettings,
    segments: normalizedSegments as Segment[],
  };
}
```

- [ ] **Step 5: pass 確認**

```
npx vitest run test/validateProject.test.ts
npm test
npm run typecheck
```
Expected: 全件パス。

- [ ] **Step 6: コミット**

```
git add src/shared/types.ts test/validateProject.test.ts
git commit -m "feat(types): add Segment.audioStart/audioEnd/clipFullDuration with normalization"
```

---

## Task 2: audioTrim.ts 純関数（TDD）

**Files:**
- Create: `src/shared/audioTrim.ts`
- Create: `test/audioTrim.test.ts`

- [ ] **Step 1: テストを書く**

`test/audioTrim.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { effectiveClipDuration, dragTrim, MIN_TRIM_DURATION } from '../src/shared/audioTrim';
import { type Segment } from '../src/shared/types';

function seg(over: Partial<Segment> = {}): Segment {
  return {
    id: 's', videoStart: 0, videoEnd: 1, originalText: '', correctedText: '',
    ttsAudio: 'tts/s.wav', voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
    ...over,
  };
}

describe('effectiveClipDuration', () => {
  it('returns full duration when trim is unset', () => {
    expect(effectiveClipDuration(seg(), 5)).toBe(5);
  });

  it('returns audioEnd - audioStart when both set', () => {
    expect(effectiveClipDuration(seg({ audioStart: 1, audioEnd: 4 }), 5)).toBe(3);
  });

  it('uses 0 when audioStart undefined and audioEnd set', () => {
    expect(effectiveClipDuration(seg({ audioEnd: 4 }), 5)).toBe(4);
  });

  it('uses full when audioStart set and audioEnd undefined', () => {
    expect(effectiveClipDuration(seg({ audioStart: 1 }), 5)).toBe(4);
  });

  it('clamps audioStart < 0 to 0', () => {
    expect(effectiveClipDuration(seg({ audioStart: -1, audioEnd: 4 }), 5)).toBe(4);
  });

  it('clamps audioEnd > full to full', () => {
    expect(effectiveClipDuration(seg({ audioStart: 1, audioEnd: 10 }), 5)).toBe(4);
  });

  it('returns 0 when audioStart >= audioEnd', () => {
    expect(effectiveClipDuration(seg({ audioStart: 4, audioEnd: 3 }), 5)).toBe(0);
    expect(effectiveClipDuration(seg({ audioStart: 3, audioEnd: 3 }), 5)).toBe(0);
  });
});

describe('dragTrim', () => {
  const base = { pxPerSec: 100, currentStart: 1, currentEnd: 4, fullClipDuration: 5 };

  it('left drag right shrinks audioStart toward audioEnd', () => {
    const r = dragTrim({ side: 'left', dxPx: 50, ...base });
    expect(r.audioStart).toBeCloseTo(1.5);
    expect(r.audioEnd).toBe(4);
  });

  it('left drag left expands audioStart back to 0', () => {
    const r = dragTrim({ side: 'left', dxPx: -200, ...base });
    expect(r.audioStart).toBe(0);
    expect(r.audioEnd).toBe(4);
  });

  it('left drag is clamped by audioEnd - minDuration', () => {
    const r = dragTrim({ side: 'left', dxPx: 1000, ...base });
    expect(r.audioStart).toBeCloseTo(4 - MIN_TRIM_DURATION);
  });

  it('right drag right expands audioEnd toward fullClipDuration', () => {
    const r = dragTrim({ side: 'right', dxPx: 50, ...base });
    expect(r.audioStart).toBe(1);
    expect(r.audioEnd).toBeCloseTo(4.5);
  });

  it('right drag is clamped by fullClipDuration', () => {
    const r = dragTrim({ side: 'right', dxPx: 1000, ...base });
    expect(r.audioEnd).toBe(5);
  });

  it('right drag is clamped by audioStart + minDuration', () => {
    const r = dragTrim({ side: 'right', dxPx: -1000, ...base });
    expect(r.audioEnd).toBeCloseTo(1 + MIN_TRIM_DURATION);
  });

  it('honours custom minDuration', () => {
    const r = dragTrim({ side: 'right', dxPx: -1000, ...base, minDuration: 0.5 });
    expect(r.audioEnd).toBeCloseTo(1.5);
  });
});
```

- [ ] **Step 2: fail を確認**

```
npx vitest run test/audioTrim.test.ts
```
Expected: モジュール未存在で fail。

- [ ] **Step 3: 実装**

`src/shared/audioTrim.ts`:

```typescript
import { type Segment } from './types';

export const MIN_TRIM_DURATION = 0.05;

/**
 * セグメントの実効再生長（秒）。
 * audioStart/audioEnd が未設定なら WAV 全長と等価。
 * 不正値（負数、全長超過、in >= out）は安全に clamp/0。
 */
export function effectiveClipDuration(
  segment: Segment, fullClipDuration: number,
): number {
  const s = Math.max(0, segment.audioStart ?? 0);
  const e = Math.min(fullClipDuration, segment.audioEnd ?? fullClipDuration);
  return Math.max(0, e - s);
}

/**
 * トリムハンドルのドラッグ。dxPx を秒換算して clamp し、新 audioStart/audioEnd を返す。
 * 左ハンドル: audioEnd は不変、audioStart を `[0, audioEnd - minDuration]` で clamp。
 * 右ハンドル: audioStart は不変、audioEnd を `[audioStart + minDuration, fullClipDuration]` で clamp。
 */
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

- [ ] **Step 4: pass 確認**

```
npx vitest run test/audioTrim.test.ts
npm run typecheck
```
Expected: 全件パス。

- [ ] **Step 5: コミット**

```
git add src/shared/audioTrim.ts test/audioTrim.test.ts
git commit -m "feat(audio): add effectiveClipDuration and dragTrim pure helpers"
```

---

## Task 3: wav.ts に parseWavDuration を追加（TDD）

**Files:**
- Modify: `src/shared/wav.ts`
- Modify: `test/wav.test.ts`

- [ ] **Step 1: テスト追加**

`test/wav.test.ts` の import と末尾 describe を追加:

```typescript
import { encodeWav, parseWavDuration } from '../src/shared/wav';
```

末尾に:

```typescript
describe('parseWavDuration', () => {
  it('returns 0 for a buffer too small to be a WAV', () => {
    expect(parseWavDuration(Buffer.alloc(10))).toBe(0);
  });

  it('returns 0 when RIFF/WAVE tag is missing', () => {
    const fake = Buffer.alloc(64);
    expect(parseWavDuration(fake)).toBe(0);
  });

  it('returns dataSize / (sampleRate * channels * bytesPerSample) for canonical PCM', () => {
    // encodeWav が出すのは mono / 16-bit。1 秒分の WAV (16000 Hz × 1ch × 2 bytes = 32000 bytes data) なら 1 秒
    const samples = new Float32Array(16000);
    const arr = encodeWav(samples, 16000);
    expect(parseWavDuration(Buffer.from(arr))).toBeCloseTo(1.0, 5);
  });

  it('returns a partial second correctly', () => {
    const samples = new Float32Array(8000); // 0.5 秒
    const arr = encodeWav(samples, 16000);
    expect(parseWavDuration(Buffer.from(arr))).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: fail を確認**

```
npx vitest run test/wav.test.ts
```
Expected: `parseWavDuration is not a function` で fail。

- [ ] **Step 3: 実装**

`src/shared/wav.ts` の末尾に追加:

```typescript
function readTag(buf: Buffer, offset: number): string {
  if (offset + 4 > buf.length) return '';
  return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}

/**
 * RIFF/WAVE の総再生秒数を返す。canonical PCM（fmt/data チャンクが直線的に配置）を想定。
 * ヘッダが壊れている、または data チャンクが見つからない場合は 0。
 */
export function parseWavDuration(buf: Buffer): number {
  if (buf.length < 44) return 0;
  if (readTag(buf, 0) !== 'RIFF' || readTag(buf, 8) !== 'WAVE') return 0;
  // fmt チャンクは 12 から
  if (readTag(buf, 12) !== 'fmt ') return 0;
  const fmtSize = buf.readUInt32LE(16);
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  if (numChannels <= 0 || sampleRate <= 0 || bitsPerSample <= 0) return 0;
  // fmt の次から data チャンクを探す
  let off = 20 + fmtSize;
  while (off + 8 <= buf.length) {
    const tag = readTag(buf, off);
    const chunkSize = buf.readUInt32LE(off + 4);
    if (tag === 'data') {
      const bytesPerSample = bitsPerSample / 8;
      const denom = sampleRate * numChannels * bytesPerSample;
      if (denom <= 0) return 0;
      return chunkSize / denom;
    }
    off += 8 + chunkSize;
  }
  return 0;
}
```

- [ ] **Step 4: pass 確認**

```
npx vitest run test/wav.test.ts
npm run typecheck
```
Expected: 全件パス。

- [ ] **Step 5: コミット**

```
git add src/shared/wav.ts test/wav.test.ts
git commit -m "feat(wav): add parseWavDuration for RIFF/PCM"
```

---

## Task 4: editorReducer に SET_SEGMENT_AUDIO_TRIM を追加

**Files:**
- Modify: `src/renderer/state/editorReducer.ts`
- Modify: `test/editorReducer.test.ts`

- [ ] **Step 1: テスト追加**

`test/editorReducer.test.ts` の末尾 `describe('editorReducer', ...)` 内に追加:

```typescript
  it('SET_SEGMENT_AUDIO_TRIM updates audioStart/audioEnd on the matching segment', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [
      seg,
      { ...seg, id: 'seg-002' },
    ] });
    s = editorReducer(s, { type: 'SET_SEGMENT_AUDIO_TRIM', id: 'seg-002', audioStart: 0.3, audioEnd: 1.7 });
    expect(s.project!.segments[0].audioStart).toBeUndefined();
    expect(s.project!.segments[1].audioStart).toBe(0.3);
    expect(s.project!.segments[1].audioEnd).toBe(1.7);
  });

  it('SET_SEGMENT_AUDIO_TRIM is a no-op when project is null', () => {
    const s = editorReducer(initialEditorState, { type: 'SET_SEGMENT_AUDIO_TRIM', id: 'x', audioStart: 0, audioEnd: 1 });
    expect(s.project).toBeNull();
  });
```

- [ ] **Step 2: fail 確認**

```
npx vitest run test/editorReducer.test.ts
```
Expected: 型エラーで fail。

- [ ] **Step 3: editorReducer 拡張**

`src/renderer/state/editorReducer.ts` の `EditorAction` ユニオン末尾（`SET_SETTINGS` の後）に追加:

```typescript
  | { type: 'SET_SEGMENT_AUDIO_TRIM'; id: string; audioStart: number; audioEnd: number };
```

`switch` ケースを `SET_SEGMENTS` の後ろに追加:

```typescript
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

- [ ] **Step 4: pass 確認**

```
npx vitest run test/editorReducer.test.ts
npm test
npm run typecheck
```
Expected: 全件パス。

- [ ] **Step 5: コミット**

```
git add src/renderer/state/editorReducer.ts test/editorReducer.test.ts
git commit -m "feat(reducer): add SET_SEGMENT_AUDIO_TRIM action for in/out offsets"
```

---

## Task 5: ttsService で clipFullDuration を保存し再生成リセット

**Files:**
- Modify: `src/main/voicevox/ttsService.ts`
- Modify: `test/ttsService.test.ts`

- [ ] **Step 1: テスト追加**

`test/ttsService.test.ts` の末尾 `describe('generateTts', ...)` 内に追加:

```typescript
  it('sets clipFullDuration from the WAV header and resets audioStart/audioEnd on (re)generation', async () => {
    // encodeWav から本物のヘッダ付き WAV バイト列を作る（1 秒 = 16000 サンプル）
    const { encodeWav } = await import('../src/shared/wav');
    const wav = Buffer.from(encodeWav(new Float32Array(16000), 16000));
    const client: TtsClient = { synthesize: async () => wav };

    const input: Segment[] = [
      { ...seg('seg-001', 'hello'), audioStart: 999, audioEnd: 999, clipFullDuration: 999 }, // 前回値をリセットすべき
    ];
    const out = await generateTts({ engine, client, outDir: dir, segments: input });
    expect(out[0].clipFullDuration).toBeCloseTo(1.0, 5);
    expect(out[0].audioStart).toBeUndefined();
    expect(out[0].audioEnd).toBeUndefined();
  });
```

- [ ] **Step 2: fail 確認**

```
npx vitest run test/ttsService.test.ts
```
Expected: 新規テストが fail（clipFullDuration が未設定、トリムリセットなし）。

- [ ] **Step 3: ttsService.ts を更新**

`src/main/voicevox/ttsService.ts` の `import` 行に追加:

```typescript
import { parseWavDuration } from '../../shared/wav';
```

ループ内の Segment 更新行を以下に置き換える:

```typescript
    const wav = await opts.client.synthesize(baseUrl, {
      text: s.correctedText,
      speaker: s.voice.speaker,
      speed: s.voice.speed,
    });
    const rel = `tts/${s.id}.wav`;
    await fs.writeFile(path.join(opts.outDir, rel), wav);
    const fullDur = parseWavDuration(wav);
    const idx = updated.findIndex((u) => u.id === s.id);
    updated[idx] = {
      ...updated[idx],
      ttsAudio: rel,
      clipFullDuration: fullDur > 0 ? fullDur : undefined,
      audioStart: undefined,
      audioEnd: undefined,
    };
```

- [ ] **Step 4: pass 確認**

```
npx vitest run test/ttsService.test.ts
npm test
npm run typecheck
```
Expected: 全件パス。

- [ ] **Step 5: コミット**

```
git add src/main/voicevox/ttsService.ts test/ttsService.test.ts
git commit -m "feat(tts): store clipFullDuration and reset trim on (re)generation"
```

---

## Task 6: ffargs.segmentAudioArgs に audioStart/audioDuration を追加（TDD）

**Files:**
- Modify: `src/main/export/ffargs.ts`
- Modify: `test/ffargs.test.ts`

- [ ] **Step 1: テスト追加**

`test/ffargs.test.ts` の末尾に追加:

```typescript
describe('segmentAudioArgs with trim', () => {
  it('omits -ss and -t when both are undefined', () => {
    const args = segmentAudioArgs({ clipPath: 'a.wav', slotDuration: 5, outPath: 'out.wav' });
    expect(args).not.toContain('-ss');
    // -t の出現は slotDuration の 1 回のみ
    expect(args.filter((a) => a === '-t')).toHaveLength(1);
  });

  it('adds -ss before -i when audioStart is set', () => {
    const args = segmentAudioArgs({
      clipPath: 'a.wav', slotDuration: 5, outPath: 'out.wav',
      audioStart: 0.4,
    });
    const ssIdx = args.indexOf('-ss');
    const iIdx = args.indexOf('-i');
    expect(ssIdx).toBeGreaterThanOrEqual(0);
    expect(ssIdx).toBeLessThan(iIdx);
    expect(args[ssIdx + 1]).toBe('0.4');
  });

  it('adds -t for audioDuration before -i (input limit) in addition to the slotDuration -t after', () => {
    const args = segmentAudioArgs({
      clipPath: 'a.wav', slotDuration: 5, outPath: 'out.wav',
      audioDuration: 2.5,
    });
    const tIdxs = args.map((a, i) => (a === '-t' ? i : -1)).filter((i) => i >= 0);
    expect(tIdxs.length).toBe(2);
    expect(args[tIdxs[0] + 1]).toBe('2.5'); // input limit
    expect(args[tIdxs[1] + 1]).toBe('5');   // slot duration (apad target)
  });

  it('combines audioStart and audioDuration both before -i', () => {
    const args = segmentAudioArgs({
      clipPath: 'a.wav', slotDuration: 5, outPath: 'out.wav',
      audioStart: 0.4, audioDuration: 2.5,
    });
    const iIdx = args.indexOf('-i');
    expect(args.slice(0, iIdx)).toContain('-ss');
    expect(args.slice(0, iIdx).filter((a) => a === '-t').length).toBe(1);
  });
});
```

- [ ] **Step 2: fail 確認**

```
npx vitest run test/ffargs.test.ts
```
Expected: 新規テストが fail。

- [ ] **Step 3: segmentAudioArgs を更新**

`src/main/export/ffargs.ts` の `segmentAudioArgs` を以下に置き換える:

```typescript
/** スロットの音声 = TTSクリップ→無音 pad で slotDuration、無ければ slotDuration の無音。均一PCM。
 *  audioStart / audioDuration を渡すと TTS の sub-range だけを入力にする（-ss / -t を -i の前）。 */
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
    const inT = (audioDuration !== undefined) ? ['-t', String(audioDuration)] : [];
    return [
      '-y',
      ...ss, ...inT,
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

- [ ] **Step 4: pass 確認**

```
npx vitest run test/ffargs.test.ts
npm test
npm run typecheck
```
Expected: 全件パス。

- [ ] **Step 5: コミット**

```
git add src/main/export/ffargs.ts test/ffargs.test.ts
git commit -m "feat(export): extend segmentAudioArgs with optional audioStart/audioDuration"
```

---

## Task 7: exportService.runExport に effective duration と sub-range 渡し

**Files:**
- Modify: `src/main/export/exportService.ts`
- Modify: `test/exportService.test.ts`

- [ ] **Step 1: テスト追加**

`test/exportService.test.ts` の末尾 `describe('runExport', ...)` 内に追加:

```typescript
  it('passes audioStart/audioDuration to ffmpeg when segment is trimmed', async () => {
    const ffmpegCalls: string[][] = [];
    await runExport({
      segments: [{
        ...seg('seg-001', 1, 3, 'tts/seg-001.wav'),
        clipFullDuration: 2.0, audioStart: 0.2, audioEnd: 1.5,
      }],
      projectDir, outPath: path.join(projectDir, 'out.mp4'), tmpDir,
      credit: 'VOICEVOX', showSubtitles: false,
      runFfmpeg: async (args) => { ffmpegCalls.push(args); },
      runProbe: async (args) => {
        const s = args.join(' ');
        if (s.includes('r_frame_rate')) return '30/1';
        if (s.includes('width,height')) return '1920,1080';
        return '2.0';
      },
    });
    const audioCall = ffmpegCalls.find((a) => a.some((x) => x.endsWith('.wav') && x.includes('seg-001')))!;
    const ss = audioCall.indexOf('-ss');
    expect(ss).toBeGreaterThanOrEqual(0);
    expect(audioCall[ss + 1]).toBe('0.2');
    // 第 1 の -t は audioDuration = audioEnd - audioStart = 1.3
    const firstT = audioCall.indexOf('-t');
    expect(audioCall[firstT + 1]).toBe('1.3');
  });

  it('omits -ss/-t for input when segment has no trim', async () => {
    const ffmpegCalls: string[][] = [];
    await runExport({
      segments: [seg('seg-001', 1, 3, 'tts/seg-001.wav')],
      projectDir, outPath: path.join(projectDir, 'out.mp4'), tmpDir,
      credit: 'VOICEVOX', showSubtitles: false,
      runFfmpeg: async (args) => { ffmpegCalls.push(args); },
      runProbe: async (args) => {
        const s = args.join(' ');
        if (s.includes('r_frame_rate')) return '30/1';
        if (s.includes('width,height')) return '1920,1080';
        return '2.0';
      },
    });
    const audioCall = ffmpegCalls.find((a) => a.some((x) => x.endsWith('.wav') && x.includes('seg-001')))!;
    const iIdx = audioCall.indexOf('-i');
    expect(audioCall.slice(0, iIdx)).not.toContain('-ss');
    // -t は output (slotDuration) の 1 個のみ
    expect(audioCall.filter((a) => a === '-t')).toHaveLength(1);
  });
```

- [ ] **Step 2: fail 確認**

```
npx vitest run test/exportService.test.ts
```
Expected: 新規テストが fail。

- [ ] **Step 3: exportService.ts を更新**

`src/main/export/exportService.ts` の import に追加:

```typescript
import { effectiveClipDuration } from '../../shared/audioTrim';
```

`clipDurations` 構築ループを以下に置き換える:

```typescript
  const clipDurations = new Map<string, number>();
  for (const s of opts.segments) {
    if (!s.ttsAudio) continue;
    const full = parseProbeDuration(await opts.runProbe(probeDurationArgs(path.join(opts.projectDir, s.ttsAudio))));
    clipDurations.set(s.id, effectiveClipDuration(s, full));
  }
```

`segmentAudioArgs(...)` 呼出しを以下に置き換える:

```typescript
    const seg = opts.segments.find((s) => s.id === slot.segmentId);
    const aStart = seg?.audioStart ?? 0;
    const aDur = slot.clipDuration;
    await opts.runFfmpeg(segmentAudioArgs({
      clipPath, slotDuration: slot.slotDuration, outPath: aOut,
      audioStart: aStart > 0 ? aStart : undefined,
      audioDuration: aDur > 0 ? aDur : undefined,
    }));
```

注: 既存のループ内に `const segment = opts.segments.find((s) => s.id === slot.segmentId);` が既にある（subtitle 経路で導入済）。重複定義しないよう、既存の `segment` を使い回す形で `aStart` / `aDur` を導入してよい。

- [ ] **Step 4: pass 確認**

```
npx vitest run test/exportService.test.ts
npm test
npm run typecheck
```
Expected: 全件パス。

- [ ] **Step 5: コミット**

```
git add src/main/export/exportService.ts test/exportService.test.ts
git commit -m "feat(export): apply effectiveClipDuration and pass sub-range to ffmpeg"
```

---

## Task 8: TtsPreviewController に effective + sub-range + stop 経路

**Files:**
- Modify: `src/renderer/audio/ttsPreview.ts`

> このファイルは Web Audio/DOM 依存のため単体テストなし。typecheck + 手動 E2E で検証。

- [ ] **Step 1: import を更新**

`src/renderer/audio/ttsPreview.ts` 上部の import を以下に置き換える:

```typescript
import { type Segment } from '../../shared/types';
import { computePreviewTimeline, type PreviewSlot } from '../../shared/previewTimeline';
import { effectiveClipDuration } from '../../shared/audioTrim';
```

- [ ] **Step 2: segments の保持を追加**

クラスのフィールド宣言群（`buffers`, `slots`, ... の付近）に追加:

```typescript
  private segments: Segment[] = [];
```

- [ ] **Step 3: load() で segments を保持し、effective duration を使う**

`load()` の本体を以下に置き換える:

```typescript
  async load(segments: Segment[], projectDir: string): Promise<void> {
    this.stop();
    const ctx = this.ensureCtx();
    this.buffers.clear();
    this.segments = segments;
    const durations = new Map<string, number>();
    for (const seg of segments) {
      if (!seg.ttsAudio) continue;
      try {
        const url = `c2m://asset/${seg.ttsAudio}?p=${encodeURIComponent(projectDir)}`;
        const res = await fetch(url);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(seg.id, buf);
        const full = seg.clipFullDuration ?? buf.duration;
        durations.set(seg.id, effectiveClipDuration(seg, full));
      } catch {
        // デコード失敗は無音区間として扱う（clipDuration=0）
      }
    }
    this.slots = computePreviewTimeline(segments, durations);
    this.positionTime = 0;
  }
```

- [ ] **Step 4: play() で sub-range をスケジュールする**

`play()` 内、`for (const slot of this.slots) { ... }` ブロックを以下に置き換える:

```typescript
    for (const slot of this.slots) {
      const buf = this.buffers.get(slot.segmentId);
      const seg = this.segments.find((s) => s.id === slot.segmentId);
      if (!buf || !seg) continue;
      const aStart = seg.audioStart ?? 0;
      const effective = slot.clipDuration;
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
    }
```

- [ ] **Step 5: typecheck + 全テスト**

```
npm run typecheck
npm test
```
Expected: 全件パス。

- [ ] **Step 6: コミット**

```
git add src/renderer/audio/ttsPreview.ts
git commit -m "feat(tts-preview): respect effectiveClipDuration and play WAV sub-range"
```

---

## Task 9: i18n キー追加（timeline.narration / timeline.tts）

**Files:**
- Modify: `src/shared/i18n/locales/ja.json`
- Modify: `src/shared/i18n/locales/en.json`

- [ ] **Step 1: ja.json に追加**

`src/shared/i18n/locales/ja.json` の `timeline` オブジェクト末尾（`"time"` の後）にカンマ + 2 キー:

```json
  "timeline": {
    "video": "映像",
    "segment": "セグメント",
    "click": "クリック",
    "splitOnDoubleClick": "ダブルクリックで分割",
    "time": "時刻",
    "narration": "ナレーション",
    "tts": "TTS"
  },
```

- [ ] **Step 2: en.json に追加**

```json
  "timeline": {
    "video": "Video",
    "segment": "Segment",
    "click": "Click",
    "splitOnDoubleClick": "Double-click to split",
    "time": "Time",
    "narration": "Narration",
    "tts": "TTS"
  },
```

- [ ] **Step 3: localeKeys テスト + 全テスト確認**

```
npx vitest run test/localeKeys.test.ts
npm test
```
Expected: 全件パス。

- [ ] **Step 4: コミット**

```
git add src/shared/i18n/locales/ja.json src/shared/i18n/locales/en.json
git commit -m "feat(i18n): add timeline.narration and timeline.tts keys"
```

---

## Task 10: PreviewPlayer に stopNonce prop を追加

このタスクでは PreviewPlayer に外部から「停止して」と通知できる薄い経路を加える。Timeline からドラッグ開始時に呼ぶ。

**Files:**
- Modify: `src/renderer/editor/PreviewPlayer.tsx`

- [ ] **Step 1: Props 拡張**

`PreviewPlayer.tsx` の `interface Props` に追加:

```typescript
  /** 値が変わるたびに再生を停止するリクエスト。Timeline のドラッグ開始等で利用。 */
  stopNonce?: number;
```

- [ ] **Step 2: 分割代入に追加**

```typescript
export function PreviewPlayer({
  videoRef, audioRef, videoUrl, audioUrl, segments, projectDir, onTime, onDuration, onActiveSegment,
  exportRunning, exportPercent, onExport, onCancelExport, requestedMode,
  subtitleText, onSlotProgress, onPlayingChange, stopNonce,
}: Props) {
```

- [ ] **Step 3: useEffect で stop を発火**

既存 `useEffect(() => { if (!requestedMode) return; ... }, [requestedMode]);` の隣に追加:

```typescript
  useEffect(() => {
    if (stopNonce === undefined) return;
    // 元音声モードでもTTSモードでも、ともかく停止する
    controllerRef.current?.stop();
    videoRef.current?.pause();
    audioRef.current?.pause();
  }, [stopNonce]);
```

`useEffect` は既に React から import されているので追加 import は不要。

- [ ] **Step 4: typecheck + テスト**

```
npm run typecheck
npm test
```
Expected: 全件パス（Timeline からの prop 渡しはまだないので EditorLayout 側で型エラーは出ない — stopNonce は optional）。

- [ ] **Step 5: コミット**

```
git add src/renderer/editor/PreviewPlayer.tsx
git commit -m "feat(preview): add stopNonce prop to externally request a stop"
```

---

## Task 11: Timeline にナレーション行 / TTS 行 / ドラッグハンドルを追加

このタスクは Timeline.tsx の大改修。`pxPerSec`, `scrollRef` 等の既存基盤はそのまま流用。

**Files:**
- Modify: `src/renderer/editor/Timeline.tsx`

- [ ] **Step 1: import を拡張**

```typescript
import { type Segment } from '../../shared/types';
import {
  segmentBox, timeToPx, pxToTime,
  pickMajorInterval, formatTimeLabel,
  clampZoom, applyZoomAtPoint,
  shouldAutoScroll,
} from './timelineGeometry';
import { effectiveClipDuration, dragTrim } from '../../shared/audioTrim';
import { cn } from '@/lib/utils';
```

- [ ] **Step 2: Props 拡張**

`interface Props` に追加:

```typescript
  onTrimChange?: (id: string, audioStart: number, audioEnd: number) => void;
  onTrimDragStart?: () => void;
```

`function Timeline({ ... }: Props)` の分割代入に追加: `onTrimChange, onTrimDragStart`。

- [ ] **Step 3: ドラッグ中の preview state を追加**

`Timeline` 関数内、`useLayoutEffect` の後あたりに追加:

```typescript
  const [dragPreview, setDragPreview] = useState<{ id: string; audioStart: number; audioEnd: number } | null>(null);
```

- [ ] **Step 4: ナレーション行と TTS 行をレンダ**

JSX 内、既存のセグメント行 contentRow の後に追加（時刻 / 映像 / セグメント / **ナレーション** / **TTS** / クリック の順になるように）:

```tsx
            {/* ナレーション行 */}
            {contentRow(segments.map((s) => {
              const b = segmentBox(s.videoStart, s.videoEnd, pxPerSec);
              return (
                <div
                  key={s.id}
                  className={cn(
                    'absolute box-border rounded-sm',
                    s.enabled === false && 'opacity-35',
                  )}
                  style={{
                    top: 3, height: ROW_H - 6,
                    left: b.left, width: b.width,
                    background: 'hsl(var(--muted) / 0.6)',
                  }}
                />
              );
            }))}

            {/* TTS 行 */}
            {contentRow(segments.map((s) => {
              if (!s.ttsAudio || s.clipFullDuration === undefined) return null;
              const draft = dragPreview?.id === s.id ? dragPreview : null;
              const aStart = draft?.audioStart ?? s.audioStart ?? 0;
              const aEnd = draft?.audioEnd ?? s.audioEnd ?? s.clipFullDuration;
              const effective = Math.max(0, aEnd - aStart);
              if (effective <= 0) return null;
              const videoSpan = Math.max(0, s.videoEnd - s.videoStart);
              const left = timeToPx(s.videoStart, pxPerSec);
              const totalW = effective * pxPerSec;
              const fitW = Math.min(effective, videoSpan) * pxPerSec;
              const overflowW = Math.max(0, totalW - fitW);
              const startHandle = (side: 'left' | 'right') => (e: React.MouseEvent) => {
                e.stopPropagation();
                if (s.clipFullDuration === undefined) return;
                onTrimDragStart?.();
                const startX = e.clientX;
                const initStart = aStart;
                const initEnd = aEnd;
                const full = s.clipFullDuration;
                let last = { audioStart: initStart, audioEnd: initEnd };
                const onMove = (ev: MouseEvent) => {
                  last = dragTrim({
                    side, dxPx: ev.clientX - startX, pxPerSec,
                    currentStart: initStart, currentEnd: initEnd, fullClipDuration: full,
                  });
                  setDragPreview({ id: s.id, ...last });
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                  setDragPreview(null);
                  onTrimChange?.(s.id, last.audioStart, last.audioEnd);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              };
              return (
                <div
                  key={s.id}
                  className={cn(
                    'absolute box-border rounded-sm',
                    s.enabled === false && 'opacity-35',
                  )}
                  style={{ top: 3, height: ROW_H - 6, left, width: totalW }}
                >
                  <div className="absolute top-0 bottom-0 left-0" style={{ width: fitW, background: 'hsl(160 60% 35%)' }} />
                  {overflowW > 0 && (
                    <div className="absolute top-0 bottom-0" style={{ left: fitW, width: overflowW, background: 'hsl(20 90% 50%)' }} />
                  )}
                  <div
                    className="absolute top-0 bottom-0 cursor-ew-resize"
                    style={{ left: 0, width: 6, background: 'hsl(var(--foreground) / 0.5)' }}
                    onMouseDown={startHandle('left')}
                  />
                  <div
                    className="absolute top-0 bottom-0 cursor-ew-resize"
                    style={{ right: 0, width: 6, background: 'hsl(var(--foreground) / 0.5)' }}
                    onMouseDown={startHandle('right')}
                  />
                </div>
              );
            }))}
```

- [ ] **Step 5: ラベル列にも 2 行追加**

JSX 内、左ラベル列のセル群を以下に置き換える（順序を新行に合わせる）:

```tsx
        <div>
          {labelCell(t('timeline.time'))}
          {labelCell(t('timeline.video'))}
          {labelCell(t('timeline.segment'))}
          {labelCell(t('timeline.narration'))}
          {labelCell(t('timeline.tts'))}
          {labelCell(t('timeline.click'))}
        </div>
```

- [ ] **Step 6: typecheck**

```
npm run typecheck
npm test
```
Expected: typecheck クリーン、全テスト 233+ パス。EditorLayout から `onTrimChange` / `onTrimDragStart` を渡していないので prop は optional のまま動く。

- [ ] **Step 7: コミット**

```
git add src/renderer/editor/Timeline.tsx
git commit -m "feat(timeline): add narration/TTS rows with trim handles for audio in/out"
```

---

## Task 12: EditorLayout で onTrimCommit / stopNonce を配線

**Files:**
- Modify: `src/renderer/editor/EditorLayout.tsx`

- [ ] **Step 1: state + ハンドラを追加**

`EditorLayout` 関数内、既存 state 宣言群（`playing`, `slotHint` 付近）に追加:

```typescript
  const [stopNonce, setStopNonce] = useState(0);

  const onTrimChange = useCallback((id: string, audioStart: number, audioEnd: number) => {
    dispatch({ type: 'SET_SEGMENT_AUDIO_TRIM', id, audioStart, audioEnd });
    const updated = segments.map((s) =>
      s.id === id ? { ...s, audioStart, audioEnd } : s,
    );
    void window.api.updateSegments(updated);
  }, [dispatch, segments]);

  const onTrimDragStart = useCallback(() => {
    setStopNonce((n) => n + 1);
  }, []);
```

`segments` は既に `const segments = project.segments;` から定義済み。`useCallback`/`useState` は既存の import に含まれているか確認、なければ追加。

- [ ] **Step 2: PreviewPlayer に stopNonce を渡す**

`<PreviewPlayer ...>` の props に追加:

```tsx
          stopNonce={stopNonce}
```

- [ ] **Step 3: Timeline に新 prop を渡す**

`<Timeline ...>` の props に追加:

```tsx
        onTrimChange={onTrimChange}
        onTrimDragStart={onTrimDragStart}
```

- [ ] **Step 4: typecheck + 全テスト**

```
npm run typecheck
npm test
```
Expected: 全件パス。

- [ ] **Step 5: コミット**

```
git add src/renderer/editor/EditorLayout.tsx
git commit -m "feat(editor): wire trim commits and drag-start stop nonce"
```

---

## Task 13: 全体検証 + 完了サマリ

**Files:** plan ドキュメントへの追記のみ

- [ ] **Step 1: typecheck**

```
npm run typecheck
```
Expected: クリーン

- [ ] **Step 2: 全テスト**

```
npm test
```
Expected: 既存 233 + 新規（audioTrim 14 + wav 4 + validateProject 1 + editorReducer 2 + ttsService 1 + ffargs 4 + exportService 2）= 約 261 件パス。実際の合計件数を記録する。

- [ ] **Step 3: build**

```
npm run build
```
Expected: クリーン

- [ ] **Step 4: 完了サマリを plan に追記**

このファイル末尾に「## 実装完了サマリ (2026-05-29)」を追加し、各タスクのコミットハッシュ・テスト件数・build 成否を箇条書きで記録する。

- [ ] **Step 5: コミット**

```
git add docs/superpowers/plans/2026-05-29-audio-trim.md
git commit -m "docs: record audio trim Phase B implementation summary"
```

---

## Task 14: 手動 E2E（実機 Windows）

**Files:** なし（手動検証）

- [ ] **Step 1: 起動**

```
npm run dev
```

- [ ] **Step 2: チェックリスト**

- [ ] プロジェクトを開く（過去のプロジェクトでもOK） → タイムラインに「ナレーション」「TTS」行が追加されている
- [ ] 古いプロジェクト（TTS あり、`clipFullDuration` なし）: TTS 行に何も出ない（ハンドル無し）。再生は従来どおり動く
- [ ] TTS を生成 → 各セグメントの clipFullDuration が設定され、TTS 行にブロックが出る
- [ ] TTS が映像区間に収まる場合: 緑のみ
- [ ] TTS が映像区間より長い場合: 緑 + オレンジ（はみ出し）
- [ ] TTS ブロック右端ハンドルをドラッグ → 短くなる、緑/オレンジ比率が動く
- [ ] TTS ブロック左端ハンドルをドラッグ → 先頭の無音をカット
- [ ] ドラッグ中はプレビュー再生が止まる
- [ ] ドラッグ確定後、TTS プレビュー再生 → トリムが反映され、フリーズが減る
- [ ] 書き出し → MP4 でフリーズが減っている、字幕タイミングも合っている
- [ ] TTS を同セグメントだけ再生成 → トリムがリセットされる（TTS 行が再び全長で出る）
- [ ] enabled=false のセグメント: TTS/ナレーション行が薄く出る、ハンドル無効
- [ ] ズーム最大時/最小時にハンドルが掴める

- [ ] **Step 3: 不具合を fix コミット**

- [ ] **Step 4: master push（ユーザー判断）**

---

## 実装順サマリ

1. types + validateProject — Segment 新フィールド
2. audioTrim.ts — 純関数
3. wav.ts — parseWavDuration
4. editorReducer — SET_SEGMENT_AUDIO_TRIM
5. ttsService — clipFullDuration セット + trim リセット
6. ffargs — segmentAudioArgs sub-range
7. exportService — effective + sub-range 配線
8. ttsPreview — effective + sub-range スケジュール
9. i18n — narration / tts キー
10. PreviewPlayer — stopNonce prop
11. Timeline — narration/TTS 行 + ハンドル
12. EditorLayout — onTrimChange + stopNonce 配線
13. 全体検証
14. 手動 E2E
