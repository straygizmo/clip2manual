# clip2manual フェーズ1（録画基盤）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画面・ナレーション音声・クリックを同時録画し、座標変換したクリックログ付きで「プロジェクト」として保存できる、動作する Electron アプリの土台を作る。

**Architecture:** Electron + TypeScript + React。純粋ロジック（座標変換・クリックログ生成・プロジェクトの読み書き）を `src/shared` / `src/main` のテスト可能なモジュールに分離し TDD で実装する。OS 統合（画面録画 = renderer の `getDisplayMedia`、グローバルマウスフック = main の `uiohook-napi`）は薄いアダプタにまとめ、手動/結合テストで検証する。すべて非破壊：録画した生データはアセットとして保存し、プロジェクトは JSON マニフェスト＋アセットフォルダで表す。

**Tech Stack:** Electron, electron-vite, Vite, React, TypeScript, Vitest（単体テスト）, uiohook-napi（グローバルマウスフック）。

**設計の根拠:** `docs/superpowers/specs/2026-05-26-clip2manual-design.md` のフェーズ1（①全体アーキテクチャ / ②録画の仕組み / ④データモデル）。

---

## ファイル構成

| パス | 責務 |
|------|------|
| `package.json` / `tsconfig.json` / `tsconfig.node.json` / `electron.vite.config.ts` / `vitest.config.ts` | プロジェクト設定・ビルド・テスト |
| `src/shared/types.ts` | プロジェクトのデータモデル（Project / Segment / ClickEvent / DisplayInfo）と `createProject` ファクトリ |
| `src/shared/coordinateTransform.ts` | 純粋関数：OS座標 → 映像ピクセル座標変換、表示領域内判定 |
| `src/shared/clickLog.ts` | 純粋関数：生マウスイベント → 相対時刻・変換済み座標の ClickEvent 配列 |
| `src/main/projectStore.ts` | プロジェクト JSON とアセットフォルダの読み書き（node fs） |
| `src/main/clickHook.ts` | グローバルマウスフックのアダプタ（uiohook-napi） |
| `src/main/ipc.ts` | 録画開始/停止の IPC ハンドラ・プロジェクト組み立て |
| `src/main/index.ts` | Electron main エントリ・ウィンドウ生成・getDisplayMedia ハンドラ登録 |
| `src/preload/index.ts` | contextBridge で renderer に安全な API を公開 |
| `src/renderer/index.html` / `src/renderer/main.tsx` / `src/renderer/App.tsx` | 最小 UI（録画ボタン・状態表示） |
| `src/renderer/recorder/screenRecorder.ts` | 画面＋マイク録画のアダプタ（getDisplayMedia / MediaRecorder） |
| `src/renderer/global.d.ts` | `window.api` の型定義 |
| `test/*.test.ts` | 純粋ロジックの単体テスト |

---

## Task 1: プロジェクトの足場（Electron + Vite + React + Vitest）

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`
- Test: `test/smoke.test.ts`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "clip2manual",
  "version": "0.1.0",
  "description": "Convert narrated screen recordings into manual videos",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "uiohook-napi": "^1.5.4"
  }
}
```

