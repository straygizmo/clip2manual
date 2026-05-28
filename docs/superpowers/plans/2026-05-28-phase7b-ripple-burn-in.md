# Phase 7b Ripple Burn-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Burn click ripples into the exported MP4 by generating per-slot transparent PNG sequences and adding an FFmpeg overlay step to the existing per-slot encode.

**Architecture:** For each preview slot, compute the "active ripples" per output frame using a pure TypeScript function (reusing Phase 5's ripple math from a now-shared module). Rasterize each frame's SVG with `sharp` into a transparent PNG sequence under `tmpDir`. Pass the sequence as a second input to the per-slot ffmpeg invocation and overlay it via `filter_complex`. Concat and mux are unchanged (stream copy preserved).

**Tech Stack:** TypeScript / Electron-vite main / Vitest / FFmpeg (overlay, image2, filter_complex) / sharp (SVG → PNG)

**Branch:** `phase7b-ripple-burn-in` (master 起点; spec commit `570113a` already present)

**Spec:** `docs/superpowers/specs/2026-05-28-clip2manual-phase7b-ripple-burn-in-design.md`

---

## File Structure

新規:
- `src/shared/rippleOverlay.ts` — Phase 5 から移設（純粋）
- `src/main/export/rippleFrames.ts` — `activeRipplesAt` / `rippleSvg` / `generateRippleFramesForSlot`
- `test/rippleFrames.test.ts` — 純関数の単体テスト + I/O テスト（tmp dir）

変更:
- `src/renderer/editor/rippleOverlay.ts` — 共有モジュールからの薄い re-export シム
- `src/main/export/ffargs.ts` — `probeResolutionArgs` / `parseResolution` 追加、`segmentVideoArgs` に optional `ripple` 追加
- `src/main/export/exportService.ts` — 解像度プローブ + per-slot ripple 生成のフック
- `test/ffargs.test.ts` — `parseResolution` と `segmentVideoArgs(ripple)` のテスト追加
- `test/exportService.test.ts` — 新 probe・新 DI を反映
- `package.json` / `package-lock.json` — `sharp` を `dependencies` に追加

---

## 共通の検証コマンド

すべてのタスクで実装後に以下を実行:

```bash
npm test           # Vitest 全件
npm run typecheck  # tsc --build
npm run build      # electron-vite build
```

`npm run dev` は GUI が起動し止まらないので**実行しない**（実機 E2E は最終確認のみ）。

---

## Task 1: rippleOverlay.ts を shared へ移設

**Files:**
- Move: `src/renderer/editor/rippleOverlay.ts` → `src/shared/rippleOverlay.ts`
- Modify: `src/renderer/editor/rippleOverlay.ts` (薄い re-export シムに置換)
- Test (verify only): `test/rippleOverlay.test.ts`（import パスは renderer 経由で変えない＝シム経由で通る）

- [ ] **Step 1: 移動先ファイルを作成**

`src/shared/rippleOverlay.ts` を作成し、現在 `src/renderer/editor/rippleOverlay.ts` にある内容（コメント含む全文）をそのままコピー:

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

- [ ] **Step 2: renderer 側を薄い再エクスポートシムに置換**

`src/renderer/editor/rippleOverlay.ts` の中身を以下のみに:

```ts
export { RIPPLE_DURATION, RIPPLE_MAX_RADIUS_RATIO, clicksCrossed, rippleProgress } from '../../shared/rippleOverlay';
```

- [ ] **Step 3: 既存テスト＋ビルドを確認**

```bash
npm test
npm run typecheck
npm run build
```

Expected: 既存テスト全件 PASS（`test/rippleOverlay.test.ts` は renderer のパスから import しているのでシム経由で通る）、typecheck/build クリーン。

- [ ] **Step 4: Commit**

```bash
git add src/shared/rippleOverlay.ts src/renderer/editor/rippleOverlay.ts
git commit -m "refactor: move rippleOverlay to shared for export reuse"
```

---

## Task 2: ffargs に `probeResolutionArgs` / `parseResolution` を追加

**Files:**
- Modify: `src/main/export/ffargs.ts`
- Modify: `test/ffargs.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/ffargs.test.ts` の冒頭の import 行に `probeResolutionArgs, parseResolution` を加える:

```ts
import {
  probeDurationArgs, parseProbeDuration, probeFpsArgs, parseFps,
  probeResolutionArgs, parseResolution,
  segmentVideoArgs, segmentAudioArgs, concatArgs, muxArgs,
} from '../src/main/export/ffargs';
```

`describe('probe parsing', ...)` ブロックの末尾に以下のテストを追加:

```ts
  it('probeResolutionArgs queries width,height of first video stream', () => {
    const s = probeResolutionArgs('v.webm').join(' ');
    expect(s).toContain('-select_streams v:0');
    expect(s).toContain('stream=width,height');
    expect(s).toContain('v.webm');
  });
  it('parseResolution parses "1920,1080"', () => {
    expect(parseResolution('1920,1080\n')).toEqual({ width: 1920, height: 1080 });
  });
  it('parseResolution accepts whitespace', () => {
    expect(parseResolution(' 1280 , 720 \n')).toEqual({ width: 1280, height: 720 });
  });
  it('parseResolution throws on garbage', () => {
    expect(() => parseResolution('N/A')).toThrow();
    expect(() => parseResolution('1920')).toThrow();
    expect(() => parseResolution('0,0')).toThrow();
  });
```

- [ ] **Step 2: テスト失敗を確認**

```bash
npx vitest run test/ffargs.test.ts
```
Expected: FAIL — `probeResolutionArgs`/`parseResolution` is not exported.

- [ ] **Step 3: 実装を追加**

`src/main/export/ffargs.ts` に `parseFps` の直後（line ~32 の `}` 直後）に以下を追加:

```ts
export function probeResolutionArgs(file: string): string[] {
  return ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=,:p=0', file];
}

export function parseResolution(stdout: string): { width: number; height: number } {
  const s = stdout.trim();
  const m = s.match(/^(\d+)\s*,\s*(\d+)$/);
  if (!m) throw new Error(`Cannot parse ffprobe resolution: ${JSON.stringify(stdout)}`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Bad resolution: ${JSON.stringify(stdout)}`);
  }
  return { width, height };
}
```

- [ ] **Step 4: テスト PASS を確認**

```bash
npx vitest run test/ffargs.test.ts
npm test         # 全体も走らせる
npm run typecheck
npm run build
```
Expected: 全件 PASS、typecheck/build クリーン。

- [ ] **Step 5: Commit**

```bash
git add src/main/export/ffargs.ts test/ffargs.test.ts
git commit -m "feat(export): add probeResolutionArgs/parseResolution ffprobe helpers"
```

---

## Task 3: `sharp` 依存を追加

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: 依存追加**

`sharp` は main 側でランタイムに使う（renderer ではない、ネイティブ）。`dependencies` に入れる:

```bash
npm install sharp
```

- [ ] **Step 2: 検証**

```bash
node -e "console.log(require('sharp').versions.vips || 'sharp ok')"  # 解決確認
npm test
npm run typecheck
npm run build
```
Expected: `sharp` がエラーなく解決、すべての検証クリーン。

注意: sharp はネイティブ依存だが Windows prebuild を持つので追加ビルドは不要。もし `npm install` 時にネイティブビルドが走る・失敗する環境なら、stop して BLOCKED を報告（その場合は環境固有の問題で、私の指示で解決できない）。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add sharp dependency for ripple PNG rasterization"
```

