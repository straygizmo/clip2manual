# shadcn UI 全面ダークリデザイン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レンダラー UI を Tailwind v4 + shadcn/ui ベースに刷新し、プロNLE風ダークテーマで全面リデザインする（表示層のみ・ロジック無変更）。

**Architecture:** `@tailwindcss/vite` プラグインで Tailwind v4 を導入し、shadcn 部品を `src/renderer/components/ui` にコピー。NLEダーク配色は `src/renderer/index.css` の CSS 変数で一元管理。土台導入後、画面を1つずつ shadcn 化する（reducer / IPC / segmentOps / previewTimeline / RippleCanvas 描画は一切変更しない）。

**Tech Stack:** Electron + React 18 + TypeScript / electron-vite / Tailwind v4 / shadcn/ui / lucide-react / Vitest

**Branch:** `ui-shadcn-redesign`（master 起点・作成済み。spec コミット `2577cee` を含む）

**Spec:** `docs/superpowers/specs/2026-05-27-clip2manual-shadcn-ui-design.md`

---

## このプランの検証方針（重要）

UI は表示層のため TDD のユニットテストは作らない。各タスクの「検証」は以下の3点で行う:

1. `npm run typecheck` がクリーン（特に `@` エイリアス解決）
2. `npm run build` がクリーン
3. `npm run dev` で対象画面が描画され、操作（既存ハンドラ）が機能し、配色が統一されていること

既存 Vitest（`npm test`）はロジック専用で本作業の影響を受けないが、各タスクの最後に走らせて緑のままであることを確認する。

**全タスク共通の不変条件:** イベントハンドラ・state・props・`window.api` 呼び出し・条件分岐などのロジックは保持し、`style={{}}` を shadcn 部品 + Tailwind `className` に置換するだけにする。

---

## ファイル構成

新規作成:
- `components.json`（ルート） — shadcn 設定
- `src/renderer/index.css` — Tailwind 取り込み + NLEダークのテーマトークン
- `src/renderer/lib/utils.ts` — `cn()` ヘルパ
- `src/renderer/components/ui/*.tsx` — shadcn 部品（CLI が生成）

変更:
- `package.json` — 依存追加
- `electron.vite.config.ts` — renderer に tailwind プラグイン + `@` エイリアス
- `tsconfig.web.json` — `@/*` paths
- `src/renderer/main.tsx` — `index.css` を import
- `src/renderer/index.html` — `<html class="dark">`
- `src/renderer/home/HomeScreen.tsx`
- `src/renderer/editor/Inspector.tsx`
- `src/renderer/editor/EditorLayout.tsx`
- `src/renderer/editor/PreviewPlayer.tsx`
- `src/renderer/editor/Timeline.tsx`

---

## Task 1: 土台セットアップ（Tailwind v4 + shadcn 設定）

このタスク完了時点では **見た目は現状のまま**（インラインスタイル残置）。土台が機能することだけ確認する。

**Files:**
- Modify: `package.json`
- Modify: `electron.vite.config.ts`
- Modify: `tsconfig.web.json`
- Create: `src/renderer/index.css`
- Create: `src/renderer/lib/utils.ts`
- Create: `components.json`
- Modify: `src/renderer/main.tsx`
- Modify: `src/renderer/index.html`

- [ ] **Step 1: 依存を追加**

```bash
npm install tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react tw-animate-css
```

（Electron の renderer は vite がバンドルするため、これらは通常の `dependencies` でよい。ネイティブ依存ではないので `externalizeDepsPlugin` の影響を受けない。）