- [ ] **Step 2: TypeScript 設定を作成**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "baseUrl": "."
  },
  "include": ["src", "test"]
}
```

`tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "composite": true, "lib": ["ES2022"] },
  "include": ["electron.vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: ビルド・テスト設定を作成**

`electron.vite.config.ts`:

```ts
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } } },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()],
  },
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 最小の main / preload / renderer を作成**

`src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

`src/preload/index.ts`:

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('api', {
  ping: () => 'pong',
});
```

`src/renderer/index.html`:

```html
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>clip2manual</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/renderer/App.tsx`:

```tsx
export default function App() {
  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>clip2manual</h1>
      <p>録画基盤の足場です。</p>
    </div>
  );
}
```

- [ ] **Step 5: 依存をインストールしてスモークテストを書く**

Run: `npm install`
Expected: 依存が解決される（uiohook-napi のネイティブビルドが走る）。

`test/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('test runner works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: テストとアプリ起動を確認**

Run: `npm test`
Expected: PASS（smoke 1件）

Run: `npm run dev`
Expected: Electron ウィンドウが開き「clip2manual / 録画基盤の足場です。」が表示される。確認したらウィンドウを閉じる。

- [ ] **Step 7: コミット**

```bash
git add package.json tsconfig.json tsconfig.node.json electron.vite.config.ts vitest.config.ts src/ test/smoke.test.ts package-lock.json
git commit -m "chore: scaffold electron + vite + react + vitest project"
```

---

## Task 2: プロジェクトのデータモデルと createProject ファクトリ

**Files:**
- Create: `src/shared/types.ts`
- Test: `test/types.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createProject, CURRENT_PROJECT_VERSION, type ProjectSource } from '../src/shared/types';

const source: ProjectSource = {
  video: 'assets/raw.webm',
  narration: 'assets/narration.webm',
  clickLog: 'assets/clicks.json',
  display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
};

describe('createProject', () => {
  it('sets the current version', () => {
    expect(createProject({ name: 'demo', source }).version).toBe(CURRENT_PROJECT_VERSION);
  });

  it('applies default settings and an empty segment list', () => {
    const p = createProject({ name: 'demo', source });
    expect(p.settings.highlightStyle).toBe('ripple');
    expect(p.settings.timingMode).toBe('video-follows-audio');
    expect(p.segments).toEqual([]);
    expect(p.meta.source).toBe(source);
  });

  it('uses the provided createdAt when given', () => {
    const p = createProject({ name: 'demo', source, createdAt: '2026-05-26T00:00:00.000Z' });
    expect(p.meta.createdAt).toBe('2026-05-26T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/types.test.ts`
Expected: FAIL（`src/shared/types` が存在しない）

- [ ] **Step 3: 最小実装を書く**

`src/shared/types.ts`:

```ts
export const CURRENT_PROJECT_VERSION = 1;

export interface DisplayInfo {
  width: number;        // 録画映像のピクセル幅
  height: number;       // 録画映像のピクセル高さ
  scaleFactor: number;  // OS の表示スケール（例: 1.25）
  originX: number;      // 録画対象ディスプレイの原点（DIP）
  originY: number;
}

export interface ClickEvent {
  x: number;       // 映像内ピクセル座標
  y: number;
  t: number;       // t0 からの相対秒
  button: number;
}

export interface SegmentVoice {
  speaker: number;
  speed: number;
}

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
}

export interface ProjectSource {
  video: string;
  narration: string;
  clickLog: string;
  display: DisplayInfo;
}

export interface LLMSettings {
  provider: 'anthropic' | 'openai' | 'azure';
  model: string;
}

export interface TTSSettings {
  defaultSpeaker: number;
  defaultSpeed: number;
}

export interface ProjectSettings {
  highlightStyle: 'ripple';
  timingMode: 'video-follows-audio';
  llm: LLMSettings;
  tts: TTSSettings;
}

export interface ProjectMeta {
  name: string;
  createdAt: string;
  source: ProjectSource;
}

export interface Project {
  version: number;
  meta: ProjectMeta;
  settings: ProjectSettings;
  segments: Segment[];
}

export function createProject(params: {
  name: string;
  source: ProjectSource;
  createdAt?: string;
}): Project {
  return {
    version: CURRENT_PROJECT_VERSION,
    meta: {
      name: params.name,
      createdAt: params.createdAt ?? new Date().toISOString(),
      source: params.source,
    },
    settings: {
      highlightStyle: 'ripple',
      timingMode: 'video-follows-audio',
      llm: { provider: 'anthropic', model: 'claude-opus-4-7' },
      tts: { defaultSpeaker: 3, defaultSpeed: 1.0 },
    },
    segments: [],
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/types.test.ts`
Expected: PASS（3件）

- [ ] **Step 5: コミット**

```bash
git add src/shared/types.ts test/types.test.ts
git commit -m "feat: add project data model and createProject factory"
```

---

## Task 3: 座標変換（純粋関数）

**Files:**
- Create: `src/shared/coordinateTransform.ts`
- Test: `test/coordinateTransform.test.ts`

**注意:** この関数は「クリック座標と表示領域を同一座標空間で受け取り、長方形→長方形へ写像する」純粋関数。実機での DPI 整合（uiohook の物理座標と Electron の DIP の対応）は Task 7 のアダプタで吸収し、手動で検証する。

- [ ] **Step 1: 失敗するテストを書く**

`test/coordinateTransform.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { osToVideoCoords, isWithinDisplay, type CaptureGeometry } from '../src/shared/coordinateTransform';

const single: CaptureGeometry = {
  displayOriginX: 0, displayOriginY: 0,
  displayWidth: 1920, displayHeight: 1080,
  videoWidth: 1920, videoHeight: 1080,
};

const hidpi: CaptureGeometry = {
  displayOriginX: 0, displayOriginY: 0,
  displayWidth: 1280, displayHeight: 720,
  videoWidth: 2560, videoHeight: 1440,
};

const secondMonitor: CaptureGeometry = {
  displayOriginX: 1920, displayOriginY: 0,
  displayWidth: 1920, displayHeight: 1080,
  videoWidth: 1920, videoHeight: 1080,
};

describe('osToVideoCoords', () => {
  it('maps 1:1 when display and video match', () => {
    expect(osToVideoCoords(960, 540, single)).toEqual({ x: 960, y: 540 });
  });

  it('scales up for HiDPI capture', () => {
    expect(osToVideoCoords(640, 360, hidpi)).toEqual({ x: 1280, y: 720 });
  });

  it('subtracts the display origin for a second monitor', () => {
    expect(osToVideoCoords(2880, 540, secondMonitor)).toEqual({ x: 960, y: 540 });
  });
});

describe('isWithinDisplay', () => {
  it('returns true for a point inside the display', () => {
    expect(isWithinDisplay(100, 100, single)).toBe(true);
  });

  it('returns false for a point on another monitor', () => {
    expect(isWithinDisplay(2000, 100, single)).toBe(false);
  });

  it('treats the far edges as outside (half-open range)', () => {
    expect(isWithinDisplay(1920, 0, single)).toBe(false);
    expect(isWithinDisplay(0, 1080, single)).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/coordinateTransform.test.ts`
Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 最小実装を書く**

`src/shared/coordinateTransform.ts`:

```ts
export interface CaptureGeometry {
  /** 録画対象ディスプレイの原点（クリック座標と同一空間） */
  displayOriginX: number;
  displayOriginY: number;
  /** 録画対象ディスプレイのサイズ（クリック座標と同一空間） */
  displayWidth: number;
  displayHeight: number;
  /** 録画された映像ストリームのピクセルサイズ */
  videoWidth: number;
  videoHeight: number;
}

export function osToVideoCoords(
  osX: number,
  osY: number,
  g: CaptureGeometry,
): { x: number; y: number } {
  const relX = osX - g.displayOriginX;
  const relY = osY - g.displayOriginY;
  return {
    x: relX * (g.videoWidth / g.displayWidth),
    y: relY * (g.videoHeight / g.displayHeight),
  };
}

export function isWithinDisplay(osX: number, osY: number, g: CaptureGeometry): boolean {
  return (
    osX >= g.displayOriginX &&
    osX < g.displayOriginX + g.displayWidth &&
    osY >= g.displayOriginY &&
    osY < g.displayOriginY + g.displayHeight
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/coordinateTransform.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: コミット**

```bash
git add src/shared/coordinateTransform.ts test/coordinateTransform.test.ts
git commit -m "feat: add OS-to-video coordinate transform"
```

---

## Task 4: クリックログ生成（純粋関数）

**Files:**
- Create: `src/shared/clickLog.ts`
- Test: `test/clickLog.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/clickLog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildClickLog, type RawClickEvent } from '../src/shared/clickLog';
import { type CaptureGeometry } from '../src/shared/coordinateTransform';

