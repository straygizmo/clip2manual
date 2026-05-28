# アプリ内プロビジョニング基盤（フェーズ8b-1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** whisper/VOICEVOX/ffmpeg をアプリ内で `userData/vendor` に自動ダウンロード・展開し、`resolve*` がそこを参照するようにし、ホーム画面に依存関係の状態＋「未取得をダウンロード」トリガを追加する。

**Architecture:** ベンダー解決を `userData/vendor`（無ければ `cwd/vendor` の dev フォールバック）に拡張。純粋な `pickVendorDir`/`checkStatus`/`apportionPercent` は electron 非依存ファイルに置き単体テスト。`app.getPath` 結合ラッパは別ファイル。main の provision エンジン（download/extract/installers）が既存 `setup:*` スクリプトのURL/手順を移植して取得。IPC＋最小ホームUI。

**Tech Stack:** Electron + TypeScript + React、Node fetch/stream、PowerShell `Expand-Archive`・`7zr.exe`（既存スクリプトと同方式）、Vitest（test/・node環境・`.test.ts`）。UI は shadcn プリミティブ（`Card`/`Badge`/`Progress`/`Button` + lucide アイコン + `sonner` トースト、ダーク NLE テーマトークン）。

spec: `docs/superpowers/specs/2026-05-28-clip2manual-phase8b1-provisioning-design.md`

> **再計画メモ（2026-05-28）:** 本ブランチは shadcn UI 再設計マージ後の master 上に rebase 済み。T1〜T5・T7 は main/IPC/preload コードで影響なし。**T6 のみ** 旧プレーン CSS から shadcn プリミティブ（`Card`/`Badge`/`Progress`/`Button`/`sonner`）へ書き直した。

---

## File Structure

- `src/main/provision/paths.ts` — **Create**: 純粋 `pickVendorDir` ＋ `Tool` 型（electron 非依存・テスト対象・node tsconfig include）
- `src/main/provision/vendorDirs.ts` — **Create**: `vendorDir`/`userVendorDir`（`app.getPath` 結合・テスト対象外）
- `src/main/provision/status.ts` — **Create**: 純粋 `checkStatus` ＋ `apportionPercent`（テスト対象・node include）
- `src/main/provision/download.ts` — **Create**: `download`/`extractZip`/`findNamed`（統合・テストなし）
- `src/main/provision/installers.ts` — **Create**: `installWhisper`/`installVoicevox`/`installFfmpeg`（統合）
- `src/main/ipc/setup.ts` — **Create**: `setup:status`/`install`/`cancel`＋進捗
- `src/main/ipc/index.ts` / `src/preload/index.ts` / `src/renderer/global.d.ts` — **Modify**
- `src/main/ipc/transcription.ts` / `src/main/ipc/tts.ts` / `src/main/ipc/export.ts` — **Modify**（resolve に vendorDir を渡す）
- `src/renderer/home/DependencyStatus.tsx` — **Create**: 最小UI
- `src/renderer/home/HomeScreen.tsx` — **Modify**: `<DependencyStatus />` を表示
- `tsconfig.node.json` — **Modify**: paths.ts / status.ts を include
- 各 `test/*.test.ts`

依存順: T1（paths, TDD）→ T2（resolve 呼び出し側）→ T3（status/progress, TDD）→ T4（download+installers）→ T5（IPC＋preload＋型）→ T6（UI）→ T7（検証）。

---

## Task 1: `provision/paths.ts`（純粋パス選択）＋ `vendorDirs.ts`（electron ラッパ）

**Files:**
- Create: `src/main/provision/paths.ts`
- Create: `src/main/provision/vendorDirs.ts`
- Test: `test/provisionPaths.test.ts`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: 失敗するテストを書く**

