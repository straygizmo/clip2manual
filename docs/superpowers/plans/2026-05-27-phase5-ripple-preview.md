# クリック強調（リップル）プレビュー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレビューで各クリック位置に「広がって消えるリップル」を canvas オーバーレイで合成し、元音声/TTS 両モードで正しいタイミングに表示する。

**Architecture:** 純関数 `rippleOverlay.ts`（交差検出・アニメ進捗）を `RippleCanvas` コンポーネントが使う。canvas のピクセルバッファを映像実解像度にして CSS で映像と同矩形に伸縮（`verify-clicks` 方式）し、映像ピクセル座標のまま描画。`video.currentTime` をキーに前進交差でリップルを発火し、各リップルは wall-clock で完走させる。

**Tech Stack:** Electron + TypeScript + React、Canvas 2D、Vitest（test/・node環境・`.test.ts`）。

spec: `docs/superpowers/specs/2026-05-27-clip2manual-phase5-ripple-preview-design.md`

---

## File Structure

- `src/renderer/editor/rippleOverlay.ts` — **Create**: 純関数 `clicksCrossed` / `rippleProgress` ＋定数（唯一の単体テスト対象）
- `test/rippleOverlay.test.ts` — **Create**
- `tsconfig.node.json` — **Modify**: include に `rippleOverlay.ts` を追加（test が import するため node typecheck に必要。`previewTimeline.ts` 等と同パターン）
- `src/renderer/editor/RippleCanvas.tsx` — **Create**: canvas オーバーレイ＋rAF描画
- `src/renderer/editor/PreviewPlayer.tsx` — **Modify**: 映像をラッパで包み `RippleCanvas` を重ね、`clicks` を渡す

依存順: T1（純関数, TDD）→ T2（RippleCanvas + PreviewPlayer 配線, T1利用）→ T3（検証）。RippleCanvas は DOM/React 依存のため単体テスト無し（typecheck/build + 手動E2E）。

---

## Task 1: `rippleOverlay.ts`（純関数）

**Files:**
- Create: `src/renderer/editor/rippleOverlay.ts`
- Test: `test/rippleOverlay.test.ts`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: 失敗するテストを書く**

`test/rippleOverlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clicksCrossed, rippleProgress, RIPPLE_DURATION } from '../src/renderer/editor/rippleOverlay';

describe('clicksCrossed', () => {
  const clicks = [{ t: 1 }, { t: 2 }, { t: 3 }];
  it('returns clicks with prevT < t <= currT (forward)', () => {
    expect(clicksCrossed(clicks, 0.5, 2)).toEqual([{ t: 1 }, { t: 2 }]);
  });
  it('excludes t === prevT, includes t === currT', () => {
    expect(clicksCrossed(clicks, 1, 2)).toEqual([{ t: 2 }]);
  });
  it('returns [] when not advancing (currT <= prevT)', () => {
    expect(clicksCrossed(clicks, 2, 2)).toEqual([]);
    expect(clicksCrossed(clicks, 3, 1)).toEqual([]);
  });
});

describe('rippleProgress', () => {
  it('starts at radius01 0, alpha 1', () => {
    expect(rippleProgress(0)).toEqual({ radius01: 0, alpha: 1 });
  });
  it('is half-way at half the duration', () => {
    const p = rippleProgress(RIPPLE_DURATION / 2);
    expect(p).not.toBeNull();
    expect(p!.radius01).toBeCloseTo(0.5);
    expect(p!.alpha).toBeCloseTo(0.5);
  });
  it('returns null once elapsed >= duration', () => {
    expect(rippleProgress(RIPPLE_DURATION)).toBeNull();
    expect(rippleProgress(RIPPLE_DURATION + 1)).toBeNull();
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- rippleOverlay`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`src/renderer/editor/rippleOverlay.ts`:

```ts
/** リップル1発の継続時間（秒, wall-clock）。 */
export const RIPPLE_DURATION = 0.8;
/** リップル最大半径 = 映像幅 * この比。 */
export const RIPPLE_MAX_RADIUS_RATIO = 1 / 12;

/**
 * 映像時刻が prevT→currT に前進する間に「交差した」クリック（prevT < t <= currT）を返す。
 * 前進していない（currT <= prevT）場合は空配列。
 */
export function clicksCrossed<T extends { t: number }>(clicks: T[], prevT: number, currT: number): T[] {
  if (currT <= prevT) return [];
  return clicks.filter((c) => c.t > prevT && c.t <= currT);
}

/**
 * 発火からの経過秒に対するリップルの半径係数(0..1)と不透明度(1..0)。
 * 経過が継続時間以上なら null（消滅）。
 */
export function rippleProgress(
  elapsed: number,
  duration: number = RIPPLE_DURATION,
): { radius01: number; alpha: number } | null {
  if (elapsed >= duration) return null;
  const k = Math.max(0, elapsed) / duration;
  return { radius01: k, alpha: 1 - k };
}
```

- [ ] **Step 4: node typecheck に含める**

`tsconfig.node.json` の `include` 配列に、`"src/renderer/editor/previewTimeline.ts"` の行の直後に追加:

```json
    "src/renderer/editor/previewTimeline.ts",
    "src/renderer/editor/rippleOverlay.ts",
```

- [ ] **Step 5: パス確認**