const geometry: CaptureGeometry = {
  displayOriginX: 0, displayOriginY: 0,
  displayWidth: 1920, displayHeight: 1080,
  videoWidth: 1920, videoHeight: 1080,
};

const raw = (osX: number, osY: number, timestampMs: number): RawClickEvent => ({
  osX, osY, button: 1, timestampMs,
});

describe('buildClickLog', () => {
  it('converts absolute timestamps to seconds relative to t0', () => {
    const log = buildClickLog([raw(100, 200, 1500)], 1000, geometry);
    expect(log).toEqual([{ x: 100, y: 200, t: 0.5, button: 1 }]);
  });

  it('drops events that occur before t0', () => {
    const log = buildClickLog([raw(100, 200, 900), raw(100, 200, 1100)], 1000, geometry);
    expect(log).toHaveLength(1);
    expect(log[0].t).toBeCloseTo(0.1);
  });

  it('drops clicks outside the captured display', () => {
    const log = buildClickLog([raw(5000, 200, 2000)], 1000, geometry);
    expect(log).toEqual([]);
  });

  it('preserves order of valid events', () => {
    const log = buildClickLog([raw(10, 10, 1100), raw(20, 20, 1200)], 1000, geometry);
    expect(log.map((e) => e.x)).toEqual([10, 20]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/clickLog.test.ts`
Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 最小実装を書く**

`src/shared/clickLog.ts`:

```ts
import { osToVideoCoords, isWithinDisplay, type CaptureGeometry } from './coordinateTransform';
import { type ClickEvent } from './types';

export interface RawClickEvent {
  osX: number;
  osY: number;
  button: number;
  timestampMs: number;
}

export function buildClickLog(
  rawEvents: RawClickEvent[],
  t0Ms: number,
  geometry: CaptureGeometry,
): ClickEvent[] {
  const result: ClickEvent[] = [];
  for (const e of rawEvents) {
    const t = (e.timestampMs - t0Ms) / 1000;
    if (t < 0) continue;
    if (!isWithinDisplay(e.osX, e.osY, geometry)) continue;
    const { x, y } = osToVideoCoords(e.osX, e.osY, geometry);
    result.push({ x, y, t, button: e.button });
  }
  return result;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/clickLog.test.ts`
Expected: PASS（4件）

- [ ] **Step 5: コミット**

```bash
git add src/shared/clickLog.ts test/clickLog.test.ts
git commit -m "feat: build click log with relative timing and coordinate transform"
```

---

## Task 5: ProjectStore（プロジェクトの読み書き）

**Files:**
- Create: `src/main/projectStore.ts`
- Test: `test/projectStore.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`test/projectStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initProjectDir, saveProject, loadProject, ASSET_DIRS } from '../src/main/projectStore';
import { createProject, type ProjectSource } from '../src/shared/types';

const source: ProjectSource = {
  video: 'assets/raw.webm',
  narration: 'assets/narration.webm',
  clickLog: 'assets/clicks.json',
  display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
};

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('projectStore', () => {
  it('round-trips a saved project', async () => {
    const project = createProject({ name: 'demo', source, createdAt: '2026-05-26T00:00:00.000Z' });
    await saveProject(dir, project);
    const loaded = await loadProject(dir);
    expect(loaded).toEqual(project);
  });

  it('leaves no temp file after saving', async () => {
    await saveProject(dir, createProject({ name: 'demo', source }));
    const entries = await fs.readdir(dir);
    expect(entries.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(entries).toContain('project.json');
  });

  it('creates the asset directories', async () => {
    await initProjectDir(dir);
    const entries = await fs.readdir(dir);
    for (const d of ASSET_DIRS) expect(entries).toContain(d);
  });

  it('rejects an unknown project version', async () => {
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ version: 999 }), 'utf8');
    await expect(loadProject(dir)).rejects.toThrow(/version/i);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/projectStore.test.ts`
Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 最小実装を書く**

`src/main/projectStore.ts`:

```ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Project, CURRENT_PROJECT_VERSION } from '../shared/types';

const PROJECT_FILE = 'project.json';
export const ASSET_DIRS = ['assets', 'tts'] as const;

export async function initProjectDir(projectDir: string): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  for (const d of ASSET_DIRS) {
    await fs.mkdir(path.join(projectDir, d), { recursive: true });
  }
}

export async function saveProject(projectDir: string, project: Project): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  const target = path.join(projectDir, PROJECT_FILE);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf8');
  await fs.rename(tmp, target);
}

export async function loadProject(projectDir: string): Promise<Project> {
  const raw = await fs.readFile(path.join(projectDir, PROJECT_FILE), 'utf8');
  const parsed = JSON.parse(raw) as Project;
  if (parsed.version !== CURRENT_PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${parsed.version}`);
  }
  return parsed;
}

export function assetPath(projectDir: string, relative: string): string {
  return path.join(projectDir, relative);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/projectStore.test.ts`
Expected: PASS（4件）

- [ ] **Step 5: コミット**

```bash
git add src/main/projectStore.ts test/projectStore.test.ts
git commit -m "feat: add ProjectStore for atomic project save/load"
```

---

## Task 6: グローバルマウスフックのアダプタ（main）

**Files:**
- Create: `src/main/clickHook.ts`

**注意:** ネイティブモジュール（uiohook-napi）を使うため単体テストではなく手動検証する。`Date.now()` をイベント時刻に使い、Task 4 の `buildClickLog` が消費できる `RawClickEvent` を生成する。

- [ ] **Step 1: アダプタを実装**

`src/main/clickHook.ts`:

```ts
import { uIOhook } from 'uiohook-napi';
import { type RawClickEvent } from '../shared/clickLog';

interface UiohookMouseEvent {
  x: number;
  y: number;
  button?: number;
}

export class ClickHook {
  private events: RawClickEvent[] = [];
  private listening = false;

  private readonly handler = (e: UiohookMouseEvent): void => {
    this.events.push({
      osX: e.x,
      osY: e.y,
      button: e.button ?? 0,
      timestampMs: Date.now(),
    });
  };

  /** 録画開始時に呼ぶ。バッファをクリアしてフックを開始する。 */
  start(): void {
    if (this.listening) return;
    this.events = [];
    uIOhook.on('mousedown', this.handler);
    uIOhook.start();
    this.listening = true;
  }

  /** 録画停止時に呼ぶ。フックを止め、収集した生イベントを返す。 */
  stop(): RawClickEvent[] {
    if (this.listening) {
      uIOhook.off('mousedown', this.handler);
      uIOhook.stop();
      this.listening = false;
    }
    return this.events;
  }
}
```

- [ ] **Step 2: 型チェックを確認**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 3: 手動スモーク確認（Task 8 の配線後にまとめて検証するため、ここではビルド確認のみ）**

Run: `npm run build`
Expected: main バンドルが生成され、uiohook-napi の解決でエラーが出ない。

- [ ] **Step 4: コミット**

```bash
git add src/main/clickHook.ts
git commit -m "feat: add global mouse-down hook adapter"
```

---

## Task 7: 画面＋マイク録画のアダプタ（renderer）

**Files:**
- Create: `src/renderer/recorder/screenRecorder.ts`
- Modify: `src/main/index.ts`（getDisplayMedia ハンドラを登録）

**注意:** ブラウザ/Electron のメディア API を使うため手動検証する。画面は `getDisplayMedia`、マイクは `getUserMedia({audio:true})` を別ストリームで取得し、それぞれ MediaRecorder で webm に録る。

- [ ] **Step 1: main に getDisplayMedia ハンドラを追加**

`src/main/index.ts` の `import` 群に `session, desktopCapturer` を追加し、`createWindow` 内 `loadURL/loadFile` の直前に以下を追加する：

```ts
import { app, BrowserWindow, session, desktopCapturer } from 'electron';
// ...（createWindow 内、ウィンドウ生成後・load 前）
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      });
    },
    { useSystemPicker: false },
  );
