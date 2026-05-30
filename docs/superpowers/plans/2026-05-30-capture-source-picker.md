# Capture Source Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home 画面のプルダウンからディスプレイ／ウィンドウを選んで録画し、その範囲だけをクリック座標として記録できるようにする。

**Architecture:** renderer の Home 画面に shadcn Select でソースピッカーを置き、`desktopCapturer.getSources({types:['window','screen']})` の結果を main 経由で整形して提示する。録画開始時に `prepareCapture(sourceId)` を呼び、main 側の `pending` state（`{sourceId,kind,label,bounds}`）に格納。`setDisplayMediaRequestHandler` が pending の sourceId を 1 回だけ消費し、`recording:stop` が pending bounds から `CaptureGeometry` を組む。ウィンドウ bounds は Win32 `GetWindowRect` を koffi 経由で取得。

**Tech Stack:** Electron 31 / TypeScript / React 18 / shadcn (radix-ui) Select / vitest / koffi（Win32 FFI）

**Spec:** `docs/superpowers/specs/2026-05-30-capture-source-picker-design.md`

---

## File Structure

```
新規:
  src/main/native/winBounds.ts            HWND パース + GetWindowRect/IsIconic（koffi 経由）
  src/main/captureSources.ts              desktopCapturer 結果の整形（純関数 + DI）
  src/main/ipc/captureSources.ts          'capture:listSources' / 'capture:prepare' / pending state
  src/renderer/home/SourcePicker.tsx      shadcn Select ベースのプルダウン
  test/captureSources.test.ts             整形ロジックの unit テスト
  test/captureSourcesIpc.test.ts          IPC ハンドラの unit テスト（electron をモック）
  test/winBounds.test.ts                  id → HWND パーサのみ unit テスト

変更:
  src/main/index.ts                       setDisplayMediaRequestHandler が pending sourceId を消費
  src/main/ipc/index.ts                   registerCaptureSourcesIpc を呼ぶ
  src/main/ipc/recording.ts               recording:stop で pending を消費し geometry に反映
  src/preload/index.ts                    listCaptureSources / prepareCapture を公開
  src/renderer/global.d.ts                api 型定義に追加
  src/renderer/home/HomeScreen.tsx        SourcePicker を配置、selectedId を prepareCapture へ
  src/shared/types.ts                     ProjectSource に captureKind/captureLabel を追加
  src/shared/i18n/locales/ja.json         home.source.* キー追加
  src/shared/i18n/locales/en.json         同上
  test/coordinateTransform.test.ts        ウィンドウオフセットを与えた CaptureGeometry ケース追加
  package.json                            koffi を optionalDependencies に追加
```

責務分割:
- `winBounds.ts`: HWND を扱う唯一の場所。koffi をモジュールトップで require せず lazy load
- `captureSources.ts`: electron API を引数で受ける純関数。テストはモック注入
- `ipc/captureSources.ts`: pending state と IPC 登録。bounds 取得は DI 経由

---

## Task 1: ProjectSource に captureKind / captureLabel を追加

**Files:**
- Modify: `src/shared/types.ts:40-45`

- [ ] **Step 1: 既存テストが PASS していることを確認**

```bash
npm test -- types.test
```

期待: PASS

- [ ] **Step 2: ProjectSource を拡張**

`src/shared/types.ts` の既存 `ProjectSource` を以下に置換:

```ts
export interface ProjectSource {
  video: string;
  narration: string;
  clickLog: string;
  display: DisplayInfo;
  /** 'screen' = ディスプレイ全体, 'window' = 特定ウィンドウ。旧プロジェクトでは undefined。 */
  captureKind?: 'screen' | 'window';
  /** UI 表示用ラベル（例「ディスプレイ 1（プライマリ・1920×1080）」/ウィンドウタイトル）。 */
  captureLabel?: string;
}
```

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

期待: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add captureKind/captureLabel to ProjectSource"
```

---

## Task 2: coordinateTransform に「ウィンドウ領域」テストを追加

座標変換ロジックは変更しないが、ウィンドウ選択時に与える `CaptureGeometry` の挙動を回帰として固定する。

**Files:**
- Test: `test/coordinateTransform.test.ts`

- [ ] **Step 1: テストを追加**

`test/coordinateTransform.test.ts` の末尾に追記:

```ts
const win: CaptureGeometry = {
  // プライマリ画面上 (200,150) を左上にした 800×600 のウィンドウを 1280×720 で録画
  displayOriginX: 200, displayOriginY: 150,
  displayWidth: 800, displayHeight: 600,
  videoWidth: 1280, videoHeight: 720,
};

describe('osToVideoCoords (window source)', () => {
  it('maps an in-window OS point to scaled video coords', () => {
    // OS(600,450) - origin(200,150) = rel(400,300) → scaled (640, 360)
    expect(osToVideoCoords(600, 450, win)).toEqual({ x: 640, y: 360 });
  });
});

describe('isWithinDisplay (window source)', () => {
  it('returns true inside the window rect', () => {
    expect(isWithinDisplay(600, 450, win)).toBe(true);
  });
  it('returns false just outside the window rect', () => {
    expect(isWithinDisplay(199, 450, win)).toBe(false);
    expect(isWithinDisplay(600, 149, win)).toBe(false);
    expect(isWithinDisplay(1000, 450, win)).toBe(false); // origin+width=1000、半開区間
  });
});
```

- [ ] **Step 2: テスト実行**

```bash
npm test -- coordinateTransform.test
```

期待: 全 PASS（既存 + 新規 5 件）

- [ ] **Step 3: コミット**

```bash
git add test/coordinateTransform.test.ts
git commit -m "test(coords): pin window-rect CaptureGeometry behavior"
```

---

## Task 3: koffi を依存に追加

Windows 専用のため optionalDependencies 扱いとし、他 OS のテスト/開発で require が失敗してもアプリ全体が壊れないようにする。

**Files:**
- Modify: `package.json`

- [ ] **Step 1: koffi をインストール**

```bash
npm install --save-optional koffi@^2
```

期待: `package.json` の `optionalDependencies` に `koffi` が入る。

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

期待: エラーなし

- [ ] **Step 3: コミット**

```bash
git add package.json package-lock.json
git commit -m "build: add koffi as optional dep for Win32 FFI"
```

---

## Task 4: winBounds — HWND パーサ（テスト先行）

desktopCapturer の window source id は `window:<HWND>:<...>` 形式。HWND を BigInt として抜き出す純関数を作る。

**Files:**
- Create: `src/main/native/winBounds.ts`
- Test: `test/winBounds.test.ts`

- [ ] **Step 1: テストを書く**

`test/winBounds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseHwndFromSourceId } from '../src/main/native/winBounds';

