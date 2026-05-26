# VOICEVOX TTS 生成基盤（フェーズ4ラウンド1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 各セグメントの `correctedText` を VOICEVOX で合成し `tts/<id>.wav` に保存・試聴でき、声/速度を既定値＋個別に選べるようにする（エンジンは最小プロビジョニング＋遅延起動で管理）。

**Architecture:** main プロセスに VOICEVOX エンジンのプロビジョニング（whisper と同パターン）・遅延起動ライフサイクル・HTTPクライアント・合成オーケストレーションを置き、IPC で公開する。レンダラの reducer に声/生成のアクションを足し、Inspector とツールバーで生成・再生成・試聴・声選択を行う。spawn と HTTP は注入境界にして単体テストは実エンジン不要にする。

**Tech Stack:** Electron + TypeScript + React、Vitest（テストは `test/`・node環境・`.test.ts` のみ）、VOICEVOX ENGINE（localhost:50021、HTTP）、Node global `fetch`。

仕様: `docs/superpowers/specs/2026-05-27-clip2manual-phase4-tts-generation-design.md`

---

## File Structure

- `src/shared/types.ts` — **Modify**: `SpeakerOption` 型を追加
- `src/main/voicevox/voicevoxPaths.ts` — **Create**: run パス解決（env→vendor manifest）
- `src/main/voicevox/ttsClient.ts` — **Create**: `synthesize` / `fetchSpeakers` / `flattenSpeakers`（HTTP、fetch注入可）
- `src/main/voicevox/ttsService.ts` — **Create**: `generateTts`（エンジン/クライアント注入、ファイル書き込み、空skip）
- `src/main/voicevox/engine.ts` — **Create**: `VoicevoxEngine`（遅延起動・再利用・停止、spawn/probe注入可）＋ `defaultEngineDeps`
- `src/main/ipc/tts.ts` — **Create**: TTS の IPC（speakers/generateSegment/generateAll/cancel）＋エンジン singleton ＋ `stopVoicevoxEngine`
- `src/main/ipc/project.ts` — **Modify**: `project:updateSettings` ハンドラ追加
- `src/main/ipc/index.ts` — **Modify**: `registerTtsIpc` を登録
- `src/main/projectSession.ts` — **Modify**: `updateSettings` 追加
- `src/main/index.ts` — **Modify**: `before-quit` でエンジン停止
- `src/preload/index.ts` — **Modify**: TTS/updateSettings を公開
- `src/renderer/global.d.ts` — **Modify**: TTS/updateSettings を型付け
- `src/renderer/state/editorReducer.ts` — **Modify**: 声/生成アクション＋`tts` スライス
- `src/renderer/editor/Inspector.tsx` — **Modify**: 声選択・生成・試聴・クレジット
- `src/renderer/editor/EditorLayout.tsx` — **Modify**: 話者取得・生成ハンドラ・進捗購読・ツールバー
- `scripts/setup-voicevox.mjs` — **Create**: エンジン取得・展開・manifest
- `package.json` — **Modify**: `setup:voicevox` スクリプト
- 各 `test/*.test.ts` — **Create/Modify**

依存順: Task1→4 は独立した純ロジック/注入境界（TDD）。Task5 reducer（TDD）。Task6 で配線。Task7 で UI。Task8 プロビジョニング（手動検証）。Task9 総合検証。

---

## Task 1: `voicevoxPaths.ts`（run パス解決）

**Files:**
- Create: `src/main/voicevox/voicevoxPaths.ts`
- Test: `test/voicevoxPaths.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/voicevoxPaths.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveVoicevox, VoicevoxNotProvisionedError } from '../src/main/voicevox/voicevoxPaths';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-vv-')); });
afterEach(async () => {
  delete process.env.C2M_VOICEVOX_RUN;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveVoicevox', () => {
  it('throws VoicevoxNotProvisionedError when no manifest and no env', () => {
    expect(() => resolveVoicevox({ vendorDir: dir })).toThrow(VoicevoxNotProvisionedError);
  });

  it('resolves from the vendor manifest', async () => {
    const runPath = path.join(dir, 'run.exe');
    await fs.writeFile(runPath, 'x');
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ runPath }));
    expect(resolveVoicevox({ vendorDir: dir })).toEqual({ runPath });
  });

  it('prefers the C2M_VOICEVOX_RUN env override', async () => {
    const runPath = path.join(dir, 'custom-run.exe');
    await fs.writeFile(runPath, 'x');
    process.env.C2M_VOICEVOX_RUN = runPath;
    expect(resolveVoicevox({ vendorDir: dir })).toEqual({ runPath });
  });

  it('throws when the manifest points to a missing file', async () => {
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ runPath: path.join(dir, 'nope.exe') }));
    expect(() => resolveVoicevox({ vendorDir: dir })).toThrow(VoicevoxNotProvisionedError);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- voicevoxPaths`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`src/main/voicevox/voicevoxPaths.ts`（`whisperPaths.ts` を踏襲）:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';

export class VoicevoxNotProvisionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoicevoxNotProvisionedError';
  }
}

export interface VoicevoxPaths {
  runPath: string;
}

function assertExists(p: string): void {
  if (!fs.existsSync(p)) {
    throw new VoicevoxNotProvisionedError(`VOICEVOX file not found: ${p}. Run: npm run setup:voicevox`);
  }
}

/**
 * VOICEVOX エンジンの run 実行ファイルパスを解決する。
 * 優先順: 環境変数 C2M_VOICEVOX_RUN → vendor/voicevox/manifest.json。
 * 設定画面による上書きはフェーズ8で追加予定。
 */