---

## Task 4: `activeRipplesAt` を実装（純関数・TDD）

**Files:**
- Create: `src/main/export/rippleFrames.ts`
- Create: `test/rippleFrames.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/rippleFrames.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest';
import { activeRipplesAt, type ActiveRippleVisual } from '../src/main/export/rippleFrames';
import { type ClickEvent } from '../src/shared/types';
import { type PreviewSlot } from '../src/shared/previewTimeline';

const slot: PreviewSlot = {
  segmentId: 'seg-001', slotStart: 0, slotDuration: 3,
  videoStart: 1, videoEnd: 2, clipDuration: 2.5,
};
const w = 1920; // 仮想映像幅
// 期待値の事前計算
// maxR = w * (1/12) = 160
// ringSW = max(2, w/400) = max(2, 4.8) = 4.8
// dotR = max(3, w/320) = max(3, 6) = 6

function click(t: number, x = 100, y = 200): ClickEvent {
  return { t, x, y, button: 1 };
}

describe('activeRipplesAt', () => {
  it('returns no ripples when no clicks are in the slot', () => {
    expect(activeRipplesAt([], slot, 0.5, w)).toEqual([]);
  });

  it('ignores clicks outside the slot video range', () => {
    // c.t <= videoStart or c.t > videoEnd are filtered out
    expect(activeRipplesAt([click(0.5)], slot, 0.5, w)).toEqual([]);
    expect(activeRipplesAt([click(1.0)], slot, 0.5, w)).toEqual([]); // boundary: c.t === videoStart is excluded
    expect(activeRipplesAt([click(2.5)], slot, 0.5, w)).toEqual([]); // after videoEnd
  });

  it('includes a click that fires exactly at tSlot (elapsed 0, alpha 1)', () => {
    // click at c.t = 1.5 → fireTimeSlot = 0.5; tSlot = 0.5 → elapsed = 0
    const out = activeRipplesAt([click(1.5)], slot, 0.5, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(1);
    expect(out[0].ringRadius).toBe(2); // max(2, 0 * maxR) = 2
    expect(out[0].dotRadius).toBeCloseTo(6);
    expect(out[0].ringStrokeWidth).toBeCloseTo(4.8);
    expect(out[0].x).toBe(100);
    expect(out[0].y).toBe(200);
  });

  it('computes mid-animation values at half duration', () => {
    // fireTimeSlot = 0.5; tSlot = 0.5 + 0.4 = 0.9 → elapsed = 0.4 (half of 0.8)
    const out = activeRipplesAt([click(1.5)], slot, 0.9, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(0.5);
    expect(out[0].ringRadius).toBeCloseTo(0.5 * 160); // k * maxR = 80
  });

  it('drops a ripple once elapsed >= RIPPLE_DURATION', () => {
    // fireTimeSlot = 0.5; tSlot = 0.5 + 0.8 = 1.3 → elapsed = 0.8 (expired)
    expect(activeRipplesAt([click(1.5)], slot, 1.3, w)).toEqual([]);
  });

  it('keeps a ripple alive into the freeze region (tSlot > videoSpan)', () => {
    // videoSpan = 1; click at c.t = 1.9 → fireTimeSlot = 0.9
    // tSlot = 1.2 (in freeze, since slotDuration=3 > videoSpan=1) → elapsed = 0.3
    const out = activeRipplesAt([click(1.9)], slot, 1.2, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(1 - 0.3 / 0.8, 3);
  });

  it('returns multiple actives when their windows overlap', () => {
    // both fire in slot, both still alive at tSlot
    const out = activeRipplesAt([click(1.2), click(1.6)], slot, 1.7, w);
    // c1: fireTimeSlot=0.2, elapsed=1.5 → expired
    // c2: fireTimeSlot=0.6, elapsed=1.1 → expired
    expect(out).toHaveLength(0);
    const out2 = activeRipplesAt([click(1.2), click(1.6)], slot, 1.3, w);
    // c1: fireTimeSlot=0.2, elapsed=1.1 → expired
    // c2: fireTimeSlot=0.6, elapsed=0.7 → active
    expect(out2).toHaveLength(1);
    const out3 = activeRipplesAt([click(1.2), click(1.6)], slot, 0.9, w);
    // c1: fireTimeSlot=0.2, elapsed=0.7 → active
    // c2: fireTimeSlot=0.6, elapsed=0.3 → active
    expect(out3).toHaveLength(2);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
npx vitest run test/rippleFrames.test.ts
```
Expected: FAIL — module not found / `activeRipplesAt is not a function`.

