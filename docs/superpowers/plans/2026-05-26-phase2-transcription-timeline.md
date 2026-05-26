# フェーズ2: 文字起こし + セグメントタイムライン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 録画済みプロジェクトのナレーションをローカル whisper.cpp で文字起こしし、得られたセグメントを NLE 型エディタのタイムラインに表示する。

**Architecture:** main プロセスが whisper.cpp を子プロセス実行（注入可能な runner 経由）してセグメント配列を生成し project.json に保存する。renderer は narration.webm を Web Audio で 16kHz モノラル WAV に遅延変換し、`c2m://` カスタムプロトコルで映像資産を再生する NLE 3 ペイン（プレビュー/タイムライン/インスペクタ）を描画する。重い純粋ロジック（WAV エンコード・whisper JSON マッピング・進捗パース・タイムライン幾何・store reducer）は Electron 非依存で単体テストし、子プロセス起動・プロトコル・React コンポーネントは手動 E2E で検証する。

**Tech Stack:** Electron 31 + TypeScript + React 18、electron-vite、Vitest（environment: node）、whisper.cpp（vendor/ に DL、ggml-small 日本語モデル）、Web Audio API。

**規約:**
- 仕様書: `docs/superpowers/specs/2026-05-26-clip2manual-phase2-design.md`
- テストは `test/*.test.ts`（既存規約）。import は `../src/...`。
- すべてのコミットメッセージは末尾に次の trailer を付ける:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- 各タスク完了時に `npm test` と `npm run typecheck` がクリーンであること。

---

## File Structure

新規/変更ファイルと責務:

```
scripts/setup-whisper.mjs                 whisper バイナリ(zip)+ ggml-small モデルを vendor/whisper/ に取得し manifest.json を書く
.gitignore                                vendor/ を追加
package.json                              "setup:whisper" スクリプト追加

src/shared/wav.ts                         Float32 PCM → 16bit WAV バイト（純粋）
src/shared/types.ts                       validateProject 追加（軽量スキーマ検証）

src/main/whisperPaths.ts                  bin/model 解決（env → vendor/manifest.json）。WhisperNotProvisionedError
src/main/transcription/progress.ts        whisper stderr 行 → 進捗%（純粋）
src/main/transcription/mapSegments.ts     whisper JSON → Segment[]、clicks 割当（純粋）
src/main/transcription/whisperRunner.ts   WhisperRunner インターフェース＋ SpawnWhisperRunner（子プロセス）
src/main/transcription/transcriptionService.ts  runner.run → JSON 読込 → mapSegments
src/main/projectSession.ts                現在のプロジェクト保持＋セグメント保存（クラス＋シングルトン）
src/main/assetProtocol.ts                 c2m:// スキーム登録＋ハンドラ
src/main/ipc/recording.ts                 recording:start / recording:stop（旧 ipc.ts から移設）
src/main/ipc/project.ts                   project:openDialog/open/recent、asset:read/write/exists
src/main/ipc/transcription.ts             transcription:run/cancel、進捗イベント送出
src/main/ipc/index.ts                      registerIpc() で上記を合成
src/main/ipc.ts                           削除
src/main/index.ts                         スキーム登録＋プロトコルハンドラ登録を追加

src/preload/index.ts                      新規 IPC チャネルを型付きで公開
src/renderer/global.d.ts                  window.api の完全な型

src/renderer/editor/timelineGeometry.ts   segmentRect / timeToPercent（純粋）
src/renderer/state/editorReducer.ts       State/Action/reducer/initialState（純粋）
src/renderer/state/editorStore.tsx        Context + Provider + useEditor フック
src/renderer/audio/decodeToWav.ts         Web Audio: webm → 16kHz モノラル → shared/wav
src/renderer/editor/PreviewPlayer.tsx     video + 同期 audio、再生/シーク/現在時刻
src/renderer/editor/Timeline.tsx          映像/セグメント/クリックの3トラック、選択・シーク・再生ヘッド
src/renderer/editor/Inspector.tsx         選択セグメントの番号/時間範囲/文字起こし（読み取り専用）
src/renderer/editor/EditorLayout.tsx      3ペイングリッド＋ツールバー＋文字起こし実行フロー
src/renderer/home/HomeScreen.tsx          録画＋最近の録画一覧→開く
src/renderer/App.tsx                       store Provider＋ home/editor ルーティング（書き換え）
```

---

## Task 1: WAV エンコーダ（shared/wav.ts）

**Files:**
- Create: `src/shared/wav.ts`
- Test: `test/wav.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/wav.test.ts
import { describe, it, expect } from 'vitest';
import { encodeWav } from '../src/shared/wav';

function tag(buf: ArrayBuffer, offset: number): string {
  const b = new Uint8Array(buf, offset, 4);
  return String.fromCharCode(b[0], b[1], b[2], b[3]);
}

describe('encodeWav', () => {
  it('produces a 44-byte header plus 2 bytes per sample', () => {
    const buf = encodeWav(new Float32Array(3), 16000);
    expect(buf.byteLength).toBe(44 + 3 * 2);
  });

  it('writes RIFF/WAVE/data tags', () => {
    const buf = encodeWav(new Float32Array(1), 16000);
    expect(tag(buf, 0)).toBe('RIFF');
    expect(tag(buf, 8)).toBe('WAVE');
    expect(tag(buf, 36)).toBe('data');
  });

  it('writes mono / 16-bit / given sample rate in the fmt chunk', () => {
    const view = new DataView(encodeWav(new Float32Array(0), 16000));
    expect(view.getUint16(22, true)).toBe(1);      // channels
    expect(view.getUint32(24, true)).toBe(16000);  // sample rate
    expect(view.getUint16(34, true)).toBe(16);     // bits per sample
  });

  it('converts and clamps float samples to signed 16-bit PCM', () => {
    const view = new DataView(encodeWav(new Float32Array([0, 1, -1, 2]), 16000));
    expect(view.getInt16(44 + 0, true)).toBe(0);
    expect(view.getInt16(44 + 2, true)).toBe(32767);
    expect(view.getInt16(44 + 4, true)).toBe(-32768);
    expect(view.getInt16(44 + 6, true)).toBe(32767); // clamped
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- wav`
Expected: FAIL（`encodeWav` が存在しない）

- [ ] **Step 3: 最小実装**

```ts
// src/shared/wav.ts
function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < tag.length; i++) view.setUint8(offset + i, tag.charCodeAt(i));
}

/** 16kHz・モノラル前提の Float32 サンプルを 16bit PCM WAV バイト列にエンコードする。 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);

  writeTag(view, 0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeTag(view, 8, 'WAVE');
  writeTag(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM fmt chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono * 16bit = 2 bytes/sample)
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeTag(view, 36, 'data');
  view.setUint32(40, n * 2, true);

  let offset = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- wav`
Expected: PASS（4 件）

- [ ] **Step 5: コミット**

```bash
git add src/shared/wav.ts test/wav.test.ts
git commit -m "feat: add Float32 PCM to 16-bit WAV encoder"
```

---

## Task 2: validateProject（shared/types.ts）

**Files:**
- Modify: `src/shared/types.ts`（末尾に追加）
- Modify: `src/main/projectStore.ts:23-31`（loadProject で利用）
- Test: `test/validateProject.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/validateProject.test.ts
import { describe, it, expect } from 'vitest';
import { validateProject, createProject } from '../src/shared/types';

const valid = createProject({
  name: 'rec-1',
  source: {
    video: 'assets/raw.webm',
    narration: 'assets/narration.webm',
    clickLog: 'assets/clicks.json',
    display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
  },
});

describe('validateProject', () => {
  it('returns the project unchanged when valid', () => {
    expect(validateProject(valid)).toBe(valid);
  });

  it('throws on non-object input', () => {
    expect(() => validateProject(null)).toThrow();
    expect(() => validateProject(42)).toThrow();
  });

  it('throws on unsupported version', () => {
    expect(() => validateProject({ ...valid, version: 999 })).toThrow(/version/i);
  });

  it('throws when meta or settings is missing', () => {
    expect(() => validateProject({ ...valid, meta: undefined })).toThrow(/meta/i);
    expect(() => validateProject({ ...valid, settings: undefined })).toThrow(/settings/i);
  });

  it('throws when segments is not an array', () => {
    expect(() => validateProject({ ...valid, segments: {} })).toThrow(/segments/i);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- validateProject`