export function resolveVoicevox(opts: { vendorDir?: string } = {}): VoicevoxPaths {
  const envRun = process.env.C2M_VOICEVOX_RUN;
  if (envRun) {
    assertExists(envRun);
    return { runPath: envRun };
  }

  const vendorDir = opts.vendorDir ?? path.join(process.cwd(), 'vendor', 'voicevox');
  const manifestPath = path.join(vendorDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new VoicevoxNotProvisionedError(
      `VOICEVOX is not provisioned (${manifestPath} not found). Run: npm run setup:voicevox`,
    );
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VoicevoxPaths;
  assertExists(m.runPath);
  return { runPath: m.runPath };
}
```

- [ ] **Step 4: パス確認**

Run: `npm test -- voicevoxPaths`
Expected: PASS（4件）

- [ ] **Step 5: コミット**

```bash
git add src/main/voicevox/voicevoxPaths.ts test/voicevoxPaths.test.ts
git commit -m "feat: add VOICEVOX run-path resolver (env -> vendor manifest)"
```

---

## Task 2: `ttsClient.ts`（HTTP クライアント）＋ `SpeakerOption` 型

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/voicevox/ttsClient.ts`
- Test: `test/ttsClient.test.ts`

- [ ] **Step 1: 共有型を追加**

`src/shared/types.ts` の `SegmentVoice` インターフェース定義の直後に追加:

```ts
export interface SpeakerOption {
  speaker: number; // VOICEVOX のスタイル id
  label: string;   // "キャラ（スタイル）"
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/ttsClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { synthesize, fetchSpeakers, flattenSpeakers, type FetchLike } from '../src/main/voicevox/ttsClient';

describe('flattenSpeakers', () => {
  it('flattens characters and styles into {speaker,label}', () => {
    const raw = [
      { name: 'ずんだもん', styles: [{ name: 'ノーマル', id: 3 }, { name: 'あまあま', id: 1 }] },
      { name: '四国めたん', styles: [{ name: 'ノーマル', id: 2 }] },
    ];
    expect(flattenSpeakers(raw)).toEqual([
      { speaker: 3, label: 'ずんだもん（ノーマル）' },
      { speaker: 1, label: 'ずんだもん（あまあま）' },
      { speaker: 2, label: '四国めたん（ノーマル）' },
    ]);
  });
});

describe('synthesize', () => {
  it('calls audio_query then synthesis, injects speedScale, returns the wav buffer', async () => {
    const calls: { url: string; init?: any }[] = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/audio_query')) {
        return { ok: true, status: 200, json: async () => ({ speedScale: 1.0, accent_phrases: [] }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new TextEncoder().encode('WAVDATA').buffer };
    };

    const buf = await synthesize('http://e', { text: 'こんにちは', speaker: 3, speed: 1.3 }, fake);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/audio_query?text=');
    expect(calls[0].url).toContain('speaker=3');
    expect(calls[1].url).toBe('http://e/synthesis?speaker=3');
    expect(JSON.parse(calls[1].init.body).speedScale).toBe(1.3);
    expect(buf.toString()).toBe('WAVDATA');
  });

  it('throws when audio_query is not ok', async () => {
    const fake: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(synthesize('http://e', { text: 'x', speaker: 3, speed: 1 }, fake)).rejects.toThrow();
  });
});

describe('fetchSpeakers', () => {
  it('GETs /speakers and returns the parsed list', async () => {
    const fake: FetchLike = async (url) => ({
      ok: true, status: 200,
      json: async () => (url.endsWith('/speakers') ? [{ name: 'A', styles: [{ name: 'N', id: 1 }] }] : []),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    expect(await fetchSpeakers('http://e', fake)).toEqual([{ name: 'A', styles: [{ name: 'N', id: 1 }] }]);
  });
});
```

- [ ] **Step 3: 失敗確認**

Run: `npm test -- ttsClient`
Expected: FAIL（モジュール未作成）

- [ ] **Step 4: 実装**

`src/main/voicevox/ttsClient.ts`:

```ts
import { type SpeakerOption } from '../../shared/types';

export interface SynthesizeInput {
  text: string;
  speaker: number;
  speed: number;
}

export interface RawSpeakerStyle {
  name: string;
  id: number;
}
export interface RawSpeaker {
  name: string;
  styles: RawSpeakerStyle[];
}

/** テストで差し替え可能な最小 fetch 型。本番では global fetch を使う。 */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const defaultFetch = globalThis.fetch as unknown as FetchLike;

/** /speakers の構造をレンダラ向けの {speaker,label} 配列に平坦化する。 */
export function flattenSpeakers(raw: RawSpeaker[]): SpeakerOption[] {
  const out: SpeakerOption[] = [];
  for (const c of raw) {
    for (const s of c.styles) {
      out.push({ speaker: s.id, label: `${c.name}（${s.name}）` });
    }
  }
  return out;
}

/** /speakers を取得する。 */
export async function fetchSpeakers(baseUrl: string, fetchFn: FetchLike = defaultFetch): Promise<RawSpeaker[]> {
  const res = await fetchFn(`${baseUrl}/speakers`);
  if (!res.ok) throw new Error(`/speakers failed (${res.status})`);
  return (await res.json()) as RawSpeaker[];
}

/** audio_query → speedScale 設定 → synthesis の順で合成し wav バイト列を返す。 */
export async function synthesize(
  baseUrl: string,
  input: SynthesizeInput,
  fetchFn: FetchLike = defaultFetch,
): Promise<Buffer> {
  const q = await fetchFn(
    `${baseUrl}/audio_query?text=${encodeURIComponent(input.text)}&speaker=${input.speaker}`,
    { method: 'POST' },
  );
  if (!q.ok) throw new Error(`audio_query failed (${q.status})`);
  const query = (await q.json()) as Record<string, unknown>;
  query['speedScale'] = input.speed;

  const s = await fetchFn(`${baseUrl}/synthesis?speaker=${input.speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!s.ok) throw new Error(`synthesis failed (${s.status})`);
  return Buffer.from(await s.arrayBuffer());
}
```

- [ ] **Step 5: パス確認**

Run: `npm test -- ttsClient`
Expected: PASS（4件）

- [ ] **Step 6: コミット**

```bash
git add src/shared/types.ts src/main/voicevox/ttsClient.ts test/ttsClient.test.ts
git commit -m "feat: add VOICEVOX HTTP client (synthesize, speakers, flatten)"
```

---

## Task 3: `ttsService.ts`（合成オーケストレーション）

**Files:**
- Create: `src/main/voicevox/ttsService.ts`
- Test: `test/ttsService.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/ttsService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateTts, type TtsEngine, type TtsClient } from '../src/main/voicevox/ttsService';
import { type Segment } from '../src/shared/types';