- [ ] **Step 3: 実装を書く**

`src/main/export/rippleFrames.ts` を新規作成:

```ts
import { type ClickEvent } from '../../shared/types';
import { type PreviewSlot } from '../../shared/previewTimeline';
import { RIPPLE_MAX_RADIUS_RATIO, rippleProgress } from '../../shared/rippleOverlay';

export interface ActiveRippleVisual {
  x: number;
  y: number;
  ringRadius: number;
  ringStrokeWidth: number;
  dotRadius: number;
  alpha: number;
}

/**
 * スロットに属するクリックのうち、与えられた slot 時刻で active なリップルの描画パラメータを返す。
 * クリックは `slot.videoStart < c.t <= slot.videoEnd` で slot 所属判定する（Phase 5 の clicksCrossed 半開区間に一致）。
 */
export function activeRipplesAt(
  clicks: ClickEvent[],
  slot: PreviewSlot,
  tSlot: number,
  videoW: number,
): ActiveRippleVisual[] {
  const out: ActiveRippleVisual[] = [];
  const maxR = videoW * RIPPLE_MAX_RADIUS_RATIO;
  const ringSW = Math.max(2, videoW / 400);
  const dotR = Math.max(3, videoW / 320);
  for (const c of clicks) {
    if (c.t <= slot.videoStart || c.t > slot.videoEnd) continue;
    const fireTimeSlot = c.t - slot.videoStart;
    const elapsed = tSlot - fireTimeSlot;
    const p = rippleProgress(elapsed);
    if (!p) continue;
    out.push({
      x: c.x,
      y: c.y,
      ringRadius: Math.max(2, p.radius01 * maxR),
      ringStrokeWidth: ringSW,
      dotRadius: dotR,
      alpha: p.alpha,
    });
  }
  return out;
}
```

- [ ] **Step 4: テスト PASS を確認**

```bash
npx vitest run test/rippleFrames.test.ts
npm run typecheck
```
Expected: 全件 PASS、typecheck クリーン。

- [ ] **Step 5: Commit**