```

（フェーズ1ではプライマリ画面 = `sources[0]` を選ぶ。`audio: 'loopback'` は無視されても良い。ナレーションはマイクから別取得する。）

- [ ] **Step 2: ScreenRecorder を実装**

`src/renderer/recorder/screenRecorder.ts`:

```ts
export interface RecordingResult {
  videoBlob: Blob;
  audioBlob: Blob;
  videoWidth: number;
  videoHeight: number;
}

export class ScreenRecorder {
  private videoRecorder?: MediaRecorder;
  private audioRecorder?: MediaRecorder;
  private videoChunks: Blob[] = [];
  private audioChunks: Blob[] = [];
  private videoStream?: MediaStream;
  private audioStream?: MediaStream;
  private videoSettings?: MediaTrackSettings;

  async start(): Promise<void> {
    this.videoStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.videoSettings = this.videoStream.getVideoTracks()[0].getSettings();

    this.videoChunks = [];
    this.audioChunks = [];
    this.videoRecorder = new MediaRecorder(this.videoStream, { mimeType: 'video/webm;codecs=vp9' });
    this.videoRecorder.ondataavailable = (e) => { if (e.data.size) this.videoChunks.push(e.data); };
    this.audioRecorder = new MediaRecorder(this.audioStream, { mimeType: 'audio/webm;codecs=opus' });
    this.audioRecorder.ondataavailable = (e) => { if (e.data.size) this.audioChunks.push(e.data); };

    this.videoRecorder.start();
    this.audioRecorder.start();
  }