function seg(id: string, text: string): Segment {
  return {
    id, videoStart: 0, videoEnd: 1, originalText: text, correctedText: text,
    ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}

const engine: TtsEngine = { ensureRunning: async () => 'http://e' };

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-tts-'));
  await fs.mkdir(path.join(dir, 'tts'), { recursive: true });
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('generateTts', () => {
  it('synthesizes non-empty segments, writes tts/<id>.wav, sets ttsAudio, skips empty', async () => {
    const calls: string[] = [];
    const client: TtsClient = {
      synthesize: async (_baseUrl, input) => { calls.push(input.text); return Buffer.from('WAV:' + input.text); },
    };
    const result = await generateTts({
      engine, client, outDir: dir,
      segments: [seg('seg-001', 'hello'), seg('seg-002', '   '), seg('seg-003', 'world')],
    });

    expect(calls).toEqual(['hello', 'world']); // 空はスキップ
    expect(result[0].ttsAudio).toBe('tts/seg-001.wav');
    expect(result[1].ttsAudio).toBeNull();
    expect(result[2].ttsAudio).toBe('tts/seg-003.wav');
    expect(await fs.readFile(path.join(dir, 'tts/seg-001.wav'), 'utf8')).toBe('WAV:hello');
    expect(await fs.readFile(path.join(dir, 'tts/seg-003.wav'), 'utf8')).toBe('WAV:world');
  });

  it('with onlyId generates just that segment', async () => {
    const client: TtsClient = { synthesize: async () => Buffer.from('X') };
    const result = await generateTts({
      engine, client, outDir: dir, onlyId: 'seg-002',
      segments: [seg('seg-001', 'a'), seg('seg-002', 'b')],
    });
    expect(result[0].ttsAudio).toBeNull();
    expect(result[1].ttsAudio).toBe('tts/seg-002.wav');
  });

  it('reports progress and uses each segment voice', async () => {
    const speakers: number[] = [];
    const client: TtsClient = { synthesize: async (_b, input) => { speakers.push(input.speaker); return Buffer.from('X'); } };
    const s1 = { ...seg('seg-001', 'a'), voice: { speaker: 8, speed: 1.2 } };
    const progress: Array<[number, number]> = [];
    await generateTts({
      engine, client, outDir: dir, segments: [s1, seg('seg-002', 'b')],
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(speakers).toEqual([8, 3]);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- ttsService`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`src/main/voicevox/ttsService.ts`:

```ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Segment } from '../../shared/types';
import { type SynthesizeInput } from './ttsClient';

/** 起動済みエンジンの baseUrl を返す抽象。 */
export interface TtsEngine {
  ensureRunning(): Promise<string>;
}

/** 合成クライアント抽象（テストで差し替え）。 */
export interface TtsClient {
  synthesize(baseUrl: string, input: SynthesizeInput): Promise<Buffer>;
}

export interface GenerateOptions {
  engine: TtsEngine;
  client: TtsClient;
  /** プロジェクトディレクトリ。`<outDir>/tts/<id>.wav` を書く。 */
  outDir: string;
  segments: Segment[];
  /** 指定時はそのセグメントだけ生成する。 */
  onlyId?: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * 対象セグメントを VOICEVOX で合成し wav を保存、ttsAudio を設定した新しい segments を返す。
 * correctedText が空のセグメントはスキップ（ttsAudio はそのまま）。最初のエラーで停止。
 */
export async function generateTts(opts: GenerateOptions): Promise<Segment[]> {
  const baseUrl = await opts.engine.ensureRunning();
  const ttsDir = path.join(opts.outDir, 'tts');
  await fs.mkdir(ttsDir, { recursive: true });

  const targets = opts.segments.filter(
    (s) => (opts.onlyId ? s.id === opts.onlyId : true) && s.correctedText.trim() !== '',
  );

  const updated = opts.segments.map((s) => ({ ...s }));
  let done = 0;
  for (const s of targets) {
    if (opts.signal?.aborted) throw new Error('TTS generation cancelled');
    const wav = await opts.client.synthesize(baseUrl, {
      text: s.correctedText,
      speaker: s.voice.speaker,
      speed: s.voice.speed,
    });
    const rel = `tts/${s.id}.wav`;
    await fs.writeFile(path.join(opts.outDir, rel), wav);
    const idx = updated.findIndex((u) => u.id === s.id);
    updated[idx] = { ...updated[idx], ttsAudio: rel };
    done += 1;
    opts.onProgress?.(done, targets.length);
  }
  return updated;
}
```

- [ ] **Step 4: パス確認**

Run: `npm test -- ttsService`
Expected: PASS（3件）

- [ ] **Step 5: コミット**

```bash
git add src/main/voicevox/ttsService.ts test/ttsService.test.ts
git commit -m "feat: add TTS generation orchestration (write tts/<id>.wav, skip empty)"
```

---

## Task 4: `engine.ts`（遅延起動ライフサイクル）

**Files:**
- Create: `src/main/voicevox/engine.ts`
- Test: `test/voicevoxEngine.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/voicevoxEngine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { VoicevoxEngine, type VoicevoxEngineDeps } from '../src/main/voicevox/engine';

function deps(over: Partial<VoicevoxEngineDeps>): VoicevoxEngineDeps {
  return {
    baseUrl: 'http://127.0.0.1:50021',
    probe: async () => false,
    spawnEngine: () => ({ kill: () => {} }),
    startTimeoutMs: 1000,
    pollIntervalMs: 1,
    sleep: async () => {},
    ...over,
  };
}

describe('VoicevoxEngine.ensureRunning', () => {
  it('reuses an already-running engine without spawning', async () => {
    let spawned = 0;
    const e = new VoicevoxEngine(deps({ probe: async () => true, spawnEngine: () => { spawned++; return { kill: () => {} }; } }));
    expect(await e.ensureRunning()).toBe('http://127.0.0.1:50021');
    expect(spawned).toBe(0);
  });

  it('spawns and polls until ready', async () => {
    let spawned = 0;
    let n = 0;
    const e = new VoicevoxEngine(deps({
      probe: async () => { n++; return n >= 3; }, // 最初の2回false→3回目true
      spawnEngine: () => { spawned++; return { kill: () => {} }; },
    }));
    expect(await e.ensureRunning()).toBe('http://127.0.0.1:50021');
    expect(spawned).toBe(1);
  });

  it('throws if it never becomes ready before timeout', async () => {
    const e = new VoicevoxEngine(deps({ probe: async () => false, startTimeoutMs: 5, pollIntervalMs: 1 }));
    await expect(e.ensureRunning()).rejects.toThrow();
  });

  it('stop kills the spawned process', async () => {
    let killed = 0;
    let n = 0;
    const e = new VoicevoxEngine(deps({
      probe: async () => { n++; return n >= 2; },
      spawnEngine: () => ({ kill: () => { killed++; } }),
    }));
    await e.ensureRunning();
    e.stop();
    expect(killed).toBe(1);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- voicevoxEngine`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`src/main/voicevox/engine.ts`:

```ts
import { spawn } from 'node:child_process';
import * as path from 'node:path';

export interface EngineProcess {
  kill(): void;
}

export interface VoicevoxEngineDeps {
  baseUrl: string;
  /** エンジンが応答するか（GET /version）。 */
  probe: () => Promise<boolean>;
  /** エンジンを子プロセスとして起動する。 */
  spawnEngine: () => EngineProcess;
  startTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * VOICEVOX エンジンの遅延起動ライフサイクル。
 * ensureRunning: 既に応答していれば再利用、なければ spawn して /version を準備完了までポーリング。
 */
export class VoicevoxEngine {
  private proc: EngineProcess | null = null;
  constructor(private deps: VoicevoxEngineDeps) {}

  async ensureRunning(): Promise<string> {
    if (await this.deps.probe()) return this.deps.baseUrl;
    if (!this.proc) this.proc = this.deps.spawnEngine();

    const timeout = this.deps.startTimeoutMs ?? 60000;
    const interval = this.deps.pollIntervalMs ?? 500;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await sleep(interval);
      if (await this.deps.probe()) return this.deps.baseUrl;
    }
    throw new Error('VOICEVOX engine did not become ready in time');
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }
}

/** 本番用 deps。run.exe を spawn し、GET /version で health check する。 */
export function defaultEngineDeps(runPath: string, port = 50021): VoicevoxEngineDeps {
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    probe: async () => {
      try {
        const r = await fetch(`${baseUrl}/version`);
        return r.ok;
      } catch {
        return false;
      }
    },
    spawnEngine: () => {
      const child = spawn(runPath, ['--host', '127.0.0.1', '--port', String(port)], {
        cwd: path.dirname(runPath),
        stdio: 'ignore',
      });
      return { kill: () => { child.kill(); } };
    },
  };
}
```

- [ ] **Step 4: パス確認**

Run: `npm test -- voicevoxEngine`
Expected: PASS（4件）

- [ ] **Step 5: コミット**

```bash
git add src/main/voicevox/engine.ts test/voicevoxEngine.test.ts
git commit -m "feat: add VOICEVOX engine lazy-start lifecycle"
```

---

## Task 5: reducer の声/生成アクション＋`tts` スライス

**Files:**
- Modify: `src/renderer/state/editorReducer.ts`
- Test: `test/editorReducer.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/editorReducer.test.ts` の `describe('editorReducer', ...)` 末尾（最後の `it` の後、閉じ `});` の前）に追記:

```ts
  it('SET_SEGMENT_VOICE updates only the matching segment voice', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg, { ...seg, id: 'seg-002' }] });
    s = editorReducer(s, { type: 'SET_SEGMENT_VOICE', id: 'seg-002', voice: { speaker: 8, speed: 1.4 } });
    expect(s.project!.segments[0].voice).toEqual({ speaker: 3, speed: 1 });
    expect(s.project!.segments[1].voice).toEqual({ speaker: 8, speed: 1.4 });
  });

  it('SET_DEFAULT_VOICE updates settings.tts', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'SET_DEFAULT_VOICE', voice: { speaker: 5, speed: 0.9 } });
    expect(s.project!.settings.tts).toEqual({ defaultSpeaker: 5, defaultSpeed: 0.9 });
  });

  it('APPLY_DEFAULT_VOICE_TO_ALL sets every segment voice to the default', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg, { ...seg, id: 'seg-002', voice: { speaker: 9, speed: 2 } }] });
    s = editorReducer(s, { type: 'SET_DEFAULT_VOICE', voice: { speaker: 5, speed: 0.9 } });
    s = editorReducer(s, { type: 'APPLY_DEFAULT_VOICE_TO_ALL' });
    expect(s.project!.segments.map((x) => x.voice)).toEqual([
      { speaker: 5, speed: 0.9 }, { speaker: 5, speed: 0.9 },
    ]);
  });

  it('tts lifecycle: start -> progress -> generated', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TTS_START' });
    expect(s.tts).toEqual({ status: 'running', percent: 0, error: null });
    s = editorReducer(s, { type: 'TTS_PROGRESS', percent: 50 });
    expect(s.tts.percent).toBe(50);
    s = editorReducer(s, { type: 'TTS_GENERATED', segments: [{ ...seg, ttsAudio: 'tts/seg-001.wav' }] });
    expect(s.tts.status).toBe('idle');
    expect(s.project!.segments[0].ttsAudio).toBe('tts/seg-001.wav');
  });

  it('TTS_ERROR records the message', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TTS_ERROR', error: 'boom' });
    expect(s.tts.status).toBe('error');
    expect(s.tts.error).toBe('boom');
  });
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- editorReducer`
Expected: FAIL（アクション/`tts` スライス未実装）

- [ ] **Step 3: import と型を追加**

`src/renderer/state/editorReducer.ts` の先頭 import を変更:

```ts
import { type Project, type Segment, type SegmentVoice } from '../../shared/types';
```

`TranscriptionState` インターフェースの直後に追加:

```ts
export interface TtsState {
  status: 'idle' | 'running' | 'error';
  percent: number;
  error: string | null;
}
```

`EditorState` インターフェースの `transcription: TranscriptionState;` 行の直後に追加:

```ts
  tts: TtsState;