```bash
git add src/main/export/rippleFrames.ts test/rippleFrames.test.ts
git commit -m "feat(export): add activeRipplesAt for per-slot ripple computation"
```

---

## Task 5: `rippleSvg` を実装（純関数・TDD）

**Files:**
- Modify: `src/main/export/rippleFrames.ts`
- Modify: `test/rippleFrames.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/rippleFrames.test.ts` の冒頭の import 行を更新:

```ts
import { activeRipplesAt, rippleSvg, type ActiveRippleVisual } from '../src/main/export/rippleFrames';
```

ファイル末尾に追加:

```ts
describe('rippleSvg', () => {
  it('returns a minimal empty svg when there are no actives', () => {
    const svg = rippleSvg([], 1920, 1080);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="1920"');
    expect(svg).toContain('height="1080"');
    expect(svg).toContain('viewBox="0 0 1920 1080"');
    expect(svg).not.toContain('<circle');
  });

  it('emits two circles per active (ring + dot)', () => {
    const a: ActiveRippleVisual = {
      x: 100, y: 200, ringRadius: 50, ringStrokeWidth: 4.8, dotRadius: 6, alpha: 0.5,
    };
    const svg = rippleSvg([a], 1920, 1080);
    const circles = svg.match(/<circle/g);
    expect(circles).not.toBeNull();
    expect(circles!.length).toBe(2);
    expect(svg).toContain('stroke="#ffcf33"');
    expect(svg).toContain('fill="#ff5470"');
    expect(svg).toContain('cx="100"');
    expect(svg).toContain('cy="200"');
  });

  it('scales the number of circles with active count', () => {
    const make = (x: number): ActiveRippleVisual => ({
      x, y: 0, ringRadius: 10, ringStrokeWidth: 2, dotRadius: 3, alpha: 1,
    });
    const svg = rippleSvg([make(1), make(2), make(3)], 100, 100);
    const circles = svg.match(/<circle/g)!;
    expect(circles.length).toBe(6); // 2 per active * 3
  });

  it('renders opacity per active', () => {
    const a: ActiveRippleVisual = {
      x: 0, y: 0, ringRadius: 1, ringStrokeWidth: 1, dotRadius: 1, alpha: 0.25,
    };
    const svg = rippleSvg([a], 10, 10);
    // both circles share the same alpha → opacity="0.250" or "0.25" depending on formatter
    const occurrences = (svg.match(/opacity="0\.25/g) || []).length;
    expect(occurrences).toBe(2);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
npx vitest run test/rippleFrames.test.ts
```
Expected: FAIL — `rippleSvg is not a function`.

- [ ] **Step 3: 実装を追加**

`src/main/export/rippleFrames.ts` の `activeRipplesAt` の下に追加:

```ts
/**
 * active リップル群を 1 枚の透明 SVG にする。背景は描かない（PNG 化時に透過のまま）。
 * 数値は小数 3 桁で出力（フレーム間の見た目を安定させる）。
 */
export function rippleSvg(actives: ActiveRippleVisual[], w: number, h: number): string {
  const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(3);
  const parts = actives.map((a) => {
    const op = fmt(a.alpha);
    return (
      `<circle cx="${fmt(a.x)}" cy="${fmt(a.y)}" r="${fmt(a.ringRadius)}" fill="none" stroke="#ffcf33" stroke-width="${fmt(a.ringStrokeWidth)}" opacity="${op}"/>` +
      `<circle cx="${fmt(a.x)}" cy="${fmt(a.y)}" r="${fmt(a.dotRadius)}" fill="#ff5470" opacity="${op}"/>`
    );
  }).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${parts}</svg>`;
}
```

- [ ] **Step 4: テスト PASS を確認**

```bash
npx vitest run test/rippleFrames.test.ts
npm run typecheck
```
Expected: 全件 PASS、typecheck クリーン。

- [ ] **Step 5: Commit**

```bash
git add src/main/export/rippleFrames.ts test/rippleFrames.test.ts
git commit -m "feat(export): add rippleSvg to render active ripples to SVG"
```

---

## Task 6: `segmentVideoArgs` に optional `ripple` を追加（TDD）

**Files:**
- Modify: `src/main/export/ffargs.ts`
- Modify: `test/ffargs.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/ffargs.test.ts` の `describe('segmentVideoArgs', ...)` ブロック内、既存テストの後ろに以下を追加:

```ts
  it('without ripple: keeps the original -vf form and -ss/-t before -i', () => {
    const args = segmentVideoArgs({ rawPath: 'raw.webm', slot, outPath: 'o.mp4', fps: 30 });
    expect(args).toContain('-vf');
    expect(args).not.toContain('-filter_complex');
    expect(args).not.toContain('-map');
    expect(args.indexOf('-t')).toBeLessThan(args.indexOf('-i'));
  });

  it('with ripple: uses filter_complex overlay and -map [vout]', () => {
    const args = segmentVideoArgs({
      rawPath: 'raw.webm', slot, outPath: 'o.mp4', fps: 30,
      ripple: { pattern: 'tmp/seg-001_ripple/%05d.png', fps: 30 },
    });
    expect(args).toContain('-filter_complex');
    expect(args).toContain('-map');
    expect(args).toContain('[vout]');
    expect(args).not.toContain('-vf'); // -vf は使わない
    // filter graph に tpad と overlay が含まれる
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1];
    expect(fc).toContain('tpad=stop_mode=clone');
    expect(fc).toContain('overlay=shortest=1');
    // PNG seq が第2入力で、-framerate がその直前にある
    const inputs = args.reduce<number[]>((acc, a, i) => (a === '-i' ? [...acc, i] : acc), []);
    expect(inputs).toHaveLength(2);
    expect(args[inputs[1] - 2]).toBe('-framerate'); // -framerate 30 -i pattern
    expect(args[inputs[1] - 1]).toBe('30');
    expect(args[inputs[1] + 1]).toBe('tmp/seg-001_ripple/%05d.png');
    // -ss/-t は依然 -i raw.webm の前（入力オプション）
    expect(args.indexOf('-ss')).toBeLessThan(inputs[0]);
    expect(args.indexOf('-t')).toBeLessThan(inputs[0]);
  });