Expected: FAIL（`validateProject` が存在しない）

- [ ] **Step 3: types.ts に実装を追加**

`src/shared/types.ts` の末尾（`createProject` の後）に追加:

```ts
/** project.json を開いたときの軽量な構造検証。フル JSON-Schema は導入しない。 */
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
  return value as Project;
}
```

- [ ] **Step 4: loadProject で利用するよう変更**

`src/main/projectStore.ts` の loadProject を変更:

```ts
import { type Project, CURRENT_PROJECT_VERSION, validateProject } from '../shared/types';
```

```ts
export async function loadProject(projectDir: string): Promise<Project> {
  const raw = await fs.readFile(path.join(projectDir, PROJECT_FILE), 'utf8');
  return validateProject(JSON.parse(raw));
}
```

（`CURRENT_PROJECT_VERSION` の import が未使用になる場合は import から外すこと。typecheck で確認。）

- [ ] **Step 5: テストと typecheck が通ることを確認**

Run: `npm test -- validateProject && npm run typecheck`
Expected: PASS / エラーなし。既存の `projectStore.test.ts` も PASS のまま。

- [ ] **Step 6: コミット**

```bash
git add src/shared/types.ts src/main/projectStore.ts test/validateProject.test.ts
git commit -m "feat: validate project.json shape on load"
```

---

## Task 3: whisper JSON → Segment[] マッピング（mapSegments）

**Files:**
- Create: `src/main/transcription/mapSegments.ts`
- Test: `test/mapSegments.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/mapSegments.test.ts
import { describe, it, expect } from 'vitest';
import { mapWhisperSegments, type WhisperSegment } from '../src/main/transcription/mapSegments';
import { type ClickEvent } from '../src/shared/types';

const voice = { speaker: 3, speed: 1.0 };
const segs: WhisperSegment[] = [
  { offsets: { from: 0, to: 1000 }, text: ' ここを' },
  { offsets: { from: 1000, to: 2000 }, text: 'クリック ' },
];
const click = (t: number): ClickEvent => ({ x: 1, y: 2, t, button: 1 });

describe('mapWhisperSegments', () => {
  it('maps offsets(ms) to seconds and zero-pads ids', () => {
    const out = mapWhisperSegments(segs, [], voice);
    expect(out.map((s) => s.id)).toEqual(['seg-001', 'seg-002']);
    expect(out[0].videoStart).toBe(0);
    expect(out[0].videoEnd).toBe(1);
    expect(out[1].videoStart).toBe(1);
  });

  it('trims text and copies it into both originalText and correctedText', () => {
    const out = mapWhisperSegments(segs, [], voice);
    expect(out[0].originalText).toBe('ここを');
    expect(out[0].correctedText).toBe('ここを');
    expect(out[1].originalText).toBe('クリック');
  });

  it('sets defaults: ttsAudio null, given voice, enabled true', () => {
    const out = mapWhisperSegments(segs, [], voice);
    expect(out[0].ttsAudio).toBeNull();
    expect(out[0].voice).toEqual(voice);
    expect(out[0].enabled).toBe(true);
  });

  it('assigns a click to the segment whose range contains it', () => {
    const out = mapWhisperSegments(segs, [click(1.5)], voice);
    expect(out[0].clicks).toHaveLength(0);
    expect(out[1].clicks).toHaveLength(1);
  });

  it('assigns a gap/edge click to the nearest segment', () => {
    const gappy: WhisperSegment[] = [
      { offsets: { from: 0, to: 1000 }, text: 'a' },
      { offsets: { from: 5000, to: 6000 }, text: 'b' },
    ];
    const out = mapWhisperSegments(gappy, [click(2), click(10), click(-1)], voice);
    expect(out[0].clicks.map((c) => c.t)).toEqual([2, -1]); // 2 nearer to [0,1]; -1 before all
    expect(out[1].clicks.map((c) => c.t)).toEqual([10]);    // after all → last
  });

  it('returns [] and drops clicks when there are no segments', () => {
    expect(mapWhisperSegments([], [click(1)], voice)).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- mapSegments`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

```ts
// src/main/transcription/mapSegments.ts
import { type ClickEvent, type Segment, type SegmentVoice } from '../../shared/types';

export interface WhisperSegment {
  offsets: { from: number; to: number }; // ミリ秒
  text: string;
}

export interface WhisperJson {
  transcription: WhisperSegment[];
}

function distanceToRange(t: number, start: number, end: number): number {
  if (t < start) return start - t;
  if (t >= end) return t - end;
  return 0;
}

/** whisper のセグメント配列を Project の Segment[] に変換し、clicks を時間で割り当てる。 */
export function mapWhisperSegments(
  whisper: WhisperSegment[],
  clicks: ClickEvent[],
  defaultVoice: SegmentVoice,
): Segment[] {
  const segments: Segment[] = whisper.map((w, i) => ({
    id: `seg-${String(i + 1).padStart(3, '0')}`,
    videoStart: w.offsets.from / 1000,
    videoEnd: w.offsets.to / 1000,
    originalText: w.text.trim(),
    correctedText: w.text.trim(),
    ttsAudio: null,
    voice: { ...defaultVoice },
    clicks: [],
    enabled: true,
  }));

  if (segments.length === 0) return segments;

  for (const c of clicks) {
    let best = 0;
    let bestDist = Infinity;
    segments.forEach((s, i) => {
      const d = distanceToRange(c.t, s.videoStart, s.videoEnd);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    segments[best].clicks.push(c);
  }
  return segments;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- mapSegments`
Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
git add src/main/transcription/mapSegments.ts test/mapSegments.test.ts
git commit -m "feat: map whisper JSON segments to project segments with click assignment"
```

---

## Task 4: 進捗パース（transcription/progress.ts）

**Files:**
- Create: `src/main/transcription/progress.ts`
- Test: `test/progress.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/progress.test.ts
import { describe, it, expect } from 'vitest';
import { parseProgress } from '../src/main/transcription/progress';