  async stop(): Promise<RecordingResult> {
    const stopOne = (r: MediaRecorder) =>
      new Promise<void>((resolve) => { r.onstop = () => resolve(); r.stop(); });
    await Promise.all([stopOne(this.videoRecorder!), stopOne(this.audioRecorder!)]);
    this.videoStream?.getTracks().forEach((t) => t.stop());
    this.audioStream?.getTracks().forEach((t) => t.stop());
    return {
      videoBlob: new Blob(this.videoChunks, { type: 'video/webm' }),
      audioBlob: new Blob(this.audioChunks, { type: 'audio/webm' }),
      videoWidth: this.videoSettings?.width ?? 0,
      videoHeight: this.videoSettings?.height ?? 0,
    };
  }
}
```

- [ ] **Step 3: 型チェックを確認**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/renderer/recorder/screenRecorder.ts src/main/index.ts
git commit -m "feat: add screen+mic recorder adapter and display-media handler"
```

---

## Task 8: 録画フローの配線・最小UI・エンドツーエンド検証

**Files:**
- Create: `src/main/ipc.ts`, `src/renderer/global.d.ts`
- Modify: `src/main/index.ts`（IPC 登録）, `src/preload/index.ts`（API 公開）, `src/renderer/App.tsx`（録画ボタン）