```

- [ ] **Step 2: テスト失敗を確認**

```bash
npx vitest run test/ffargs.test.ts
```
Expected: FAIL — ripple オプションが未知 / filter_complex が出力に出ない。

- [ ] **Step 3: 実装を書き換え**

`src/main/export/ffargs.ts` の `segmentVideoArgs` 全体を以下に置換:

```ts
/** raw 映像のスロット区間を切り出し、末尾フレームを slotDuration までフリーズして均一H.264で出力。
 *  ripple 指定時は image2 を第2入力にして overlay を挿入する。 */
export function segmentVideoArgs(input: {
  rawPath: string;
  slot: PreviewSlot;
  outPath: string;
  fps: number;
  ripple?: { pattern: string; fps: number };
}): string[] {
  const { rawPath, slot, outPath, fps, ripple } = input;
  const videoSpan = Math.max(0, slot.videoEnd - slot.videoStart);
  const freeze = Math.max(0, slot.slotDuration - videoSpan);
  const tpadChain = `tpad=stop_mode=clone:stop_duration=${freeze},fps=${fps},setpts=PTS-STARTPTS`;
  // -ss/-t は -i より前（入力オプション）。Phase 7a の重要バグ修正と同じ理由。
  if (ripple) {
    return [
      '-y',
      '-ss', String(slot.videoStart),
      '-t', String(videoSpan),
      '-i', rawPath,
      '-framerate', String(ripple.fps),
      '-i', ripple.pattern,
      '-filter_complex', `[0:v] ${tpadChain} [vbase]; [vbase][1:v] overlay=shortest=1 [vout]`,
      '-map', '[vout]',
      '-an',
      ...VIDEO_ENCODE,
      outPath,
    ];
  }
  return [
    '-y',
    '-ss', String(slot.videoStart),
    '-t', String(videoSpan),
    '-i', rawPath,
    '-vf', tpadChain,
    '-an',
    ...VIDEO_ENCODE,
    outPath,
  ];
}
```

- [ ] **Step 4: テスト PASS を確認**

```bash
npx vitest run test/ffargs.test.ts
npm test          # 全体（既存の segmentVideoArgs テストも引き続き通ること）
npm run typecheck
npm run build
```
Expected: 既存テスト含め全件 PASS、typecheck/build クリーン。

- [ ] **Step 5: Commit**

```bash
git add src/main/export/ffargs.ts test/ffargs.test.ts
git commit -m "feat(export): extend segmentVideoArgs with optional ripple overlay"
```

---

## Task 7: `generateRippleFramesForSlot` を実装（I/O）

**Files:**
- Modify: `src/main/export/rippleFrames.ts`
- Modify: `test/rippleFrames.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/rippleFrames.test.ts` の冒頭 import を更新:

```ts
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { activeRipplesAt, rippleSvg, generateRippleFramesForSlot, type ActiveRippleVisual } from '../src/main/export/rippleFrames';
```

ファイル末尾に追加:

```ts
describe('generateRippleFramesForSlot', () => {
  let outDir: string;
  beforeEach(async () => { outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-rip-')); });
  afterEach(async () => { await fs.rm(outDir, { recursive: true, force: true }); });

  it('returns null and writes no files when no clicks fall in the slot', async () => {
    const r = await generateRippleFramesForSlot({
      slot, clicks: [], fps: 30, videoW: 1920, videoH: 1080, outDir,
    });
    expect(r).toBeNull();
    const files = await fs.readdir(outDir).catch(() => []);
    expect(files.length).toBe(0);
  });

  it('writes ceil(slotDuration*fps) PNG frames and returns the pattern', async () => {
    const r = await generateRippleFramesForSlot({
      slot, clicks: [{ t: 1.5, x: 100, y: 200, button: 1 }],
      fps: 10, videoW: 640, videoH: 360, outDir,
    });
    expect(r).not.toBeNull();
    expect(r!.fps).toBe(10);
    expect(r!.pattern).toBe(path.join(outDir, '%05d.png'));
    const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
    // slotDuration=3, fps=10 → 30 frames numbered 00000..00029
    expect(files.length).toBe(30);
    expect(files[0]).toBe('00000.png');
    expect(files[29]).toBe('00029.png');
    // each file is a non-trivial PNG (sharp writes a valid header)
    const head = await fs.readFile(path.join(outDir, '00000.png'));
    expect(head.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG signature
  });

  it('aborts when the signal fires', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(generateRippleFramesForSlot({
      slot, clicks: [{ t: 1.5, x: 0, y: 0, button: 1 }],
      fps: 10, videoW: 100, videoH: 100, outDir, signal: ac.signal,
    })).rejects.toThrow(/cancel/i);
  });
});
```

import 行に vitest の `beforeEach`/`afterEach` を含めるよう更新:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
```

- [ ] **Step 2: テスト失敗を確認**

```bash
npx vitest run test/rippleFrames.test.ts
```
Expected: FAIL — `generateRippleFramesForSlot is not a function`.

- [ ] **Step 3: 実装を追加**

`src/main/export/rippleFrames.ts` 上部の import に node 標準と sharp を追加:

```ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
```

ファイル末尾に以下の関数を追加:

```ts
export interface GenerateRippleFramesInput {
  slot: PreviewSlot;
  clicks: ClickEvent[];      // segment.clicks のフラット化を想定（slot 外は内部で除外）
  fps: number;
  videoW: number;
  videoH: number;
  outDir: string;            // <tmpDir>/<slotId>_ripple
  signal?: AbortSignal;
}

/**
 * スロットに属する click だけを描画した透明 PNG シーケンスを outDir に出す。
 * クリック空なら null（呼び出し側は overlay をスキップ）。
 */
export async function generateRippleFramesForSlot(
  input: GenerateRippleFramesInput,
): Promise<{ pattern: string; fps: number } | null> {
  const slotClicks = input.clicks.filter((c) => c.t > input.slot.videoStart && c.t <= input.slot.videoEnd);
  if (slotClicks.length === 0) return null;
  await fs.mkdir(input.outDir, { recursive: true });
  const totalFrames = Math.ceil(input.slot.slotDuration * input.fps);
  for (let n = 0; n < totalFrames; n++) {
    if (input.signal?.aborted) throw new Error('Export cancelled');
    const tSlot = n / input.fps;
    const actives = activeRipplesAt(slotClicks, input.slot, tSlot, input.videoW);
    const svg = rippleSvg(actives, input.videoW, input.videoH);
    const filePath = path.join(input.outDir, `${String(n).padStart(5, '0')}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(filePath);
  }
  return { pattern: path.join(input.outDir, '%05d.png'), fps: input.fps };
}
```

- [ ] **Step 4: テスト PASS を確認**

```bash
npx vitest run test/rippleFrames.test.ts
npm run typecheck
```
Expected: 全件 PASS、typecheck クリーン。

メモ: テスト 1 件あたり 30 フレームを実書き出しするので、I/O テストは数百ミリ秒〜数秒かかる（sharp の初期化）。これは正常。

- [ ] **Step 5: Commit**

```bash
git add src/main/export/rippleFrames.ts test/rippleFrames.test.ts
git commit -m "feat(export): generate per-slot ripple PNG sequence via sharp"
```

---

## Task 8: `exportService.ts` を統合（既存テストも更新）

**Files:**
- Modify: `src/main/export/exportService.ts`
- Modify: `test/exportService.test.ts`

- [ ] **Step 1: 既存テストを新しい挙動に合わせて更新**

`test/exportService.test.ts` の最初のテストを以下のように置換（resolution プローブが増えるので probeCalls.length が変わる）:

```ts
  it('probes fps + resolution + clip durations, runs per-segment + concat + mux, reports progress', async () => {
    const ffmpegCalls: string[][] = [];
    const probeCalls: string[][] = [];
    const progress: number[] = [];

    await runExport({
      segments: [seg('seg-001', 1, 3, 'tts/seg-001.wav'), seg('seg-002', 3, 6, null)],
      projectDir,
      outPath: path.join(projectDir, 'out.mp4'),
      tmpDir,
      credit: 'VOICEVOX',
      runFfmpeg: async (args) => { ffmpegCalls.push(args); },
      runProbe: async (args) => {
        probeCalls.push(args);
        const s = args.join(' ');
        if (s.includes('r_frame_rate')) return '30/1';
        if (s.includes('width,height')) return '1920,1080';
        return '2.0';
      },
      onProgress: (p) => progress.push(p),
    });

    expect(probeCalls.length).toBe(3); // fps + resolution + 1 clip duration (seg-002 has no ttsAudio)
    expect(ffmpegCalls.length).toBe(7); // 2 video + 2 audio + 2 concat + 1 mux (no clicks → no overlay)
    expect(ffmpegCalls[6][ffmpegCalls[6].length - 1]).toBe(path.join(projectDir, 'out.mp4'));
    expect(progress[progress.length - 1]).toBe(100);
    // 重要: clicks 空のスロットでは ripple overlay は使われない（-vf 形式のまま）
    for (let i = 0; i < 2; i++) {
      expect(ffmpegCalls[i * 2]).toContain('-vf');
      expect(ffmpegCalls[i * 2]).not.toContain('-filter_complex');
    }
  });