describe('parseProgress', () => {
  it('extracts percent from a whisper progress line', () => {
    expect(parseProgress('whisper_print_progress_callback: progress =  50%')).toBe(50);
  });
  it('handles 0 and 100', () => {
    expect(parseProgress('progress = 0%')).toBe(0);
    expect(parseProgress('progress = 100%')).toBe(100);
  });
  it('returns null for unrelated lines', () => {
    expect(parseProgress('whisper_full: something')).toBeNull();
    expect(parseProgress('')).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- progress`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// src/main/transcription/progress.ts
const PROGRESS_RE = /progress\s*=\s*(\d+)\s*%/;

/** whisper の stderr 行から進捗パーセントを取り出す。該当しなければ null。 */
export function parseProgress(line: string): number | null {
  const m = PROGRESS_RE.exec(line);
  return m ? Number(m[1]) : null;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- progress`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add src/main/transcription/progress.ts test/progress.test.ts
git commit -m "feat: parse whisper progress percentage from stderr"
```

---

## Task 5: whisper パス解決（whisperPaths.ts）

**Files:**
- Create: `src/main/whisperPaths.ts`
- Test: `test/whisperPaths.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/whisperPaths.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveWhisper, WhisperNotProvisionedError } from '../src/main/whisperPaths';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-whisper-'));
  delete process.env.C2M_WHISPER_BIN;
  delete process.env.C2M_WHISPER_MODEL;
});
afterEach(async () => {
  delete process.env.C2M_WHISPER_BIN;
  delete process.env.C2M_WHISPER_MODEL;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveWhisper', () => {
  it('throws WhisperNotProvisionedError when no manifest exists', () => {
    expect(() => resolveWhisper({ vendorDir: dir })).toThrow(WhisperNotProvisionedError);
  });

  it('reads bin/model from vendor manifest.json', async () => {
    const bin = path.join(dir, 'whisper-cli.exe');
    const model = path.join(dir, 'ggml-small.bin');
    await fs.writeFile(bin, 'x');
    await fs.writeFile(model, 'x');
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ binPath: bin, modelPath: model }));
    expect(resolveWhisper({ vendorDir: dir })).toEqual({ binPath: bin, modelPath: model });
  });

  it('prefers environment variables over the manifest', async () => {
    const bin = path.join(dir, 'env-bin.exe');
    const model = path.join(dir, 'env-model.bin');
    await fs.writeFile(bin, 'x');
    await fs.writeFile(model, 'x');
    process.env.C2M_WHISPER_BIN = bin;
    process.env.C2M_WHISPER_MODEL = model;
    expect(resolveWhisper({ vendorDir: dir })).toEqual({ binPath: bin, modelPath: model });
  });

  it('throws when a referenced file is missing', async () => {
    await fs.writeFile(path.join(dir, 'manifest.json'),
      JSON.stringify({ binPath: path.join(dir, 'nope.exe'), modelPath: path.join(dir, 'nope.bin') }));
    expect(() => resolveWhisper({ vendorDir: dir })).toThrow(WhisperNotProvisionedError);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- whisperPaths`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// src/main/whisperPaths.ts
import * as fs from 'node:fs';
import * as path from 'node:path';

export class WhisperNotProvisionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhisperNotProvisionedError';
  }
}

export interface WhisperPaths {
  binPath: string;
  modelPath: string;
}

function assertExists(p: string): void {
  if (!fs.existsSync(p)) {
    throw new WhisperNotProvisionedError(`whisper file not found: ${p}. Run: npm run setup:whisper`);
  }
}

/**
 * whisper のバイナリとモデルのパスを解決する。
 * 優先順: 環境変数(C2M_WHISPER_BIN / C2M_WHISPER_MODEL) → vendor/whisper/manifest.json。
 * 設定画面による上書きはフェーズ8で追加予定。
 */
export function resolveWhisper(opts: { vendorDir?: string } = {}): WhisperPaths {
  const envBin = process.env.C2M_WHISPER_BIN;
  const envModel = process.env.C2M_WHISPER_MODEL;
  if (envBin && envModel) {
    assertExists(envBin);
    assertExists(envModel);
    return { binPath: envBin, modelPath: envModel };
  }

  const vendorDir = opts.vendorDir ?? path.join(process.cwd(), 'vendor', 'whisper');
  const manifestPath = path.join(vendorDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new WhisperNotProvisionedError(
      `whisper is not provisioned (${manifestPath} not found). Run: npm run setup:whisper`,
    );
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as WhisperPaths;
  assertExists(m.binPath);
  assertExists(m.modelPath);
  return { binPath: m.binPath, modelPath: m.modelPath };
}
```

- [ ] **Step 4: テストと typecheck が通ることを確認**

Run: `npm test -- whisperPaths && npm run typecheck`
Expected: PASS / エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/main/whisperPaths.ts test/whisperPaths.test.ts
git commit -m "feat: resolve whisper binary and model paths via env or vendor manifest"
```

---

## Task 6: whisper 子プロセス runner（whisperRunner.ts）

実バイナリを起動するため単体テストはしない（Task 19 の手動 E2E で検証）。インターフェースと spawn 実装を用意する。

**Files:**
- Create: `src/main/transcription/whisperRunner.ts`

- [ ] **Step 1: 実装**

```ts
// src/main/transcription/whisperRunner.ts
import { spawn } from 'node:child_process';
import { parseProgress } from './progress';

export interface WhisperRunInput {
  binPath: string;
  modelPath: string;
  audioPath: string;
  /** -of に渡す出力ベース。完了後 `${outBase}.json` が生成される。 */
  outBase: string;
  language: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** whisper の実行を抽象化する。テストでは偽実装に差し替える。 */
export interface WhisperRunner {
  run(input: WhisperRunInput): Promise<void>;
}

/** whisper-cli を子プロセスとして実行する本番 runner。 */
export class SpawnWhisperRunner implements WhisperRunner {
  run(input: WhisperRunInput): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', input.modelPath,
        '-f', input.audioPath,
        '-l', input.language,
        '-oj',
        '-of', input.outBase,
        '--print-progress',
      ];
      const child = spawn(input.binPath, args);

      const onAbort = () => child.kill();
      input.signal?.addEventListener('abort', onAbort, { once: true });

      let stderrTail = '';
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrTail = (stderrTail + text).slice(-1000);
        for (const line of text.split('\n')) {
          const pct = parseProgress(line);
          if (pct !== null) input.onProgress?.(pct);
        }
      });

      child.on('error', (err) => {
        input.signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
      child.on('close', (code) => {
        input.signal?.removeEventListener('abort', onAbort);
        if (code === 0) resolve();
        else reject(new Error(`whisper exited with code ${code}\n${stderrTail}`));
      });
    });
  }
}
```

- [ ] **Step 2: typecheck が通ることを確認**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/main/transcription/whisperRunner.ts
git commit -m "feat: add whisper runner interface and child-process implementation"
```

---

## Task 7: 文字起こしオーケストレーション（transcriptionService.ts）

**Files:**
- Create: `src/main/transcription/transcriptionService.ts`
- Test: `test/transcriptionService.test.ts`

- [ ] **Step 1: 失敗するテストを書く（偽 runner が fixture JSON を書く）**

```ts
// test/transcriptionService.test.ts
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { transcribe } from '../src/main/transcription/transcriptionService';
import { type WhisperRunner, type WhisperRunInput } from '../src/main/transcription/whisperRunner';

class FakeRunner implements WhisperRunner {
  async run(input: WhisperRunInput): Promise<void> {
    input.onProgress?.(100);
    const json = {
      transcription: [
        { offsets: { from: 0, to: 1000 }, text: ' a' },
        { offsets: { from: 1000, to: 2000 }, text: ' b' },
      ],
    };
    await fs.writeFile(`${input.outBase}.json`, JSON.stringify(json), 'utf8');
  }
}

describe('transcribe', () => {
  it('runs the runner, reads its JSON, and maps to segments with clicks', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-tx-'));
    let lastPct = -1;
    const segments = await transcribe({
      runner: new FakeRunner(),
      binPath: 'bin', modelPath: 'model', audioPath: 'a.wav',
      outDir: dir, language: 'ja',
      clicks: [{ x: 1, y: 2, t: 0.5, button: 1 }],
      defaultVoice: { speaker: 3, speed: 1.0 },
      onProgress: (p) => { lastPct = p; },
    });

    expect(segments.map((s) => s.id)).toEqual(['seg-001', 'seg-002']);
    expect(segments[0].clicks).toHaveLength(1);
    expect(lastPct).toBe(100);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- transcriptionService`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// src/main/transcription/transcriptionService.ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type ClickEvent, type Segment, type SegmentVoice } from '../../shared/types';
import { mapWhisperSegments, type WhisperJson } from './mapSegments';
import { type WhisperRunner } from './whisperRunner';