```

`EditorAction` ユニオンの `TRANSCRIPTION_ERROR` 行の直後に追加:

```ts
  | { type: 'SET_SEGMENT_VOICE'; id: string; voice: SegmentVoice }
  | { type: 'SET_DEFAULT_VOICE'; voice: SegmentVoice }
  | { type: 'APPLY_DEFAULT_VOICE_TO_ALL' }
  | { type: 'TTS_START' }
  | { type: 'TTS_PROGRESS'; percent: number }
  | { type: 'TTS_GENERATED'; segments: Segment[] }
  | { type: 'TTS_ERROR'; error: string };
```

（元の `TRANSCRIPTION_ERROR` 行は末尾の `;` を持っているので、上記追加後は新しい末尾行の `;` のみ残し、`TRANSCRIPTION_ERROR` 行末の `;` は `|` 継続のため不要になる点に注意。具体的には `TRANSCRIPTION_ERROR` 行を `  | { type: 'TRANSCRIPTION_ERROR'; error: string }` に変更し、最後の `TTS_ERROR` 行末に `;` を置く。）

`initialEditorState` の `transcription: { status: 'idle', percent: 0, error: null },` 行の直後に追加:

```ts
  tts: { status: 'idle', percent: 0, error: null },
```

- [ ] **Step 4: ハンドラを実装**

`src/renderer/state/editorReducer.ts` の `switch` 内、`case 'TRANSCRIPTION_ERROR':` の `return` 文の直後に追加:

```ts
    case 'SET_SEGMENT_VOICE':
      if (!state.project) return state;
      return {
        ...state,
        project: {
          ...state.project,
          segments: state.project.segments.map((s) =>
            s.id === action.id ? { ...s, voice: action.voice } : s,
          ),
        },
      };
    case 'SET_DEFAULT_VOICE':
      if (!state.project) return state;
      return {
        ...state,
        project: {
          ...state.project,
          settings: {
            ...state.project.settings,
            tts: { defaultSpeaker: action.voice.speaker, defaultSpeed: action.voice.speed },
          },
        },
      };
    case 'APPLY_DEFAULT_VOICE_TO_ALL': {
      if (!state.project) return state;
      const v = {
        speaker: state.project.settings.tts.defaultSpeaker,
        speed: state.project.settings.tts.defaultSpeed,
      };
      return {
        ...state,
        project: {
          ...state.project,
          segments: state.project.segments.map((s) => ({ ...s, voice: { ...v } })),
        },
      };
    }
    case 'TTS_START':
      return { ...state, tts: { status: 'running', percent: 0, error: null } };
    case 'TTS_PROGRESS':
      return { ...state, tts: { ...state.tts, percent: action.percent } };
    case 'TTS_GENERATED':
      return {
        ...state,
        project: state.project ? { ...state.project, segments: action.segments } : null,
        tts: { status: 'idle', percent: 100, error: null },
      };
    case 'TTS_ERROR':
      return { ...state, tts: { status: 'error', percent: 0, error: action.error } };