```

そのテストの直後に新しいテストを追加（ripple ありの経路を DI でカバー）:

```ts
  it('uses ripple overlay for slots that have clicks', async () => {
    const ffmpegCalls: string[][] = [];
    const generateCalls: Array<{ segmentId: string; clickCount: number }> = [];
    const segWithClicks: Segment = {
      ...seg('seg-001', 1, 3, 'tts/seg-001.wav'),
      clicks: [{ t: 1.5, x: 100, y: 200, button: 1 }],
    };
    await runExport({
      segments: [segWithClicks],
      projectDir,
      outPath: path.join(projectDir, 'out.mp4'),
      tmpDir,
      credit: 'VOICEVOX',
      runFfmpeg: async (args) => { ffmpegCalls.push(args); },
      runProbe: async (args) => {
        const s = args.join(' ');
        if (s.includes('r_frame_rate')) return '30/1';
        if (s.includes('width,height')) return '1920,1080';
        return '2.5';
      },
      generateRippleFrames: async (input) => {
        generateCalls.push({ segmentId: input.slot.segmentId, clickCount: input.clicks.length });
        return { pattern: path.join(input.outDir, '%05d.png'), fps: input.fps };
      },
    });

    expect(generateCalls).toEqual([{ segmentId: 'seg-001', clickCount: 1 }]);
    // seg-001 の video 中間クリップ呼び出しに ripple overlay が入っている
    const videoCall = ffmpegCalls[0];
    expect(videoCall).toContain('-filter_complex');
    expect(videoCall).toContain('-map');
    expect(videoCall.join(' ')).toContain('overlay=shortest=1');
  });
