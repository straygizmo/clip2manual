# MVP書き出し（フェーズ7ラウンドA）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プロジェクトを「映像を音声に合わせる」リタイミング済み映像＋TTS音声の MP4（H.264/AAC, 元解像度）として FFmpeg で書き出す（リップル焼き込みは含まない）。

**Architecture:** main プロセスで FFmpeg を子プロセス実行（whisper構成踏襲）。`computePreviewTimeline` を `shared/` に移して書き出しでも再利用。FFmpeg/ffprobe 引数は純関数 `ffargs.ts` で組み立て単体テスト。`exportService` が注入された runner/probe でセグメントごとの中間クリップ→concat→mux を統括。

**Tech Stack:** Electron + TypeScript + React、FFmpeg/ffprobe（vendor 静的ビルド）、Vitest（test/・node環境・`.test.ts`）。

spec: `docs/superpowers/specs/2026-05-27-clip2manual-phase7a-export-design.md`

---

## File Structure

- `src/shared/previewTimeline.ts` — **Move** from `src/renderer/editor/`（純粋・renderer/main 共有）
- `src/main/ffmpegPaths.ts` — **Create**: ffmpeg/ffprobe パス解決（env→manifest）
- `src/main/export/ffargs.ts` — **Create**: FFmpeg/ffprobe 引数の純関数群＋パース（単体テスト対象）
- `src/main/export/ffmpegRunner.ts` — **Create**: spawn 抽象（`runFfmpeg`/`runProbe`）
- `src/main/export/exportService.ts` — **Create**: パイプライン統括（注入runner/probe、単体テスト対象）
- `src/main/ipc/export.ts` — **Create**: IPC（dialog/run/progress/cancel）
- `src/main/ipc/index.ts` — **Modify**: `registerExportIpc` 登録
- `src/preload/index.ts` / `src/renderer/global.d.ts` — **Modify**: export API 公開・型
- `src/renderer/editor/EditorLayout.tsx` — **Modify**: 「書き出し」ボタン＋進捗
- `scripts/setup-ffmpeg.mjs` / `package.json` — **Create/Modify**: `setup:ffmpeg`
- 各 `test/*.test.ts`

依存順: T1（previewTimeline移動）→ T2（ffmpegPaths, TDD）→ T3（ffargs, TDD）→ T4（runner+exportService, TDD）→ T5（IPC配線）→ T6（UI）→ T7（setup script）→ T8（検証）。

---

## Task 1: `previewTimeline.ts` を `shared/` に移動

**Files:**
- Move: `src/renderer/editor/previewTimeline.ts` → `src/shared/previewTimeline.ts`
- Modify: `src/renderer/audio/ttsPreview.ts`, `test/previewTimeline.test.ts`, `tsconfig.node.json`

- [ ] **Step 1: ファイルを移動**

```bash
git mv src/renderer/editor/previewTimeline.ts src/shared/previewTimeline.ts
```

- [ ] **Step 2: 移動先の import を修正**

`src/shared/previewTimeline.ts` の先頭 import を変更（`shared` 内になったため相対パスが変わる）:

```ts
import { type Segment } from './types';
```

- [ ] **Step 3: 参照元を更新**

`src/renderer/audio/ttsPreview.ts` の import:

```ts
import { computePreviewTimeline, type PreviewSlot } from '../../shared/previewTimeline';
```

`test/previewTimeline.test.ts` の import:

```ts
import { computePreviewTimeline, previewTotalDuration, TAIL_PAUSE } from '../src/shared/previewTimeline';
```

- [ ] **Step 4: tsconfig.node.json を更新**

`tsconfig.node.json` の `include` から `"src/renderer/editor/previewTimeline.ts",` の行を削除する（`src/shared` は既に include 済みなので新パスは自動的に含まれる）。`rippleOverlay.ts` の行は残す。

- [ ] **Step 5: 検証（全 green）**