- [ ] **Step 2: `electron.vite.config.ts` の renderer に tailwind プラグインと `@` エイリアスを追加**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer') } },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react(), tailwindcss()],
  },
});
```

（main コメント冒頭のブロックコメントは保持してよい。上記は省略しているだけ。）

- [ ] **Step 3: `tsconfig.web.json` に `@/*` paths を追加**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": [],
    "outDir": "out/tsc",
    "paths": { "@/*": ["src/renderer/*"] }
  },
  "include": ["src/renderer", "src/shared"]
}
```

（`baseUrl` は `tsconfig.base.json` で `.` 設定済み。）

- [ ] **Step 4: `src/renderer/lib/utils.ts` を作成**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: `src/renderer/index.css` を作成（NLEダークのテーマトークン）**

ダーク固定。値は `:root` に直接定義し、`dark:` 変種のために `.dark` クラスも併記（同値）する。

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.5rem;
  --background: #1e1e1e;
  --foreground: #e0e0e0;
  --card: #252525;
  --card-foreground: #e0e0e0;
  --popover: #252525;
  --popover-foreground: #e0e0e0;
  --primary: #3b82f6;
  --primary-foreground: #ffffff;
  --secondary: #2f2f2f;
  --secondary-foreground: #e0e0e0;
  --muted: #2a2a2a;
  --muted-foreground: #9a9a9a;
  --accent: #333a4d;
  --accent-foreground: #e0e0e0;
  --destructive: #ef4444;
  --destructive-foreground: #ffffff;
  --border: #3a3a3a;
  --input: #3a3a3a;
  --ring: #3b82f6;

  /* エディタ専用トークン */
  --toolbar: #2a2a2a;
  --preview-bg: #000000;
  --timeline-bg: #111111;
  --timeline-track: #1b1b1b;
  --segment: #3a3a3a;
  --segment-selected: #4a90d9;
  --segment-playing: #2e8b57;
  --segment-border: #555555;
  --playhead: #ee5544;
  --click-marker: #e0a030;
}

.dark {
  --background: #1e1e1e;
  --foreground: #e0e0e0;
  --card: #252525;
  --card-foreground: #e0e0e0;
  --popover: #252525;
  --popover-foreground: #e0e0e0;
  --primary: #3b82f6;
  --primary-foreground: #ffffff;
  --secondary: #2f2f2f;
  --secondary-foreground: #e0e0e0;
  --muted: #2a2a2a;
  --muted-foreground: #9a9a9a;
  --accent: #333a4d;
  --accent-foreground: #e0e0e0;
  --destructive: #ef4444;
  --destructive-foreground: #ffffff;
  --border: #3a3a3a;
  --input: #3a3a3a;
  --ring: #3b82f6;
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-toolbar: var(--toolbar);
  --color-preview-bg: var(--preview-bg);
  --color-timeline-bg: var(--timeline-bg);
  --color-timeline-track: var(--timeline-track);
  --color-segment: var(--segment);
  --color-segment-selected: var(--segment-selected);
  --color-segment-playing: var(--segment-playing);
  --color-segment-border: var(--segment-border);
  --color-playhead: var(--playhead);
  --color-click-marker: var(--click-marker);
}

