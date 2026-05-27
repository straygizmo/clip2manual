# タイミング調整付きTTSプレビュー（フェーズ4ラウンド2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 中央プレビューで「映像を音声に合わせる」を再現し、各セグメントの TTS 音声に映像を同期（区間再生→末尾フリーズ/小休止）させて通し再生できるようにする（元音声↔TTSトグル付き）。

**Architecture:** 純関数 `computePreviewTimeline` がセグメント＋クリップ長から「スロット」列を作る（フェーズ7書き出しでも再利用）。`TtsPreviewController` が TTS を Web Audio でスケジュール（音声=master clock）し、rAF で映像要素を駆動（区間ネイティブ再生→区間外フリーズ）。PreviewPlayer に元音声↔TTSトグルを追加し、再生中セグメントを Timeline でハイライト。

**Tech Stack:** Electron + TypeScript + React、Web Audio API（`AudioContext`/`decodeAudioData`）、Vitest（test/・node環境・`.test.ts`）。

spec: `docs/superpowers/specs/2026-05-27-clip2manual-phase4r2-timed-preview-design.md`

---

## File Structure

- `src/renderer/editor/previewTimeline.ts` — **Create**: 純関数 `computePreviewTimeline` / `previewTotalDuration` / `PreviewSlot` / `TAIL_PAUSE`（唯一の単体テスト対象）
- `src/renderer/audio/ttsPreview.ts` — **Create**: `TtsPreviewController`（デコード＋スケジュール＋映像駆動。Web Audio/DOM 依存のため typecheck/build + 手動E2Eで検証）
- `src/renderer/editor/Timeline.tsx` — **Modify**: `playingId` ハイライト
- `src/renderer/editor/PreviewPlayer.tsx` — **Modify（全置換）**: 元音声↔TTSトグル＋コントローラ配線＋モード別ハンドラ
- `src/renderer/editor/EditorLayout.tsx` — **Modify**: segments/projectDir/onActiveSegment を渡し、`playingId` を保持して Timeline に渡す
- `test/previewTimeline.test.ts` — **Create**

依存順: T1（純関数, TDD）→ T2（コントローラ, T1利用。単体では未使用なので typecheck/build は green）→ T3（UI統合: Timeline+PreviewPlayer+EditorLayout を一括変更し green を保つ）→ T4（検証）。3つのUIファイルは型が相互依存するため、途中で typecheck を赤にしないよう **1タスクにまとめる**。

---

## Task 1: `previewTimeline.ts`（純関数・タイムライン計算）

**Files:**
- Create: `src/renderer/editor/previewTimeline.ts`
- Test: `test/previewTimeline.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/previewTimeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computePreviewTimeline, previewTotalDuration, TAIL_PAUSE } from '../src/renderer/editor/previewTimeline';
import { type Segment } from '../src/shared/types';

function seg(id: string, start: number, end: number): Segment {
  return {
    id, videoStart: start, videoEnd: end, originalText: '', correctedText: '',
    ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}

describe('computePreviewTimeline', () => {
  it('returns [] for no segments', () => {
    expect(computePreviewTimeline([], new Map())).toEqual([]);
  });

  it('uses videoSpan + TAIL_PAUSE when there is no clip', () => {
    const slots = computePreviewTimeline([seg('seg-001', 0, 2)], new Map());
    expect(slots[0].slotStart).toBe(0);
    expect(slots[0].clipDuration).toBe(0);
    expect(slots[0].slotDuration).toBeCloseTo(2 + TAIL_PAUSE);
  });

  it('uses clip length when the clip is longer than the video span', () => {
    const slots = computePreviewTimeline([seg('seg-001', 0, 2)], new Map([['seg-001', 5]]));
    expect(slots[0].slotDuration).toBeCloseTo(5 + TAIL_PAUSE);
  });

  it('uses video span when the clip is shorter', () => {
    const slots = computePreviewTimeline([seg('seg-001', 0, 4)], new Map([['seg-001', 1]]));
    expect(slots[0].slotDuration).toBeCloseTo(4 + TAIL_PAUSE);
  });

  it('accumulates slotStart and computes total duration', () => {
    const slots = computePreviewTimeline(
      [seg('seg-001', 0, 2), seg('seg-002', 2, 5)],
      new Map([['seg-001', 3], ['seg-002', 1]]),
    );
    expect(slots[0].slotStart).toBe(0);
    expect(slots[0].slotDuration).toBeCloseTo(3 + TAIL_PAUSE); // max(3,2)+tail
    expect(slots[1].slotStart).toBeCloseTo(3 + TAIL_PAUSE);
    expect(slots[1].slotDuration).toBeCloseTo(3 + TAIL_PAUSE); // max(1,3)+tail
    expect(previewTotalDuration(slots)).toBeCloseTo((3 + TAIL_PAUSE) * 2);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- previewTimeline`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`src/renderer/editor/previewTimeline.ts`:

```ts
import { type Segment } from '../../shared/types';

export interface PreviewSlot {
  segmentId: string;
  slotStart: number;     // プレビュータイムライン上の開始秒
  slotDuration: number;  // このスロットの長さ（秒）
  videoStart: number;    // 元映像の開始秒
  videoEnd: number;      // 元映像の終了秒
  clipDuration: number;  // TTS クリップ長（秒）。未生成は 0
}

/** 各セグメント末尾の小休止（秒）。 */
export const TAIL_PAUSE = 0.3;

/**
 * セグメントと TTS クリップ長から、プレビュー（=書き出し）のスロット列を作る。
 * 各スロット長 = max(クリップ長, 映像区間長) + TAIL_PAUSE。
 * これで「音声が長ければ末尾フレームをフリーズ保持、短ければ末尾に小休止」を統一表現する。
 */
export function computePreviewTimeline(
  segments: Segment[],
  clipDurations: Map<string, number>,
): PreviewSlot[] {
  const slots: PreviewSlot[] = [];
  let cursor = 0;
  for (const seg of segments) {
    const videoSpan = Math.max(0, seg.videoEnd - seg.videoStart);
    const clipDuration = clipDurations.get(seg.id) ?? 0;
    const slotDuration = Math.max(clipDuration, videoSpan) + TAIL_PAUSE;
    slots.push({
      segmentId: seg.id,
      slotStart: cursor,
      slotDuration,
      videoStart: seg.videoStart,
      videoEnd: seg.videoEnd,
      clipDuration,
    });
    cursor += slotDuration;
  }
  return slots;
}

export function previewTotalDuration(slots: PreviewSlot[]): number {
  return slots.reduce((sum, s) => sum + s.slotDuration, 0);
}
```

- [ ] **Step 4: パス確認**

Run: `npm test -- previewTimeline`
Expected: PASS（5件）

- [ ] **Step 5: コミット**

```bash
git add src/renderer/editor/previewTimeline.ts test/previewTimeline.test.ts
git commit -m "feat: add preview timeline (video-follows-audio slot computation)"
```

---

## Task 2: `ttsPreview.ts`（再生コントローラ）

**Files:**
- Create: `src/renderer/audio/ttsPreview.ts`

> Web Audio と映像/DOM に依存するため単体テストはしない。`npm run typecheck` + `npm run build` で検証し、実挙動は手動E2E（Task 4）で確認する。このファイルはまだどこからも import されないが、`tsc --build` で型検査されるため単体で green になる。

- [ ] **Step 1: 実装**

`src/renderer/audio/ttsPreview.ts`:

```ts
import { type Segment } from '../../shared/types';
import { computePreviewTimeline, type PreviewSlot } from '../editor/previewTimeline';

export interface TtsPreviewCallbacks {
  onActiveSegment?: (segmentId: string | null) => void;
  onEnded?: () => void;
}

const DRIFT_THRESHOLD = 0.25; // 秒。これを超えたら映像時刻を補正する。

/**
 * 各セグメントの TTS を Web Audio でスケジュール再生し（音声=master clock）、
 * rAF で映像要素を駆動する（区間内はネイティブ再生、区間外は末尾フレームでフリーズ）。
 */
export class TtsPreviewController {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private slots: PreviewSlot[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private rafId: number | null = null;
  private startCtxTime = 0; // previewTime=0 に対応する ctx.currentTime
  private positionTime = 0; // 一時停止位置（秒）
  private playing = false;
  private video: HTMLVideoElement | null = null;
  private activeId: string | null = null;

  constructor(private cb: TtsPreviewCallbacks = {}) {}

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** 各セグメントの TTS をデコードしてタイムラインを構築する。 */
  async load(segments: Segment[], projectDir: string): Promise<void> {
    this.stop();
    const ctx = this.ensureCtx();
    this.buffers.clear();
    const durations = new Map<string, number>();
    for (const seg of segments) {
      if (!seg.ttsAudio) continue;
      try {
        const url = `c2m://asset/${seg.ttsAudio}?p=${encodeURIComponent(projectDir)}`;
        const res = await fetch(url);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(seg.id, buf);
        durations.set(seg.id, buf.duration);
      } catch {
        // デコード失敗は無音区間として扱う（clipDuration=0）
      }
    }
    this.slots = computePreviewTimeline(segments, durations);
    this.positionTime = 0;
  }

  hasSlots(): boolean { return this.slots.length > 0; }
  missingClips(): boolean { return this.slots.some((s) => s.clipDuration === 0); }

  get totalDuration(): number {
    const last = this.slots[this.slots.length - 1];
    return last ? last.slotStart + last.slotDuration : 0;
  }

  /** positionTime から再生する（末尾到達後は先頭から）。 */
  async play(video: HTMLVideoElement): Promise<void> {
    const ctx = this.ensureCtx();
    if (this.slots.length === 0) return;
    if (ctx.state === 'suspended') await ctx.resume();
    this.teardown();
    this.video = video;
    this.playing = true;

    const from = this.positionTime >= this.totalDuration ? 0 : this.positionTime;
    this.positionTime = from;
    this.startCtxTime = ctx.currentTime - from;

    for (const slot of this.slots) {
      const buf = this.buffers.get(slot.segmentId);
      if (!buf) continue;
      const clipEnd = slot.slotStart + buf.duration;
      if (from >= clipEnd) continue; // この区間の音声は再生済み
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const when = this.startCtxTime + slot.slotStart;
      if (when >= ctx.currentTime) {
        src.start(when);
      } else {
        src.start(ctx.currentTime, from - slot.slotStart); // 区間途中から
      }
      this.sources.push(src);
    }

    const slot = this.slotAt(from) ?? this.slots[0];
    const videoSpan = Math.max(0, slot.videoEnd - slot.videoStart);
    video.currentTime = slot.videoStart + Math.min(Math.max(0, from - slot.slotStart), videoSpan);
    try { await video.play(); } catch { /* autoplay 制限は無視 */ }

    this.rafId = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.teardown();
    this.playing = false;
    this.video?.pause();
  }

  stop(): void {
    this.teardown();
    this.playing = false;
    this.video?.pause();
    this.positionTime = 0;
    if (this.activeId !== null) {
      this.activeId = null;
      this.cb.onActiveSegment?.(null);
    }
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.video || !this.playing) return;
    const previewTime = ctx.currentTime - this.startCtxTime;
    this.positionTime = previewTime;
    if (previewTime >= this.totalDuration) {
      this.finish();
      return;
    }

    const slot = this.slotAt(previewTime);
    if (slot) {
      if (slot.segmentId !== this.activeId) {
        this.activeId = slot.segmentId;
        this.cb.onActiveSegment?.(slot.segmentId);
      }
      const offset = previewTime - slot.slotStart;
      const videoSpan = Math.max(0, slot.videoEnd - slot.videoStart);
      if (offset < videoSpan) {
        if (this.video.paused) void this.video.play().catch(() => {});
        const target = slot.videoStart + offset;
        if (Math.abs(this.video.currentTime - target) > DRIFT_THRESHOLD) this.video.currentTime = target;
      } else {
        if (!this.video.paused) this.video.pause();
        if (Math.abs(this.video.currentTime - slot.videoEnd) > 0.05) this.video.currentTime = slot.videoEnd;
      }
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.teardown();
    this.playing = false;
    this.video?.pause();
    this.positionTime = 0;
    this.activeId = null;
    this.cb.onActiveSegment?.(null);
    this.cb.onEnded?.();
  }

  private slotAt(t: number): PreviewSlot | null {
    for (const s of this.slots) {
      if (t >= s.slotStart && t < s.slotStart + s.slotDuration) return s;
    }
    return null;
  }

  private teardown(): void {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* 既に停止済み */ }
      s.disconnect();
    }
    this.sources = [];
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
```

- [ ] **Step 2: typecheck と build**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/renderer/audio/ttsPreview.ts
git commit -m "feat: add TtsPreviewController (audio-clock playback driving the video)"
```

---

## Task 3: UI 統合（Timeline ハイライト＋PreviewPlayer トグル＋EditorLayout 配線）

**Files:**
- Modify: `src/renderer/editor/Timeline.tsx`
- Modify（全置換）: `src/renderer/editor/PreviewPlayer.tsx`
- Modify: `src/renderer/editor/EditorLayout.tsx`

> この3ファイルは型が相互依存するため**1タスクで一括変更**し、末尾でまとめて typecheck/build/test が green になることを確認する（途中の単体コミットはしない）。Web Audio/映像/DOM 依存のため動作は手動E2E（Task 4）で検証。

- [ ] **Step 1: `Timeline.tsx` に `playingId` を追加**

`Props` に `playingId` を追加（`selectedId` の直後）:

```ts
interface Props {
  duration: number;
  currentTime: number;
  segments: Segment[];
  selectedId: string | null;
  playingId: string | null;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
}
```

関数引数の分割代入にも追加:

```ts
export function Timeline({ duration, currentTime, segments, selectedId, playingId, onSelect, onSeek }: Props) {
```

セグメント `<div>` の `background` 行を置き換える（再生中=緑を最優先、その次に選択=青）:

```ts
              background: s.id === playingId ? '#2e8b57' : s.id === selectedId ? '#4a90d9' : '#3a3a3a',
```

- [ ] **Step 2: `PreviewPlayer.tsx` を全置換**

```tsx
import { useRef, useState, useEffect, type RefObject } from 'react';
import { type Segment } from '../../shared/types';
import { TtsPreviewController } from '../audio/ttsPreview';

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  videoUrl: string;
  audioUrl: string;
  segments: Segment[];
  projectDir: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
  onActiveSegment: (id: string | null) => void;
}

/**
 * 元音声モード: 映像(c2m:raw.webm)を主時計に narration を従わせて再生（従来どおり）。
 * TTSモード: TtsPreviewController が TTS を Web Audio でスケジュールし映像を駆動する。
 */
export function PreviewPlayer({
  videoRef, audioRef, videoUrl, audioUrl, segments, projectDir, onTime, onDuration, onActiveSegment,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<'original' | 'tts'>('original');
  const [ttsLoading, setTtsLoading] = useState(false);
  const resolvingDuration = useRef(false);

  // onActiveSegment を最新参照で呼ぶ（コントローラは一度だけ生成する）
  const onActiveRef = useRef(onActiveSegment);
  onActiveRef.current = onActiveSegment;

  const controllerRef = useRef<TtsPreviewController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new TtsPreviewController({
      onActiveSegment: (id) => onActiveRef.current(id),
      onEnded: () => setPlaying(false),
    });
  }
  useEffect(() => () => { controllerRef.current?.dispose(); controllerRef.current = null; }, []);

  // MediaRecorder 製 WebM は duration メタが無く Infinity になるため、末尾シークで実尺を確定する。
  const resolveDuration = (v: HTMLVideoElement) => {
    if (Number.isFinite(v.duration) && v.duration > 0) {
      onDuration(v.duration);
      return;
    }
    resolvingDuration.current = true;
    const onDurationChange = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return;
      v.removeEventListener('durationchange', onDurationChange);
      onDuration(v.duration);
      resolvingDuration.current = false;
      v.currentTime = 0;
    };
    v.addEventListener('durationchange', onDurationChange);
    v.currentTime = 1e101;
  };

  const syncAudioTime = () => {
    if (resolvingDuration.current) return;
    const v = videoRef.current;
    const a = audioRef.current;
    if (v && a && Math.abs(a.currentTime - v.currentTime) > 0.15) a.currentTime = v.currentTime;
  };

  const inTts = () => mode === 'tts';

  const toggleOriginal = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    if (v.paused) {
      if (a) { a.currentTime = v.currentTime; void a.play(); }
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      a?.pause();
      setPlaying(false);
    }
  };

  const toggleTts = async () => {
    const c = controllerRef.current;
    const v = videoRef.current;
    if (!c || !v) return;
    if (playing) {
      c.pause();
      setPlaying(false);
    } else {
      await c.play(v);
      setPlaying(true);
    }
  };

  const togglePlay = () => { if (inTts()) void toggleTts(); else toggleOriginal(); };

  const switchMode = async (next: 'original' | 'tts') => {
    if (next === mode) return;
    videoRef.current?.pause();
    audioRef.current?.pause();
    controllerRef.current?.stop();
    setPlaying(false);
    if (next === 'tts') {
      setTtsLoading(true);
      try { await controllerRef.current?.load(segments, projectDir); } finally { setTtsLoading(false); }
    }
    setMode(next);
  };

  const missing = mode === 'tts' && !ttsLoading && (controllerRef.current?.missingClips() ?? false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000' }}>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          onLoadedMetadata={(e) => resolveDuration(e.currentTarget)}
          onTimeUpdate={(e) => {
            if (inTts() || resolvingDuration.current) return;
            onTime(e.currentTarget.currentTime);
            syncAudioTime();
          }}
          onPlay={() => { if (inTts()) return; if (audioRef.current) void audioRef.current.play(); setPlaying(true); }}
          onPause={() => { if (inTts()) return; audioRef.current?.pause(); setPlaying(false); }}
          onSeeked={() => { if (inTts()) return; syncAudioTime(); }}
        />
        <audio ref={audioRef} src={audioUrl} />
      </div>
      <div style={{ padding: 8, background: '#222', color: '#fff', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={togglePlay} disabled={ttsLoading}>{playing ? '⏸ 一時停止' : '▶ 再生'}</button>
        <span style={{ fontSize: 12, color: '#bbb' }}>音声:</span>
        <button onClick={() => void switchMode('original')} disabled={mode === 'original'}>元音声</button>
        <button onClick={() => void switchMode('tts')} disabled={mode === 'tts'}>TTS</button>
        {ttsLoading && <span style={{ fontSize: 12, color: '#bbb' }}>TTS読み込み中…</span>}
        {missing && <span style={{ fontSize: 12, color: '#caa' }}>TTS未生成のセグメントは無音で再生されます</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `EditorLayout.tsx` を配線**

(a) 先頭 React import に `useCallback` を追加:

```ts
import { useEffect, useRef, useState, useCallback } from 'react';
```

(b) `const [ttsNonce, setTtsNonce] = useState(0);` の直後に追加:

```ts
  const [playingId, setPlayingId] = useState<string | null>(null);
  const handleActiveSegment = useCallback((id: string | null) => setPlayingId(id), []);