Run: `npm test` → PASS（previewTimeline テストが新パスで通る、回帰なし）
Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "refactor: move previewTimeline to shared for export reuse"
```

---

## Task 2: `ffmpegPaths.ts`（パス解決）

**Files:**
- Create: `src/main/ffmpegPaths.ts`
- Test: `test/ffmpegPaths.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/ffmpegPaths.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveFfmpeg, FfmpegNotProvisionedError } from '../src/main/ffmpegPaths';

let dir: string;
beforeEach(async () => {
  delete process.env.C2M_FFMPEG;
  delete process.env.C2M_FFPROBE;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-ff-'));
});
afterEach(async () => {
  delete process.env.C2M_FFMPEG;
  delete process.env.C2M_FFPROBE;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveFfmpeg', () => {
  it('throws FfmpegNotProvisionedError when no manifest and no env', () => {
    expect(() => resolveFfmpeg({ vendorDir: dir })).toThrow(FfmpegNotProvisionedError);
  });

  it('resolves from the vendor manifest', async () => {
    const ffmpegPath = path.join(dir, 'ffmpeg.exe');
    const ffprobePath = path.join(dir, 'ffprobe.exe');
    await fs.writeFile(ffmpegPath, 'x');
    await fs.writeFile(ffprobePath, 'x');
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ffmpegPath, ffprobePath }));
    expect(resolveFfmpeg({ vendorDir: dir })).toEqual({ ffmpegPath, ffprobePath });
  });

  it('prefers env overrides', async () => {
    const ffmpegPath = path.join(dir, 'a.exe');
    const ffprobePath = path.join(dir, 'b.exe');
    await fs.writeFile(ffmpegPath, 'x');
    await fs.writeFile(ffprobePath, 'x');
    process.env.C2M_FFMPEG = ffmpegPath;
    process.env.C2M_FFPROBE = ffprobePath;
    expect(resolveFfmpeg({ vendorDir: dir })).toEqual({ ffmpegPath, ffprobePath });
  });

  it('throws when the manifest points to a missing file', async () => {
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ffmpegPath: path.join(dir, 'no.exe'), ffprobePath: path.join(dir, 'no2.exe') }));
    expect(() => resolveFfmpeg({ vendorDir: dir })).toThrow(FfmpegNotProvisionedError);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- ffmpegPaths`
Expected: FAIL（未作成）

- [ ] **Step 3: 実装**

`src/main/ffmpegPaths.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';

export class FfmpegNotProvisionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegNotProvisionedError';
  }
}

export interface FfmpegPaths {
  ffmpegPath: string;
  ffprobePath: string;
}

function assertExists(p: string): void {
  if (!fs.existsSync(p)) {
    throw new FfmpegNotProvisionedError(`FFmpeg file not found: ${p}. Run: npm run setup:ffmpeg`);
  }
}

/**
 * ffmpeg/ffprobe のパスを解決する。
 * 優先順: 環境変数 C2M_FFMPEG / C2M_FFPROBE → vendor/ffmpeg/manifest.json。
 */