describe('parseHwndFromSourceId', () => {
  it('parses a decimal HWND from "window:HWND:..." form', () => {
    expect(parseHwndFromSourceId('window:12345:0')).toBe(12345n);
  });
  it('parses long HWNDs (64-bit ranges)', () => {
    expect(parseHwndFromSourceId('window:9876543210:1')).toBe(9876543210n);
  });
  it('throws on screen sources', () => {
    expect(() => parseHwndFromSourceId('screen:0:0')).toThrow();
  });
  it('throws on malformed ids', () => {
    expect(() => parseHwndFromSourceId('window:abc:0')).toThrow();
    expect(() => parseHwndFromSourceId('window:')).toThrow();
    expect(() => parseHwndFromSourceId('')).toThrow();
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
npm test -- winBounds.test
```

期待: FAIL（モジュール未作成）

- [ ] **Step 3: パーサを実装**

`src/main/native/winBounds.ts`:

```ts
export interface WindowRect { x: number; y: number; w: number; h: number }

/**
 * Electron の desktopCapturer が返す window source id（"window:<hwnd>:<...>"）から
 * HWND を BigInt として取り出す。x64 環境では HWND が 32bit 範囲を超えうるため number は使わない。
 */
export function parseHwndFromSourceId(sourceId: string): bigint {
  if (!sourceId.startsWith('window:')) {
    throw new Error(`Not a window source id: ${sourceId}`);
  }
  const parts = sourceId.split(':');
  if (parts.length < 2 || parts[1].length === 0) {
    throw new Error(`Malformed window source id: ${sourceId}`);
  }
  if (!/^\d+$/.test(parts[1])) {
    throw new Error(`HWND segment is not numeric: ${sourceId}`);
  }
  return BigInt(parts[1]);
}
```

- [ ] **Step 4: テスト PASS を確認**

```bash
npm test -- winBounds.test
```

期待: 4 件 PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/native/winBounds.ts test/winBounds.test.ts
git commit -m "feat(native): parse HWND from desktopCapturer window source id"
```

---

## Task 5: winBounds — koffi で GetWindowRect / IsIconic を実装

**Files:**
- Modify: `src/main/native/winBounds.ts`

- [ ] **Step 1: koffi の lazy ロード + Win32 関数定義を追加**

`src/main/native/winBounds.ts` を以下に置換（既存の `parseHwndFromSourceId` は残す）:

```ts
export interface WindowRect { x: number; y: number; w: number; h: number }

export function parseHwndFromSourceId(sourceId: string): bigint {
  if (!sourceId.startsWith('window:')) {
    throw new Error(`Not a window source id: ${sourceId}`);
  }
  const parts = sourceId.split(':');
  if (parts.length < 2 || parts[1].length === 0) {
    throw new Error(`Malformed window source id: ${sourceId}`);
  }
  if (!/^\d+$/.test(parts[1])) {
    throw new Error(`HWND segment is not numeric: ${sourceId}`);
  }
  return BigInt(parts[1]);
}

interface User32 {
  GetWindowRect: (hwnd: bigint, rectOut: object) => number;
  IsIconic: (hwnd: bigint) => number;
}

let cachedUser32: User32 | null = null;
let cachedKoffi: typeof import('koffi') | null = null;

function loadUser32(): User32 {
  if (cachedUser32) return cachedUser32;
  if (process.platform !== 'win32') {
    throw new Error('winBounds is only supported on Windows');
  }
  if (!cachedKoffi) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedKoffi = require('koffi');
  }
  const koffi = cachedKoffi!;
  const user32 = koffi.load('user32.dll');
  const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  cachedUser32 = {
    GetWindowRect: user32.func('__stdcall', 'GetWindowRect', 'bool', ['intptr', koffi.out(koffi.pointer(RECT))]),
    IsIconic: user32.func('__stdcall', 'IsIconic', 'bool', ['intptr']),
  };
  return cachedUser32!;
}

/** OS スクリーン座標（物理ピクセル）でのウィンドウ矩形。最小化中は呼ばないこと。 */
export function getWindowRectByHwnd(hwnd: bigint): WindowRect {
  const u = loadUser32();
  const rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const ok = u.GetWindowRect(hwnd, rect);
  if (!ok) throw new Error(`GetWindowRect failed for HWND ${hwnd.toString()}`);
  return { x: rect.left, y: rect.top, w: rect.right - rect.left, h: rect.bottom - rect.top };
}

export function isWindowMinimized(hwnd: bigint): boolean {
  const u = loadUser32();
  return u.IsIconic(hwnd) !== 0;
}

/** koffi/user32 がロードできるかを確認（テストや non-Windows での早期判定に使う）。 */
export function isWinBoundsAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    loadUser32();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

期待: エラーなし

- [ ] **Step 3: 既存パーサテストが通る**

```bash
npm test -- winBounds.test
```

期待: 既存 4 件 PASS（koffi 部は OS 依存のためテスト対象外）

- [ ] **Step 4: コミット**

```bash
git add src/main/native/winBounds.ts
git commit -m "feat(native): GetWindowRect/IsIconic via koffi (lazy-loaded)"
```

---

## Task 6: captureSources — desktopCapturer 結果整形（テスト先行）

**Files:**
- Create: `src/main/captureSources.ts`
- Test: `test/captureSources.test.ts`

- [ ] **Step 1: テストを書く**

`test/captureSources.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatCaptureSources, type RawSource, type DisplayLike } from '../src/main/captureSources';

const displays: DisplayLike[] = [
  { id: 100, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: true },
  { id: 200, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1, primary: false },
];

const sources: RawSource[] = [
  { id: 'screen:0:0', name: 'Entire Screen', display_id: '100' },
  { id: 'screen:1:0', name: 'Screen 2',      display_id: '200' },
  { id: 'window:111:0', name: 'メモ帳 - 無題',  display_id: '' },
  { id: 'window:222:0', name: '',               display_id: '' }, // 空タイトル
  { id: 'window:333:0', name: 'clip2manual',    display_id: '' }, // 自身
];

const LABELS = {
  displayPrimary: 'ディスプレイ {{n}}（プライマリ・{{w}}×{{h}}）',
  display: 'ディスプレイ {{n}}（{{w}}×{{h}}）',
};

describe('formatCaptureSources', () => {
  it('lists screens first with primary marker and resolution', () => {
    const out = formatCaptureSources({
      sources, displays, selfMediaSourceId: 'window:333:0', labels: LABELS,
    });
    expect(out[0]).toEqual({ id: 'screen:0:0', kind: 'screen', label: 'ディスプレイ 1（プライマリ・1920×1080）', displayId: 100 });
    expect(out[1]).toEqual({ id: 'screen:1:0', kind: 'screen', label: 'ディスプレイ 2（2560×1440）', displayId: 200 });
  });

  it('drops blank-title windows', () => {
    const out = formatCaptureSources({
      sources, displays, selfMediaSourceId: 'window:333:0', labels: LABELS,
    });
    expect(out.find((s) => s.id === 'window:222:0')).toBeUndefined();
  });

  it('drops the self window by media source id', () => {
    const out = formatCaptureSources({
      sources, displays, selfMediaSourceId: 'window:333:0', labels: LABELS,
    });
    expect(out.find((s) => s.id === 'window:333:0')).toBeUndefined();
  });

  it('keeps a tail of windows after screens, sorted by label', () => {
    const out = formatCaptureSources({
      sources: [
        ...sources,
        { id: 'window:444:0', name: 'A first', display_id: '' },
      ],
      displays, selfMediaSourceId: 'window:333:0', labels: LABELS,
    });
    const windowLabels = out.filter((s) => s.kind === 'window').map((s) => s.label);
    expect(windowLabels).toEqual(['A first', 'メモ帳 - 無題']);
  });

  it('drops screen sources whose display_id does not resolve', () => {
    const out = formatCaptureSources({
      sources: [{ id: 'screen:9:0', name: 'Unknown Display', display_id: '999' }],
      displays, selfMediaSourceId: '', labels: LABELS,
    });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
npm test -- captureSources.test
```

期待: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`src/main/captureSources.ts`:

```ts
export interface RawSource {
  id: string;
  name: string;
  display_id: string;
}

export interface DisplayLike {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  primary: boolean;
}

export interface CaptureSource {
  id: string;
  kind: 'screen' | 'window';
  label: string;
  displayId?: number;
}

export interface FormatInput {
  sources: RawSource[];
  displays: DisplayLike[];
  /** mainWindow.getMediaSourceId() の値。自ウィンドウ除外に使う。 */
  selfMediaSourceId: string;
  labels: {
    /** 例: "ディスプレイ {{n}}（プライマリ・{{w}}×{{h}}）" */
    displayPrimary: string;
    /** 例: "ディスプレイ {{n}}（{{w}}×{{h}}）" */
    display: string;
  };
}

export function formatCaptureSources(input: FormatInput): CaptureSource[] {
  const { sources, displays, selfMediaSourceId, labels } = input;
  const displayById = new Map<number, { display: DisplayLike; index: number }>();
  displays.forEach((d, i) => displayById.set(d.id, { display: d, index: i }));

  const screens: CaptureSource[] = [];
  const windows: CaptureSource[] = [];

  for (const s of sources) {
    if (s.id === selfMediaSourceId) continue;
    if (s.id.startsWith('screen:')) {
      const did = Number(s.display_id);
      const entry = Number.isFinite(did) ? displayById.get(did) : undefined;
      if (!entry) continue; // 結合できないソースは除外
      const { display, index } = entry;
      const tpl = display.primary ? labels.displayPrimary : labels.display;
      const label = tpl
        .replace('{{n}}', String(index + 1))
        .replace('{{w}}', String(display.bounds.width))
        .replace('{{h}}', String(display.bounds.height));
      screens.push({ id: s.id, kind: 'screen', label, displayId: display.id });
    } else if (s.id.startsWith('window:')) {
      const name = s.name.trim();
      if (!name) continue;
      windows.push({ id: s.id, kind: 'window', label: name });
    }
  }

  windows.sort((a, b) => a.label.localeCompare(b.label));
  return [...screens, ...windows];
}
```

- [ ] **Step 4: テスト PASS を確認**

```bash
npm test -- captureSources.test
```

期待: 5 件 PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/captureSources.ts test/captureSources.test.ts
git commit -m "feat(capture): format desktopCapturer sources for picker UI"
```

---

## Task 7: IPC — listCaptureSources / prepareCapture（テスト先行・最終 API）

pending state は `{sourceId,kind,label,bounds}` の 1 つにまとめる。`takePendingCapture()` で recording:stop が消費、`takePendingCaptureSourceId()` は `setDisplayMediaRequestHandler` 専用で sourceId のみ消費しつつ bounds/label は残す。

**Files:**
- Create: `src/main/ipc/captureSources.ts`
- Test: `test/captureSourcesIpc.test.ts`

- [ ] **Step 1: テストを書く**

`test/captureSourcesIpc.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const getSources = vi.fn();
  const getAllDisplays = vi.fn();
  const getPrimaryDisplay = vi.fn();
  const getMediaSourceId = vi.fn(() => 'window:999:0');
  const fakeWin = { getMediaSourceId, isDestroyed: () => false };
  return { handlers, getSources, getAllDisplays, getPrimaryDisplay, getMediaSourceId, fakeWin };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
  desktopCapturer: { getSources: (opts: unknown) => h.getSources(opts) },
  screen: {
    getAllDisplays: () => h.getAllDisplays(),
    getPrimaryDisplay: () => h.getPrimaryDisplay(),
  },
}));

vi.mock('../src/main/index', () => ({ getMainWindow: () => h.fakeWin }));

import {
  registerCaptureSourcesIpc,
  takePendingCapture,
  takePendingCaptureSourceId,
  __setBoundsResolverForTest,
} from '../src/main/ipc/captureSources';

const PRIMARY = { id: 100, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25, internal: true, label: '', primary: true } as const;

beforeEach(() => {
  h.handlers.clear();
  h.getSources.mockReset();
  h.getAllDisplays.mockReset();
  h.getPrimaryDisplay.mockReset();
  h.getMediaSourceId.mockClear();
  takePendingCapture(); // clear
  registerCaptureSourcesIpc();
  h.getPrimaryDisplay.mockReturnValue(PRIMARY);
});

describe('capture:listSources', () => {
  it('returns screens + windows, dropping self and blank-title', async () => {
    h.getAllDisplays.mockReturnValue([PRIMARY]);
    h.getSources.mockResolvedValue([
      { id: 'screen:0:0', name: 'X', display_id: '100' },
      { id: 'window:111:0', name: 'Notepad', display_id: '' },
      { id: 'window:999:0', name: 'clip2manual', display_id: '' },
      { id: 'window:222:0', name: '', display_id: '' },
    ]);
    const out = await h.handlers.get('capture:listSources')!(null);
    expect((out as Array<{ id: string }>).map((s) => s.id)).toEqual(['screen:0:0', 'window:111:0']);
  });

  it('falls back to displays-only when getSources rejects', async () => {
    h.getAllDisplays.mockReturnValue([PRIMARY]);
    h.getSources.mockRejectedValue(new Error('fail'));
    const out = await h.handlers.get('capture:listSources')!(null);
    expect((out as Array<{ kind: string }>).every((s) => s.kind === 'screen')).toBe(true);
    expect((out as Array<unknown>).length).toBe(1);
  });
});

describe('capture:prepare (screen)', () => {
  beforeEach(() => { h.getAllDisplays.mockReturnValue([PRIMARY]); });

  it('stores screen bounds in physical px and pending kind', async () => {
    h.getSources.mockResolvedValue([{ id: 'screen:0:0', name: 'X', display_id: '100' }]);
    const res = await h.handlers.get('capture:prepare')!(null, 'screen:0:0');
    expect(res).toEqual({ ok: true });
    const cap = takePendingCapture()!;
    expect(cap.sourceId).toBe('screen:0:0');
    expect(cap.kind).toBe('screen');
    expect(cap.bounds).toEqual({ x: 0, y: 0, w: 1920 * 1.25, h: 1080 * 1.25, scaleFactor: 1.25 });
  });

  it('takePendingCaptureSourceId leaves bounds/label for recording:stop', async () => {
    h.getSources.mockResolvedValue([{ id: 'screen:0:0', name: 'X', display_id: '100' }]);
    await h.handlers.get('capture:prepare')!(null, 'screen:0:0');
    const id1 = takePendingCaptureSourceId();
    expect(id1).toBe('screen:0:0');
    const cap = takePendingCapture()!;
    expect(cap.kind).toBe('screen');
    expect(cap.bounds.w).toBe(1920 * 1.25);
  });
});

describe('capture:prepare (window)', () => {
  beforeEach(() => { h.getAllDisplays.mockReturnValue([PRIMARY]); });

  it('stores window bounds via injected resolver', async () => {
    h.getSources.mockResolvedValue([{ id: 'window:111:0', name: 'Notepad', display_id: '' }]);
    __setBoundsResolverForTest({
      isAvailable: () => true,
      isMinimized: () => false,
      getRect: () => ({ x: 100, y: 200, w: 800, h: 600 }),
      scaleFactorFor: () => 1.0,
    });
    const res = await h.handlers.get('capture:prepare')!(null, 'window:111:0');
    expect(res).toEqual({ ok: true });
    const cap = takePendingCapture()!;
    expect(cap.kind).toBe('window');
    expect(cap.label).toBe('Notepad');
    expect(cap.bounds).toEqual({ x: 100, y: 200, w: 800, h: 600, scaleFactor: 1.0 });
  });

  it('rejects minimized window', async () => {
    h.getSources.mockResolvedValue([{ id: 'window:111:0', name: 'Notepad', display_id: '' }]);
    __setBoundsResolverForTest({
      isAvailable: () => true,
      isMinimized: () => true,
      getRect: () => { throw new Error('should not be called'); },
      scaleFactorFor: () => 1.0,
    });
    const res = await h.handlers.get('capture:prepare')!(null, 'window:111:0');
    expect(res).toEqual({ ok: false, reason: 'minimized' });
    expect(takePendingCapture()).toBeNull();
  });

  it('rejects when winBounds is unavailable', async () => {
    h.getSources.mockResolvedValue([{ id: 'window:111:0', name: 'Notepad', display_id: '' }]);
    __setBoundsResolverForTest({
      isAvailable: () => false,
      isMinimized: () => false,
      getRect: () => ({ x: 0, y: 0, w: 0, h: 0 }),
      scaleFactorFor: () => 1.0,
    });
    const res = await h.handlers.get('capture:prepare')!(null, 'window:111:0');
    expect(res).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('capture:prepare (unknown id)', () => {
  it('returns not-found', async () => {
    h.getAllDisplays.mockReturnValue([PRIMARY]);
    h.getSources.mockResolvedValue([]);
    const res = await h.handlers.get('capture:prepare')!(null, 'window:zzz:0');
    expect(res).toEqual({ ok: false, reason: 'not-found' });
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
npm test -- captureSourcesIpc.test
```

期待: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`src/main/ipc/captureSources.ts`:

```ts
import { ipcMain, desktopCapturer, screen } from 'electron';
import { formatCaptureSources, type CaptureSource } from '../captureSources';
import { getMainWindow } from '../index';
import {
  getWindowRectByHwnd,
  isWindowMinimized,
  isWinBoundsAvailable,
  parseHwndFromSourceId,
} from '../native/winBounds';

export interface PendingCaptureBounds {
  /** OS スクリーン座標・物理ピクセル */
  x: number; y: number; w: number; h: number;
  scaleFactor: number;
}

export interface PendingCapture {
  sourceId: string;
  kind: 'screen' | 'window';
  label: string;
  bounds: PendingCaptureBounds;
}

let pending: PendingCapture | null = null;

/** recording:stop が消費。bounds/label/kind を全部使う。 */
export function takePendingCapture(): PendingCapture | null {
  const v = pending; pending = null; return v;
}

/** setDisplayMediaRequestHandler 専用: sourceId だけ消費し、recording:stop 用に他は残す。 */
export function takePendingCaptureSourceId(): string | null {
  if (!pending) return null;
  const id = pending.sourceId;
  pending = { ...pending, sourceId: '' };
  return id;
}

/** bounds 取得を依存注入で受ける */
export interface BoundsResolver {
  isAvailable(): boolean;
  isMinimized(hwnd: bigint): boolean;
  getRect(hwnd: bigint): { x: number; y: number; w: number; h: number };
  scaleFactorFor(hwnd: bigint): number;
}

let boundsResolver: BoundsResolver = {
  isAvailable: () => isWinBoundsAvailable(),
  isMinimized: (h) => isWindowMinimized(h),
  getRect: (h) => getWindowRectByHwnd(h),
  // GetWindowRect は物理 px を返すため、ここは 1.0 を返す。
  // CaptureGeometry の videoWidth/Height で吸収する。
  scaleFactorFor: () => 1.0,
};

export function __setBoundsResolverForTest(r: BoundsResolver): void {
  boundsResolver = r;
}

// Task 13 で i18n に置き換える一時 fallback。
// home.source.displayPrimary / display のテンプレ文字列。
function labelTemplates(): { displayPrimary: string; display: string } {
  return {
    displayPrimary: 'ディスプレイ {{n}}（プライマリ・{{w}}×{{h}}）',
    display: 'ディスプレイ {{n}}（{{w}}×{{h}}）',
  };
}

async function listSources(): Promise<CaptureSource[]> {
  const labels = labelTemplates();
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const win = getMainWindow();
  const selfId = win && !win.isDestroyed() ? win.getMediaSourceId() : '';

  try {
    const raw = await desktopCapturer.getSources({ types: ['window', 'screen'], fetchWindowIcons: false });
    return formatCaptureSources({
      sources: raw.map((s) => ({ id: s.id, name: s.name, display_id: s.display_id })),
      displays: displays.map((d) => ({
        id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor, primary: d.id === primaryId,
      })),
      selfMediaSourceId: selfId,
      labels,
    });
  } catch (err) {
    console.warn('[capture] getSources failed, falling back to displays only:', err);
    return displays.map((d, i) => ({
      id: `screen:${i}:0`,
      kind: 'screen' as const,
      label: (d.id === primaryId ? labels.displayPrimary : labels.display)
        .replace('{{n}}', String(i + 1))
        .replace('{{w}}', String(d.bounds.width))
        .replace('{{h}}', String(d.bounds.height)),
      displayId: d.id,
    }));
  }
}

type PrepareResult = { ok: true } | { ok: false; reason: string };

async function prepare(sourceId: string): Promise<PrepareResult> {
  pending = null;
  const list = await listSources();
  const found = list.find((s) => s.id === sourceId);
  if (!found) return { ok: false, reason: 'not-found' };

  if (found.kind === 'screen') {
    const display = screen.getAllDisplays().find((d) => d.id === found.displayId);
    if (!display) return { ok: false, reason: 'not-found' };
    const sf = display.scaleFactor;
    pending = {
      sourceId,
      kind: 'screen',
      label: found.label,
      bounds: {
        x: display.bounds.x * sf, y: display.bounds.y * sf,
        w: display.bounds.width * sf, h: display.bounds.height * sf,
        scaleFactor: sf,
      },
    };
    return { ok: true };
  }

  // window
  if (!boundsResolver.isAvailable()) return { ok: false, reason: 'unsupported' };
  const hwnd = parseHwndFromSourceId(sourceId);
  if (boundsResolver.isMinimized(hwnd)) return { ok: false, reason: 'minimized' };
  let rect: { x: number; y: number; w: number; h: number };
  try {
    rect = boundsResolver.getRect(hwnd);
  } catch (err) {
    console.warn('[capture] getRect failed:', err);
    return { ok: false, reason: 'bounds-failed' };
  }
  pending = {
    sourceId,
    kind: 'window',
    label: found.label,
    bounds: { ...rect, scaleFactor: boundsResolver.scaleFactorFor(hwnd) },
  };
  return { ok: true };
}

export function registerCaptureSourcesIpc(): void {
  ipcMain.handle('capture:listSources', () => listSources());
  ipcMain.handle('capture:prepare', (_e, sourceId: string) => prepare(sourceId));
}
```

- [ ] **Step 4: テスト PASS を確認**

```bash
npm test -- captureSourcesIpc.test
```

期待: 7 件 PASS

- [ ] **Step 5: typecheck**

```bash
npm run typecheck
```

期待: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/main/ipc/captureSources.ts test/captureSourcesIpc.test.ts
git commit -m "feat(ipc): listCaptureSources + prepareCapture with pending capture state"
```

---

## Task 8: registerIpc に組み込み + setDisplayMediaRequestHandler を更新

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/index.ts:80-94`

- [ ] **Step 1: registerIpc に追加**

`src/main/ipc/index.ts`:

```ts
import { registerRecordingIpc } from './recording';
import { registerProjectIpc } from './project';
import { registerTranscriptionIpc } from './transcription';
import { registerTtsIpc } from './tts';
import { registerExportIpc } from './export';
import { registerSetupIpc } from './setup';
import { registerWindowIpc } from './window';
import { registerCaptureSourcesIpc } from './captureSources';

export function registerIpc(): void {
  registerRecordingIpc();
  registerProjectIpc();
  registerTranscriptionIpc();
  registerTtsIpc();
  registerExportIpc();
  registerSetupIpc();
  registerWindowIpc();
  registerCaptureSourcesIpc();
}
```

- [ ] **Step 2: setDisplayMediaRequestHandler を pending id 消費に変更**

`src/main/index.ts` の冒頭 import に追加:

```ts
import { takePendingCaptureSourceId } from './ipc/captureSources';
```

（注: ipc/captureSources は内部で `getMainWindow` を関数呼び出しで参照するだけで、モジュール読み込み時には呼ばないため循環 import 上の問題なし）

旧 `session.defaultSession.setDisplayMediaRequestHandler(...)` ブロック（旧 82-94 行付近）を以下に置換:

```ts
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const wanted = takePendingCaptureSourceId();
    desktopCapturer
      .getSources({ types: ['window', 'screen'] })
      .then((sources) => {
        const pick = wanted ? sources.find((s) => s.id === wanted) : undefined;
        if (wanted && !pick) {
          console.warn(`[capture] pending source ${wanted} not found in current sources; falling back to sources[0]`);
        }
        callback({ video: pick ?? sources[0], audio: 'loopback' });
      })
      .catch((err) => {
        console.error('Failed to enumerate screen sources for display media', err);
        callback({});
      });
  });
```

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

期待: エラーなし

- [ ] **Step 4: 全テスト**

```bash
npm test
```

期待: 全 PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/ipc/index.ts src/main/index.ts
git commit -m "feat(main): wire capture picker IPC + consume pending source id"
```

---

## Task 9: recording.ts で pending を採用

**Files:**
- Modify: `src/main/ipc/recording.ts:65-117`

- [ ] **Step 1: import を追加**

`src/main/ipc/recording.ts` の上部 import 群に追加:

```ts
import { takePendingCapture } from './captureSources';
```

- [ ] **Step 2: recording:stop の geometry 構築を分岐**

`ipcMain.handle('recording:stop', async (_e, payload: StopPayload) => { ... })` のボディを以下に置換:

```ts
  ipcMain.handle('recording:stop', async (_e, payload: StopPayload) => {
    const rawEvents = clickHook ? clickHook.stop() : [];
    clickHook = null;

    const pending = takePendingCapture();

    let captureKind: 'screen' | 'window';
    let captureLabel: string | undefined;
    let geometry: CaptureGeometry;
    let displayInfo: { width: number; height: number; scaleFactor: number; originX: number; originY: number };

    if (pending) {
      // pending は OS 物理 px（screen は bounds*sf、window は GetWindowRect 直値）
      geometry = {
        displayOriginX: pending.bounds.x,
        displayOriginY: pending.bounds.y,
        displayWidth: pending.bounds.w,
        displayHeight: pending.bounds.h,
        videoWidth: payload.videoWidth,
        videoHeight: payload.videoHeight,
      };
      captureKind = pending.kind;
      captureLabel = pending.label;
      displayInfo = {
        width: payload.videoWidth,
        height: payload.videoHeight,
        scaleFactor: pending.bounds.scaleFactor,
        originX: pending.bounds.x / pending.bounds.scaleFactor,
        originY: pending.bounds.y / pending.bounds.scaleFactor,
      };
    } else {
      // フォールバック（prepareCapture 未経由）: 従来通り primary display
      const display = screen.getPrimaryDisplay();
      const sf = display.scaleFactor;
      geometry = {
        displayOriginX: display.bounds.x * sf,
        displayOriginY: display.bounds.y * sf,
        displayWidth: display.bounds.width * sf,
        displayHeight: display.bounds.height * sf,
        videoWidth: payload.videoWidth,
        videoHeight: payload.videoHeight,
      };
      captureKind = 'screen';
      displayInfo = {
        width: payload.videoWidth, height: payload.videoHeight,
        scaleFactor: sf, originX: display.bounds.x, originY: display.bounds.y,
      };
    }

    const clicks = buildClickLog(rawEvents, t0Ms, geometry);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const projectDir = path.join(app.getPath('videos'), 'clip2manual', `rec-${stamp}`);
    await initProjectDir(projectDir);

    const rawPath = assetPath(projectDir, 'assets/raw.webm');
    const narrationPath = assetPath(projectDir, 'assets/narration.webm');
    await fs.writeFile(rawPath, Buffer.from(payload.video));
    await fs.writeFile(narrationPath, Buffer.from(payload.audio));
    await fs.writeFile(assetPath(projectDir, 'assets/clicks.json'), JSON.stringify(clicks, null, 2));
    await tryAddWebmCues(rawPath);
    await tryAddWebmCues(narrationPath);

    const source: ProjectSource = {
      video: 'assets/raw.webm',
      narration: 'assets/narration.webm',
      clickLog: 'assets/clicks.json',
      display: displayInfo,
      captureKind,
      ...(captureLabel ? { captureLabel } : {}),
    };
    const project = createProject({ name: path.basename(projectDir), source });
    await saveProject(projectDir, project);

    return { projectDir, clickCount: clicks.length };
  });
```

- [ ] **Step 3: 既存テスト + 新規テスト全て PASS**

```bash
npm test
```

期待: 全 PASS

- [ ] **Step 4: typecheck**

```bash
npm run typecheck
```

期待: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/main/ipc/recording.ts
git commit -m "feat(recording): use pending capture bounds for click geometry"
```

---

## Task 10: preload + global.d.ts を更新

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: preload に追加**

`src/preload/index.ts` の `contextBridge.exposeInMainWorld('api', { ... })` ブロックの `notifyRecordingStarted` の直前あたりに追記:

```ts
  listCaptureSources: () => ipcRenderer.invoke('capture:listSources'),
  prepareCapture: (sourceId: string) => ipcRenderer.invoke('capture:prepare', sourceId),
```

- [ ] **Step 2: global.d.ts に型を追加**

`src/renderer/global.d.ts` の `interface Window { api: { ... } }` に追加（`notifyRecordingStarted` の直前あたり）:

```ts
      listCaptureSources: () => Promise<Array<{
        id: string;
        kind: 'screen' | 'window';
        label: string;
        displayId?: number;
      }>>;
      prepareCapture: (sourceId: string) =>
        Promise<{ ok: true } | { ok: false; reason: string }>;
```

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

期待: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(preload): expose listCaptureSources / prepareCapture"
```

---

## Task 11: SourcePicker コンポーネント

**Files:**
- Create: `src/renderer/home/SourcePicker.tsx`

- [ ] **Step 1: 実装**

`src/renderer/home/SourcePicker.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface CaptureSourceOption {
  id: string;
  kind: 'screen' | 'window';
  label: string;
  displayId?: number;
}

export interface SourcePickerProps {
  value: string | null;
  onChange: (sourceId: string) => void;
  disabled?: boolean;
}

export function SourcePicker({ value, onChange, disabled }: SourcePickerProps): JSX.Element {
  const { t } = useTranslation();
  const [sources, setSources] = useState<CaptureSourceOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh(): Promise<void> {
    const list = await window.api.listCaptureSources();
    setSources(list);
    setLoaded(true);
    if (!value && list.length > 0) {
      const firstScreen = list.find((s) => s.kind === 'screen') ?? list[0];
      onChange(firstScreen.id);
    }
  }

  // 初回マウントで一度だけ取得して既定（プライマリ画面）を選ぶ
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const screens = sources.filter((s) => s.kind === 'screen');
  const windows = sources.filter((s) => s.kind === 'window');
  const current = sources.find((s) => s.id === value);

  return (
    <Select
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={disabled}
      onOpenChange={(open) => { if (open) void refresh(); }}
    >
      <SelectTrigger className="min-w-64">
        <SelectValue placeholder={t('home.source.placeholder')}>
          {current?.label ?? (loaded ? t('home.source.empty') : t('home.source.loading'))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {screens.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t('home.source.groupScreens')}</SelectLabel>
            {screens.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectGroup>
        )}
        {windows.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t('home.source.groupWindows')}</SelectLabel>
            {windows.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

期待: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/renderer/home/SourcePicker.tsx
git commit -m "feat(home): SourcePicker component for screen/window selection"
```

---

## Task 12: HomeScreen に SourcePicker を組み込む + 録画開始フロー更新

**Files:**
- Modify: `src/renderer/home/HomeScreen.tsx`

- [ ] **Step 1: import に SourcePicker を追加**

`src/renderer/home/HomeScreen.tsx` の `import { DependencyStatus } …` の手前に追加:

```tsx
import { SourcePicker } from './SourcePicker';
```

- [ ] **Step 2: state を追加**

`HomeScreen` 関数の既存 `useState` 群の末尾に追加:

```tsx
const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
```

- [ ] **Step 3: onStart を置換**

```tsx
async function onStart() {
  if (!selectedSourceId) {
    setStatus(t('home.source.notSelected'));
    return;
  }
  try {
    await window.api.notifyRecordingStarted();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const prep = await window.api.prepareCapture(selectedSourceId);
    if (!prep.ok) {
      await window.api.notifyRecordingStopped();
      setStatus(t(`home.source.prepareFailed.${prep.reason}`, { defaultValue: t('home.source.prepareFailed.generic') }));
      return;
    }

    const recorder = new ScreenRecorder();
    await recorder.start();
    await window.api.startRecording();
    recorderRef.current = recorder;
    setRecording(true);
    setStatus(t('home.statusRecording'));
  } catch (err) {
    await window.api.notifyRecordingStopped();
    recorderRef.current = null;
    setRecording(false);
    setStatus(t('home.recordStartFailed', { message: String(err) }));
  }
}
```

- [ ] **Step 4: Button 行を SourcePicker 同梱版に置換**

既存の `<div className="flex items-center gap-3">…</div>` ブロックを以下に置換:

```tsx
<div className="flex items-center gap-3">
  <Button
    onClick={recording ? onStop : onStart}
    variant={recording ? 'destructive' : 'default'}
    size="lg"
    disabled={!recording && !selectedSourceId}
  >
    {recording ? <Square className="size-4" /> : <Circle className="size-4 fill-current" />}
    {recording ? t('home.recordStop') : t('home.recordStart')}
  </Button>
  <SourcePicker
    value={selectedSourceId}
    onChange={setSelectedSourceId}
    disabled={recording}
  />
  <Button
    variant="secondary"
    onClick={() =>
      window.api
        .openProjectDialog()
        .then((r) => r && dispatch({ type: 'OPEN_PROJECT', projectDir: r.projectDir, project: r.project }))
    }
  >
    <FolderOpen className="size-4" />
    {t('home.openFromFolder')}
  </Button>
</div>
```

- [ ] **Step 5: typecheck**

```bash
npm run typecheck
```

期待: エラーなし

- [ ] **Step 6: 既存テスト全て PASS**

```bash
npm test
```

期待: 全 PASS

- [ ] **Step 7: コミット**

```bash
git add src/renderer/home/HomeScreen.tsx
git commit -m "feat(home): wire SourcePicker + prepareCapture into record flow"
```

---

## Task 13: i18n キー追加 + ハードコード fallback を i18n に差し替え

**Files:**
- Modify: `src/shared/i18n/locales/ja.json`
- Modify: `src/shared/i18n/locales/en.json`
- Modify: `src/main/ipc/captureSources.ts`

- [ ] **Step 1: ja.json に home.source を追加**

`src/shared/i18n/locales/ja.json` の `"home": { ... }` ブロックの最後（既存末尾の `"cancel": "キャンセル"` の直前にカンマを足してから）に追加:

```json
    "source": {
      "placeholder": "録画対象を選択",
      "loading": "読み込み中…",
      "empty": "対象が見つかりません",
      "groupScreens": "画面",
      "groupWindows": "ウィンドウ",
      "displayPrimary": "ディスプレイ {{n}}（プライマリ・{{w}}×{{h}}）",
      "display": "ディスプレイ {{n}}（{{w}}×{{h}}）",
      "notSelected": "録画対象を選択してください",
      "prepareFailed": {
        "generic": "録画対象の準備に失敗しました",
        "not-found": "選択された録画対象が見つかりません",
        "minimized": "選択されたウィンドウが最小化されています。復元してから録画してください",
        "bounds-failed": "ウィンドウの位置取得に失敗しました",
        "unsupported": "この OS ではウィンドウ単位の録画はサポートされていません"
      }
    },
```

- [ ] **Step 2: en.json に同等のキーを追加**

`src/shared/i18n/locales/en.json` の `"home"` ブロックに同じ構造で追加:

```json
    "source": {
      "placeholder": "Select capture target",
      "loading": "Loading…",
      "empty": "No targets found",
      "groupScreens": "Screens",
      "groupWindows": "Windows",
      "displayPrimary": "Display {{n}} (primary, {{w}}×{{h}})",
      "display": "Display {{n}} ({{w}}×{{h}})",
      "notSelected": "Please select a capture target",
      "prepareFailed": {
        "generic": "Failed to prepare capture target",
        "not-found": "Selected capture target is no longer available",
        "minimized": "The selected window is minimized. Please restore it and try again",
        "bounds-failed": "Failed to read window bounds",
        "unsupported": "Window-level capture is not supported on this OS"
      }
    },
```

- [ ] **Step 3: captureSources.ts のハードコード fallback を i18n に差し替え**

`src/main/ipc/captureSources.ts` の冒頭 import 群に追加:

```ts
import { t } from '../i18n';
```

`labelTemplates()` 関数を以下に置換:

```ts
function labelTemplates(): { displayPrimary: string; display: string } {
  return {
    displayPrimary: t('home.source.displayPrimary'),
    display: t('home.source.display'),
  };
}
```

- [ ] **Step 4: 既存 localeKeys テストがあれば PASS**

```bash
npm test -- localeKeys.test
```

期待: ja と en で同じキー集合（home.source.* 含む）になっていることを検査する既存テストが PASS

- [ ] **Step 5: テスト全体**

```bash
npm test
```

期待: 全 PASS

- [ ] **Step 6: コミット**

```bash
git add src/shared/i18n/locales/ja.json src/shared/i18n/locales/en.json src/main/ipc/captureSources.ts
git commit -m "i18n(home): add source picker strings (ja/en); use t() in main"
```

---

## Task 14: 手動 E2E（実機 Win11 + マルチモニタ環境）

ユニットテストでは検証不能な部分の手動確認。各項目に PASS/FAIL を記録し、結果を memory `clip2manual-capture-picker-status.md` に保存する。

- [ ] **E2E-1: 起動 → プルダウンに項目が並ぶ**
  - 「画面」セクションにディスプレイが 1 つ以上
  - プライマリには「プライマリ」表記
  - 「ウィンドウ」セクションにタイトル付きウィンドウが並ぶ（タイトル空は出ない）
  - clip2manual 自身は出ない
  - 初期選択がプライマリディスプレイ

- [ ] **E2E-2: プライマリ画面を選んで録画 → 旧フロー同等**
  - 録画開始→停止が成功
  - エディタが開く
  - クリック ◆ の位置が正しい
  - `clicks.json` に座標が記録されている

- [ ] **E2E-3: セカンダリ画面を選んで録画**（マルチモニタ環境のみ）
  - そのモニタで数か所クリック
  - エディタの ◆ がそのモニタの該当位置に立つ
  - プライマリで同位置をクリックした場合と区別できる

- [ ] **E2E-4: 特定ウィンドウ（メモ帳など）を選んで録画**
  - メモ帳内をクリック → ◆ がウィンドウ内座標に正しく立つ
  - 録画中にウィンドウをドラッグ移動 → 以降のクリックは「開始時のウィンドウ矩形」基準で記録される（仕様確認）
  - ウィンドウ外（タスクバー等）クリックが `clicks.json` に出ない

- [ ] **E2E-5: 異常系**
  - ウィンドウ選択後、prepareCapture 前にそのウィンドウを閉じる → status に「対象が見つかりません」相当が出て録画開始しない
  - 最小化中のウィンドウを選んで開始 → 「最小化されています」相当が出て録画が始まらない

- [ ] **E2E-6: 結果を memory に保存**
  ```
  Write file: ~/.claude/projects/.../memory/clip2manual-capture-picker-status.md
  MEMORY.md にエントリを追加
  ```

---

## Self-Review（計画者メモ）

1. **Spec coverage**:
   - 「Home にプルダウン」「全画面（=プライマリ画面）デフォルト」→ Task 11/12（SourcePicker + 初回 refresh で先頭 screen を選ぶ）
   - 「特定の画面選択時はそのエリアだけ録画」→ Task 8（setDisplayMediaRequestHandler が pending id 採用）
   - 「クリック座標の変換」→ Task 9（pending bounds → CaptureGeometry）
   - 「マルチモニタ」→ Task 6/7（displays 結合 + プライマリ表記 + Task 13 i18n）
   - エラー処理（not-found / minimized / bounds-failed / unsupported / getSources 失敗）→ Task 7 テスト + Task 13 i18n
   - 非目標（追従/ROI/サムネ）→ Plan に含めない（OK）

2. **Placeholder scan**: なし

3. **Type consistency**: `CaptureSource`/`PendingCapture`/`PendingCaptureBounds`/`takePendingCapture`/`takePendingCaptureSourceId`/`BoundsResolver` の名前と署名は Task 6〜12 で一貫

4. **scaleFactor の扱い**: 物理 px で揃える（screen は bounds*sf、window は GetWindowRect 直値）。`displayInfo.originX/Y` は DIP のままにするため pending.x / scaleFactor。Task 9 で明示。