Run: `npm test -- rippleOverlay`
Expected: PASS（6件）

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/renderer/editor/rippleOverlay.ts test/rippleOverlay.test.ts tsconfig.node.json
git commit -m "feat: add ripple overlay helpers (crossing detection + progress)"
```

---

## Task 2: `RippleCanvas.tsx` ＋ `PreviewPlayer` 配線

**Files:**
- Create: `src/renderer/editor/RippleCanvas.tsx`
- Modify: `src/renderer/editor/PreviewPlayer.tsx`

> DOM/canvas/rAF 依存のため単体テスト無し。`npm run typecheck` + `npm run build` で検証、実挙動は手動E2E（Task 3）。

- [ ] **Step 1: `RippleCanvas.tsx` を作成**

```tsx
import { useEffect, useRef, type RefObject } from 'react';
import { type ClickEvent } from '../../shared/types';
import { clicksCrossed, rippleProgress, RIPPLE_MAX_RADIUS_RATIO } from './rippleOverlay';

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  clicks: ClickEvent[];
}

interface ActiveRipple { x: number; y: number; firedAt: number; }

/**
 * 映像に重ねた canvas に、クリック位置のリップル（広がって消える輪＋中心点）を描く。
 * canvas のピクセルバッファを映像実解像度にし CSS で同矩形に伸縮するため、映像ピクセル座標のまま描ける。
 * video.currentTime をキーにするので元音声/TTS 両モードで動作する。
 */
export function RippleCanvas({ videoRef, clicks }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // clicks を最新参照で使う（rAF ループは一度だけ張る）
  const clicksRef = useRef(clicks);
  clicksRef.current = clicks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let prevT = videoRef.current?.currentTime ?? 0;
    const active: ActiveRipple[] = [];

    const loop = () => {
      const video = videoRef.current;
      if (video && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const w = canvas.width;
        const t = video.currentTime;
        if (t < prevT - 0.05) {
          active.length = 0; // 後方シーク: リセット（二重発火防止）
        } else if (t > prevT) {
          for (const c of clicksCrossed(clicksRef.current, prevT, t)) {
            active.push({ x: c.x, y: c.y, firedAt: performance.now() });
          }
        }
        prevT = t;

        ctx.clearRect(0, 0, w, canvas.height);
        const maxR = w * RIPPLE_MAX_RADIUS_RATIO;
        const now = performance.now();
        for (let i = active.length - 1; i >= 0; i--) {
          const p = rippleProgress((now - active[i].firedAt) / 1000);
          if (!p) { active.splice(i, 1); continue; }
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.strokeStyle = '#ffcf33';
          ctx.lineWidth = Math.max(2, w / 400);
          ctx.beginPath();
          ctx.arc(active[i].x, active[i].y, Math.max(2, p.radius01 * maxR), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ff5470';
          ctx.beginPath();
          ctx.arc(active[i].x, active[i].y, Math.max(3, w / 320), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
```

- [ ] **Step 2: `PreviewPlayer.tsx` に組み込む**

(a) import を追加（`TtsPreviewController` の import 行の下）:

```ts
import { TtsPreviewController } from '../audio/ttsPreview';
import { RippleCanvas } from './RippleCanvas';
```

(b) `return (` の直前（`const missing = ...` の後あたり）に、全クリックを集約する行を追加:

```ts
  const clicks = segments.flatMap((s) => s.clicks);
```

(c) 映像領域の JSX を、`<video>` を相対配置ラッパで包み `RippleCanvas` を重ねる形に置き換える。現在の該当ブロック:

```tsx
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
```

を次に置き換える（`<video>` の属性・ハンドラは不変、`style` を `display:block` 付きにし、ラッパと `RippleCanvas` を追加）:

```tsx
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '100%' }}>
          <video
            ref={videoRef}
            src={videoUrl}
            style={{ display: 'block', maxWidth: '100%', maxHeight: '100%' }}
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
          <RippleCanvas videoRef={videoRef} clicks={clicks} />
        </div>
        <audio ref={audioRef} src={audioUrl} />
      </div>
```

- [ ] **Step 3: 検証**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `npm test`
Expected: PASS（既存＋rippleOverlay 追加分）

- [ ] **Step 4: コミット**

```bash
git add src/renderer/editor/RippleCanvas.tsx src/renderer/editor/PreviewPlayer.tsx
git commit -m "feat: overlay click ripples on the preview video"
```

---

## Task 3: 全体検証（手動E2E＋最終チェック）

**Files:** なし（検証のみ）

- [ ] **Step 1: 自動チェック green**

Run: `npm test`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 2: 手動E2E（実機GUI）**

Run: `npm run dev`

手順と期待結果（クリックのある録画＝文字起こし済みプロジェクトで。TTS生成済みだと TTSモードも確認できる）:
1. `rec-*` を開く（セグメントにクリックがあるもの）。
2. **元音声**モードで再生 → クリックした瞬間（その映像フレーム）に、クリック位置で輪が広がって消えるリップルが出る。位置が実クリック箇所に乗っている。
3. タイムラインをクリックして別位置にシーク→再生しても、以降のクリックで正しく発火する（後方シーク後の再発火）。
4. **TTS**モードに切替えて再生 → 各セグメントの該当時刻でリップルが出る。区間末尾のフリーズ中に輪が固まらず、出ている途中なら wall-clock で完走して消える。
5. リップルは再生コントロール（ボタン）を妨げない（`pointer-events:none`）。
6. クリックの無いプロジェクト/セグメントでは何も出ない（エラーにならない）。

- [ ] **Step 3: 結果を記録**

確認できた項目／できなかった項目を簡潔に記録。問題があれば systematic-debugging で対処（特に canvas と映像の矩形ズレ＝ラッパCSS、リップルのタイミング、`RIPPLE_DURATION`/`RIPPLE_MAX_RADIUS_RATIO`/色の体感調整）。

---

## 完了の定義

- `clicksCrossed` / `rippleProgress` の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機で、元音声/TTS 両モードでクリック位置にリップルが正しいタイミングで表示され、映像にぴったり重なり、再生コントロールを妨げず、フリーズ中も破綻しない。