export function resolveFfmpeg(opts: { vendorDir?: string } = {}): FfmpegPaths {
  const envFf = process.env.C2M_FFMPEG;
  const envProbe = process.env.C2M_FFPROBE;
  if (envFf && envProbe) {
    assertExists(envFf);
    assertExists(envProbe);
    return { ffmpegPath: envFf, ffprobePath: envProbe };
  }

  const vendorDir = opts.vendorDir ?? path.join(process.cwd(), 'vendor', 'ffmpeg');
  const manifestPath = path.join(vendorDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new FfmpegNotProvisionedError(
      `FFmpeg is not provisioned (${manifestPath} not found). Run: npm run setup:ffmpeg`,
    );
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FfmpegPaths;
  assertExists(m.ffmpegPath);
  assertExists(m.ffprobePath);
  return { ffmpegPath: m.ffmpegPath, ffprobePath: m.ffprobePath };
}
```

- [ ] **Step 4: パス確認**

Run: `npm test -- ffmpegPaths`
Expected: PASS（4件）
Run: `npm run typecheck` → PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/ffmpegPaths.ts test/ffmpegPaths.test.ts
git commit -m "feat: add ffmpeg/ffprobe path resolver"
```

---

## Task 3: `ffargs.ts`（FFmpeg 引数の純関数）

**Files:**
- Create: `src/main/export/ffargs.ts`
- Test: `test/ffargs.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/ffargs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  probeDurationArgs, parseProbeDuration, probeFpsArgs, parseFps,
  segmentVideoArgs, segmentAudioArgs, concatArgs, muxArgs,
} from '../src/main/export/ffargs';
import { type PreviewSlot } from '../src/shared/previewTimeline';

const slot: PreviewSlot = { segmentId: 'seg-001', slotStart: 0, slotDuration: 5, videoStart: 1, videoEnd: 3, clipDuration: 4.7 };

describe('probe parsing', () => {
  it('parseProbeDuration parses a numeric stdout', () => {
    expect(parseProbeDuration('12.34\n')).toBeCloseTo(12.34);
  });
  it('parseProbeDuration throws on garbage', () => {
    expect(() => parseProbeDuration('N/A')).toThrow();
  });
  it('parseFps parses a rational and a plain number', () => {
    expect(parseFps('30000/1001')).toBeCloseTo(29.97, 1);
    expect(parseFps('30/1')).toBe(30);
    expect(parseFps('25')).toBe(25);
  });
  it('parseFps throws on garbage', () => {
    expect(() => parseFps('0/0')).toThrow();
  });
  it('probeDurationArgs/probeFpsArgs include the file and the right show_entries', () => {
    expect(probeDurationArgs('a.wav')).toContain('a.wav');
    expect(probeDurationArgs('a.wav').join(' ')).toContain('format=duration');
    expect(probeFpsArgs('v.webm').join(' ')).toContain('r_frame_rate');
  });
});

describe('segmentVideoArgs', () => {
  it('trims [videoStart, +videoSpan] and freezes the remainder', () => {
    const args = segmentVideoArgs({ rawPath: 'raw.webm', slot, outPath: 'o.mp4', fps: 30 });
    const s = args.join(' ');
    expect(s).toContain('-ss 1'); // videoStart
    expect(s).toContain('-t 2');  // videoSpan = videoEnd - videoStart = 2
    expect(s).toContain('stop_duration=3'); // slotDuration - videoSpan = 5 - 2
    expect(s).toContain('libx264');
    expect(args[args.length - 1]).toBe('o.mp4');
  });
});

describe('segmentAudioArgs', () => {
  it('with a clip pads to slotDuration', () => {
    const args = segmentAudioArgs({ clipPath: 'c.wav', slotDuration: 5, outPath: 'a.wav' });
    const s = args.join(' ');
    expect(s).toContain('c.wav');
    expect(s).toContain('apad');
    expect(s).toContain('-t 5');
  });
  it('without a clip generates slotDuration of silence', () => {
    const args = segmentAudioArgs({ clipPath: null, slotDuration: 5, outPath: 'a.wav' });
    const s = args.join(' ');
    expect(s).toContain('anullsrc');
    expect(s).toContain('-t 5');
  });
});

describe('concatArgs / muxArgs', () => {
  it('concatArgs uses the concat demuxer with stream copy', () => {
    const s = concatArgs({ listFile: 'l.txt', outPath: 'o.mp4' }).join(' ');
    expect(s).toContain('-f concat');
    expect(s).toContain('-safe 0');
    expect(s).toContain('-c copy');
  });
  it('muxArgs copies video, encodes aac, embeds the credit comment', () => {
    const args = muxArgs({ videoPath: 'v.mp4', audioPath: 'a.wav', outPath: 'out.mp4', comment: 'VOICEVOX' });
    const s = args.join(' ');
    expect(s).toContain('-c:v copy');
    expect(s).toContain('-c:a aac');
    expect(args).toContain('comment=VOICEVOX');
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- ffargs`
Expected: FAIL（未作成）

- [ ] **Step 3: 実装**

`src/main/export/ffargs.ts`:

```ts
import { type PreviewSlot } from '../../shared/previewTimeline';

/** 全中間クリップを揃えるための共通エンコード設定。 */
const VIDEO_ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
const AUDIO_RATE = '48000';

export function probeDurationArgs(file: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', file];
}

export function parseProbeDuration(stdout: string): number {
  const n = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(n)) throw new Error(`Cannot parse ffprobe duration: ${JSON.stringify(stdout)}`);
  return n;
}

export function probeFpsArgs(file: string): string[] {
  return ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'default=nokey=1:noprint_wrappers=1', file];
}

export function parseFps(stdout: string): number {
  const s = stdout.trim();
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (den > 0 && num > 0) return num / den;
  }
  const f = Number.parseFloat(s);
  if (Number.isFinite(f) && f > 0) return f;
  throw new Error(`Cannot parse ffprobe fps: ${JSON.stringify(stdout)}`);
}

/** raw 映像のスロット区間を切り出し、末尾フレームを slotDuration までフリーズして均一H.264で出力。 */
export function segmentVideoArgs(input: { rawPath: string; slot: PreviewSlot; outPath: string; fps: number }): string[] {
  const { rawPath, slot, outPath, fps } = input;
  const videoSpan = Math.max(0, slot.videoEnd - slot.videoStart);
  const freeze = Math.max(0, slot.slotDuration - videoSpan);
  return [
    '-y',
    '-ss', String(slot.videoStart),
    '-i', rawPath,
    '-t', String(videoSpan),
    '-vf', `tpad=stop_mode=clone:stop_duration=${freeze},fps=${fps},setpts=PTS-STARTPTS`,
    '-an',
    ...VIDEO_ENCODE,
    outPath,
  ];
}

/** スロットの音声 = TTSクリップ→無音 pad で slotDuration、無ければ slotDuration の無音。均一PCM。 */
export function segmentAudioArgs(input: { clipPath: string | null; slotDuration: number; outPath: string }): string[] {
  const { clipPath, slotDuration, outPath } = input;
  if (clipPath) {
    return [
      '-y',
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

/** concat デマルチプレクサ（同一パラメータの中間クリップをストリームコピーで連結）。 */
export function concatArgs(input: { listFile: string; outPath: string }): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', input.listFile, '-c', 'copy', input.outPath];
}

/** 映像＋音声を多重化し、メタデータ comment（クレジット）を付けて MP4 出力。 */
export function muxArgs(input: { videoPath: string; audioPath: string; outPath: string; comment: string }): string[] {
  return [
    '-y',
    '-i', input.videoPath,
    '-i', input.audioPath,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-metadata', `comment=${input.comment}`,
    '-movflags', '+faststart',
    '-shortest',
    input.outPath,
  ];
}
```

- [ ] **Step 4: パス確認**

Run: `npm test -- ffargs`
Expected: PASS
Run: `npm run typecheck` → PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/export/ffargs.ts test/ffargs.test.ts
git commit -m "feat: add ffmpeg argument builders for export"
```

---

## Task 4: `ffmpegRunner.ts` ＋ `exportService.ts`

**Files:**
- Create: `src/main/export/ffmpegRunner.ts`
- Create: `src/main/export/exportService.ts`
- Test: `test/exportService.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/exportService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runExport } from '../src/main/export/exportService';
import { type Segment } from '../src/shared/types';