```

`Segment` 型 import 行が既存ファイルに無ければ `import { type Segment } from '../src/shared/types';` を確認（既存にあり）。

- [ ] **Step 2: テスト失敗を確認**

```bash
npx vitest run test/exportService.test.ts
```
Expected: FAIL — 1件目は `probeCalls.length` 不一致、2件目は `generateRippleFrames` を opts が受け取らない / overlay が出ない。

- [ ] **Step 3: 実装を書く**

`src/main/export/exportService.ts` を以下に置換:

```ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Segment } from '../../shared/types';
import { computePreviewTimeline } from '../../shared/previewTimeline';
import {
  probeDurationArgs, parseProbeDuration, probeFpsArgs, parseFps,
  probeResolutionArgs, parseResolution,
  segmentVideoArgs, segmentAudioArgs, concatArgs, muxArgs,
} from './ffargs';
import { generateRippleFramesForSlot, type GenerateRippleFramesInput } from './rippleFrames';

export interface ExportOptions {
  segments: Segment[];
  projectDir: string;
  outPath: string;
  tmpDir: string;
  credit: string;
  runFfmpeg: (args: string[]) => Promise<void>;
  runProbe: (args: string[]) => Promise<string>;
  /** デフォルトは本物の generateRippleFramesForSlot。テストでモック可。 */
  generateRippleFrames?: (
    input: GenerateRippleFramesInput,
  ) => Promise<{ pattern: string; fps: number } | null>;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

function listLine(p: string): string {
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

export async function runExport(opts: ExportOptions): Promise<void> {
  if (opts.segments.length === 0) throw new Error('No segments to export');
  const raw = path.join(opts.projectDir, 'assets/raw.webm');
  await fs.mkdir(opts.tmpDir, { recursive: true });

  const fps = parseFps(await opts.runProbe(probeFpsArgs(raw)));
  const { width: videoW, height: videoH } = parseResolution(await opts.runProbe(probeResolutionArgs(raw)));

  const clipDurations = new Map<string, number>();
  for (const s of opts.segments) {
    if (!s.ttsAudio) continue;
    const d = parseProbeDuration(await opts.runProbe(probeDurationArgs(path.join(opts.projectDir, s.ttsAudio))));
    clipDurations.set(s.id, d);
  }

  const slots = computePreviewTimeline(opts.segments, clipDurations);
  if (slots.length === 0) throw new Error('No enabled segments to export');
  const total = slots.length + 3; // segments + 2 concat + 1 mux
  let done = 0;
  const tick = () => { done += 1; opts.onProgress?.(Math.round((done / total) * 100)); };

  const generate = opts.generateRippleFrames ?? generateRippleFramesForSlot;

  const videoParts: string[] = [];
  const audioParts: string[] = [];
  for (const slot of slots) {
    if (opts.signal?.aborted) throw new Error('Export cancelled');
    const segment = opts.segments.find((s) => s.id === slot.segmentId);
    const clicks = segment?.clicks ?? [];
    const ripple = await generate({
      slot,
      clicks,
      fps,
      videoW,
      videoH,
      outDir: path.join(opts.tmpDir, `${slot.segmentId}_ripple`),
      signal: opts.signal,
    });

    const vOut = path.join(opts.tmpDir, `${slot.segmentId}.mp4`);
    const aOut = path.join(opts.tmpDir, `${slot.segmentId}.wav`);
    const clipPath = segment && segment.ttsAudio ? path.join(opts.projectDir, segment.ttsAudio) : null;
    await opts.runFfmpeg(segmentVideoArgs({ rawPath: raw, slot, outPath: vOut, fps, ripple: ripple ?? undefined }));
    await opts.runFfmpeg(segmentAudioArgs({ clipPath, slotDuration: slot.slotDuration, outPath: aOut }));
    videoParts.push(vOut);
    audioParts.push(aOut);
    tick();
  }

  const vList = path.join(opts.tmpDir, 'video.txt');
  const aList = path.join(opts.tmpDir, 'audio.txt');
  await fs.writeFile(vList, videoParts.map(listLine).join('\n'), 'utf8');
  await fs.writeFile(aList, audioParts.map(listLine).join('\n'), 'utf8');

  const vConcat = path.join(opts.tmpDir, 'video.mp4');
  const aConcat = path.join(opts.tmpDir, 'audio.wav');
  await opts.runFfmpeg(concatArgs({ listFile: vList, outPath: vConcat }));
  tick();
  await opts.runFfmpeg(concatArgs({ listFile: aList, outPath: aConcat }));
  tick();

  await opts.runFfmpeg(muxArgs({ videoPath: vConcat, audioPath: aConcat, outPath: opts.outPath, comment: opts.credit }));
  tick();
}
```

注意: 既存テスト 1 件目（修正版）は `clicks: []` のセグメントしか使わないので `ripple = null` が返り、`segmentVideoArgs` の従来パス（`-vf` 形式）が走る。これにより既存の動作互換が保たれる。

- [ ] **Step 4: テスト PASS を確認**

```bash
npx vitest run test/exportService.test.ts
npm test          # 全体
npm run typecheck
npm run build
```
Expected: 全件 PASS、typecheck/build クリーン。

- [ ] **Step 5: Commit**

```bash
git add src/main/export/exportService.ts test/exportService.test.ts
git commit -m "feat(export): integrate per-slot ripple burn-in into runExport"
```

---

## 完了の定義

- 全タスクのコミットが `phase7b-ripple-burn-in` ブランチに揃っている。
- `npm test` / `npm run typecheck` / `npm run build` がクリーン。
- 新規ユニットテスト（rippleFrames, parseResolution, segmentVideoArgs(ripple), exportService ripple 経路）が緑。
- **手動 E2E（要・実機、`npm run dev`）**: クリック付きプロジェクトで書き出しを実行し、出力 MP4 でリップルが期待の位置・タイミングで現れる（プレビューとおおむね一致、フリーズ区間に伸びる場合あり、スロット境界をまたがない）こと、クリック無しセグメントのみの書き出しも従来どおり成功すること、キャンセルが効くこと、tmp が残らないこと。

非対象（後続）:
- リップル ON/OFF トグル、配色/期間カスタマイズ
- 出力品質/fps 設定
- フェーズ6b（端トリム/区間削除）、フェーズ8（ウィザード/インストーラ）