`test/provisionPaths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { pickVendorDir } from '../src/main/provision/paths';

const userBase = join('U', 'vendor');
const cwdBase = join('C', 'vendor');

describe('pickVendorDir', () => {
  it('prefers the userData dir when its manifest exists', () => {
    const r = pickVendorDir(userBase, cwdBase, 'whisper', (d) => d === join(userBase, 'whisper'));
    expect(r).toBe(join(userBase, 'whisper'));
  });
  it('falls back to the cwd dir when the userData manifest is absent', () => {
    const r = pickVendorDir(userBase, cwdBase, 'whisper', () => false);
    expect(r).toBe(join(cwdBase, 'whisper'));
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- provisionPaths`
Expected: FAIL（未作成）

- [ ] **Step 3: `paths.ts` を実装（electron 非依存）**

`src/main/provision/paths.ts`:

```ts
import { join } from 'node:path';

export type Tool = 'whisper' | 'voicevox' | 'ffmpeg';

/**
 * `<userBase>/<tool>` に manifest があればそれを、無ければ `<cwdBase>/<tool>` を返す（純粋）。
 * manifestExists は注入（テスト容易化）。electron に依存しない。
 */
export function pickVendorDir(
  userBase: string,
  cwdBase: string,
  tool: string,
  manifestExists: (dir: string) => boolean,
): string {
  const userDir = join(userBase, tool);
  if (manifestExists(userDir)) return userDir;
  return join(cwdBase, tool);
}
```

- [ ] **Step 4: `vendorDirs.ts` を実装（electron 結合・テスト対象外）**

`src/main/provision/vendorDirs.ts`:

```ts
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pickVendorDir, type Tool } from './paths';

/** install の書き込み先（常に userData 側）。 */
export function userVendorDir(tool: Tool): string {
  return join(app.getPath('userData'), 'vendor', tool);
}

/** resolve* に渡すベンダーディレクトリ（userData 優先・cwd フォールバック）。 */
export function vendorDir(tool: Tool): string {
  return pickVendorDir(
    join(app.getPath('userData'), 'vendor'),
    join(process.cwd(), 'vendor'),
    tool,
    (d) => existsSync(join(d, 'manifest.json')),
  );
}
```

- [ ] **Step 5: tsconfig.node に paths.ts を追加**

`tsconfig.node.json` の `include` 配列、`"src/renderer/state/segmentOps.ts",` の行の直後に追加（`vendorDirs.ts` は electron 依存のため**追加しない**＝main tsconfig 側でのみ型検査）:

```json
    "src/renderer/state/segmentOps.ts",
    "src/main/provision/paths.ts",
```

- [ ] **Step 6: 確認**

Run: `npm test -- provisionPaths` → PASS（2件）
Run: `npm run typecheck` → PASS（vendorDirs.ts は main tsconfig で electron 型解決）
Run: `npm run build` → PASS

- [ ] **Step 7: コミット**

```bash
git add src/main/provision/paths.ts src/main/provision/vendorDirs.ts test/provisionPaths.test.ts tsconfig.node.json
git commit -m "feat: add vendor dir resolution (userData preferred, cwd fallback)"
```

---

## Task 2: resolve 呼び出し側を vendorDir 経由にする

**Files:**
- Modify: `src/main/ipc/transcription.ts`
- Modify: `src/main/ipc/tts.ts`
- Modify: `src/main/ipc/export.ts`

> typecheck/build で検証（IPC 単体テストは無い）。

- [ ] **Step 1: transcription.ts**

`src/main/ipc/transcription.ts` の `resolveWhisper` import の下に追加:

```ts
import { vendorDir } from '../provision/vendorDirs';
```

`const { binPath, modelPath } = resolveWhisper();` を次に変更:

```ts
const { binPath, modelPath } = resolveWhisper({ vendorDir: vendorDir('whisper') });
```

- [ ] **Step 2: tts.ts**

`src/main/ipc/tts.ts` の import 群に追加:

```ts
import { vendorDir } from '../provision/vendorDirs';
```

`getEngine()` 内の `const { runPath } = resolveVoicevox();` を次に変更:

```ts
const { runPath } = resolveVoicevox({ vendorDir: vendorDir('voicevox') });
```

- [ ] **Step 3: export.ts**