```

- [ ] **Step 5: パス確認**

Run: `npm test -- editorReducer`
Expected: PASS（既存9件＋追加5件）

- [ ] **Step 6: コミット**

```bash
git add src/renderer/state/editorReducer.ts test/editorReducer.test.ts
git commit -m "feat: add voice + TTS generation actions to editor reducer"
```

---

## Task 6: 配線（projectSession・IPC・preload・型）

**Files:**
- Modify: `src/main/projectSession.ts`
- Modify: `src/main/ipc/project.ts`
- Create: `src/main/ipc/tts.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`

> このタスクは配線中心で IPC ハンドラ単体テストはこのコードベースに無い。`npm run typecheck` + `npm run build` で検証する。

- [ ] **Step 1: `projectSession.updateSettings` を追加**

`src/main/projectSession.ts` の先頭 import を変更:

```ts
import { type Project, type ProjectSettings, type Segment } from '../shared/types';
```

`updateSegments` メソッドの直後に追加:

```ts
  /** 設定を差し替えて project.json に保存する。 */
  async updateSettings(settings: ProjectSettings): Promise<void> {
    const { dir, project } = this.getCurrent();
    const updated: Project = { ...project, settings };
    this.project = updated;
    await saveProject(dir, updated);
  }
```

- [ ] **Step 2: `project:updateSettings` IPC を追加**

`src/main/ipc/project.ts` の `Segment` import 行を変更:

```ts
import { type Segment, type ProjectSettings } from '../../shared/types';
```

`ipcMain.handle('project:updateSegments', ...)` のブロック直後に追加:

```ts
  ipcMain.handle('project:updateSettings', async (_e, settings: ProjectSettings) => {
    await projectSession.updateSettings(settings);
    return { ok: true as const };
  });
```

- [ ] **Step 3: TTS の IPC モジュールを作成**

`src/main/ipc/tts.ts`:

```ts
// src/main/ipc/tts.ts
import { ipcMain } from 'electron';
import { projectSession } from '../projectSession';
import { resolveVoicevox } from '../voicevox/voicevoxPaths';
import { VoicevoxEngine, defaultEngineDeps } from '../voicevox/engine';
import { synthesize, fetchSpeakers, flattenSpeakers, type SynthesizeInput } from '../voicevox/ttsClient';
import { generateTts, type TtsClient } from '../voicevox/ttsService';

let engine: VoicevoxEngine | null = null;
let currentAbort: AbortController | null = null;

/** 未プロビジョニング時は resolveVoicevox が VoicevoxNotProvisionedError を投げ、レンダラに伝わる。 */
function getEngine(): VoicevoxEngine {
  if (!engine) {
    const { runPath } = resolveVoicevox();
    engine = new VoicevoxEngine(defaultEngineDeps(runPath));
  }
  return engine;
}

const client: TtsClient = {
  synthesize: (baseUrl: string, input: SynthesizeInput) => synthesize(baseUrl, input),
};

/** アプリ終了時にエンジンを停止する。 */
export function stopVoicevoxEngine(): void {
  engine?.stop();
  engine = null;
}

export function registerTtsIpc(): void {
  ipcMain.handle('tts:speakers', async () => {
    const baseUrl = await getEngine().ensureRunning();
    return flattenSpeakers(await fetchSpeakers(baseUrl));
  });

  ipcMain.handle('tts:generateSegment', async (_e, id: string) => {
    const { dir, project } = projectSession.getCurrent();
    const updated = await generateTts({
      engine: getEngine(), client, outDir: dir, segments: project.segments, onlyId: id,
    });
    await projectSession.updateSegments(updated);
    return { segments: updated };
  });

  ipcMain.handle('tts:generateAll', async (event) => {
    const { dir, project } = projectSession.getCurrent();
    currentAbort = new AbortController();
    try {
      const updated = await generateTts({
        engine: getEngine(), client, outDir: dir, segments: project.segments,
        onProgress: (done, total) => event.sender.send('tts:progress', Math.round((done / total) * 100)),
        signal: currentAbort.signal,
      });
      await projectSession.updateSegments(updated);
      return { segments: updated };
    } finally {
      currentAbort = null;
    }
  });

  ipcMain.handle('tts:cancel', () => {
    currentAbort?.abort();
    return { ok: true as const };
  });
}
```

- [ ] **Step 4: IPC を登録**

`src/main/ipc/index.ts` を変更:

```ts
// src/main/ipc/index.ts
import { registerRecordingIpc } from './recording';
import { registerProjectIpc } from './project';
import { registerTranscriptionIpc } from './transcription';
import { registerTtsIpc } from './tts';

export function registerIpc(): void {
  registerRecordingIpc();
  registerProjectIpc();
  registerTranscriptionIpc();
  registerTtsIpc();
}
```

- [ ] **Step 5: 終了時にエンジン停止**

`src/main/index.ts` の `registerIpc` import 行の直後に追加:

```ts
import { registerAssetScheme, registerAssetProtocol } from './assetProtocol';
import { stopVoicevoxEngine } from './ipc/tts';
```

`app.on('window-all-closed', ...)` の直前に追加:

```ts
app.on('before-quit', () => {
  stopVoicevoxEngine();
});
```

- [ ] **Step 6: preload で公開**

`src/preload/index.ts` の型 import 行を変更:

```ts
import type { Segment, ProjectSettings } from '../shared/types';
```

`exposeInMainWorld('api', { ... })` の `onTranscriptionProgress` ブロックの直後（オブジェクト末尾）に追加:

```ts
  updateSettings: (settings: ProjectSettings) => ipcRenderer.invoke('project:updateSettings', settings),
  ttsSpeakers: () => ipcRenderer.invoke('tts:speakers'),
  ttsGenerateSegment: (id: string) => ipcRenderer.invoke('tts:generateSegment', id),
  ttsGenerateAll: () => ipcRenderer.invoke('tts:generateAll'),
  cancelTts: () => ipcRenderer.invoke('tts:cancel'),
  onTtsProgress: (cb: (percent: number) => void) => {
    const listener = (_e: unknown, percent: number) => cb(percent);
    ipcRenderer.on('tts:progress', listener);
    return () => { ipcRenderer.removeListener('tts:progress', listener); };
  },