function seg(id: string, start: number, end: number, ttsAudio: string | null): Segment {
  return {
    id, videoStart: start, videoEnd: end, originalText: '', correctedText: '',
    ttsAudio, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}

let projectDir: string;
let tmpDir: string;
beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-exp-'));
  tmpDir = path.join(projectDir, 'export-tmp');
});
afterEach(async () => { await fs.rm(projectDir, { recursive: true, force: true }); });

describe('runExport', () => {
  it('probes fps + clip durations, runs per-segment + concat + mux, reports progress', async () => {
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
        return args.join(' ').includes('r_frame_rate') ? '30/1' : '2.0';
      },
      onProgress: (p) => progress.push(p),
    });

    // fps probe + 1 clip duration probe (seg-002 has no ttsAudio)
    expect(probeCalls.length).toBe(2);
    // 2 video + 2 audio + 2 concat + 1 mux = 7 ffmpeg calls
    expect(ffmpegCalls.length).toBe(7);
    // last call is the mux producing out.mp4
    expect(ffmpegCalls[6][ffmpegCalls[6].length - 1]).toBe(path.join(projectDir, 'out.mp4'));
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('throws when there are no segments', async () => {
    await expect(runExport({
      segments: [], projectDir, outPath: path.join(projectDir, 'o.mp4'), tmpDir, credit: 'x',
      runFfmpeg: async () => {}, runProbe: async () => '30/1',
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- exportService`
Expected: FAIL（未作成）

- [ ] **Step 3: `ffmpegRunner.ts` を実装**

`src/main/export/ffmpegRunner.ts`:

```ts
import { spawn } from 'node:child_process';

/** ffmpeg を実行する。非0終了で reject（stderr 末尾付き）。 */
export function runFfmpeg(ffmpegPath: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args);
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    let tail = '';
    child.stderr.on('data', (c: Buffer) => { tail = (tail + c.toString()).slice(-2000); });
    child.on('error', (e) => { signal?.removeEventListener('abort', onAbort); reject(e); });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${tail}`));
    });
  });
}

/** ffprobe を実行し stdout を返す。 */
export function runProbe(ffprobePath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, args);
    let out = '';
    let tail = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { tail = (tail + c.toString()).slice(-1000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`ffprobe exited with code ${code}\n${tail}`));
    });
  });
}
```

- [ ] **Step 4: `exportService.ts` を実装**

`src/main/export/exportService.ts`:

```ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Segment } from '../../shared/types';
import { computePreviewTimeline } from '../../shared/previewTimeline';
import {
  probeDurationArgs, parseProbeDuration, probeFpsArgs, parseFps,
  segmentVideoArgs, segmentAudioArgs, concatArgs, muxArgs,
} from './ffargs';

export interface ExportOptions {
  segments: Segment[];
  projectDir: string; // assets/raw.webm, tts/<id>.wav がある
  outPath: string;    // 最終 MP4
  tmpDir: string;     // 中間ファイル
  credit: string;     // メタデータ comment
  runFfmpeg: (args: string[]) => Promise<void>;
  runProbe: (args: string[]) => Promise<string>;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** concat リスト用にパスを安全に引用する。 */
function listLine(p: string): string {
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

export async function runExport(opts: ExportOptions): Promise<void> {
  if (opts.segments.length === 0) throw new Error('No segments to export');
  const raw = path.join(opts.projectDir, 'assets/raw.webm');
  await fs.mkdir(opts.tmpDir, { recursive: true });

  const fps = parseFps(await opts.runProbe(probeFpsArgs(raw)));

  const clipDurations = new Map<string, number>();
  for (const s of opts.segments) {
    if (!s.ttsAudio) continue;
    const d = parseProbeDuration(await opts.runProbe(probeDurationArgs(path.join(opts.projectDir, s.ttsAudio))));
    clipDurations.set(s.id, d);
  }

  const slots = computePreviewTimeline(opts.segments, clipDurations);
  const total = slots.length + 3; // segments + 2 concat + 1 mux
  let done = 0;
  const tick = () => { done += 1; opts.onProgress?.(Math.round((done / total) * 100)); };

  const videoParts: string[] = [];
  const audioParts: string[] = [];
  for (const slot of slots) {
    if (opts.signal?.aborted) throw new Error('Export cancelled');
    const vOut = path.join(opts.tmpDir, `${slot.segmentId}.mp4`);
    const aOut = path.join(opts.tmpDir, `${slot.segmentId}.wav`);
    const segment = opts.segments.find((s) => s.id === slot.segmentId);
    const clipPath = segment && segment.ttsAudio ? path.join(opts.projectDir, segment.ttsAudio) : null;
    await opts.runFfmpeg(segmentVideoArgs({ rawPath: raw, slot, outPath: vOut, fps }));
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

- [ ] **Step 5: パス確認**

Run: `npm test -- exportService`
Expected: PASS（2件）
Run: `npm run typecheck` → PASS

- [ ] **Step 6: コミット**

```bash
git add src/main/export/ffmpegRunner.ts src/main/export/exportService.ts test/exportService.test.ts
git commit -m "feat: add export service pipeline (per-segment retime + concat + mux)"
```

---

## Task 5: IPC 配線（`export.ts` ＋ preload ＋ 型）

**Files:**
- Create: `src/main/ipc/export.ts`
- Modify: `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/renderer/global.d.ts`

> IPC ハンドラ単体テストは無い。`npm run typecheck` + `npm run build` で検証。

- [ ] **Step 1: `src/main/ipc/export.ts` を作成**

```ts
// src/main/ipc/export.ts
import { ipcMain, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { projectSession } from '../projectSession';
import { resolveFfmpeg } from '../ffmpegPaths';
import { runExport } from '../export/exportService';
import { runFfmpeg, runProbe } from '../export/ffmpegRunner';

const CREDIT = 'Audio synthesized with VOICEVOX (https://voicevox.hps.info/).';
let currentAbort: AbortController | null = null;

export function registerExportIpc(): void {
  ipcMain.handle('export:dialog', async () => {
    const { project } = projectSession.getCurrent();
    const res = await dialog.showSaveDialog({
      defaultPath: `${project.meta.name}.mp4`,
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return res.filePath;
  });

  ipcMain.handle('export:run', async (event, outPath: string) => {
    const { dir, project } = projectSession.getCurrent();
    const { ffmpegPath, ffprobePath } = resolveFfmpeg();
    const tmpDir = path.join(dir, 'export-tmp');
    currentAbort = new AbortController();
    try {
      await runExport({
        segments: project.segments,
        projectDir: dir,
        outPath,
        tmpDir,
        credit: CREDIT,
        runFfmpeg: (args) => runFfmpeg(ffmpegPath, args, currentAbort!.signal),
        runProbe: (args) => runProbe(ffprobePath, args),
        onProgress: (p) => event.sender.send('export:progress', p),
        signal: currentAbort.signal,
      });
      return { ok: true as const, outPath, credit: CREDIT };
    } finally {
      currentAbort = null;
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  ipcMain.handle('export:cancel', () => {
    currentAbort?.abort();
    return { ok: true as const };
  });
}
```

- [ ] **Step 2: 登録**

`src/main/ipc/index.ts` に追加:

```ts
import { registerExportIpc } from './export';
```
`registerIpc()` 内の最後に `registerExportIpc();` を追加。

- [ ] **Step 3: preload で公開**

`src/preload/index.ts` の `exposeInMainWorld('api', { ... })` の末尾（`onTtsProgress` ブロックの後）に追加:

```ts
  exportDialog: () => ipcRenderer.invoke('export:dialog'),
  runExport: (outPath: string) => ipcRenderer.invoke('export:run', outPath),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb: (percent: number) => void) => {
    const listener = (_e: unknown, percent: number) => cb(percent);
    ipcRenderer.on('export:progress', listener);
    return () => { ipcRenderer.removeListener('export:progress', listener); };
  },
```

- [ ] **Step 4: 型を追加**

`src/renderer/global.d.ts` の `api` インターフェース末尾（`onTtsProgress` 行の後）に追加:

```ts
      exportDialog: () => Promise<string | null>;
      runExport: (outPath: string) => Promise<{ ok: true; outPath: string; credit: string }>;
      cancelExport: () => Promise<{ ok: true }>;
      onExportProgress: (cb: (percent: number) => void) => () => void;
```

- [ ] **Step 5: 検証**

Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS
Run: `npm test` → PASS

- [ ] **Step 6: コミット**

```bash
git add src/main/ipc/export.ts src/main/ipc/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat: wire export IPC (dialog/run/progress/cancel)"
```

---

## Task 6: 書き出しUI（`EditorLayout.tsx`）

**Files:**
- Modify: `src/renderer/editor/EditorLayout.tsx`

> typecheck/build + 手動E2E（Task 8）で検証。

- [ ] **Step 1: 進捗購読と状態・ハンドラを追加**

`EditorLayout.tsx` の `const [ttsNonce, setTtsNonce] = useState(0);` の直後に追加:

```ts
  const [exportState, setExportState] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; percent: number; message: string }>(
    { status: 'idle', percent: 0, message: '' },
  );
```

進捗購読を既存の useEffect（`onTranscriptionProgress`/`onTtsProgress` を購読しているブロック）に追記する。現在:

```ts
    const unsubTts = window.api.onTtsProgress((p) =>
      dispatch({ type: 'TTS_PROGRESS', percent: p }),
    );
    return () => { unsubTx(); unsubTts(); };
```

を次に置き換え:

```ts
    const unsubTts = window.api.onTtsProgress((p) =>
      dispatch({ type: 'TTS_PROGRESS', percent: p }),
    );
    const unsubExport = window.api.onExportProgress((p) =>
      setExportState((s) => (s.status === 'running' ? { ...s, percent: p } : s)),
    );
    return () => { unsubTx(); unsubTts(); unsubExport(); };
```

`generateAll` 関数の後（他のハンドラの近く）に書き出しハンドラを追加:

```ts
  async function doExport() {
    const outPath = await window.api.exportDialog();
    if (!outPath) return;
    setExportState({ status: 'running', percent: 0, message: '' });
    try {
      const res = await window.api.runExport(outPath);
      setExportState({ status: 'done', percent: 100, message: `書き出し完了: ${res.outPath}（${res.credit}）` });
    } catch (err) {
      setExportState({ status: 'error', percent: 0, message: String(err) });
    }
  }
```

- [ ] **Step 2: ツールバーにボタンと表示を追加**

ツールバー内の TTS のブロックの後（`{tts.status === 'error' && ...}` の行の後）に追加:

```tsx
        <button onClick={doExport} disabled={exportState.status === 'running'}>
          {exportState.status === 'running' ? `書き出し中… ${exportState.percent}%` : '書き出し'}
        </button>
        {exportState.status === 'running' && <button onClick={() => window.api.cancelExport()}>キャンセル</button>}
        {exportState.status === 'done' && <span style={{ fontSize: 12, color: '#9c9' }}>{exportState.message}</span>}
        {exportState.status === 'error' && <span style={{ color: '#f88' }}>書き出し失敗: {exportState.message}</span>}
```

- [ ] **Step 3: 検証**

Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS
Run: `npm test` → PASS

- [ ] **Step 4: コミット**

```bash
git add src/renderer/editor/EditorLayout.tsx
git commit -m "feat: add export button + progress to the editor toolbar"
```

---

## Task 7: プロビジョニング `setup-ffmpeg.mjs`

**Files:**
- Create: `scripts/setup-ffmpeg.mjs`
- Modify: `package.json`

> **検証は手動（ダウンロード）**。静的 FFmpeg（gyan.dev の release-essentials zip）を取得し `ffmpeg.exe`/`ffprobe.exe` を vendor に配置。**404/構成変更時は URL/探索を更新**。

- [ ] **Step 1: `package.json` にスクリプト追加**

`scripts` の `setup:voicevox` 行の直後に追加:

```json
    "setup:voicevox": "node scripts/setup-voicevox.mjs",
    "setup:ffmpeg": "node scripts/setup-ffmpeg.mjs"
```

- [ ] **Step 2: `scripts/setup-ffmpeg.mjs` を作成**

```js
// scripts/setup-ffmpeg.mjs
// 静的ビルドの ffmpeg.exe / ffprobe.exe を vendor/ffmpeg/ に取得し manifest.json を書く。
// gyan.dev の release-essentials zip（常に最新リリース）を使用。zip は Expand-Archive で展開。
import { existsSync, mkdirSync, createWriteStream, writeFileSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

const vendorDir = resolve(process.cwd(), 'vendor', 'ffmpeg');
const extractDir = join(vendorDir, 'dist');
const zipPath = join(vendorDir, 'ffmpeg.zip');

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function findNamed(dir, target) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const found = findNamed(p, target);
      if (found) return found;
    } else if (name.toLowerCase() === target) {
      return p;
    }
  }
  return null;
}

async function main() {
  mkdirSync(vendorDir, { recursive: true });

  let ffmpegPath = existsSync(extractDir) ? findNamed(extractDir, 'ffmpeg.exe') : null;
  let ffprobePath = existsSync(extractDir) ? findNamed(extractDir, 'ffprobe.exe') : null;
  if (!ffmpegPath || !ffprobePath) {
    await download(ZIP_URL, zipPath);
    mkdirSync(extractDir, { recursive: true });
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`,
    ], { stdio: 'inherit' });
    await rm(zipPath, { force: true });
    ffmpegPath = findNamed(extractDir, 'ffmpeg.exe');
    ffprobePath = findNamed(extractDir, 'ffprobe.exe');
  }
  if (!ffmpegPath || !ffprobePath) {
    throw new Error(`ffmpeg.exe/ffprobe.exe not found under ${extractDir} after extraction. Check the zip layout / URL.`);
  }

  writeFileSync(join(vendorDir, 'manifest.json'), JSON.stringify({ ffmpegPath, ffprobePath }, null, 2));
  console.log(`\nDone.\n  ffmpeg:  ${ffmpegPath}\n  ffprobe: ${ffprobePath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: 構文チェック（ダウンロードは実行しない）**

Run: `node --check scripts/setup-ffmpeg.mjs`
Expected: exit 0（構文OK）

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"`
Expected: `package.json OK`

- [ ] **Step 4: コミット**

```bash
git add scripts/setup-ffmpeg.mjs package.json
git commit -m "feat: add ffmpeg provisioning script (setup:ffmpeg)"
```

---

## Task 8: 全体検証（手動E2E＋最終チェック）

**Files:** なし（検証のみ）

- [ ] **Step 1: 自動チェック green**

Run: `npm test` → PASS
Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS

- [ ] **Step 2: 手動E2E（実機）**

Run: `npm run setup:ffmpeg`（未実施なら。~80MB DL）
期待: `vendor/ffmpeg/manifest.json` が `ffmpeg.exe`/`ffprobe.exe` を指す。404時は `ZIP_URL`/探索を更新。

Run: `npm run dev`
手順と期待結果（TTS生成済みプロジェクトで）:
1. `rec-*` を開く。
2. ツールバーの「書き出し」→保存ダイアログで `.mp4` の保存先を選ぶ。
3. 進捗（％）が進み、完了で「書き出し完了: <パス>（クレジット）」が出る。
4. 生成 MP4 を再生 → 各セグメントで映像が音声長に合わせてフリーズ/小休止し、TTS が同期。解像度が元と同じ。MP4 メタデータ comment にクレジット。
5. 書き出し中に「キャンセル」→中断され、`export-tmp/` が残らない。
6. TTS未生成セグメントは無音で書き出される（全編未生成でも書き出せる）。
7. 未プロビジョニング（vendor削除）でエラーメッセージが出る。

- [ ] **Step 3: 結果を記録**

確認項目／問題を記録。問題があれば systematic-debugging で対処（特に `setup:ffmpeg` の URL/zip構成、`-ss/-t`＋`tpad` の切り出し/フリーズ、concat の均一パラメータ要件、進捗精度）。

---

## 完了の定義

- `ffmpegPaths`/`ffargs`/`exportService`/（移動後）`computePreviewTimeline` の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機で `setup:ffmpeg` 後、TTS生成済みプロジェクトを MP4 に書き出せ、再生すると映像が音声に合い TTS が同期、クレジットが付き、キャンセル/未取得/未生成の各経路が壊れない。