`src/main/ipc/export.ts` の import 群に追加:

```ts
import { vendorDir } from '../provision/vendorDirs';
```

`const { ffmpegPath, ffprobePath } = resolveFfmpeg();` を次に変更:

```ts
const { ffmpegPath, ffprobePath } = resolveFfmpeg({ vendorDir: vendorDir('ffmpeg') });
```

- [ ] **Step 4: 確認**

Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS
Run: `npm test` → PASS（回帰なし）

- [ ] **Step 5: コミット**

```bash
git add src/main/ipc/transcription.ts src/main/ipc/tts.ts src/main/ipc/export.ts
git commit -m "feat: resolve whisper/voicevox/ffmpeg via userData-aware vendorDir"
```

---

## Task 3: `provision/status.ts`（純粋 checkStatus ＋ apportionPercent）

**Files:**
- Create: `src/main/provision/status.ts`
- Test: `test/provisionStatus.test.ts`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: 失敗するテストを書く**

`test/provisionStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkStatus, apportionPercent } from '../src/main/provision/status';

describe('checkStatus', () => {
  it('maps each probe to provisioned=true unless it throws', () => {
    const r = checkStatus({
      whisper: () => {},
      voicevox: () => { throw new Error('not provisioned'); },
      ffmpeg: () => {},
    });
    expect(r).toEqual({ whisper: true, voicevox: false, ffmpeg: true });
  });
});

describe('apportionPercent', () => {
  it('maps a step + its inner percent onto the overall 0..100', () => {
    expect(apportionPercent(0, 2, 0)).toBe(0);
    expect(apportionPercent(0, 2, 100)).toBe(50);
    expect(apportionPercent(0, 2, 50)).toBe(25);
    expect(apportionPercent(1, 2, 0)).toBe(50);
    expect(apportionPercent(1, 2, 100)).toBe(100);
  });
  it('clamps and handles zero steps', () => {
    expect(apportionPercent(0, 0, 50)).toBe(100);
    expect(apportionPercent(1, 2, 200)).toBe(100);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npm test -- provisionStatus`
Expected: FAIL（未作成）

- [ ] **Step 3: 実装**

`src/main/provision/status.ts`:

```ts
import { type Tool } from './paths';

export type ProvisionStatus = Record<Tool, boolean>;

/** 各 probe を実行し、例外を投げなければ provisioned=true。probe は resolve* を呼ぶ薄い関数を注入する。 */
export function checkStatus(probes: Record<Tool, () => void>): ProvisionStatus {
  const ok = (fn: () => void): boolean => {
    try { fn(); return true; } catch { return false; }
  };
  return { whisper: ok(probes.whisper), voicevox: ok(probes.voicevox), ffmpeg: ok(probes.ffmpeg) };
}

/** stepIndex 番目（0始まり、全 stepCount 個）の内部進捗 stepPercent(0..100) を全体 0..100 に按分する。 */
export function apportionPercent(stepIndex: number, stepCount: number, stepPercent: number): number {
  if (stepCount <= 0) return 100;
  const per = 100 / stepCount;
  const inner = Math.max(0, Math.min(100, stepPercent)) / 100;
  const v = stepIndex * per + inner * per;
  return Math.round(Math.max(0, Math.min(100, v)));
}
```

- [ ] **Step 4: tsconfig.node に追加**

`tsconfig.node.json` の include、`"src/main/provision/paths.ts",` の直後に追加:

```json
    "src/main/provision/paths.ts",
    "src/main/provision/status.ts",
```

- [ ] **Step 5: 確認**

Run: `npm test -- provisionStatus` → PASS
Run: `npm run typecheck` → PASS

- [ ] **Step 6: コミット**

```bash
git add src/main/provision/status.ts test/provisionStatus.test.ts tsconfig.node.json
git commit -m "feat: add provision status check + progress apportionment"
```

---

## Task 4: `provision/download.ts` ＋ `provision/installers.ts`（取得エンジン）