```

- [ ] **Step 7: renderer の型に追加**

`src/renderer/global.d.ts` の先頭 import を変更:

```ts
import type { Project, Segment, ProjectSettings, SpeakerOption } from '../shared/types';
```

`api` インターフェースの `onTranscriptionProgress` 行の直後に追加:

```ts
      updateSettings: (settings: ProjectSettings) => Promise<{ ok: true }>;
      ttsSpeakers: () => Promise<SpeakerOption[]>;
      ttsGenerateSegment: (id: string) => Promise<{ segments: Segment[] }>;
      ttsGenerateAll: () => Promise<{ segments: Segment[] }>;
      cancelTts: () => Promise<{ ok: true }>;
      onTtsProgress: (cb: (percent: number) => void) => () => void;
```

- [ ] **Step 8: typecheck と build**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 9: コミット**

```bash
git add src/main/projectSession.ts src/main/ipc/project.ts src/main/ipc/tts.ts src/main/ipc/index.ts src/main/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat: wire TTS + project settings IPC (main/preload/types)"
```

---

## Task 7: UI（Inspector の声/生成/試聴 ＋ EditorLayout のツールバー/配線）

**Files:**
- Modify: `src/renderer/editor/Inspector.tsx`
- Modify: `src/renderer/editor/EditorLayout.tsx`

> Reactコンポーネントの単体テスト基盤は無い。`npm run typecheck` + `npm run build` + 手動E2E（Task 9）で検証する。
>
> **stale-closure 注意（フェーズ3と同じ）**: 声変更は dispatch 直後に保存するため、保存対象 `segments` をその場で計算して渡すこと。

- [ ] **Step 1: `Inspector.tsx` を全置換**

`src/renderer/editor/Inspector.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { type Segment, type SpeakerOption } from '../../shared/types';
import { useEditor } from '../state/editorStore';
import { projectAssetUrl } from './assetUrl';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

interface Props {
  segment: Segment | null;
  index: number;
  speakers: SpeakerOption[];
  projectDir: string;
  ttsNonce: number;
  busy: boolean;
  onLoadSpeakers: () => void;
  onGenerate: (id: string) => void;
}

export function Inspector({ segment, index, speakers, projectDir, ttsNonce, busy, onLoadSpeakers, onGenerate }: Props) {
  const { state, dispatch } = useEditor();
  const [saveError, setSaveError] = useState<string | null>(null);

  // セグメント切替時に前のセグメントの保存エラー表示を消す
  useEffect(() => { setSaveError(null); }, [segment?.id]);

  if (!segment) {
    return <div style={{ padding: 12, color: '#888' }}>セグメントを選択してください</div>;
  }

  const edited = segment.correctedText !== segment.originalText;

  const persist = async (segments: Segment[]) => {
    try {
      await window.api.updateSegments(segments);
      setSaveError(null);
    } catch (err) {
      setSaveError(String(err));
    }
  };

  const onBlurText = () => {
    if (state.project) void persist(state.project.segments);
  };

  const revert = () => {
    if (!state.project) return;
    const segments = state.project.segments.map((s) =>
      s.id === segment.id ? { ...s, correctedText: s.originalText } : s,
    );
    dispatch({ type: 'EDIT_SEGMENT_TEXT', id: segment.id, text: segment.originalText });
    void persist(segments);
  };

  const setVoice = (voice: { speaker: number; speed: number }) => {
    if (!state.project) return;
    const segments = state.project.segments.map((s) => (s.id === segment.id ? { ...s, voice } : s));
    dispatch({ type: 'SET_SEGMENT_VOICE', id: segment.id, voice });
    void persist(segments);
  };

  const speakerLabel = speakers.find((s) => s.speaker === segment.voice.speaker)?.label;
  // 話者一覧が未取得でも現在の speaker を選べるよう、フォールバック option を用意する。
  const options = speakers.length > 0
    ? speakers
    : [{ speaker: segment.voice.speaker, label: `話者 ${segment.voice.speaker}` }];

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <h3 style={{ marginTop: 0 }}>
        セグメント {index + 1}（{segment.id}）
        {edited && (
          <span style={{ marginLeft: 8, fontSize: 11, color: '#0a7', border: '1px solid #0a7', borderRadius: 4, padding: '1px 5px' }}>
            編集済み
          </span>
        )}
      </h3>
      <div style={{ color: '#666', marginBottom: 8 }}>
        {fmt(segment.videoStart)} – {fmt(segment.videoEnd)}
      </div>

      <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>元の文字起こし（読み取り専用）</div>
      <div style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
        {segment.originalText || '（無音/空）'}
      </div>

      <div style={{ color: '#666', fontSize: 12, marginTop: 8, marginBottom: 4 }}>補正テキスト</div>
      <textarea
        value={segment.correctedText}
        onChange={(e) => dispatch({ type: 'EDIT_SEGMENT_TEXT', id: segment.id, text: e.target.value })}
        onBlur={onBlurText}
        rows={4}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', padding: 8, borderRadius: 4 }}
      />
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={revert} disabled={!edited}>元に戻す</button>
        {saveError && <span style={{ color: '#c00', fontSize: 12 }}>保存に失敗しました</span>}
      </div>

      <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #eee' }} />

      <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>声（話者）</div>
      <select
        value={segment.voice.speaker}
        onMouseDown={onLoadSpeakers}
        onChange={(e) => setVoice({ speaker: Number(e.target.value), speed: segment.voice.speed })}
        style={{ width: '100%', padding: 4 }}
      >
        {options.map((o) => (
          <option key={o.speaker} value={o.speaker}>{o.label}</option>
        ))}
      </select>

      <div style={{ color: '#666', fontSize: 12, marginTop: 8, marginBottom: 4 }}>速度（{segment.voice.speed.toFixed(2)}）</div>
      <input
        type="range" min={0.5} max={2} step={0.05}
        value={segment.voice.speed}
        onChange={(e) => setVoice({ speaker: segment.voice.speaker, speed: Number(e.target.value) })}
        style={{ width: '100%' }}
      />

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => onGenerate(segment.id)} disabled={busy || segment.correctedText.trim() === ''}>
          {segment.ttsAudio ? '再生成' : '生成'}
        </button>
        <span style={{ fontSize: 12, color: segment.ttsAudio ? '#0a7' : '#999' }}>
          {segment.ttsAudio ? '生成済み' : '未生成'}
        </span>
      </div>

      {segment.ttsAudio && (
        <div style={{ marginTop: 8 }}>
          <audio controls src={`${projectAssetUrl(segment.ttsAudio, projectDir)}&v=${ttsNonce}`} style={{ width: '100%' }} />
          {speakerLabel && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>クレジット: VOICEVOX：{speakerLabel}</div>
          )}
        </div>
      )}

      <div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>クリック {segment.clicks.length} 件</div>
    </div>
  );
}
```

- [ ] **Step 2: `EditorLayout.tsx` を全置換**

`src/renderer/editor/EditorLayout.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/editorStore';
import { PreviewPlayer } from './PreviewPlayer';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { decodeToWav } from '../audio/decodeToWav';
import { projectAssetUrl } from './assetUrl';
import { type SpeakerOption } from '../../shared/types';