- [ ] **Step 1: IPC ハンドラを実装**

`src/main/ipc.ts`:

```ts
import { ipcMain, screen, app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ClickHook } from './clickHook';
import { initProjectDir, saveProject, assetPath } from './projectStore';
import { buildClickLog } from '../shared/clickLog';
import { type CaptureGeometry } from '../shared/coordinateTransform';
import { createProject, type ProjectSource } from '../shared/types';

interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

let clickHook: ClickHook | null = null;
let t0Ms = 0;

export function registerIpc(): void {
  ipcMain.handle('recording:start', () => {
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
    // uiohook は物理ピクセルで座標を返す前提。DIP の bounds をスケール倍して物理空間に合わせる。
    // （実機での整合は下の手動検証で確認し、必要なら係数を調整する。）
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

- [ ] **Step 2: main で IPC を登録**

`src/main/index.ts` の先頭付近に `import { registerIpc } from './ipc';` を追加し、`app.whenReady().then(() => { ... })` の中、`createWindow();` の直前に `registerIpc();` を追加する。

- [ ] **Step 3: preload で API を公開**

`src/preload/index.ts` を以下に置き換える：

```ts
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
});
```

- [ ] **Step 4: window.api の型を定義**

`src/renderer/global.d.ts`:

```ts
export interface StopPayload {
  video: ArrayBuffer;
  audio: ArrayBuffer;
  videoWidth: number;
  videoHeight: number;
}