**Files:**
- Create: `src/main/provision/download.ts`
- Create: `src/main/provision/installers.ts`

> ネットワーク/子プロセス依存のため単体テストなし。`npm run typecheck` + `npm run build` で検証、実取得は手動E2E（Task 7）。URL/手順は既存 `scripts/setup-*.mjs` から移植。

- [ ] **Step 1: `download.ts` を実装**

`src/main/provision/download.ts`:

```ts
import { createWriteStream, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

/** url を dest にダウンロードする。content-length があれば onProgress(0..100) を通知。signal で中断可。 */
export async function download(
  url: string,
  dest: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { redirect: 'follow', signal });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  if (onProgress && total > 0) {
    let received = 0;
    body.on('data', (c: Buffer) => {
      received += c.length;
      onProgress(Math.min(100, Math.round((received / total) * 100)));
    });
  }
  await pipeline(body, createWriteStream(dest));
}

/** PowerShell Expand-Archive で zip を展開する（追加依存なし）。 */
export function extractZip(zip: string, dest: string): void {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path "${zip}" -DestinationPath "${dest}" -Force`],
    { stdio: 'ignore', windowsHide: true },
  );
}

/** dir 以下を再帰検索し、名前が target（小文字一致）の最初のファイルパスを返す。 */
export function findNamed(dir: string, target: string): string | null {
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
```

- [ ] **Step 2: `installers.ts` を実装**

`src/main/provision/installers.ts`:

```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { userVendorDir } from './vendorDirs';
import { download, extractZip, findNamed } from './download';
import { apportionPercent } from './status';

// 既存 scripts/setup-*.mjs から移植（URL は当面2箇所にピン留め。404 時は両方更新）
const WHISPER_VERSION = 'v1.8.4';
const WHISPER_BIN_URL = `https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`;
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';

const VOICEVOX_VERSION = '0.25.2';
const VOICEVOX_ENGINE_URL = `https://github.com/VOICEVOX/voicevox_engine/releases/download/${VOICEVOX_VERSION}/voicevox_engine-windows-cpu-${VOICEVOX_VERSION}.7z.001`;
const SEVENZR_URL = 'https://www.7-zip.org/a/7zr.exe';

const FFMPEG_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

type OnProgress = (percent: number) => void;

/** whisper-cli + ggml-small を取得し manifest {binPath, modelPath} を書く。 */
export async function installWhisper(onProgress: OnProgress, signal?: AbortSignal): Promise<void> {
  const dir = userVendorDir('whisper');
  const binDir = join(dir, 'bin');
  const modelPath = join(dir, 'ggml-small.bin');
  const zipPath = join(dir, 'whisper-bin-x64.zip');
  mkdirSync(dir, { recursive: true });
  try {
    if (!existsSync(modelPath)) {
      await download(WHISPER_MODEL_URL, modelPath, (p) => onProgress(apportionPercent(0, 2, p)), signal);
    } else {
      onProgress(apportionPercent(0, 2, 100));
    }
    await download(WHISPER_BIN_URL, zipPath, (p) => onProgress(apportionPercent(1, 2, p)), signal);
    mkdirSync(binDir, { recursive: true });
    extractZip(zipPath, binDir);
  } finally {
    await rm(zipPath, { force: true });
  }
  const exe = findNamed(binDir, 'whisper-cli.exe') ?? findNamed(binDir, 'main.exe');
  if (!exe) throw new Error('whisper executable not found after extraction');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ binPath: exe, modelPath }, null, 2));
  onProgress(100);
}