export interface TranscribeOptions {
  runner: WhisperRunner;
  binPath: string;
  modelPath: string;
  audioPath: string;
  /** 出力 JSON を置くディレクトリ。`<outDir>/transcription.json` を生成する。 */
  outDir: string;
  language: string;
  clicks: ClickEvent[];
  defaultVoice: SegmentVoice;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** whisper を実行して Segment[] を返す。project.json への保存は呼び出し側が行う。 */
export async function transcribe(opts: TranscribeOptions): Promise<Segment[]> {
  const outBase = path.join(opts.outDir, 'transcription');
  await opts.runner.run({
    binPath: opts.binPath,
    modelPath: opts.modelPath,
    audioPath: opts.audioPath,
    outBase,
    language: opts.language,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });
  const raw = await fs.readFile(`${outBase}.json`, 'utf8');
  const json = JSON.parse(raw) as WhisperJson;
  return mapWhisperSegments(json.transcription, opts.clicks, opts.defaultVoice);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- transcriptionService`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/transcription/transcriptionService.ts test/transcriptionService.test.ts
git commit -m "feat: orchestrate whisper run, JSON read, and segment mapping"
```

---

## Task 8: 現在のプロジェクト保持（projectSession.ts）

**Files:**
- Create: `src/main/projectSession.ts`
- Test: `test/projectSession.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/projectSession.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectSession } from '../src/main/projectSession';
import { createProject, type Project } from '../src/shared/types';
import { saveProject, loadProject } from '../src/main/projectStore';

function makeProject(): Project {
  return createProject({
    name: 'rec-1',
    source: {
      video: 'assets/raw.webm', narration: 'assets/narration.webm', clickLog: 'assets/clicks.json',
      display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
    },
  });
}

describe('ProjectSession', () => {
  let session: ProjectSession;
  beforeEach(() => { session = new ProjectSession(); });

  it('has no current project initially', () => {
    expect(session.getCurrentProjectDir()).toBeNull();
    expect(() => session.getCurrent()).toThrow();
  });

  it('stores and returns the current project', () => {
    const p = makeProject();
    session.setCurrent('/tmp/rec-1', p);
    expect(session.getCurrentProjectDir()).toBe('/tmp/rec-1');
    expect(session.getCurrent().project).toBe(p);
  });

  it('updateSegments writes segments to project.json on disk', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-sess-'));
    const p = makeProject();
    await saveProject(dir, p);
    session.setCurrent(dir, p);

    await session.updateSegments([
      { id: 'seg-001', videoStart: 0, videoEnd: 1, originalText: 'a', correctedText: 'a',
        ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true },
    ]);

    const reloaded = await loadProject(dir);
    expect(reloaded.segments).toHaveLength(1);
    expect(session.getCurrent().project.segments).toHaveLength(1);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- projectSession`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// src/main/projectSession.ts
import { type Project, type Segment } from '../shared/types';
import { saveProject } from './projectStore';

/** main プロセスで「現在開いているプロジェクト」を保持する。 */
export class ProjectSession {
  private dir: string | null = null;
  private project: Project | null = null;

  setCurrent(dir: string, project: Project): void {
    this.dir = dir;
    this.project = project;
  }

  getCurrentProjectDir(): string | null {
    return this.dir;
  }

  getCurrent(): { dir: string; project: Project } {
    if (this.dir === null || this.project === null) {
      throw new Error('No project is currently open');
    }
    return { dir: this.dir, project: this.project };
  }

  /** セグメントを差し替えて project.json に保存する。 */
  async updateSegments(segments: Segment[]): Promise<void> {
    const { dir, project } = this.getCurrent();
    const updated: Project = { ...project, segments };
    this.project = updated;
    await saveProject(dir, updated);
  }
}

/** main プロセス全体で共有するシングルトン。 */
export const projectSession = new ProjectSession();
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- projectSession`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add src/main/projectSession.ts test/projectSession.test.ts
git commit -m "feat: track the currently open project in main process"
```

---

## Task 9: c2m:// アセットプロトコル（assetProtocol.ts）

Electron プロトコルのため単体テストはしない（Task 19 の E2E で検証）。

**Files:**
- Create: `src/main/assetProtocol.ts`

- [ ] **Step 1: 実装**

```ts
// src/main/assetProtocol.ts
import { protocol, net } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectSession } from './projectSession';

const SCHEME = 'c2m';

/** app ready より前に呼ぶ必要がある。 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true },
    },
  ]);
}

/** app ready 後に呼ぶ。c2m://asset/<相対パス> を現在のプロジェクト配下のファイルに解決する。 */
export function registerAssetProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const dir = projectSession.getCurrentProjectDir();
    if (!dir) return new Response('No project open', { status: 404 });

    const filePath = path.join(dir, rel);
    const normalizedDir = path.resolve(dir);
    if (!path.resolve(filePath).startsWith(normalizedDir)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
```

- [ ] **Step 2: typecheck が通ることを確認**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/main/assetProtocol.ts
git commit -m "feat: serve project assets over a c2m:// protocol"
```

---

## Task 10: IPC 再構成（ipc/ 配下に分割）

**Files:**
- Create: `src/main/ipc/recording.ts`, `src/main/ipc/project.ts`, `src/main/ipc/transcription.ts`, `src/main/ipc/index.ts`
- Delete: `src/main/ipc.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: recording.ts（旧 ipc.ts の recording 部分を移設）**

```ts
// src/main/ipc/recording.ts
import { ipcMain, screen, app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ClickHook } from '../clickHook';
import { initProjectDir, saveProject, assetPath } from '../projectStore';
import { buildClickLog } from '../../shared/clickLog';
import { type CaptureGeometry } from '../../shared/coordinateTransform';
import { createProject, type ProjectSource } from '../../shared/types';

interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

let clickHook: ClickHook | null = null;
let t0Ms = 0;

export function registerRecordingIpc(): void {
  ipcMain.handle('recording:start', () => {
    if (clickHook) clickHook.stop();
    clickHook = new ClickHook();
    clickHook.start();
    t0Ms = Date.now();
    return { ok: true };
  });

  ipcMain.handle('recording:stop', async (_e, payload: StopPayload) => {
    const rawEvents = clickHook ? clickHook.stop() : [];
    clickHook = null;

    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor;
    const geometry: CaptureGeometry = {
      displayOriginX: display.bounds.x * sf,
      displayOriginY: display.bounds.y * sf,
      displayWidth: display.bounds.width * sf,
      displayHeight: display.bounds.height * sf,
      videoWidth: payload.videoWidth,
      videoHeight: payload.videoHeight,
    };
    const clicks = buildClickLog(rawEvents, t0Ms, geometry);

    const projectDir = path.join(app.getPath('videos'), 'clip2manual', `rec-${Date.now()}`);
    await initProjectDir(projectDir);
    await fs.writeFile(assetPath(projectDir, 'assets/raw.webm'), Buffer.from(payload.video));
    await fs.writeFile(assetPath(projectDir, 'assets/narration.webm'), Buffer.from(payload.audio));
    await fs.writeFile(assetPath(projectDir, 'assets/clicks.json'), JSON.stringify(clicks, null, 2));

    const source: ProjectSource = {
      video: 'assets/raw.webm',
      narration: 'assets/narration.webm',
      clickLog: 'assets/clicks.json',
      display: {
        width: payload.videoWidth,
        height: payload.videoHeight,
        scaleFactor: sf,
        originX: display.bounds.x,
        originY: display.bounds.y,
      },
    };
    const project = createProject({ name: path.basename(projectDir), source });
    await saveProject(projectDir, project);

    return { projectDir, clickCount: clicks.length };
  });
}
```

- [ ] **Step 2: project.ts（open/recent/asset）**

```ts
// src/main/ipc/project.ts
import { ipcMain, dialog, app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadProject, assetPath } from '../projectStore';
import { projectSession } from '../projectSession';

const recordingsRoot = () => path.join(app.getPath('videos'), 'clip2manual');

async function openDir(projectDir: string) {
  const project = await loadProject(projectDir);
  projectSession.setCurrent(projectDir, project);
  return { projectDir, project };
}

export function registerProjectIpc(): void {
  ipcMain.handle('project:openDialog', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: recordingsRoot(),
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return openDir(res.filePaths[0]);
  });

  ipcMain.handle('project:open', (_e, projectDir: string) => openDir(projectDir));

  ipcMain.handle('project:recent', async () => {
    const root = recordingsRoot();
    let entries: string[] = [];
    try {
      entries = await fs.readdir(root);
    } catch {
      return [];
    }
    const out: { projectDir: string; name: string; createdAt: string }[] = [];
    for (const name of entries) {
      const projectDir = path.join(root, name);
      try {
        const project = await loadProject(projectDir);
        out.push({ projectDir, name: project.meta.name, createdAt: project.meta.createdAt });
      } catch {
        // project.json が無い/壊れているフォルダは無視
      }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  });

  ipcMain.handle('asset:read', async (_e, rel: string) => {
    const { dir } = projectSession.getCurrent();
    const buf = await fs.readFile(assetPath(dir, rel));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('asset:write', async (_e, args: { rel: string; data: ArrayBuffer }) => {
    const { dir } = projectSession.getCurrent();
    await fs.writeFile(assetPath(dir, args.rel), Buffer.from(args.data));
    return { ok: true as const };
  });

  ipcMain.handle('asset:exists', async (_e, rel: string) => {
    const { dir } = projectSession.getCurrent();
    try {
      await fs.access(assetPath(dir, rel));
      return true;
    } catch {
      return false;
    }
  });
}
```

- [ ] **Step 3: transcription.ts**

```ts
// src/main/ipc/transcription.ts
import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { projectSession } from '../projectSession';
import { assetPath } from '../projectStore';
import { resolveWhisper } from '../whisperPaths';
import { transcribe } from '../transcription/transcriptionService';
import { SpawnWhisperRunner } from '../transcription/whisperRunner';
import { type ClickEvent } from '../../shared/types';

let currentAbort: AbortController | null = null;

export function registerTranscriptionIpc(): void {
  ipcMain.handle('transcription:run', async (event) => {
    const { dir, project } = projectSession.getCurrent();
    const { binPath, modelPath } = resolveWhisper();

    const clicksRaw = await fs.readFile(assetPath(dir, 'assets/clicks.json'), 'utf8');
    const clicks = JSON.parse(clicksRaw) as ClickEvent[];
    const defaultVoice = {
      speaker: project.settings.tts.defaultSpeaker,
      speed: project.settings.tts.defaultSpeed,
    };

    currentAbort = new AbortController();
    try {
      const segments = await transcribe({
        runner: new SpawnWhisperRunner(),
        binPath,
        modelPath,
        audioPath: assetPath(dir, 'assets/narration.wav'),
        outDir: path.join(dir, 'assets'),
        language: 'ja',
        clicks,
        defaultVoice,
        onProgress: (pct) => event.sender.send('transcription:progress', pct),
        signal: currentAbort.signal,
      });
      await projectSession.updateSegments(segments);
      return { segments };
    } finally {
      currentAbort = null;
    }
  });

  ipcMain.handle('transcription:cancel', () => {
    currentAbort?.abort();
    return { ok: true as const };
  });
}
```

- [ ] **Step 4: index.ts（合成）**

```ts
// src/main/ipc/index.ts
import { registerRecordingIpc } from './recording';
import { registerProjectIpc } from './project';
import { registerTranscriptionIpc } from './transcription';

export function registerIpc(): void {
  registerRecordingIpc();
  registerProjectIpc();
  registerTranscriptionIpc();
}
```

- [ ] **Step 5: 旧 ipc.ts を削除し main/index.ts を更新**

```bash
git rm src/main/ipc.ts
```

`src/main/index.ts` を更新（import 追加＋スキーム登録＋プロトコル登録）:

```ts
import { app, BrowserWindow, session, desktopCapturer } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { registerAssetScheme, registerAssetProtocol } from './assetProtocol';

registerAssetScheme(); // app ready より前に呼ぶ

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpc();
  registerAssetProtocol();
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch((err) => {
        console.error('Failed to enumerate screen sources for display media', err);
        callback({});
      });
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 6: typecheck・build・既存テストを確認**

Run: `npm run typecheck && npm run build && npm test`
Expected: すべてエラーなし／PASS

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "refactor: split IPC into recording/project/transcription modules and register c2m protocol"
```

---

## Task 11: preload とレンダラ型（preload/index.ts, global.d.ts）

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: preload を更新**

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

export interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

contextBridge.exposeInMainWorld('api', {
  startRecording: () => ipcRenderer.invoke('recording:start'),
  stopRecording: (payload: StopPayload) => ipcRenderer.invoke('recording:stop', payload),

  openProjectDialog: () => ipcRenderer.invoke('project:openDialog'),
  openProject: (projectDir: string) => ipcRenderer.invoke('project:open', projectDir),
  recentProjects: () => ipcRenderer.invoke('project:recent'),

  readAsset: (rel: string) => ipcRenderer.invoke('asset:read', rel),
  writeAsset: (rel: string, data: ArrayBuffer) => ipcRenderer.invoke('asset:write', { rel, data }),
  assetExists: (rel: string) => ipcRenderer.invoke('asset:exists', rel),

  runTranscription: () => ipcRenderer.invoke('transcription:run'),
  cancelTranscription: () => ipcRenderer.invoke('transcription:cancel'),
  onTranscriptionProgress: (cb: (percent: number) => void) => {
    const listener = (_e: unknown, percent: number) => cb(percent);
    ipcRenderer.on('transcription:progress', listener);
    return () => { ipcRenderer.removeListener('transcription:progress', listener); };
  },
});
```

- [ ] **Step 2: global.d.ts を更新**

```ts
// src/renderer/global.d.ts
import type { Project, Segment } from '../shared/types';

export interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

export interface RecentProject {
  projectDir: string;
  name: string;
  createdAt: string;
}

export interface OpenedProject {
  projectDir: string;
  project: Project;
}

declare global {
  interface Window {
    api: {
      startRecording: () => Promise<{ ok: boolean }>;
      stopRecording: (payload: StopPayload) => Promise<{ projectDir: string; clickCount: number }>;
      openProjectDialog: () => Promise<OpenedProject | null>;
      openProject: (projectDir: string) => Promise<OpenedProject>;
      recentProjects: () => Promise<RecentProject[]>;
      readAsset: (rel: string) => Promise<ArrayBuffer>;
      writeAsset: (rel: string, data: ArrayBuffer) => Promise<{ ok: true }>;
      assetExists: (rel: string) => Promise<boolean>;
      runTranscription: () => Promise<{ segments: Segment[] }>;
      cancelTranscription: () => Promise<{ ok: true }>;
      onTranscriptionProgress: (cb: (percent: number) => void) => () => void;
    };
  }
}

export {};
```

- [ ] **Step 3: typecheck が通ることを確認**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat: expose project/asset/transcription IPC to the renderer"
```

---

## Task 12: タイムライン幾何（timelineGeometry.ts）

**Files:**
- Create: `src/renderer/editor/timelineGeometry.ts`
- Test: `test/timelineGeometry.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/timelineGeometry.test.ts
import { describe, it, expect } from 'vitest';
import { segmentRect, timeToPercent } from '../src/renderer/editor/timelineGeometry';

describe('timeToPercent', () => {
  it('maps time to a percentage of duration', () => {
    expect(timeToPercent(5, 10)).toBe(50);
  });
  it('returns 0 for non-positive duration', () => {
    expect(timeToPercent(5, 0)).toBe(0);
  });
  it('clamps to [0,100]', () => {
    expect(timeToPercent(-1, 10)).toBe(0);
    expect(timeToPercent(20, 10)).toBe(100);
  });
});

describe('segmentRect', () => {
  it('returns left/width as percentages', () => {
    expect(segmentRect(0, 5, 10)).toEqual({ left: 0, width: 50 });
    expect(segmentRect(5, 10, 10)).toEqual({ left: 50, width: 50 });
  });
  it('clamps a segment that runs past the duration', () => {
    expect(segmentRect(8, 15, 10)).toEqual({ left: 80, width: 20 });
  });
  it('returns zero width for non-positive duration', () => {
    expect(segmentRect(0, 5, 0)).toEqual({ left: 0, width: 0 });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- timelineGeometry`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// src/renderer/editor/timelineGeometry.ts
export function timeToPercent(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(100, (t / duration) * 100));
}

export function segmentRect(start: number, end: number, duration: number): { left: number; width: number } {
  if (duration <= 0) return { left: 0, width: 0 };
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(s, Math.min(end, duration));
  return { left: (s / duration) * 100, width: ((e - s) / duration) * 100 };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- timelineGeometry`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/renderer/editor/timelineGeometry.ts test/timelineGeometry.test.ts
git commit -m "feat: add timeline geometry helpers"
```

---

## Task 13: エディタ状態 reducer と store（editorReducer.ts, editorStore.tsx）

**Files:**
- Create: `src/renderer/state/editorReducer.ts`
- Create: `src/renderer/state/editorStore.tsx`
- Test: `test/editorReducer.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/editorReducer.test.ts
import { describe, it, expect } from 'vitest';
import { editorReducer, initialEditorState } from '../src/renderer/state/editorReducer';
import { createProject, type Project, type Segment } from '../src/shared/types';

function makeProject(): Project {
  return createProject({
    name: 'rec-1',
    source: {
      video: 'assets/raw.webm', narration: 'assets/narration.webm', clickLog: 'assets/clicks.json',
      display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
    },
  });
}
const seg: Segment = {
  id: 'seg-001', videoStart: 0, videoEnd: 1, originalText: 'a', correctedText: 'a',
  ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
};

describe('editorReducer', () => {
  it('starts on the home screen', () => {
    expect(initialEditorState.screen).toBe('home');
  });

  it('OPEN_PROJECT switches to the editor', () => {
    const s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    expect(s.screen).toBe('editor');
    expect(s.projectDir).toBe('/d');
    expect(s.selectedSegmentId).toBeNull();
    expect(s.transcription.status).toBe('idle');
  });

  it('CLOSE_PROJECT returns home', () => {
    const open = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    expect(editorReducer(open, { type: 'CLOSE_PROJECT' }).screen).toBe('home');
  });

  it('SELECT_SEGMENT and SET_CURRENT_TIME update state', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'SELECT_SEGMENT', id: 'seg-001' });
    s = editorReducer(s, { type: 'SET_CURRENT_TIME', time: 4.2 });
    expect(s.selectedSegmentId).toBe('seg-001');
    expect(s.currentTime).toBe(4.2);
  });

  it('transcription lifecycle: start → progress → done selects first segment', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_START' });
    expect(s.transcription).toEqual({ status: 'running', percent: 0, error: null });
    s = editorReducer(s, { type: 'TRANSCRIPTION_PROGRESS', percent: 42 });
    expect(s.transcription.percent).toBe(42);
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg] });
    expect(s.transcription.status).toBe('idle');
    expect(s.project?.segments).toHaveLength(1);
    expect(s.selectedSegmentId).toBe('seg-001');
  });

  it('TRANSCRIPTION_ERROR records the message', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_ERROR', error: 'boom' });
    expect(s.transcription.status).toBe('error');
    expect(s.transcription.error).toBe('boom');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- editorReducer`
Expected: FAIL

- [ ] **Step 3: reducer 実装**

```ts
// src/renderer/state/editorReducer.ts
import { type Project, type Segment } from '../../shared/types';

export interface TranscriptionState {
  status: 'idle' | 'running' | 'error';
  percent: number;
  error: string | null;
}

export interface EditorState {
  screen: 'home' | 'editor';
  projectDir: string | null;
  project: Project | null;
  selectedSegmentId: string | null;
  currentTime: number;
  transcription: TranscriptionState;
}

export type EditorAction =
  | { type: 'OPEN_PROJECT'; projectDir: string; project: Project }
  | { type: 'CLOSE_PROJECT' }
  | { type: 'SELECT_SEGMENT'; id: string }
  | { type: 'SET_CURRENT_TIME'; time: number }
  | { type: 'TRANSCRIPTION_START' }
  | { type: 'TRANSCRIPTION_PROGRESS'; percent: number }
  | { type: 'TRANSCRIPTION_DONE'; segments: Segment[] }
  | { type: 'TRANSCRIPTION_ERROR'; error: string };

export const initialEditorState: EditorState = {
  screen: 'home',
  projectDir: null,
  project: null,
  selectedSegmentId: null,
  currentTime: 0,
  transcription: { status: 'idle', percent: 0, error: null },
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'OPEN_PROJECT':
      return {
        ...initialEditorState,
        screen: 'editor',
        projectDir: action.projectDir,
        project: action.project,
        selectedSegmentId: action.project.segments[0]?.id ?? null,
      };
    case 'CLOSE_PROJECT':
      return { ...initialEditorState };
    case 'SELECT_SEGMENT':
      return { ...state, selectedSegmentId: action.id };
    case 'SET_CURRENT_TIME':
      return { ...state, currentTime: action.time };
    case 'TRANSCRIPTION_START':
      return { ...state, transcription: { status: 'running', percent: 0, error: null } };
    case 'TRANSCRIPTION_PROGRESS':
      return { ...state, transcription: { ...state.transcription, percent: action.percent } };
    case 'TRANSCRIPTION_DONE':
      return {
        ...state,
        project: state.project ? { ...state.project, segments: action.segments } : null,
        selectedSegmentId: action.segments[0]?.id ?? null,
        transcription: { status: 'idle', percent: 100, error: null },
      };
    case 'TRANSCRIPTION_ERROR':
      return { ...state, transcription: { status: 'error', percent: 0, error: action.error } };
    default:
      return state;
  }
}
```

- [ ] **Step 4: store（Context + Provider + フック）実装**

```tsx
// src/renderer/state/editorStore.tsx
import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import { editorReducer, initialEditorState, type EditorState, type EditorAction } from './editorReducer';

const EditorContext = createContext<{ state: EditorState; dispatch: Dispatch<EditorAction> } | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  return <EditorContext.Provider value={{ state, dispatch }}>{children}</EditorContext.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
```

- [ ] **Step 5: テストと typecheck が通ることを確認**

Run: `npm test -- editorReducer && npm run typecheck`
Expected: PASS / エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/renderer/state/editorReducer.ts src/renderer/state/editorStore.tsx test/editorReducer.test.ts
git commit -m "feat: add editor state reducer and React store"
```

---

## Task 14: ナレーション WAV 変換（decodeToWav.ts）

ブラウザ API（Web Audio）のため単体テストはしない（Task 19 で検証）。

**Files:**
- Create: `src/renderer/audio/decodeToWav.ts`

- [ ] **Step 1: 実装**

```ts
// src/renderer/audio/decodeToWav.ts
import { encodeWav } from '../../shared/wav';

const TARGET_RATE = 16000;

/** webm/opus などの音声 ArrayBuffer を 16kHz モノラルの 16bit WAV にデコード変換する。 */
export async function decodeToWav(input: ArrayBuffer): Promise<ArrayBuffer> {
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(input.slice(0));
  } finally {
    await decodeCtx.close();
  }

  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), TARGET_RATE);
}
```

- [ ] **Step 2: typecheck が通ることを確認**

Run: `npm run typecheck`
Expected: エラーなし（`OfflineAudioContext` 等は web の lib 型に含まれる。tsconfig.web.json の lib に DOM があることを確認。無ければ `"lib": ["ES2022", "DOM", "DOM.Iterable"]` を確認）

- [ ] **Step 3: コミット**

```bash
git add src/renderer/audio/decodeToWav.ts
git commit -m "feat: decode narration audio to 16kHz mono WAV via Web Audio"
```

---

## Task 15: エディタ各ペイン（PreviewPlayer, Timeline, Inspector）

React コンポーネントは手動 E2E で検証する（jsdom 未導入のため単体テストなし）。

**Files:**
- Create: `src/renderer/editor/PreviewPlayer.tsx`
- Create: `src/renderer/editor/Timeline.tsx`
- Create: `src/renderer/editor/Inspector.tsx`

- [ ] **Step 1: PreviewPlayer**

```tsx
// src/renderer/editor/PreviewPlayer.tsx
import { useState, type RefObject } from 'react';

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  videoUrl: string;
  audioUrl: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
}