declare global {
  interface Window {
    api: {
      startRecording: () => Promise<{ ok: boolean }>;
      stopRecording: (payload: StopPayload) => Promise<{ projectDir: string; clickCount: number }>;
    };
  }
}

export {};
```

- [ ] **Step 5: 録画ボタンの UI を実装**

`src/renderer/App.tsx` を以下に置き換える：

```tsx
import { useRef, useState } from 'react';
import { ScreenRecorder } from './recorder/screenRecorder';

export default function App() {
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('録画していません');

  async function onStart() {
    recorderRef.current = new ScreenRecorder();
    await window.api.startRecording();
    await recorderRef.current.start();
    setRecording(true);
    setStatus('録画中…');
  }

  async function onStop() {
    const result = await recorderRef.current!.stop();
    const video = await result.videoBlob.arrayBuffer();
    const audio = await result.audioBlob.arrayBuffer();
    const res = await window.api.stopRecording({
      video,
      audio,
      videoWidth: result.videoWidth,
      videoHeight: result.videoHeight,
    });
    setRecording(false);
    setStatus(`保存しました: ${res.projectDir}（クリック ${res.clickCount} 件）`);
  }

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>clip2manual</h1>
      <button onClick={recording ? onStop : onStart}>
        {recording ? '■ 停止して保存' : '● 録画開始'}
      </button>
      <p>{status}</p>
    </div>
  );
}
```

- [ ] **Step 6: 型チェックと自動テストを確認**

Run: `npm run typecheck`
Expected: エラーなし

Run: `npm test`
Expected: PASS（smoke / types / coordinateTransform / clickLog / projectStore のすべて）

- [ ] **Step 7: エンドツーエンドの手動検証**

Run: `npm run dev`

手順：
1. 「● 録画開始」を押す。画面共有のプロンプトが出たらプライマリ画面を選ぶ（マイク許可も承認）。
2. 画面上の**分かりやすい位置**（例：画面中央のアイコン、四隅近くのボタン）を数回クリックしながら一言ナレーションする。
3. 「■ 停止して保存」を押す。
4. 状態表示に出た `projectDir` をエクスプローラで開く。

確認項目（Expected）：
- `project.json` が生成され、`version:1`・`settings.highlightStyle:"ripple"`・`segments:[]` を含む。
- `assets/raw.webm`（映像）が再生でき、録画した画面が映っている。
- `assets/narration.webm`（音声）にナレーションが入っている。
- `assets/clicks.json` にクリック数ぶんの要素があり、各 `{x,y,t,button}` の `t` が秒単位で増加している。
- **座標検証**：`clicks.json` の `x,y` が、実際にクリックした映像内の位置とおおむね一致する（画面中央クリックなら `x≈videoWidth/2, y≈videoHeight/2`）。
  - もし一定倍率ずれている場合、`src/main/ipc.ts` の geometry 構築（`* sf` の有無）を調整する。これが「OS物理座標 vs DIP」整合の調整ポイント。1モニタ・スケール100%の環境ではズレないはず。

- [ ] **Step 8: コミット**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/global.d.ts src/renderer/App.tsx
git commit -m "feat: wire up end-to-end recording flow with project save"
```

---

## 完了の定義（フェーズ1）

- `npm test` が全ロジックテストで PASS する。
- `npm run dev` で録画開始→停止すると、`raw.webm` / `narration.webm` / `clicks.json` / `project.json` を含むプロジェクトフォルダが生成される。
- クリック座標が映像内位置とおおむね一致する（スケール100%・単一モニタ環境で検証）。

## フェーズ1で扱わないもの（次フェーズ以降）

- 文字起こし・セグメント生成・タイムライン表示（フェーズ2）
- webm → mp4 への変換（書き出しフェーズで対応）
- 録画対象ディスプレイ/ウィンドウの選択 UI（当面プライマリ画面固定）
- マルチモニタ・混在 DPI の厳密対応（純粋関数は対応済み。アダプタ側の係数調整は将来）
- t0 同期の精緻化（main のフック開始と renderer の録画開始のわずかな skew は許容）