/** VOICEVOX ENGINE(Windows CPU) を 7zr で展開し manifest {runPath} を書く。 */
export async function installVoicevox(onProgress: OnProgress, signal?: AbortSignal): Promise<void> {
  const dir = userVendorDir('voicevox');
  const engineRoot = join(dir, 'engine');
  const archivePath = join(dir, 'engine.7z.001');
  const sevenZr = join(dir, '7zr.exe');
  mkdirSync(dir, { recursive: true });
  try {
    if (!existsSync(sevenZr)) await download(SEVENZR_URL, sevenZr, undefined, signal);
    await download(VOICEVOX_ENGINE_URL, archivePath, (p) => onProgress(Math.round(p * 0.9)), signal);
    mkdirSync(engineRoot, { recursive: true });
    execFileSync(sevenZr, ['x', archivePath, `-o${engineRoot}`, '-y'], { stdio: 'ignore', windowsHide: true });
  } finally {
    await rm(archivePath, { force: true });
  }
  onProgress(95);
  const runPath = findNamed(engineRoot, 'run.exe');
  if (!runPath) throw new Error('run.exe not found after extraction');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ runPath }, null, 2));
  onProgress(100);
}

/** ffmpeg/ffprobe を取得し manifest {ffmpegPath, ffprobePath} を書く。 */
export async function installFfmpeg(onProgress: OnProgress, signal?: AbortSignal): Promise<void> {
  const dir = userVendorDir('ffmpeg');
  const extractDir = join(dir, 'dist');
  const zipPath = join(dir, 'ffmpeg.zip');
  mkdirSync(dir, { recursive: true });
  try {
    await download(FFMPEG_ZIP_URL, zipPath, (p) => onProgress(Math.round(p * 0.9)), signal);
    mkdirSync(extractDir, { recursive: true });
    extractZip(zipPath, extractDir);
  } finally {
    await rm(zipPath, { force: true });
  }
  onProgress(95);
  const ffmpegPath = findNamed(extractDir, 'ffmpeg.exe');
  const ffprobePath = findNamed(extractDir, 'ffprobe.exe');
  if (!ffmpegPath || !ffprobePath) throw new Error('ffmpeg/ffprobe not found after extraction');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ffmpegPath, ffprobePath }, null, 2));
  onProgress(100);
}
```

- [ ] **Step 3: 確認**

Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS

- [ ] **Step 4: コミット**

```bash
git add src/main/provision/download.ts src/main/provision/installers.ts
git commit -m "feat: add in-app provisioning engine (download/extract/installers)"
```

---

## Task 5: `ipc/setup.ts` ＋ preload ＋ 型

**Files:**
- Create: `src/main/ipc/setup.ts`
- Modify: `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/renderer/global.d.ts`

> typecheck/build で検証。

- [ ] **Step 1: `src/main/ipc/setup.ts` を作成**

```ts
// src/main/ipc/setup.ts
import { ipcMain } from 'electron';
import { checkStatus, type ProvisionStatus } from '../provision/status';
import { type Tool } from '../provision/paths';
import { vendorDir } from '../provision/vendorDirs';
import { resolveWhisper } from '../whisperPaths';
import { resolveVoicevox } from '../voicevox/voicevoxPaths';
import { resolveFfmpeg } from '../ffmpegPaths';
import { installWhisper, installVoicevox, installFfmpeg } from '../provision/installers';

let currentAbort: AbortController | null = null;

function status(): ProvisionStatus {
  return checkStatus({
    whisper: () => { resolveWhisper({ vendorDir: vendorDir('whisper') }); },
    voicevox: () => { resolveVoicevox({ vendorDir: vendorDir('voicevox') }); },
    ffmpeg: () => { resolveFfmpeg({ vendorDir: vendorDir('ffmpeg') }); },
  });
}

const installers: Record<Tool, (onP: (p: number) => void, signal?: AbortSignal) => Promise<void>> = {
  whisper: installWhisper,
  voicevox: installVoicevox,
  ffmpeg: installFfmpeg,
};