/** 映像(c2m:raw.webm)を主時計に、ナレーション音声(narration.webm)を従わせて同期再生する。 */
export function PreviewPlayer({ videoRef, audioRef, videoUrl, audioUrl, onTime, onDuration }: Props) {
  const [playing, setPlaying] = useState(false);

  const syncAudioTime = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (v && a && Math.abs(a.currentTime - v.currentTime) > 0.15) a.currentTime = v.currentTime;
  };

  const togglePlay = () => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000' }}>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          onLoadedMetadata={(e) => onDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => { onTime(e.currentTarget.currentTime); syncAudioTime(); }}
          onPlay={() => { audioRef.current && void audioRef.current.play(); setPlaying(true); }}
          onPause={() => { audioRef.current?.pause(); setPlaying(false); }}
          onSeeked={syncAudioTime}
        />
        <audio ref={audioRef} src={audioUrl} />
      </div>
      <div style={{ padding: 8, background: '#222', color: '#fff' }}>
        <button onClick={togglePlay}>{playing ? '⏸ 一時停止' : '▶ 再生'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Timeline**

```tsx
// src/renderer/editor/Timeline.tsx
import { type Segment } from '../../shared/types';
import { segmentRect, timeToPercent } from './timelineGeometry';

interface Props {
  duration: number;
  currentTime: number;
  segments: Segment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
}

const ROW_H = 28;

export function Timeline({ duration, currentTime, segments, selectedId, onSelect, onSeek }: Props) {
  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, ratio)) * duration);
  };

  const row = (label: string, children: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', height: ROW_H }}>
      <div style={{ width: 90, fontSize: 12, color: '#aaa', flexShrink: 0 }}>{label}</div>
      <div style={{ position: 'relative', flex: 1, height: ROW_H, background: '#1b1b1b' }} onClick={seekFromEvent}>
        {children}
      </div>
    </div>
  );

  const allClicks = segments.flatMap((s) => s.clicks);

  return (
    <div style={{ position: 'relative', padding: 8, background: '#111' }}>
      {row('映像', null)}
      {row('セグメント', segments.map((s) => {
        const r = segmentRect(s.videoStart, s.videoEnd, duration);
        return (
          <div
            key={s.id}
            onClick={(e) => { e.stopPropagation(); onSelect(s.id); }}
            title={s.correctedText}
            style={{
              position: 'absolute', top: 3, height: ROW_H - 6,
              left: `${r.left}%`, width: `${r.width}%`,
              background: s.id === selectedId ? '#4a90d9' : '#3a3a3a',
              border: '1px solid #555', borderRadius: 3, overflow: 'hidden',
              fontSize: 11, color: '#fff', whiteSpace: 'nowrap', cursor: 'pointer', padding: '0 4px',
            }}
          >
            {s.correctedText}
          </div>
        );
      }))}
      {row('クリック', allClicks.map((c, i) => (
        <div key={i} style={{
          position: 'absolute', top: ROW_H / 2 - 4, width: 8, height: 8,
          left: `calc(${timeToPercent(c.t, duration)}% - 4px)`,
          background: '#e0a030', transform: 'rotate(45deg)',
        }} />
      )))}
      {/* 再生ヘッド */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        left: `calc(90px + (100% - 90px) * ${timeToPercent(currentTime, duration) / 100})`,
        width: 2, background: '#e54', pointerEvents: 'none',
      }} />
    </div>
  );
}
```

- [ ] **Step 3: Inspector**

```tsx
// src/renderer/editor/Inspector.tsx
import { type Segment } from '../../shared/types';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

export function Inspector({ segment, index }: { segment: Segment | null; index: number }) {
  if (!segment) {
    return <div style={{ padding: 12, color: '#888' }}>セグメントを選択してください</div>;
  }
  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <h3 style={{ marginTop: 0 }}>セグメント {index + 1}（{segment.id}）</h3>
      <div style={{ color: '#666', marginBottom: 8 }}>{fmt(segment.videoStart)} – {fmt(segment.videoEnd)}</div>
      <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>文字起こし（読み取り専用）</div>
      <div style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
        {segment.originalText || '（無音/空）'}
      </div>
      <div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>クリック {segment.clicks.length} 件</div>
    </div>
  );
}
```

- [ ] **Step 4: typecheck・build が通ることを確認**

Run: `npm run typecheck && npm run build`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/renderer/editor/PreviewPlayer.tsx src/renderer/editor/Timeline.tsx src/renderer/editor/Inspector.tsx
git commit -m "feat: add preview player, timeline, and inspector panes"
```

---

## Task 16: エディタシェルと文字起こし実行フロー（EditorLayout.tsx）

**Files:**
- Create: `src/renderer/editor/EditorLayout.tsx`

- [ ] **Step 1: 実装**

```tsx
// src/renderer/editor/EditorLayout.tsx
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/editorStore';
import { PreviewPlayer } from './PreviewPlayer';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { decodeToWav } from '../audio/decodeToWav';

export function EditorLayout() {
  const { state, dispatch } = useEditor();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);

  // 進捗イベントの購読
  useEffect(() => {
    const unsub = window.api.onTranscriptionProgress((p) =>
      dispatch({ type: 'TRANSCRIPTION_PROGRESS', percent: p }),
    );
    return unsub;
  }, [dispatch]);

  const project = state.project;
  if (!project) return null;
  const segments = project.segments;
  const selectedIndex = segments.findIndex((s) => s.id === state.selectedSegmentId);
  const selected = selectedIndex >= 0 ? segments[selectedIndex] : null;

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
    if (audioRef.current) audioRef.current.currentTime = t;
    dispatch({ type: 'SET_CURRENT_TIME', time: t });
  };

  async function runTranscription() {
    dispatch({ type: 'TRANSCRIPTION_START' });
    try {
      if (!(await window.api.assetExists('assets/narration.wav'))) {
        const webm = await window.api.readAsset('assets/narration.webm');
        const wav = await decodeToWav(webm);
        await window.api.writeAsset('assets/narration.wav', wav);
      }
      const { segments: result } = await window.api.runTranscription();
      dispatch({ type: 'TRANSCRIPTION_DONE', segments: result });
    } catch (err) {
      dispatch({ type: 'TRANSCRIPTION_ERROR', error: String(err) });
    }
  }

  const tx = state.transcription;

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr auto', height: '100vh' }}>
      {/* ツールバー */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', background: '#2a2a2a', color: '#fff' }}>
        <button onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}>← ホーム</button>
        <strong>{project.meta.name}</strong>
        <button onClick={runTranscription} disabled={tx.status === 'running'}>
          {tx.status === 'running' ? `文字起こし中… ${tx.percent}%` : '文字起こし'}
        </button>
        {tx.status === 'running' && <button onClick={() => window.api.cancelTranscription()}>キャンセル</button>}
        {tx.status === 'error' && <span style={{ color: '#f88' }}>失敗: {tx.error}</span>}
      </div>

      {/* 中央＝プレビュー / 右＝インスペクタ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', minHeight: 0 }}>
        <PreviewPlayer
          videoRef={videoRef}
          audioRef={audioRef}
          videoUrl="c2m://asset/assets/raw.webm"
          audioUrl="c2m://asset/assets/narration.webm"
          onTime={(t) => dispatch({ type: 'SET_CURRENT_TIME', time: t })}
          onDuration={setDuration}
        />
        <div style={{ borderLeft: '1px solid #ddd', overflow: 'auto' }}>
          <Inspector segment={selected} index={selectedIndex} />
        </div>
      </div>

      {/* 下＝タイムライン */}
      <Timeline
        duration={duration}
        currentTime={state.currentTime}
        segments={segments}
        selectedId={state.selectedSegmentId}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onSeek={seek}
      />
    </div>
  );
}
```

- [ ] **Step 2: typecheck・build が通ることを確認**

Run: `npm run typecheck && npm run build`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/renderer/editor/EditorLayout.tsx
git commit -m "feat: editor shell with transcription run flow and progress"
```