@layer base {
  * { border-color: var(--border); }
  html, body, #root { height: 100%; margin: 0; }
  body {
    background-color: var(--background);
    color: var(--foreground);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
}
```

- [ ] **Step 6: `components.json` をルートに作成**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 7: `src/renderer/main.tsx` で CSS を import**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 8: `src/renderer/index.html` の `<html>` に `dark` クラスを付与**

```html
<html lang="ja" class="dark">
```

- [ ] **Step 9: 検証（土台が機能し、無回帰であること）**

```bash
npm run typecheck
npm run build
```
Expected: どちらもエラーなく完了（`@` エイリアスが解決される）。

```bash
npm run dev
```
Expected: アプリが起動し、背景が `#1e1e1e` 系のダークになる（既存のインラインスタイル要素はそのまま。レイアウト崩れ・白画面が無いこと）。

- [ ] **Step 10: コミット**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig.web.json components.json src/renderer/index.css src/renderer/lib/utils.ts src/renderer/main.tsx src/renderer/index.html
git commit -m "feat(ui): add Tailwind v4 + shadcn foundation with NLE dark theme"
```

---

## Task 2: shadcn 部品を導入

**Files:**
- Create: `src/renderer/components/ui/*.tsx`（CLI 生成）

- [ ] **Step 1: 必要部品を一括追加**

```bash
npx shadcn@latest add button select slider textarea label card separator badge progress tooltip scroll-area sonner
```
（`components.json` の `aliases` と `tsconfig.web.json` の `paths` により `src/renderer/components/ui/` に配置され、Radix 依存が自動で `package.json` に追加される。プロンプトが出たら既定で進める。）

- [ ] **Step 2: 生成物の配置を確認**

`src/renderer/components/ui/` に `button.tsx`, `select.tsx`, `slider.tsx`, `textarea.tsx`, `label.tsx`, `card.tsx`, `separator.tsx`, `badge.tsx`, `progress.tsx`, `tooltip.tsx`, `scroll-area.tsx`, `sonner.tsx` が存在すること。

- [ ] **Step 3: 検証**

```bash
npm run typecheck
npm run build
```
Expected: エラーなく完了（生成された部品が `@/lib/utils` を正しく解決）。

- [ ] **Step 4: コミット**

```bash
git add src/renderer/components package.json package-lock.json
git commit -m "feat(ui): add shadcn primitives (button/select/slider/etc.)"
```

---

## Task 3: HomeScreen を shadcn 化

`src/renderer/home/HomeScreen.tsx` のロジック（録画/停止/開く/最近一覧の state とハンドラ）は保持し、JSX の `return` ブロックのみ置換する。

**Files:**
- Modify: `src/renderer/home/HomeScreen.tsx`

- [ ] **Step 1: import を追加（ファイル先頭の既存 import 群に追記）**

```tsx
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Circle, Square, FolderOpen, Play } from 'lucide-react';
```

- [ ] **Step 2: `return (...)` 全体を置換**

`recording ? onStop : onStart` などの既存ハンドラ・state（`recording`, `status`, `recent`, `open`）はそのまま使う。

```tsx
return (
  <div className="mx-auto max-w-3xl p-8">
    <h1 className="mb-6 text-2xl font-semibold tracking-tight">clip2manual</h1>
    <div className="flex items-center gap-3">
      <Button
        onClick={recording ? onStop : onStart}
        variant={recording ? 'destructive' : 'default'}
        size="lg"
      >
        {recording ? <Square className="size-4" /> : <Circle className="size-4 fill-current" />}
        {recording ? '停止して保存' : '録画開始'}
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          window.api
            .openProjectDialog()
            .then((r) => r && dispatch({ type: 'OPEN_PROJECT', projectDir: r.projectDir, project: r.project }))
        }
      >
        <FolderOpen className="size-4" />
        フォルダから開く
      </Button>
    </div>
    <p className="mt-3 text-sm text-muted-foreground">{status}</p>

    <h2 className="mt-8 mb-3 text-base font-medium">最近の録画</h2>
    {recent.length === 0 ? (
      <p className="text-sm text-muted-foreground">まだ録画がありません。</p>
    ) : (
      <div className="flex flex-col gap-2">
        {recent.map((r) => (
          <Card key={r.projectDir} className="flex flex-row items-center gap-3 p-3">
            <Button size="sm" variant="ghost" onClick={() => open(r.projectDir)}>
              <Play className="size-4" />
              開く
            </Button>
            <span className="font-medium">{r.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {new Date(r.createdAt).toLocaleString()}
            </span>
          </Card>
        ))}
      </div>
    )}
  </div>
);
```

- [ ] **Step 3: 検証**

```bash
npm run typecheck && npm run build
npm run dev
```
Expected: typecheck/build クリーン。ホーム画面がダークで描画され、録画開始→停止、フォルダから開く、最近一覧の「開く」が従来どおり機能する。

- [ ] **Step 4: コミット**

```bash
git add src/renderer/home/HomeScreen.tsx
git commit -m "feat(ui): restyle HomeScreen with shadcn"
```

---

## Task 4: Inspector を shadcn 化

`src/renderer/editor/Inspector.tsx` の全ロジック（`persist`, `onBlurText`, `revert`, `setVoice`, `applyOps`, `onToggleCut`, `onMerge`, `onSplit`, 各種派生値）は保持。`return (...)` の各要素を対応部品へ置換する。

**Files:**
- Modify: `src/renderer/editor/Inspector.tsx`

- [ ] **Step 1: import を追加**

```tsx
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Scissors, SplitSquareHorizontal, ArrowDownToLine, RotateCcw } from 'lucide-react';
```

- [ ] **Step 2: 要素を以下のマッピングで置換（ハンドラ・props は保持）**

- 「セグメントを選択してください」の空状態: `<div className="p-3 text-sm text-muted-foreground">…</div>`
- ルートの `<div style={{ padding: 12, fontSize: 13 }}>` → `<div className="p-3 text-sm">`
- 「編集済み」`<span>` → `<Badge variant="outline" className="ml-2">編集済み</Badge>`（`edited` の時のみ）
- 元の文字起こし表示ブロック（`background:#f5f5f5`）→ `<div className="whitespace-pre-wrap rounded-md bg-muted p-2 text-muted-foreground">…</div>`
- ラベル類（「補正テキスト」「声（話者）」「速度」等）→ `<Label className="text-muted-foreground">…</Label>`
- `<textarea>` → `<Textarea>`（`value` / `onChange` / `onBlur` / `disabled` / `rows={4}` を維持。`style` は削除し `className` 不要）

`<select>`（話者）は shadcn `Select` に置換。shadcn の `Select` は `onValueChange(value: string)` なので数値変換に注意:

```tsx
<Select
  value={String(segment.voice.speaker)}
  onValueChange={(v) => setVoice({ speaker: Number(v), speed: segment.voice.speed })}
  disabled={busy}
  onOpenChange={(open) => { if (open) onLoadSpeakers(); }}
>
  <SelectTrigger className="w-full">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {options.map((o) => (
      <SelectItem key={o.speaker} value={String(o.speaker)}>{o.label}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

`<input type="range">`（速度）→ shadcn `Slider`（配列 API に注意）:

```tsx
<Slider
  min={0.5} max={2} step={0.05}
  value={[segment.voice.speed]}
  onValueChange={([v]) => setVoice({ speaker: segment.voice.speaker, speed: v })}
  disabled={busy}
/>
```

- `<hr>` 区切り → `<Separator className="my-3" />`
- 「元に戻す」ボタン → `<Button variant="ghost" size="sm" onClick={revert} disabled={!edited || busy}><RotateCcw className="size-4" />元に戻す</Button>`
- 保存失敗 `<span>` → `<span className="text-xs text-destructive">保存に失敗しました</span>`
- 「生成 / 再生成」ボタン → `<Button size="sm" onClick={() => onGenerate(segment.id)} disabled={busy || segment.correctedText.trim() === ''}>{segment.ttsAudio ? '再生成' : '生成'}</Button>`
- 「生成済み / 未生成」`<span>` → `<span className={segment.ttsAudio ? 'text-xs text-primary' : 'text-xs text-muted-foreground'}>…</span>`
- セグメント操作ボタン群（`<div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>` → `<div className="flex flex-wrap gap-2">`）:
  - カット/有効化 → `<Button variant="outline" size="sm" onClick={onToggleCut}><Scissors className="size-4" />{segment.enabled ? 'カット' : '有効化'}</Button>`
  - 分割 → `<Button variant="outline" size="sm" onClick={onSplit} disabled={!canSplit}><SplitSquareHorizontal className="size-4" />分割（再生ヘッド位置）</Button>`
  - 次と結合 → `<Button variant="outline" size="sm" onClick={onMerge} disabled={isLast}><ArrowDownToLine className="size-4" />次と結合</Button>`
- カット中の注記 → `<div className="mt-1.5 text-xs text-amber-500">カット中（プレビュー/書き出しで除外）</div>`
- 「クリック N 件」→ `<div className="mt-2 text-xs text-muted-foreground">クリック {segment.clicks.length} 件</div>`
- `<audio controls>` はそのまま残し、`style={{ width:'100%' }}` を `className="w-full"` に変更。クレジット行は `className="mt-1 text-xs text-muted-foreground"`。

- [ ] **Step 3: 検証**

```bash
npm run typecheck && npm run build
npm run dev
```
Expected: typecheck/build クリーン。セグメント選択→テキスト編集（blur保存）、元に戻す、話者 Select、速度 Slider、生成、カット/分割/結合、音声プレビューが従来どおり機能。Select/Slider の値が数値として正しく反映される（speaker 切替・速度反映を実機確認）。

- [ ] **Step 4: コミット**

```bash
git add src/renderer/editor/Inspector.tsx
git commit -m "feat(ui): restyle Inspector with shadcn"
```

---

## Task 5: EditorLayout ツールバーを shadcn 化

`src/renderer/editor/EditorLayout.tsx` のロジック・effect・各 async 関数・grid レイアウト構造（`gridTemplateRows: '48px 1fr auto'` と `gridTemplateColumns: '1fr 320px'`）は保持。ツールバー内のコントロールと、中央/右ペインのコンテナ装飾のみ置換する。

**Files:**
- Modify: `src/renderer/editor/EditorLayout.tsx`

- [ ] **Step 1: import を追加**

```tsx
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, FileText, Mic, Download, X } from 'lucide-react';
```

- [ ] **Step 2: ルート grid とツールバーのコンテナ class 化**

- ルート: `<div className="grid h-screen grid-rows-[48px_1fr_auto]">`
- ツールバー: `<div className="flex flex-wrap items-center gap-2 bg-toolbar px-3 text-foreground">`

- [ ] **Step 3: ツールバー内コントロールを置換（ハンドラ保持）**

- 「← ホーム」→ `<Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}><ArrowLeft className="size-4" />ホーム</Button>`
- プロジェクト名 `<strong>` → `<span className="font-semibold">{project.meta.name}</span>`
- 文字起こしボタン → `<Button variant="secondary" size="sm" onClick={runTranscription} disabled={tx.status === 'running'}><FileText className="size-4" />{tx.status === 'running' ? `文字起こし中… ${tx.percent}%` : '文字起こし'}</Button>`
- 文字起こしキャンセル（running時）→ `<Button variant="ghost" size="sm" onClick={() => window.api.cancelTranscription()}><X className="size-4" />キャンセル</Button>`
- 文字起こしエラー → `<span className="text-xs text-destructive">失敗: {tx.error}</span>`
- `<Separator orientation="vertical" className="h-6" />` で論理グループを区切る（任意・見栄え用）
- 「既定の声」ラベル → `<span className="text-xs text-muted-foreground">既定の声</span>`
- 既定の声 `<select>` → shadcn `Select`（Task 4 と同じ数値変換パターン。`value={String(defaultSpeaker)}`, `onValueChange={(v) => setDefaultVoice({ speaker: Number(v), speed: defaultSpeed })}`, `onOpenChange` で `loadSpeakers()`。`SelectTrigger` に `className="h-8 w-40"`）
- 速度 `<input type=range>` → `<Slider className="w-32" min={0.5} max={2} step={0.05} value={[defaultSpeed]} onValueChange={([v]) => setDefaultVoice({ speaker: defaultSpeaker, speed: v })} disabled={ttsBusy} />`
- 「全セグメントに適用」→ `<Button variant="secondary" size="sm" onClick={applyDefaultToAll} disabled={ttsBusy}>全セグメントに適用</Button>`
- 「全セグメント生成」→ `<Button variant="secondary" size="sm" onClick={generateAll} disabled={ttsBusy}><Mic className="size-4" />{ttsBusy ? `生成中… ${tts.percent}%` : '全セグメント生成'}</Button>`
- TTS キャンセル/注記/エラーは文字起こしと同じパターン（ghost ボタン / `text-muted-foreground` / `text-destructive`）
- 書き出しボタン → `<Button size="sm" onClick={doExport} disabled={exportState.status === 'running'}><Download className="size-4" />{exportState.status === 'running' ? `書き出し中… ${exportState.percent}%` : '書き出し'}</Button>`
- 書き出しキャンセル → ghost ボタン（`<X />`）
- 書き出し完了 → `<span className="text-xs text-primary">{exportState.message}</span>`、失敗 → `<span className="text-xs text-destructive">書き出し失敗: {exportState.message}</span>`
- 進捗が動く処理（文字起こし/TTS/書き出し running 時）には、テキスト％に加えツールバー下端へ `<Progress value={tx.percent} className="h-1" />` 等を任意で配置可（YAGNI: テキスト％で足りるなら省略可）

- [ ] **Step 4: 中央/右ペインのコンテナを class 化**

- `<div style={{ display:'grid', gridTemplateColumns:'1fr 320px', minHeight:0 }}>` → `<div className="grid min-h-0 grid-cols-[1fr_320px]">`
- 右ペイン `<div style={{ borderLeft:'1px solid #ddd', overflow:'auto' }}>` → `<div className="overflow-auto border-l border-border">`

`<PreviewPlayer .../>`, `<Inspector .../>`, `<Timeline .../>` への props は変更しない。

- [ ] **Step 5: 検証**

```bash
npm run typecheck && npm run build
npm run dev
```
Expected: typecheck/build クリーン。ツールバーが濃グレーで整列し、文字起こし・既定の声 Select/Slider・全適用・全生成・書き出し・各キャンセルが従来どおり機能。進捗％表示が出る。

- [ ] **Step 6: コミット**

```bash
git add src/renderer/editor/EditorLayout.tsx
git commit -m "feat(ui): restyle EditorLayout toolbar with shadcn"
```

---

## Task 6: PreviewPlayer を shadcn 化

`src/renderer/editor/PreviewPlayer.tsx` の再生ロジック（`toggleOriginal`, `toggleTts`, `switchMode`, `resolveDuration`, `syncAudioTime` 等）と `<video>` / `<audio>` / `<RippleCanvas>` 要素・ハンドラは保持。下部のコントロールバーと外枠の装飾のみ置換する。

**Files:**
- Modify: `src/renderer/editor/PreviewPlayer.tsx`

- [ ] **Step 1: import を追加**

```tsx
import { Button } from '@/components/ui/button';
import { Play, Pause } from 'lucide-react';
```

- [ ] **Step 2: コンテナと `<video>` の style を class 化（要素・ハンドラは保持）**

- 外枠 `<div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#000' }}>` → `<div className="flex h-full flex-col bg-preview-bg">`
- 中央 `<div style={{ flex:1, ... }}>` → `<div className="flex flex-1 items-center justify-center overflow-hidden">`
- 映像ラッパ `<div style={{ position:'relative', display:'inline-block', ... }}>` → `<div className="relative inline-block max-h-full max-w-full">`
- `<video style={{ display:'block', maxWidth:'100%', maxHeight:'100%' }} ...>` → `<video className="block max-h-full max-w-full" ...>`（`ref`/`src`/全 `on*` ハンドラは保持）
- `<RippleCanvas .../>` と `<audio ref={audioRef} src={audioUrl} />` はそのまま。

- [ ] **Step 3: 下部コントロールバーを置換**

```tsx
<div className="flex flex-wrap items-center gap-3 bg-muted px-3 py-2 text-foreground">
  <Button size="sm" onClick={togglePlay} disabled={ttsLoading}>
    {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
    {playing ? '一時停止' : '再生'}
  </Button>
  <span className="text-xs text-muted-foreground">音声:</span>
  <Button size="sm" variant={mode === 'original' ? 'default' : 'secondary'}
    onClick={() => void switchMode('original')} disabled={mode === 'original' || ttsLoading}>
    元音声
  </Button>
  <Button size="sm" variant={mode === 'tts' ? 'default' : 'secondary'}
    onClick={() => void switchMode('tts')} disabled={mode === 'tts' || ttsLoading}>
    TTS
  </Button>
  {ttsLoading && <span className="text-xs text-muted-foreground">TTS読み込み中…</span>}
  {missing && <span className="text-xs text-amber-500">TTS未生成のセグメントは無音で再生されます</span>}
</div>
```

- [ ] **Step 4: 検証**

```bash
npm run typecheck && npm run build
npm run dev
```
Expected: typecheck/build クリーン。再生/一時停止、元音声↔TTS 切替、TTS読み込み表示、未生成警告が従来どおり。**リップル（RippleCanvas）が映像上に正しく重なって表示される**こと（描画ロジック未変更の確認）。

- [ ] **Step 5: コミット**

```bash
git add src/renderer/editor/PreviewPlayer.tsx
git commit -m "feat(ui): restyle PreviewPlayer controls with shadcn"
```

---

## Task 7: Timeline を再配色

`src/renderer/editor/Timeline.tsx` は shadcn 部品ではなく独自レイアウト。`seekFromEvent`, `row`, `segmentRect`, `timeToPercent`, 各種計算・ハンドラは保持し、インラインの色/レイアウト style を Tailwind トークン class に置換する。位置計算（`left`/`width`/`%` や `calc(...)`）は動的値なので `style` のまま残してよい。

**Files:**
- Modify: `src/renderer/editor/Timeline.tsx`

- [ ] **Step 1: `row` ヘルパの style を class 化**

```tsx
const row = (label: string, children: React.ReactNode) => (
  <div className="flex items-center" style={{ height: ROW_H }}>
    <div className="w-[90px] flex-shrink-0 text-xs text-muted-foreground">{label}</div>
    <div className="relative flex-1 bg-timeline-track" style={{ height: ROW_H }} onClick={seekFromEvent}>
      {children}
    </div>
  </div>
);
```

- [ ] **Step 2: ルート・セグメント・クリック・再生ヘッドの色を置換**

- ルート `<div style={{ position:'relative', padding:8, background:'#111' }}>` → `<div className="relative bg-timeline-bg p-2">`
- セグメント塊: 動的な `left`/`width`/`top`/`height` は `style` に残し、色は条件付き `className` で。背景色は `cn()` を使い分岐:

```tsx
import { cn } from '@/lib/utils';
// ...
<div
  key={s.id}
  onClick={(e) => { e.stopPropagation(); onSelect(s.id); }}
  title={s.correctedText}
  className={cn(
    'absolute overflow-hidden whitespace-nowrap rounded-sm border px-1 text-[11px] text-white cursor-pointer box-border',
    'border-segment-border',
    s.id === playingId ? 'bg-segment-playing' : s.id === selectedId ? 'bg-segment-selected' : 'bg-segment',
    s.enabled === false && 'opacity-35',
  )}
  style={{ top: 3, height: ROW_H - 6, left: `${r.left}%`, width: `${r.width}%` }}
>
  {s.correctedText}
</div>
```

- クリックマーカー: 色だけ class 化、位置は `style` 維持:

```tsx
<div
  key={i}
  className="absolute size-2 bg-click-marker"
  style={{ top: ROW_H / 2 - 4, left: `calc(${timeToPercent(c.t, duration)}% - 4px)`, transform: 'rotate(45deg)' }}
/>
```

- 再生ヘッド: 色だけ class 化、位置は `style` 維持:

```tsx
<div
  className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-playhead"
  style={{ left: `calc(90px + (100% - 90px) * ${timeToPercent(currentTime, duration) / 100})` }}
/>
```

- [ ] **Step 3: 検証**

```bash
npm run typecheck && npm run build
npm run dev
```
Expected: typecheck/build クリーン。タイムラインのトラック・セグメント（選択=青/再生中=緑/カット=半透明）・クリック菱形・青い再生ヘッドが正しい色で描画され、クリックでのシーク・セグメント選択が従来どおり機能。

- [ ] **Step 4: コミット**

```bash
git add src/renderer/editor/Timeline.tsx
git commit -m "feat(ui): recolor Timeline with NLE theme tokens"
```

---

## Task 8: Sonner トースト統合 + 最終仕上げ

書き出し完了/失敗などの一過性通知をトースト化し（任意）、残インラインスタイルの除去と全体検証を行う。

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/editor/EditorLayout.tsx`（任意のトースト化）

- [ ] **Step 1: `App.tsx` に Toaster を設置**

```tsx
import { EditorProvider, useEditor } from './state/editorStore';
import { HomeScreen } from './home/HomeScreen';
import { EditorLayout } from './editor/EditorLayout';
import { Toaster } from '@/components/ui/sonner';

function Router() {
  const { state } = useEditor();
  return state.screen === 'editor' ? <EditorLayout /> : <HomeScreen />;
}

export default function App() {
  return (
    <EditorProvider>
      <Router />
      <Toaster theme="dark" position="bottom-right" />
    </EditorProvider>
  );
}
```

- [ ] **Step 2: （任意）書き出し完了/失敗をトーストでも通知**

`EditorLayout.tsx` の `doExport` 内、成功/失敗時に `toast.success(...)` / `toast.error(...)` を追加（`import { toast } from 'sonner';`）。ツールバーのインライン完了/失敗表示は残しても、トーストに寄せて簡素化してもよい。

- [ ] **Step 3: 残インラインスタイル走査**

Grep ツール（または `npx rg "style={{" src/renderer`）で `style={{` を `src/renderer/**/*.tsx` から検索し、Task 3–7 で意図的に残した動的位置指定（Timeline の `left`/`width`/`top`/`height`、ROW_H 由来の height）以外に取り残しが無いか確認する。残っていれば該当タスクの方針で class 化する。

- [ ] **Step 4: 全体検証**

```bash
npm run typecheck
npm run build
npm test
```
Expected: 3つともクリーン（typecheck/build エラー無し、既存ユニットテスト緑）。

```bash
npm run dev
```
Expected（手動E2E）: ホーム→録画/開く、エディタの文字起こし・TTS生成（既定の声/速度/個別/全体）・セグメント操作（カット/分割/結合）・プレビュー再生（元音声/TTS、リップル表示）・タイムライン操作・書き出し（完了トースト）が一通り機能し、全画面がプロNLE風ダークで統一されていること。レイアウト崩れ・白浮き・操作不能要素が無いこと。

- [ ] **Step 5: コミット**

```bash
git add src/renderer/App.tsx src/renderer/editor/EditorLayout.tsx
git commit -m "feat(ui): add sonner toaster and finalize dark redesign"
```

---

## 完了の定義

- 全コンポーネントから固定色/レイアウトのインラインスタイルが除去され、shadcn 部品 + Tailwind トークンに統一されている（Timeline の動的位置指定 `style` のみ許容）。
- `npm run typecheck` / `npm run build` / `npm test` がクリーン。
- 手動E2Eで全機能が従来どおり動作し、プロNLE風ダークで見た目が統一されている。
- ロジック（reducer / IPC / segmentOps / previewTimeline / RippleCanvas 描画）は無変更。