export function registerSetupIpc(): void {
  ipcMain.handle('setup:status', () => status());

  ipcMain.handle('setup:install', async (event) => {
    const st = status();
    const missing = (Object.keys(st) as Tool[]).filter((t) => !st[t]);
    currentAbort = new AbortController();
    try {
      for (const tool of missing) {
        try {
          await installers[tool]((percent) => event.sender.send('setup:progress', { tool, percent }), currentAbort.signal);
        } catch (err) {
          throw new Error(`${tool}: ${String(err)}`);
        }
      }
      return status();
    } finally {
      currentAbort = null;
    }
  });

  ipcMain.handle('setup:cancel', () => {
    currentAbort?.abort();
    return { ok: true as const };
  });
}
```

- [ ] **Step 2: 登録**

`src/main/ipc/index.ts` に `import { registerSetupIpc } from './setup';` を追加し、`registerIpc()` 内の最後に `registerSetupIpc();` を追加。

- [ ] **Step 3: preload**

`src/preload/index.ts` の `exposeInMainWorld('api', { ... })` 末尾に追加:

```ts
  setupStatus: () => ipcRenderer.invoke('setup:status'),
  runSetup: () => ipcRenderer.invoke('setup:install'),
  cancelSetup: () => ipcRenderer.invoke('setup:cancel'),
  onSetupProgress: (cb: (p: { tool: string; percent: number }) => void) => {
    const listener = (_e: unknown, p: { tool: string; percent: number }) => cb(p);
    ipcRenderer.on('setup:progress', listener);
    return () => { ipcRenderer.removeListener('setup:progress', listener); };
  },
```

- [ ] **Step 4: 型**

`src/renderer/global.d.ts` の `api` インターフェース末尾に追加:

```ts
      setupStatus: () => Promise<{ whisper: boolean; voicevox: boolean; ffmpeg: boolean }>;
      runSetup: () => Promise<{ whisper: boolean; voicevox: boolean; ffmpeg: boolean }>;
      cancelSetup: () => Promise<{ ok: true }>;
      onSetupProgress: (cb: (p: { tool: string; percent: number }) => void) => () => void;
```

- [ ] **Step 5: 確認**

Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS
Run: `npm test` → PASS

- [ ] **Step 6: コミット**

```bash
git add src/main/ipc/setup.ts src/main/ipc/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat: wire setup IPC (status/install/progress/cancel)"
```

---

## Task 6: 最小UI（`DependencyStatus.tsx` ＋ HomeScreen）

**Files:**
- Create: `src/renderer/home/DependencyStatus.tsx`
- Modify: `src/renderer/home/HomeScreen.tsx`

> typecheck/build + 手動E2E（Task 7）で検証。**shadcn プリミティブ**（`Card`/`Badge`/`Progress`/`Button` + lucide + `sonner`）で、現行ダーク NLE テーマに合わせる。HomeScreen は**まず読んでから**、自然な位置に1行追加する。`<Toaster>` は `App.tsx` 直下にマウント済みなのでホームでも `toast` が機能する。

- [ ] **Step 1: `DependencyStatus.tsx` を作成**

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Check, X, Download, Loader2 } from 'lucide-react';

type Tool = 'whisper' | 'voicevox' | 'ffmpeg';
const TOOLS: Tool[] = ['whisper', 'voicevox', 'ffmpeg'];
const LABEL: Record<Tool, string> = {
  whisper: '文字起こし (whisper)',
  voicevox: '音声合成 (VOICEVOX)',
  ffmpeg: '書き出し (ffmpeg)',
};

/** ホーム画面の依存関係セクション: 取得状況の表示と未取得のダウンロード。 */
export function DependencyStatus() {
  const [status, setStatus] = useState<Record<Tool, boolean> | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ tool: string; percent: number } | null>(null);

  useEffect(() => { void window.api.setupStatus().then(setStatus); }, []);
  useEffect(() => window.api.onSetupProgress((p) => setProgress(p)), []);

  if (!status) return null;
  const missing = TOOLS.filter((t) => !status[t]);

  const onDownload = async () => {
    setInstalling(true);
    try {
      const next = await window.api.runSetup();
      setStatus(next);
      toast.success('依存関係の準備が完了しました');
    } catch (e) {
      toast.error('ダウンロードに失敗しました', { description: String(e) });
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  };

  return (
    <Card className="mt-8 flex flex-col gap-3 p-4">
      <h2 className="text-base font-medium">依存関係</h2>
      <ul className="flex flex-col gap-1.5">
        {TOOLS.map((t) => (
          <li key={t} className="flex items-center gap-2 text-sm">
            <Badge variant={status[t] ? 'secondary' : 'destructive'} className="gap-1">
              {status[t] ? <Check className="size-3" /> : <X className="size-3" />}
              {status[t] ? '取得済み' : '未取得'}
            </Badge>
            <span>{LABEL[t]}</span>
          </li>
        ))}
      </ul>
      {missing.length === 0 ? (
        <p className="text-sm text-muted-foreground">準備完了</p>
      ) : installing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              {progress ? `${LABEL[progress.tool as Tool] ?? progress.tool} 取得中…` : '準備中…'}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void window.api.cancelSetup()}>
              キャンセル
            </Button>
          </div>
          <Progress value={progress?.percent ?? 0} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button variant="default" size="sm" className="w-fit" onClick={onDownload}>
            <Download className="size-4" />
            未取得をダウンロード（{missing.length}件）
          </Button>
          <p className="text-xs text-muted-foreground">
            初回は数百MB〜1GB超のダウンロードがあり時間がかかります。
          </p>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: HomeScreen に組み込む**

`src/renderer/home/HomeScreen.tsx` を読み、先頭の import 群（`@/components/ui/...` の近く）に追加:

```ts
import { DependencyStatus } from './DependencyStatus';
```

そして HomeScreen の最外 `<div className="mx-auto max-w-3xl p-8">` 内、「最近の録画」セクション（`recent.length === 0 ? ... : (...)` ブロック）の**直後・閉じ `</div>` の直前**に1行追加:

```tsx
      <DependencyStatus />