---

## Task 17: ホーム画面とルーティング（HomeScreen.tsx, App.tsx）

**Files:**
- Create: `src/renderer/home/HomeScreen.tsx`
- Modify: `src/renderer/App.tsx`（全面書き換え）

- [ ] **Step 1: HomeScreen（録画＋最近の録画）**

```tsx
// src/renderer/home/HomeScreen.tsx
import { useEffect, useRef, useState } from 'react';
import { ScreenRecorder } from '../recorder/screenRecorder';
import { useEditor } from '../state/editorStore';
import type { RecentProject } from '../global';

export function HomeScreen() {
  const { dispatch } = useEditor();
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('録画していません');
  const [recent, setRecent] = useState<RecentProject[]>([]);

  const refreshRecent = () => { void window.api.recentProjects().then(setRecent); };
  useEffect(refreshRecent, []);

  async function open(projectDir: string) {
    const { project } = await window.api.openProject(projectDir);
    dispatch({ type: 'OPEN_PROJECT', projectDir, project });
  }

  async function onStart() {
    const recorder = new ScreenRecorder();
    try {
      await recorder.start();
      await window.api.startRecording();
      recorderRef.current = recorder;
      setRecording(true);
      setStatus('録画中…');
    } catch (err) {
      recorderRef.current = null;
      setRecording(false);
      setStatus(`録画開始に失敗しました: ${String(err)}`);
    }
  }

  async function onStop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      const result = await recorder.stop();
      const video = await result.videoBlob.arrayBuffer();
      const audio = await result.audioBlob.arrayBuffer();
      const res = await window.api.stopRecording({
        video, audio, videoWidth: result.videoWidth, videoHeight: result.videoHeight,
      });
      setRecording(false);
      recorderRef.current = null;
      setStatus(`保存しました（クリック ${res.clickCount} 件）。エディタを開きます…`);
      await open(res.projectDir);
    } catch (err) {
      setRecording(false);
      recorderRef.current = null;
      setStatus(`保存に失敗しました: ${String(err)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto' }}>
      <h1>clip2manual</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={recording ? onStop : onStart}>
          {recording ? '■ 停止して保存' : '● 録画開始'}
        </button>
        <button onClick={() => window.api.openProjectDialog().then((r) => r && dispatch({ type: 'OPEN_PROJECT', projectDir: r.projectDir, project: r.project }))}>
          フォルダから開く
        </button>
      </div>
      <p>{status}</p>

      <h2 style={{ fontSize: 16 }}>最近の録画</h2>
      {recent.length === 0 ? (
        <p style={{ color: '#888' }}>まだ録画がありません。</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {recent.map((r) => (
            <li key={r.projectDir} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <button onClick={() => open(r.projectDir)} style={{ marginRight: 8 }}>開く</button>
              {r.name}
              <span style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>{new Date(r.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: App.tsx を書き換え**

```tsx
// src/renderer/App.tsx
import { EditorProvider, useEditor } from './state/editorStore';
import { HomeScreen } from './home/HomeScreen';
import { EditorLayout } from './editor/EditorLayout';

function Router() {
  const { state } = useEditor();
  return state.screen === 'editor' ? <EditorLayout /> : <HomeScreen />;
}

export default function App() {
  return (
    <EditorProvider>
      <Router />
    </EditorProvider>
  );
}
```

- [ ] **Step 3: typecheck・build・全テストが通ることを確認**

Run: `npm run typecheck && npm run build && npm test`
Expected: エラーなし／全 PASS

- [ ] **Step 4: コミット**

```bash
git add src/renderer/home/HomeScreen.tsx src/renderer/App.tsx
git commit -m "feat: home screen with recent recordings and home/editor routing"
```

---

## Task 18: whisper セットアップスクリプト（setup-whisper.mjs）

**Files:**
- Create: `scripts/setup-whisper.mjs`
- Modify: `.gitignore`（`vendor/` 追加）
- Modify: `package.json`（`setup:whisper` スクリプト追加）

注意: 下記の URL/バージョンは現時点で妥当な固定値。実行時にアセットが 404 する場合は
whisper.cpp の最新リリースページで Windows x64 zip 名と HF のモデル URL を確認し、定数を更新すること。

- [ ] **Step 1: スクリプト作成**

```js
// scripts/setup-whisper.mjs
// whisper.cpp の Windows ビルド済みバイナリと ggml-small モデルを vendor/whisper/ に取得する。
import { existsSync, mkdirSync, createWriteStream, writeFileSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const WHISPER_VERSION = 'v1.7.4';
const BIN_URL = `https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`;
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';

const vendorDir = resolve(process.cwd(), 'vendor', 'whisper');
const binDir = join(vendorDir, 'bin');
const modelPath = join(vendorDir, 'ggml-small.bin');
const zipPath = join(vendorDir, 'whisper-bin-x64.zip');

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function findExe(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const found = findExe(p);
      if (found) return found;
    } else if (name === 'whisper-cli.exe' || name === 'main.exe') {
      return p;
    }
  }
  return null;
}

async function main() {
  mkdirSync(vendorDir, { recursive: true });

  if (!existsSync(modelPath)) {
    await download(MODEL_URL, modelPath);
  } else {
    console.log('Model already present, skipping.');
  }

  let exePath = existsSync(binDir) ? findExe(binDir) : null;
  if (!exePath) {
    await download(BIN_URL, zipPath);
    mkdirSync(binDir, { recursive: true });
    // PowerShell の Expand-Archive で展開（追加依存なし）
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${binDir}" -Force`,
    ], { stdio: 'inherit' });
    await rm(zipPath, { force: true });
    exePath = findExe(binDir);
  }
  if (!exePath) {
    throw new Error(`whisper executable not found under ${binDir} after extraction. ` +
      `Check the release asset name for ${WHISPER_VERSION}.`);
  }

  writeFileSync(join(vendorDir, 'manifest.json'),
    JSON.stringify({ binPath: exePath, modelPath }, null, 2));
  console.log(`\nDone.\n  bin:   ${exePath}\n  model: ${modelPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: .gitignore に vendor/ を追加**

`.gitignore` の「Build output」セクション付近に追記:

```
# Vendored binaries/models (provisioned via scripts/setup-whisper.mjs)
vendor/
```

- [ ] **Step 3: package.json に scripts を追加**

`scripts` ブロックに追加:

```json
    "setup:whisper": "node scripts/setup-whisper.mjs",
```

- [ ] **Step 4: スクリプトを実行して取得を確認**

Run: `npm run setup:whisper`
Expected: `vendor/whisper/ggml-small.bin`、`vendor/whisper/bin/.../whisper-cli.exe`（または `main.exe`）、`vendor/whisper/manifest.json` が生成される。最後に bin/model のパスが表示される。
（404 の場合は冒頭の注意に従い定数を更新して再実行）

- [ ] **Step 5: コミット**

```bash
git add scripts/setup-whisper.mjs .gitignore package.json
git commit -m "feat: add whisper provisioning script (downloads binary + ggml-small to vendor/)"
```

---

## Task 19: 手動 E2E 検証

自動テストでは到達できない統合（whisper 実行・c2m プロトコル・Web Audio・3 ペイン UI）を実機で確認する。

**Files:** なし（検証のみ）

- [ ] **Step 1: 事前条件**

Run: `npm run setup:whisper`（未実行なら）
Run: `npm run dev`

- [ ] **Step 2: 既存録画を開く**

- ホーム画面に「最近の録画」一覧が表示される。
- フェーズ1で録画した `rec-*` の「開く」を押す → エディタ（3 ペイン）に遷移する。
- （録画が無ければ「● 録画開始」で新規録画 → 停止 → 自動でエディタに遷移することも確認）

- [ ] **Step 3: プレビュー再生**

- 中央プレビューで「▶ 再生」を押すと映像が再生され、ナレーション音声が同期して聞こえる。
- タイムラインのトラックをクリックすると再生位置（再生ヘッド）が移動する。

- [ ] **Step 4: 文字起こし**

- ツールバーの「文字起こし」を押す。
- 進捗（%）が更新される。
- 完了後、タイムラインの「セグメント」トラックに日本語のセグメント帯が並ぶ。
- 初回は `assets/narration.wav` が生成されていることをエクスプローラで確認。

- [ ] **Step 5: 選択とインスペクタ**

- セグメント帯をクリック → 選択がハイライトされ、右インスペクタに番号・時間範囲・文字起こしテキストが表示される。
- クリックトラックにマーカー（◆）が表示される。

- [ ] **Step 6: 永続化**

- 「← ホーム」→ 同じプロジェクトを開き直すと、セグメントが保持されている（project.json に保存済み）。
- `project.json` の `segments` に文字起こし結果が入っていることを確認。

- [ ] **Step 7: 検証結果の記録**

- 上記がすべて通ればフェーズ2完了。`docs/superpowers/specs/2026-05-26-clip2manual-phase2-design.md` の手動 E2E 項目と突き合わせる。
- 問題（座標ズレ／音ズレ／whisper パス未解決など）があれば記録し、該当タスクに戻る。

---

## Self-Review メモ（計画作成者による確認）

- **仕様カバレッジ**: ① フロー=Task 14/16/19、② whisper 入手=Task 5/18、③ モジュール構成=全タスク、
  ④ IPC/プロトコル契約=Task 9/10/11、⑤ ロジック（whisper引数=Task 6、進捗=Task 4、Segment生成/clicks=Task 3、
  validateProject=Task 2、WAV=Task 1/14）、⑥ UI=Task 12/13/15/16/17、⑦ テスト=各 TDD タスク＋Task 19、
  ⑧ 非対象=実装せず、⑨ 先送り対応（validateProject）=Task 2。すべて対応タスクあり。
- **型整合**: `WhisperSegment`/`WhisperJson`(Task 3) は transcriptionService(Task 7)・whisperRunner と一致。
  `EditorState`/`EditorAction`(Task 13) は editorStore・EditorLayout で一致。`window.api`(Task 11) は
  preload(Task 11) と各 renderer 呼び出しで一致。`resolveWhisper`(Task 5) の返り値型を transcription.ts が使用。
- **プレースホルダ**: setup スクリプトの URL/バージョンのみ「実行時に要確認」と明示（外部リリースに依存するため不可避）。
  それ以外に TBD/TODO なし。
```