```

(c) `<PreviewPlayer ... />` を次に置き換える（`segments`/`projectDir`/`onActiveSegment` を追加）:

```tsx
        <PreviewPlayer
          videoRef={videoRef}
          audioRef={audioRef}
          videoUrl={projectAssetUrl('assets/raw.webm', state.projectDir ?? '')}
          audioUrl={projectAssetUrl('assets/narration.webm', state.projectDir ?? '')}
          segments={segments}
          projectDir={state.projectDir ?? ''}
          onTime={(t) => dispatch({ type: 'SET_CURRENT_TIME', time: t })}
          onDuration={setDuration}
          onActiveSegment={handleActiveSegment}
        />
```

(d) `<Timeline ... />` に `playingId={playingId}` を追加（`selectedId` の直後）:

```tsx
      <Timeline
        duration={duration}
        currentTime={state.currentTime}
        segments={segments}
        selectedId={state.selectedSegmentId}
        playingId={playingId}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onSeek={seek}
      />
```

- [ ] **Step 4: typecheck / build / test（全体 green）**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `npm test`
Expected: PASS（既存＋previewTimeline 追加分）

- [ ] **Step 5: コミット**

```bash
git add src/renderer/editor/Timeline.tsx src/renderer/editor/PreviewPlayer.tsx src/renderer/editor/EditorLayout.tsx
git commit -m "feat: wire timed TTS preview into the editor (toggle + playing highlight)"
```

---

## Task 4: 全体検証（手動E2E＋最終チェック）

**Files:** なし（検証のみ）

- [ ] **Step 1: 自動チェック green**

Run: `npm test`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 2: 手動E2E（実機）**

Run: `npm run dev`

手順と期待結果（事前に `setup:voicevox` 済み・TTS をいくつか生成済みのプロジェクトで）:
1. 文字起こし＋TTS生成済みの `rec-*` を開く。
2. プレビュー下部の音声トグルで **TTS** を選ぶ → 「TTS読み込み中…」後に準備完了。一部未生成なら「無音で再生されます」のヒントが出る。
3. **▶再生** → 各セグメントで、映像がその区間を再生→区間が終わると末尾フレームでフリーズしつつ VOICEVOX 音声が流れ、音声が終わると次セグメントへ前進する（=映像が音声に合う）。
4. 再生中のセグメントがタイムラインで緑にハイライトされ、進行に合わせて移動する。
5. **⏸一時停止** → その位置で止まり、再度 ▶ で続きから再生（レジューム）。
6. **元音声** に戻す → 従来どおり映像＋元ナレーションが再生され、スクラブ（タイムラインクリック）もできる。
7. TTS未生成のセグメントは、その区間が無音で（映像のみ）流れる。

- [ ] **Step 3: 結果を記録**

確認できた項目／できなかった項目を簡潔に記録。問題があれば systematic-debugging で対処（特に映像のフリーズ/シーク挙動、WebM のシーク精度、AudioContext の resume、ドリフト補正閾値 `DRIFT_THRESHOLD`/`TAIL_PAUSE` の体感調整）。

---

## 完了の定義

- `computePreviewTimeline` の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機で TTSモードに切替→通し再生でき、各セグメントの映像が音声長に合わせてフリーズ/小休止し、再生中セグメントがハイライトされ、一時停止/再開ができ、元音声トグルで従来再生に戻る。