```

（`DependencyStatus` 自身が `mt-8` を持つので余白は付けない。既存レイアウト構造は変更しない。）

- [ ] **Step 3: 確認**

Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS
Run: `npm test` → PASS

- [ ] **Step 4: コミット**

```bash
git add src/renderer/home/DependencyStatus.tsx src/renderer/home/HomeScreen.tsx
git commit -m "feat: show dependency status + download-missing trigger on home"
```

---

## Task 7: 全体検証（手動E2E＋最終チェック）

**Files:** なし（検証のみ）

- [ ] **Step 1: 自動チェック green**

Run: `npm test` → PASS
Run: `npm run typecheck` → PASS
Run: `npm run build` → PASS

- [ ] **Step 2: 手動E2E（実機）**

事前に `userData/vendor` を空にする（Windows の userData は通常 `%APPDATA%/clip2manual`。dev では electron の userData。`cwd/vendor` も退避すると「未取得」を再現できる）。

Run: `npm run dev`

手順と期待結果:
1. ホーム画面に「依存関係」セクションが表示され、未取得なら whisper/VOICEVOX/ffmpeg が ✗。
2. 「未取得をダウンロード」→ 各ツールの取得進捗（`<ツール> 取得中… NN%`）が表示され、順に完了して ✓ に変わる。完了後「準備完了」。
3. 取得後、録画→文字起こし(whisper)→TTS生成(voicevox)→書き出し(ffmpeg) が動作する（`resolve*` が userData/vendor を解決）。
4. ダウンロード中に「キャンセル」→ 中断され、再実行で再開（部分zipは上書き）できる。
5. dev で既に `cwd/vendor` に取得済みの場合は最初から全部 ✓（既存 dev 経路が壊れない）。env 上書き（`C2M_*`）が設定されていればそれが使われる。

- [ ] **Step 3: 結果を記録**

確認項目／問題を記録。問題があれば systematic-debugging で対処（特に userData パス解決、content-length 無し時の進捗、7z/zip 展開、キャンセル時の部分ファイル）。

---

## 完了の定義

- `pickVendorDir`・`checkStatus`・`apportionPercent` の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機で、空の `userData/vendor` から「未取得をダウンロード」で3ツールを取得でき、以降 録画/文字起こし/TTS/書き出しが動作する。dev（cwd/vendor・env 上書き）経路が壊れない。