export function EditorLayout() {
  const { state, dispatch } = useEditor();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [speakers, setSpeakers] = useState<SpeakerOption[]>([]);
  const speakersLoading = useRef(false);
  const [ttsNonce, setTtsNonce] = useState(0);

  // 文字起こし・TTS 進捗イベントの購読
  useEffect(() => {
    const unsubTx = window.api.onTranscriptionProgress((p) =>
      dispatch({ type: 'TRANSCRIPTION_PROGRESS', percent: p }),
    );
    const unsubTts = window.api.onTtsProgress((p) =>
      dispatch({ type: 'TTS_PROGRESS', percent: p }),
    );
    return () => { unsubTx(); unsubTts(); };
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

  // 話者一覧を遅延取得する（初回TTS操作時にエンジンが起動する）。
  async function loadSpeakers() {
    if (speakersLoading.current || speakers.length > 0) return;
    speakersLoading.current = true;
    try {
      setSpeakers(await window.api.ttsSpeakers());
    } catch {
      // 取得失敗時はフォールバック option のままにする
    } finally {
      speakersLoading.current = false;
    }
  }

  async function generateSegment(id: string) {
    dispatch({ type: 'TTS_START' });
    try {
      void loadSpeakers(); // クレジット表示用に一覧も取得
      const { segments: result } = await window.api.ttsGenerateSegment(id);
      dispatch({ type: 'TTS_GENERATED', segments: result });
      setTtsNonce((n) => n + 1);
    } catch (err) {
      dispatch({ type: 'TTS_ERROR', error: String(err) });
    }
  }

  async function generateAll() {
    dispatch({ type: 'TTS_START' });
    try {
      void loadSpeakers();
      const { segments: result } = await window.api.ttsGenerateAll();
      dispatch({ type: 'TTS_GENERATED', segments: result });
      setTtsNonce((n) => n + 1);
    } catch (err) {
      dispatch({ type: 'TTS_ERROR', error: String(err) });
    }
  }

  function setDefaultVoice(voice: { speaker: number; speed: number }) {
    dispatch({ type: 'SET_DEFAULT_VOICE', voice });
    // 直後の state は未更新なので settings をその場で組み立てて保存する
    void window.api.updateSettings({
      ...project.settings,
      tts: { defaultSpeaker: voice.speaker, defaultSpeed: voice.speed },
    });
  }

  function applyDefaultToAll() {
    const v = { speaker: project.settings.tts.defaultSpeaker, speed: project.settings.tts.defaultSpeed };
    const updated = segments.map((s) => ({ ...s, voice: { ...v } }));
    dispatch({ type: 'APPLY_DEFAULT_VOICE_TO_ALL' });
    void window.api.updateSegments(updated);
  }

  const tx = state.transcription;
  const tts = state.tts;
  const ttsBusy = tts.status === 'running';
  const defaultSpeaker = project.settings.tts.defaultSpeaker;
  const defaultSpeed = project.settings.tts.defaultSpeed;
  const defaultOptions = speakers.length > 0
    ? speakers
    : [{ speaker: defaultSpeaker, label: `話者 ${defaultSpeaker}` }];

  return (
    <div style={{ display: 'grid', gridTemplateRows: '48px 1fr auto', height: '100vh' }}>
      {/* ツールバー */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', background: '#2a2a2a', color: '#fff', flexWrap: 'wrap' }}>
        <button onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}>← ホーム</button>
        <strong>{project.meta.name}</strong>
        <button onClick={runTranscription} disabled={tx.status === 'running'}>
          {tx.status === 'running' ? `文字起こし中… ${tx.percent}%` : '文字起こし'}
        </button>
        {tx.status === 'running' && <button onClick={() => window.api.cancelTranscription()}>キャンセル</button>}
        {tx.status === 'error' && <span style={{ color: '#f88' }}>失敗: {tx.error}</span>}

        <span style={{ marginLeft: 12, fontSize: 12, color: '#bbb' }}>既定の声</span>
        <select
          value={defaultSpeaker}
          onMouseDown={loadSpeakers}
          onChange={(e) => setDefaultVoice({ speaker: Number(e.target.value), speed: defaultSpeed })}
        >
          {defaultOptions.map((o) => (
            <option key={o.speaker} value={o.speaker}>{o.label}</option>
          ))}
        </select>
        <input
          type="range" min={0.5} max={2} step={0.05} value={defaultSpeed}
          onChange={(e) => setDefaultVoice({ speaker: defaultSpeaker, speed: Number(e.target.value) })}
          title={`速度 ${defaultSpeed.toFixed(2)}`}
        />
        <button onClick={applyDefaultToAll}>全セグメントに適用</button>

        <button onClick={generateAll} disabled={ttsBusy}>
          {ttsBusy ? `生成中… ${tts.percent}%` : '全セグメント生成'}
        </button>
        {ttsBusy && <button onClick={() => window.api.cancelTts()}>キャンセル</button>}
        {ttsBusy && tts.percent === 0 && <span style={{ fontSize: 12, color: '#bbb' }}>（初回はエンジン起動に時間がかかります）</span>}
        {tts.status === 'error' && <span style={{ color: '#f88' }}>TTS失敗: {tts.error}</span>}
      </div>

      {/* 中央＝プレビュー / 右＝インスペクタ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', minHeight: 0 }}>
        <PreviewPlayer
          videoRef={videoRef}
          audioRef={audioRef}
          videoUrl={projectAssetUrl('assets/raw.webm', state.projectDir ?? '')}
          audioUrl={projectAssetUrl('assets/narration.webm', state.projectDir ?? '')}
          onTime={(t) => dispatch({ type: 'SET_CURRENT_TIME', time: t })}
          onDuration={setDuration}
        />
        <div style={{ borderLeft: '1px solid #ddd', overflow: 'auto' }}>
          <Inspector
            segment={selected}
            index={selectedIndex}
            speakers={speakers}
            projectDir={state.projectDir ?? ''}
            ttsNonce={ttsNonce}
            busy={ttsBusy}
            onLoadSpeakers={loadSpeakers}
            onGenerate={generateSegment}
          />
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

- [ ] **Step 3: typecheck と build**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/renderer/editor/Inspector.tsx src/renderer/editor/EditorLayout.tsx
git commit -m "feat: add voice selection, TTS generate/regenerate, and audition UI"
```

---

## Task 8: プロビジョニングスクリプト `setup-voicevox.mjs`

**Files:**
- Create: `scripts/setup-voicevox.mjs`
- Modify: `package.json`

> **このタスクの検証は手動（大容量ダウンロード）**。VOICEVOX ENGINE 0.25.2 の Windows CPU 配布物（`voicevox_engine-windows-cpu-0.25.2.7z.001`、単一パートの 7z）を、スタンドアロンの `7zr.exe` で展開する。**実ダウンロードに対して検証し、404/形式変更時は `VOICEVOX_VERSION`/URL を最新リリースに更新する**（whisper と同じ運用。リリース一覧: https://github.com/VOICEVOX/voicevox_engine/releases ）。

- [ ] **Step 1: `package.json` にスクリプトを追加**

`package.json` の `scripts` の `setup:whisper` 行の直後に追加:

```json
    "setup:whisper": "node scripts/setup-whisper.mjs",
    "setup:voicevox": "node scripts/setup-voicevox.mjs"
```

- [ ] **Step 2: `scripts/setup-voicevox.mjs` を作成**

```js
// scripts/setup-voicevox.mjs
// VOICEVOX ENGINE（Windows CPU）を vendor/voicevox/ に取得・展開し manifest.json を書く。
// 配布物は単一パートの 7z（.7z.001）。PowerShell の Expand-Archive は 7z 非対応のため、
// スタンドアロンの 7zr.exe を取得して展開する。
import { existsSync, mkdirSync, createWriteStream, writeFileSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const VOICEVOX_VERSION = '0.25.2';
const ENGINE_URL = `https://github.com/VOICEVOX/voicevox_engine/releases/download/${VOICEVOX_VERSION}/voicevox_engine-windows-cpu-${VOICEVOX_VERSION}.7z.001`;
const SEVENZR_URL = 'https://www.7-zip.org/a/7zr.exe';

const vendorDir = resolve(process.cwd(), 'vendor', 'voicevox');
const engineRoot = join(vendorDir, 'engine');
const archivePath = join(vendorDir, 'engine.7z.001');
const sevenZrPath = join(vendorDir, '7zr.exe');

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

  let runPath = existsSync(engineRoot) ? findNamed(engineRoot, 'run.exe') : null;
  if (!runPath) {
    if (!existsSync(sevenZrPath)) await download(SEVENZR_URL, sevenZrPath);
    await download(ENGINE_URL, archivePath);
    mkdirSync(engineRoot, { recursive: true });
    // 7zr x: .7z.001 を指定すると（分割でも）まとめて展開する。
    execFileSync(sevenZrPath, ['x', archivePath, `-o${engineRoot}`, '-y'], { stdio: 'inherit' });
    await rm(archivePath, { force: true });
    runPath = findNamed(engineRoot, 'run.exe');
  }
  if (!runPath) {
    throw new Error(
      `run.exe not found under ${engineRoot} after extraction. ` +
      `Check the release asset name/format for VOICEVOX ENGINE ${VOICEVOX_VERSION}.`,
    );
  }

  writeFileSync(join(vendorDir, 'manifest.json'), JSON.stringify({ runPath }, null, 2));
  console.log(`\nDone.\n  run: ${runPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: 手動検証（実ダウンロード）**

Run: `npm run setup:voicevox`
Expected: `vendor/voicevox/manifest.json` が生成され `{ "runPath": ".../engine/.../run.exe" }` を指す。`run.exe` が存在する。

失敗時の対処:
- 404 → リリース一覧で最新の Windows CPU 資産名/バージョンを確認し `VOICEVOX_VERSION`/`ENGINE_URL` を更新。資産が複数パート（`.7z.002` 等）の場合も全パートをダウンロードしてから `.001` を `7zr x` すれば展開される（その場合は各パートを順に download する処理を追加）。
- `run.exe` が見つからない → 展開後のディレクトリ構成を確認し、実行ファイル名（`run.exe`）を `findNamed` の対象に合わせる。

- [ ] **Step 4: コミット**

```bash
git add scripts/setup-voicevox.mjs package.json
git commit -m "feat: add VOICEVOX engine provisioning script (setup:voicevox)"
```

---

## Task 9: 全体検証（手動E2E＋最終チェック）

**Files:** なし（検証のみ）

- [ ] **Step 1: 自動テスト・typecheck・build が green**

Run: `npm test`
Expected: PASS（既存＋追加分すべて）

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 2: 手動E2E（実機）**

Run: `npm run setup:voicevox`（未実施なら）→ `npm run dev`

手順と期待結果:
1. 文字起こし済みの `rec-*` を開く（無ければ文字起こしを実行）。
2. セグメントを選択 → Inspector に「声（話者）」「速度」「生成」ボタンが表示される。
3. [生成] をクリック → 初回はエンジン起動の待ち（数十秒）後に合成され、`<audio>` で試聴できる。「生成済み」表示になる。
4. 話者ドロップダウンを開くと一覧が読み込まれ（VOICEVOXキャラ）、別の声を選んで [再生成] すると音が変わる。速度スライダを変えて再生成しても反映される。
5. ツールバーの「既定の声」を変更し [全セグメントに適用] → 各セグメントの声が既定値になる。
6. [全セグメント生成] → 進捗が進み、[キャンセル] で中断できる。
7. 「← ホーム」→ 同じプロジェクトを開き直す → `ttsAudio`（生成済み表示・試聴）と声設定・既定値が保持されている。
8. クレジット表記（VOICEVOX：キャラ名）が試聴の近くに表示される。

- [ ] **Step 3: 結果を記録**

実機で確認できた項目／できなかった項目を簡潔に記録する。問題があれば systematic-debugging で対処（特に setup:voicevox の URL/形式、run.exe の引数、起動タイムアウト）。

---

## 完了の定義

- 追加した単体テスト（voicevoxPaths/ttsClient/ttsService/engine/reducer）が通る。
- `npm test` / `npm run typecheck` / `npm run build` がすべて green。
- 実機で `setup:voicevox` 後、セグメントの生成・再生成・一括生成・試聴・声選択ができ、再オープンで保持される。
- 話者クレジットがアプリ内に表示される。
