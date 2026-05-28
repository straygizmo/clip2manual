# 字幕表示機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレビュー(HTML/CSS) と書き出しMP4(ffmpeg焼き込み) に同じテキストの字幕を表示し、単一のプロジェクト設定 `showSubtitles` で切替えられるようにする。

**Architecture:** 共有純関数 `pickSubtitle` でテキスト選択ロジックを集約。プレビューは `<div>` overlay、書き出しは sharp で SVG→PNG を1スロット1枚生成し ffmpeg `overlay` フィルタで焼き込み（既存リップル方式と同じ）。日本語フォント (Noto Sans JP) は SVG 内に base64 `@font-face` で埋込み、`librsvg`/fontconfig 非依存にする。

**Tech Stack:** TypeScript, Electron (main/renderer 分離), React 18, Tailwind v4 + shadcn, Vitest, sharp 0.34, ffmpeg, electron-vite, i18next, electron-builder

**Spec:** `docs/superpowers/specs/2026-05-29-clip2manual-subtitles-design.md`

---

## File Structure

**Create:**
- `src/shared/subtitleSelect.ts` — `pickSubtitle` 純関数
- `src/main/export/subtitleWrap.ts` — `wrapJapanese` 純関数
- `src/main/export/subtitleSvg.ts` — `subtitleSvg` 純関数 (SVG文字列を返す)
- `src/main/export/subtitleFrames.ts` — `generateSubtitleFrameForSlot` I/O ラッパ
- `src/main/export/fontPaths.ts` — フォント絶対パス + base64 ロード
- `vendor/fonts/NotoSansJP-Regular.otf` — 同梱フォント
- `vendor/fonts/LICENSE` — OFL 1.1 ライセンス
- `test/subtitleSelect.test.ts`
- `test/subtitleWrap.test.ts`
- `test/subtitleSvg.test.ts`

**Modify:**
- `src/shared/types.ts` — `ProjectSettings.showSubtitles` 追加、`createProject` デフォルト、`validateProject` 正規化
- `src/renderer/audio/ttsPreview.ts` — `onSlotProgress` コールバック追加
- `src/renderer/editor/PreviewPlayer.tsx` — 字幕 overlay 追加、`onSlotProgress` 配線
- `src/renderer/editor/EditorLayout.tsx` — ツールバーに字幕トグル、`subtitleText` state 計算
- `src/renderer/editor/Inspector.tsx` — 変更なし（テキスト編集 UI は既存のまま）
- `src/main/export/ffargs.ts` — `segmentVideoArgs` に optional `subtitle` 引数追加
- `src/main/export/exportService.ts` — subtitle PNG 生成と引数組立て、`showSubtitles` 受取り
- `src/main/ipc/export.ts` — `runExport` に `project.settings.showSubtitles` を渡す
- `src/shared/i18n/locales/ja.json`, `en.json` — 字幕関連キー追加
- `tsconfig.node.json` — 新しい純関数/ファイルを include に追加
- `electron-vite.config.ts` または `electron-builder` 設定 — `vendor/fonts/` を extraResources へ
- `package.json` — `electron-builder` の `build.extraResources` を追加（既存ならエントリ追加）
- `test/validateProject.test.ts` — `showSubtitles` 正規化テストを追加
- `test/exportService.test.ts` — subtitle 統合テスト追加
- `test/ffargs.test.ts` — subtitle 引数テスト追加

---

## Task 1: ProjectSettings.showSubtitles を追加 + 正規化

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `test/validateProject.test.ts`

- [ ] **Step 1: validateProject の正規化テストを追加（失敗させる）**

`test/validateProject.test.ts` の末尾 `describe('validateProject', () => { ... })` 内に追加:

```typescript
  it('defaults showSubtitles to true when missing', () => {
    const { showSubtitles, ...rest } = valid.settings;
    const input = { ...valid, settings: rest };
    const out = validateProject(input);
    expect(out.settings.showSubtitles).toBe(true);
  });

  it('preserves explicit showSubtitles=false', () => {
    const input = { ...valid, settings: { ...valid.settings, showSubtitles: false } };
    const out = validateProject(input);
    expect(out.settings.showSubtitles).toBe(false);
  });

  it('coerces non-boolean showSubtitles to true', () => {
    const input = { ...valid, settings: { ...valid.settings, showSubtitles: 'yes' as unknown as boolean } };
    const out = validateProject(input);
    expect(out.settings.showSubtitles).toBe(true);
  });
```

- [ ] **Step 2: 実行して fail を確認**

```
npx vitest run test/validateProject.test.ts
```
Expected: 3つの新規テストが fail（`createProject` がまだ `showSubtitles` を出さない or `validateProject` が正規化しない）。

- [ ] **Step 3: types.ts を更新**

`src/shared/types.ts` の `ProjectSettings` インターフェースに追加:

```typescript
export interface ProjectSettings {
  highlightStyle: HighlightStyle;
  timingMode: TimingMode;
  llm: LLMSettings;
  tts: TTSSettings;
  showSubtitles: boolean;
}
```

`createProject` の `settings` リテラルに `showSubtitles: true` を追加:

```typescript
    settings: {
      highlightStyle: 'ripple',
      timingMode: 'video-follows-audio',
      llm: { provider: 'anthropic', model: 'claude-opus-4-7' },
      tts: { defaultSpeaker: 3, defaultSpeed: 1.0 },
      showSubtitles: true,
    },
```

`validateProject` の関数本体を以下に置き換える（既存の throw チェックは保持し、最後に正規化して新オブジェクトを返す）:

```typescript
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
  const settings = p.settings as Record<string, unknown>;
  const normalizedSettings = {
    ...settings,
    showSubtitles: typeof settings.showSubtitles === 'boolean' ? settings.showSubtitles : true,
  };
  return { ...(value as Project), settings: normalizedSettings as ProjectSettings };
}
```

- [ ] **Step 4: 実行して pass を確認**

```
npx vitest run test/validateProject.test.ts
```
Expected: 全件パス。

- [ ] **Step 5: 既存テスト「returns the project unchanged when valid」が新挙動と整合か確認**

既存テストは `expect(validateProject(valid)).toBe(valid)` だが、上の変更で **新オブジェクトを返す** ようになるため fail する。修正:

```typescript
  it('returns the project equivalently when valid', () => {
    const out = validateProject(valid);
    expect(out).toEqual(valid);
  });
```

`npx vitest run test/validateProject.test.ts` 再実行 → 全件パス。

- [ ] **Step 6: typecheck 通過確認**

```
npm run typecheck
```
Expected: エラーなし。

- [ ] **Step 7: コミット**

```
git add src/shared/types.ts test/validateProject.test.ts
git commit -m "feat(types): add ProjectSettings.showSubtitles with default true and back-compat normalization"
```

---

## Task 2: shared/subtitleSelect.ts — pickSubtitle 純関数

**Files:**
- Create: `src/shared/subtitleSelect.ts`
- Create: `test/subtitleSelect.test.ts`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: テストを書く**

`test/subtitleSelect.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { pickSubtitle } from '../src/shared/subtitleSelect';
import { type Segment } from '../src/shared/types';

function seg(id: string, vs: number, ve: number, corrected: string, original = ''): Segment {
  return {
    id, videoStart: vs, videoEnd: ve, originalText: original, correctedText: corrected,
    ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}

const segs = [
  seg('a', 0, 2, 'hello'),
  seg('b', 2, 4, ''),                       // 補正空
  seg('c', 4, 6, '', 'original-c'),         // 補正空＝原文
  seg('d', 6, 8, '   '),                    // 空白のみ＝null
  { ...seg('e', 8, 10, 'cut'), enabled: false },
];

describe('pickSubtitle', () => {
  it('returns null when showSubtitles is false', () => {
    expect(pickSubtitle({
      segments: segs, showSubtitles: false, mode: 'original',
      cursor: { kind: 'original', videoTime: 1 },
    })).toBeNull();
  });

  describe('original mode', () => {
    it('returns correctedText when within [videoStart, videoEnd)', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 1 },
      })).toBe('hello');
    });

    it('falls back to originalText when correctedText is empty', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 5 },
      })).toBe('original-c');
    });

    it('returns null when both texts are empty/whitespace', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 3 },   // segment b: both empty
      })).toBeNull();
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 7 },   // segment d: whitespace
      })).toBeNull();
    });

    it('skips disabled segments', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 9 },   // segment e: disabled
      })).toBeNull();
    });

    it('treats videoEnd as exclusive', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 2 },   // belongs to b, not a
      })).toBeNull();
    });

    it('returns null when no segment contains the time', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 100 },
      })).toBeNull();
    });
  });

  describe('tts mode', () => {
    it('returns text while offsetInSlot < visibleDuration', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'a', offsetInSlot: 1, visibleDuration: 2 },
      })).toBe('hello');
    });

    it('returns null once offsetInSlot >= visibleDuration (freeze/tail)', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'a', offsetInSlot: 2, visibleDuration: 2 },
      })).toBeNull();
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'a', offsetInSlot: 2.5, visibleDuration: 2 },
      })).toBeNull();
    });

    it('returns null when slotId is not found', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'nope', offsetInSlot: 0, visibleDuration: 2 },
      })).toBeNull();
    });

    it('returns null when both texts are empty', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'b', offsetInSlot: 0, visibleDuration: 2 },
      })).toBeNull();
    });
  });
});
```

- [ ] **Step 2: 実行して fail を確認**

```
npx vitest run test/subtitleSelect.test.ts
```
Expected: 「Cannot find module '../src/shared/subtitleSelect'」で全件 fail。

- [ ] **Step 3: 実装**

`src/shared/subtitleSelect.ts`:

```typescript
import { type Segment } from './types';

export type SubtitleCursor =
  | { kind: 'original'; videoTime: number }
  | { kind: 'tts'; slotId: string; offsetInSlot: number; visibleDuration: number };

export interface SubtitleSelectInput {
  segments: Segment[];
  showSubtitles: boolean;
  mode: 'original' | 'tts';
  cursor: SubtitleCursor;
}

function textOf(seg: Segment): string | null {
  const c = seg.correctedText.trim();
  if (c !== '') return c;
  const o = seg.originalText.trim();
  if (o !== '') return o;
  return null;
}

/**
 * 現在の再生位置・モードから、表示すべき字幕テキストを決める純関数。
 * 表示しない場合は null。
 */
export function pickSubtitle(input: SubtitleSelectInput): string | null {
  if (!input.showSubtitles) return null;
  if (input.cursor.kind === 'original') {
    const t = input.cursor.videoTime;
    const seg = input.segments.find((s) => s.enabled !== false && t >= s.videoStart && t < s.videoEnd);
    return seg ? textOf(seg) : null;
  }
  if (input.cursor.kind === 'tts') {
    if (input.cursor.offsetInSlot >= input.cursor.visibleDuration) return null;
    const seg = input.segments.find((s) => s.id === input.cursor.slotId);
    return seg ? textOf(seg) : null;
  }
  return null;
}
```

- [ ] **Step 4: tsconfig.node.json の include に追加**

`tsconfig.node.json` の `include` 配列に追加（test/ は既にカバー）:

```json
    "src/shared/subtitleSelect.ts",
```

具体的には `"src/main/provision/status.ts",` の直後に挿入。

- [ ] **Step 5: 実行して pass を確認**

```
npx vitest run test/subtitleSelect.test.ts
npm run typecheck
```
Expected: 全件パス、typecheck エラーなし。

- [ ] **Step 6: コミット**

```
git add src/shared/subtitleSelect.ts test/subtitleSelect.test.ts tsconfig.node.json
git commit -m "feat(subtitles): add pickSubtitle pure function for preview and export"
```

---

## Task 3: TtsPreviewController に onSlotProgress を追加

**Files:**
- Modify: `src/renderer/audio/ttsPreview.ts`

> 本ファイルは Web Audio / DOM 依存のため単体テスト無し（既存方針どおり）。tick の純関数化は範囲外。typecheck と E2E で検証する。

- [ ] **Step 1: コールバック型を追加**

`src/renderer/audio/ttsPreview.ts` の `TtsPreviewCallbacks` インターフェースに以下を追加（他コールバックの並びに合わせる）:

```typescript
export interface SlotProgressHint {
  slotId: string;
  offsetInSlot: number;
  visibleDuration: number;  // = clipDuration > 0 ? clipDuration : videoSpan
}

export interface TtsPreviewCallbacks {
  onActiveSegment?: (segmentId: string | null) => void;
  onTime?: (videoTime: number) => void;
  onEnded?: () => void;
  /** rAF 毎に現スロットの進捗を通知。フリーズ/tail/停止中は null。 */
  onSlotProgress?: (hint: SlotProgressHint | null) => void;
}
```

- [ ] **Step 2: tick から onSlotProgress を発火させる**

`tick` メソッド内、`if (slot) { ... }` ブロック内の `this.cb.onTime?.(...)` の直後に挿入:

```typescript
      const visibleDuration = slot.clipDuration > 0 ? slot.clipDuration : videoSpan;
      this.cb.onSlotProgress?.({ slotId: slot.segmentId, offsetInSlot: offset, visibleDuration });
```

ブロック外（`if (slot)` の else 相当：slotAt が null を返したとき）でも null を発火させる。`if (slot) { ... }` の閉じ括弧の直後に以下を追加:

```typescript
    } else {
      this.cb.onSlotProgress?.(null);
    }
```

- [ ] **Step 3: stop/finish/pause/dispose で null 発火を保証**

`stop()` メソッド内、`this.cb.onActiveSegment?.(null);` の直後に追加（条件分岐の中なので適切な位置を選ぶ）。具体的には、`stop()` の `if (this.activeId !== null)` 分岐の直後、`if (this.ctx && ...)` の前に:

```typescript
    this.cb.onSlotProgress?.(null);
```

`finish()` 内、`this.cb.onActiveSegment?.(null);` の直後に同じ行を追加。

`pause()` 内では、関数末尾（`this.video?.pause();` の後）に追加:

```typescript
    this.cb.onSlotProgress?.(null);
```

- [ ] **Step 4: typecheck 通過確認**

```
npm run typecheck
```
Expected: エラーなし。

- [ ] **Step 5: 既存テスト全件パス確認**

```
npm test
```
Expected: 既存128件以上が全件パス。

- [ ] **Step 6: コミット**

```
git add src/renderer/audio/ttsPreview.ts
git commit -m "feat(tts-preview): add onSlotProgress hint callback for subtitle timing"
```

---

## Task 4: PreviewPlayer に字幕オーバーレイを追加

**Files:**
- Modify: `src/renderer/editor/PreviewPlayer.tsx`

- [ ] **Step 1: Props を拡張**

`src/renderer/editor/PreviewPlayer.tsx` の `interface Props` に追加:

```typescript
  /** 字幕表示テキスト。null/空文字で非表示。EditorLayout 側で pickSubtitle 結果が渡される。 */
  subtitleText: string | null;
  /** TTS モード進捗のフォワード（EditorLayout が pickSubtitle 引数に使う）。 */
  onSlotProgress: (hint: { slotId: string; offsetInSlot: number; visibleDuration: number } | null) => void;
```

- [ ] **Step 2: 関数引数に取り込む**

`export function PreviewPlayer({ ... }: Props)` の分割代入リストに `subtitleText, onSlotProgress` を追加。

- [ ] **Step 3: コントローラ生成時に onSlotProgress を配線**

`onActiveRef`/`onTimeRef` と同じパターンで `onSlotProgressRef` を用意する。既存:

```typescript
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
```

の直後に追加:

```typescript
  const onSlotProgressRef = useRef(onSlotProgress);
  onSlotProgressRef.current = onSlotProgress;
```

`new TtsPreviewController({...})` の callbacks に追加:

```typescript
    controllerRef.current = new TtsPreviewController({
      onActiveSegment: (id) => onActiveRef.current(id),
      onTime: (t) => onTimeRef.current(t),
      onSlotProgress: (h) => onSlotProgressRef.current(h),
      onEnded: () => setPlaying(false),
    });
```

- [ ] **Step 4: 字幕オーバーレイ <div> を映像コンテナ内に追加**

JSX 内、`<RippleCanvas videoRef={videoRef} clicks={clicks} />` の直後に追加:

```tsx
          {subtitleText && (
            <div
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-pre-wrap break-words rounded px-3 py-1 text-center font-semibold text-white"
              style={{
                bottom: '8%',
                maxWidth: '80%',
                background: 'rgba(0, 0, 0, 0.55)',
                fontSize: 'clamp(14px, 3.5vh, 32px)',
                lineHeight: 1.3,
                textShadow: '0 0 2px black, 0 0 3px black',
                fontFamily: 'system-ui, -apple-system, "Yu Gothic UI", "Meiryo", sans-serif',
              }}
            >
              {subtitleText}
            </div>
          )}
```

- [ ] **Step 5: typecheck 通過確認**

```
npm run typecheck
```
Expected: エラーなし（EditorLayout 側で新 prop を渡していないため呼出し側 typecheck が落ちるはず → 次タスクで解決）。

→ ここでは PreviewPlayer 単体のコンパイル可否のみを見るため、エラーは「呼出側の prop 不足」のみであることを確認する。

- [ ] **Step 6: コミット**

```
git add src/renderer/editor/PreviewPlayer.tsx
git commit -m "feat(preview): add subtitle overlay div driven by subtitleText prop"
```

---

## Task 5: EditorLayout に字幕トグル UI + pickSubtitle 配線

**Files:**
- Modify: `src/renderer/editor/EditorLayout.tsx`
- Modify: `src/shared/i18n/locales/ja.json`
- Modify: `src/shared/i18n/locales/en.json`

- [ ] **Step 1: i18n キーを追加**

`src/shared/i18n/locales/ja.json` の `editor` オブジェクト末尾（`"exportDoneMessage"` の後ろ、 `}` の前）に追加（前の行末カンマを忘れない）:

```json
    "exportDoneMessage": "書き出し完了: {{path}}（{{credit}}）",
    "showSubtitles": "字幕",
    "showSubtitlesTooltip": "プレビューと書き出しMP4に字幕を表示します"
```

`src/shared/i18n/locales/en.json` に対応するキーを追加:

```json
    "exportDoneMessage": "Exported: {{path}} ({{credit}})",
    "showSubtitles": "Subtitles",
    "showSubtitlesTooltip": "Show subtitles in preview and exported MP4"
```

- [ ] **Step 2: localeKeys テスト通過確認**

```
npx vitest run test/localeKeys.test.ts
```
Expected: ja と en のキー集合が一致、placeholder 一致。

- [ ] **Step 3: EditorLayout で pickSubtitle 用 state と関数を追加**

`src/renderer/editor/EditorLayout.tsx` の import を拡張:

```typescript
import { pickSubtitle } from '../../shared/subtitleSelect';
import { Subtitles } from 'lucide-react';
```

`EditorLayout` 関数内、既存 `const [playingId, setPlayingId] = useState<string | null>(null);` の直後に追加:

```typescript
  const [slotHint, setSlotHint] = useState<{ slotId: string; offsetInSlot: number; visibleDuration: number } | null>(null);
  const onSlotProgress = useCallback((h: { slotId: string; offsetInSlot: number; visibleDuration: number } | null) => setSlotHint(h), []);
```

`project` 取得後、`const segments = project.segments;` の直後に追加:

```typescript
  const showSubtitles = project.settings.showSubtitles;
  const subtitleText = pickSubtitle(
    slotHint
      ? { segments, showSubtitles, mode: 'tts', cursor: { kind: 'tts', ...slotHint } }
      : { segments, showSubtitles, mode: 'original', cursor: { kind: 'original', videoTime: state.currentTime } },
  );

  function setShowSubtitles(next: boolean) {
    void window.api.updateSettings({ ...project!.settings, showSubtitles: next });
  }
```

> 注: state は `useReducer` 経由なので即時には反映されないが、`updateSettings` が `project.json` に保存し、次回 `project:open`/状態同期で反映される。即時反映のため `dispatch({ type: 'SET_SETTINGS', settings })` を将来追加する場合は本タスクの範囲外。

- [ ] **Step 4: ツールバーに「字幕」チェックボックスを追加**

`EditorLayout.tsx` のツールバー内、`</Button>` の `applyDefaultToAll` 直後、`<Separator orientation="vertical" className="h-6" />` の前に挿入:

```tsx
        <Separator orientation="vertical" className="h-6" />

        <label className="flex items-center gap-1 text-xs" title={t('editor.showSubtitlesTooltip')}>
          <Subtitles className="size-4" />
          <input
            type="checkbox"
            checked={showSubtitles}
            onChange={(e) => setShowSubtitles(e.currentTarget.checked)}
            className="size-4"
          />
          {t('editor.showSubtitles')}
        </label>
```

- [ ] **Step 5: PreviewPlayer に新 prop を渡す**

`<PreviewPlayer ...>` の props に追加:

```tsx
          subtitleText={subtitleText}
          onSlotProgress={onSlotProgress}
```

- [ ] **Step 6: 状態同期のために project を再読込する**

`setShowSubtitles` の後、`window.api.updateSettings(...)` の戻りで現在の state を更新するために、`OPEN_PROJECT` を再 dispatch する手は冗長。代わりに editorReducer に簡易 action を1つ追加する:

`src/renderer/state/editorReducer.ts` の `EditorAction` 型に追加:

```typescript
  | { type: 'SET_SETTINGS'; settings: ProjectSettings };
```

`import` を拡張:

```typescript
import { type Project, type Segment, type SegmentVoice, type ProjectSettings } from '../../shared/types';
```

`switch` ケースを `SET_DEFAULT_VOICE` の直前に追加:

```typescript
    case 'SET_SETTINGS':
      if (!state.project) return state;
      return {
        ...state,
        project: { ...state.project, settings: action.settings },
      };
```

`EditorLayout.tsx` の `setShowSubtitles` を以下に変更:

```typescript
  function setShowSubtitles(next: boolean) {
    const settings = { ...project!.settings, showSubtitles: next };
    dispatch({ type: 'SET_SETTINGS', settings });
    void window.api.updateSettings(settings);
  }
```

- [ ] **Step 7: typecheck 通過確認**

```
npm run typecheck
npm test
```
Expected: 全件パス。

- [ ] **Step 8: コミット**

```
git add src/renderer/editor/EditorLayout.tsx src/renderer/state/editorReducer.ts src/shared/i18n/locales/ja.json src/shared/i18n/locales/en.json
git commit -m "feat(editor): wire pickSubtitle into PreviewPlayer and add subtitles toggle in toolbar"
```

---

## Task 6: main/export/subtitleWrap.ts — 日本語ラップ純関数

**Files:**
- Create: `src/main/export/subtitleWrap.ts`
- Create: `test/subtitleWrap.test.ts`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: テストを書く**

`test/subtitleWrap.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { wrapJapanese } from '../src/main/export/subtitleWrap';

describe('wrapJapanese', () => {
  it('returns empty array for empty string', () => {
    expect(wrapJapanese('', 10, 3)).toEqual([]);
    expect(wrapJapanese('   ', 10, 3)).toEqual([]);
  });

  it('returns a single line when within maxCols (halfwidth)', () => {
    expect(wrapJapanese('hello', 10, 3)).toEqual(['hello']);
  });

  it('wraps halfwidth text at maxCols boundary', () => {
    expect(wrapJapanese('abcdefghij', 5, 3)).toEqual(['abcde', 'fghij']);
  });

  it('counts fullwidth chars as 2 columns', () => {
    // 「あいう」= 6 cols, maxCols=5 → 「あい」(4) + 「う」(2)
    expect(wrapJapanese('あいう', 5, 3)).toEqual(['あい', 'う']);
  });

  it('handles mixed halfwidth/fullwidth', () => {
    // 「ab漢字cd」: a=1, b=1, 漢=2, 字=2, c=1, d=1 (total 8). maxCols=5 → 'ab漢' (4) + '字cd' (4)
    expect(wrapJapanese('ab漢字cd', 5, 3)).toEqual(['ab漢', '字cd']);
  });

  it('truncates with ellipsis when exceeding maxLines', () => {
    const out = wrapJapanese('aaaaabbbbbcccccddddd', 5, 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('aaaaa');
    expect(out[1]).toBe('bbbbb');
    expect(out[2].endsWith('…')).toBe(true);
  });

  it('preserves emoji as one grapheme (counted as 2 cols)', () => {
    // 「a😀b」: a=1, 😀=2, b=1 (total 4). maxCols=5 → 1 line
    expect(wrapJapanese('a😀b', 5, 3)).toEqual(['a😀b']);
    // maxCols=3 → 'a😀' (3) + 'b' (1)
    expect(wrapJapanese('a😀b', 3, 3)).toEqual(['a😀', 'b']);
  });
});
```

- [ ] **Step 2: 実行して fail を確認**

```
npx vitest run test/subtitleWrap.test.ts
```
Expected: モジュール未存在で fail。

- [ ] **Step 3: 実装**

`src/main/export/subtitleWrap.ts`:

```typescript
/**
 * テキストを行配列に分割する。
 * 全角・絵文字は 2 cols、それ以外は 1 col とし、maxCols を超えないように 1 グラフェムずつ詰める。
 * maxLines を超えたら最終行末尾を「…」で打切り。
 */
export function wrapJapanese(text: string, maxCols: number, maxLines: number): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  const graphemes = Array.from(segmenter.segment(trimmed), (s) => s.segment);

  const colWidth = (g: string): number => {
    // ASCII 印字可能範囲は 1、それ以外は全角扱いで 2（絵文字含む）
    const cp = g.codePointAt(0) ?? 0;
    if (cp < 0x7f && g.length === 1) return 1;
    return 2;
  };

  const lines: string[] = [];
  let cur = '';
  let curCols = 0;
  for (const g of graphemes) {
    const w = colWidth(g);
    if (curCols + w > maxCols && cur !== '') {
      lines.push(cur);
      cur = '';
      curCols = 0;
    }
    cur += g;
    curCols += w;
  }
  if (cur !== '') lines.push(cur);

  if (lines.length <= maxLines) return lines;
  const truncated = lines.slice(0, maxLines);
  // 最後の行に「…」を追加（はみ出すなら末尾グラフェムを置換）
  const lastLine = truncated[maxLines - 1];
  const lastGraphemes = Array.from(segmenter.segment(lastLine), (s) => s.segment);
  let cols = 0;
  for (const g of lastGraphemes) cols += colWidth(g);
  if (cols + 1 <= maxCols) {
    truncated[maxLines - 1] = lastLine + '…';
  } else {
    // 末尾グラフェムを「…」と置き換え
    truncated[maxLines - 1] = lastGraphemes.slice(0, -1).join('') + '…';
  }
  return truncated;
}
```

- [ ] **Step 4: tsconfig.node.json の include に追加**

`tsconfig.node.json` の `include` に追加:

```json
    "src/main/export/subtitleWrap.ts",
```

`"src/main/provision/status.ts",` の直後に挿入。

- [ ] **Step 5: 実行して pass を確認**

```
npx vitest run test/subtitleWrap.test.ts
npm run typecheck
```
Expected: 全件パス、typecheck エラーなし。

- [ ] **Step 6: コミット**

```
git add src/main/export/subtitleWrap.ts test/subtitleWrap.test.ts tsconfig.node.json
git commit -m "feat(export): add wrapJapanese pure function for subtitle line wrapping"
```

---

## Task 7: Noto Sans JP フォントを同梱

**Files:**
- Create: `vendor/fonts/NotoSansJP-Regular.otf`
- Create: `vendor/fonts/LICENSE`
- Modify: `package.json`

- [ ] **Step 1: フォントファイルを取得**

Google Fonts または `https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansJP-Regular.otf` から `NotoSansJP-Regular.otf` (5MB前後) を `vendor/fonts/NotoSansJP-Regular.otf` として配置。

```
mkdir -p vendor/fonts
# 手動でファイルを配置する。コマンドの例（環境依存）:
# Invoke-WebRequest -OutFile vendor/fonts/NotoSansJP-Regular.otf https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansJP-Regular.otf
```

- [ ] **Step 2: LICENSE 同梱**

`vendor/fonts/LICENSE` に SIL Open Font License Version 1.1 の全文を配置。Noto Sans JP のリポジトリの `LICENSE` 内容をそのままコピーする。

> 参照: `https://github.com/notofonts/noto-cjk/raw/main/Sans/LICENSE`

- [ ] **Step 3: フォントファイルが実在することを確認**

```
ls -la vendor/fonts/
```
Expected: `NotoSansJP-Regular.otf` （>= 4MB）と `LICENSE` が存在する。

- [ ] **Step 4: package.json に electron-builder の extraResources を追加**

`package.json` の `dependencies` の後ろに `build` セクションを追加（既存に build フィールドが無い前提）:

```json
  "build": {
    "extraResources": [
      { "from": "vendor/fonts", "to": "fonts" }
    ]
  }
```

> 既存に `build` セクションがある場合は、`extraResources` 配列に上のオブジェクトを追加。

- [ ] **Step 5: typecheck + 既存テスト通過確認**

```
npm run typecheck
npm test
```
Expected: 全件パス。

- [ ] **Step 6: コミット（フォント自体は大きいので Git LFS を考慮するかは別途検討。今回は通常コミット）**

```
git add vendor/fonts/NotoSansJP-Regular.otf vendor/fonts/LICENSE package.json
git commit -m "chore(fonts): bundle Noto Sans JP Regular under OFL for subtitle burn-in"
```

---

## Task 8: fontPaths.ts — フォントパス + base64 ロード

**Files:**
- Create: `src/main/export/fontPaths.ts`

- [ ] **Step 1: 実装**

`src/main/export/fontPaths.ts`:

```typescript
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';

const FONT_FILENAME = 'NotoSansJP-Regular.otf';

let cachedBase64: string | null = null;

/** 開発: <repo>/vendor/fonts/<f>、本番: process.resourcesPath/fonts/<f>。 */
export function resolveSubtitleFontPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'fonts', FONT_FILENAME);
  }
  return path.join(app.getAppPath(), 'vendor', 'fonts', FONT_FILENAME);
}

/** 1回のみ読込み base64 をキャッシュ。 */
export async function loadSubtitleFontBase64(): Promise<string> {
  if (cachedBase64 !== null) return cachedBase64;
  const buf = await fs.readFile(resolveSubtitleFontPath());
  cachedBase64 = buf.toString('base64');
  return cachedBase64;
}

/** テスト用にキャッシュをリセット。 */
export function resetSubtitleFontCache(): void {
  cachedBase64 = null;
}
```

- [ ] **Step 2: typecheck 通過確認**

```
npm run typecheck
```
Expected: エラーなし。

> 単体テストは `app` を import するため省略（既存の `ffmpegPaths.ts` と同方針）。E2E で検証。

- [ ] **Step 3: コミット**

```
git add src/main/export/fontPaths.ts
git commit -m "feat(export): resolve and cache base64 of bundled subtitle font"
```

---

## Task 9: main/export/subtitleSvg.ts — SVG 生成

**Files:**
- Create: `src/main/export/subtitleSvg.ts`
- Create: `test/subtitleSvg.test.ts`
- Modify: `tsconfig.node.json`

- [ ] **Step 1: テストを書く**

`test/subtitleSvg.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { subtitleSvg } from '../src/main/export/subtitleSvg';

const fakeFont = 'AABBCC';   // base64 ダミー

describe('subtitleSvg', () => {
  it('returns null for empty or whitespace text', () => {
    expect(subtitleSvg({ text: '', videoW: 1920, videoH: 1080, fontBase64: fakeFont })).toBeNull();
    expect(subtitleSvg({ text: '   ', videoW: 1920, videoH: 1080, fontBase64: fakeFont })).toBeNull();
  });

  it('returns an svg with viewBox matching videoW/videoH', () => {
    const svg = subtitleSvg({ text: 'hello', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('viewBox="0 0 1920 1080"');
  });

  it('embeds the font via @font-face with the provided base64', () => {
    const svg = subtitleSvg({ text: 'hello', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    expect(svg).toContain('@font-face');
    expect(svg).toContain('NotoSansJP');
    expect(svg).toContain('data:font/otf;base64,AABBCC');
  });

  it('renders a single <tspan> per wrapped line', () => {
    const svg = subtitleSvg({ text: 'short line', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    const tspans = svg.match(/<tspan/g) ?? [];
    expect(tspans.length).toBe(1);
  });

  it('renders multiple <tspan> for wrapped long text', () => {
    const longText = 'a'.repeat(500); // overflows easily
    const svg = subtitleSvg({ text: longText, videoW: 320, videoH: 240, fontBase64: fakeFont })!;
    const tspans = svg.match(/<tspan/g) ?? [];
    expect(tspans.length).toBeGreaterThanOrEqual(2);
    expect(tspans.length).toBeLessThanOrEqual(3);  // capped at 3 lines
  });

  it('positions text near bottom (y > 0.7 * videoH)', () => {
    const svg = subtitleSvg({ text: 'x', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    const yMatch = svg.match(/<text[^>]*\sy="(\d+(?:\.\d+)?)"/);
    expect(yMatch).not.toBeNull();
    expect(Number(yMatch![1])).toBeGreaterThan(0.7 * 1080);
  });

  it('escapes XML-significant chars in text', () => {
    const svg = subtitleSvg({ text: '<b>&"\'', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    expect(svg).not.toMatch(/<tspan[^>]*><b>/);
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&amp;');
  });
});
```

- [ ] **Step 2: 実行して fail を確認**

```
npx vitest run test/subtitleSvg.test.ts
```
Expected: 全件 fail（モジュール未存在）。

- [ ] **Step 3: 実装**

`src/main/export/subtitleSvg.ts`:

```typescript
import { wrapJapanese } from './subtitleWrap';

export interface SubtitleSvgInput {
  text: string;
  videoW: number;
  videoH: number;
  fontBase64: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 字幕を映像サイズに合わせた SVG として返す。空テキストなら null。
 * フォントは @font-face で base64 埋込み（fontconfig 非依存）。
 */
export function subtitleSvg(input: SubtitleSvgInput): string | null {
  if (input.text.trim() === '') return null;
  const { videoW, videoH, fontBase64 } = input;
  const fontSize = Math.max(12, Math.round(videoH * 0.045));
  const colCharWidth = fontSize * 0.6;
  const maxCols = Math.max(4, Math.floor((videoW * 0.8) / colCharWidth));
  const lines = wrapJapanese(input.text, maxCols, 3);
  if (lines.length === 0) return null;

  const lineHeight = Math.round(fontSize * 1.3);
  const totalTextH = lineHeight * lines.length;
  const paddingY = Math.round(fontSize * 0.3);
  const paddingX = Math.round(fontSize * 0.6);
  const rectH = totalTextH + paddingY * 2;

  // 中央寄せの長さ近似（最も幅広い行のグラフェム個数 × colCharWidth ≈ 表示幅）
  const widest = lines.reduce((m, l) => Math.max(m, [...l].length * colCharWidth), 0);
  const rectW = Math.min(videoW * 0.9, widest + paddingX * 2);

  const rectX = (videoW - rectW) / 2;
  const rectY = Math.round(videoH * 0.85) - rectH;

  const textY = rectY + paddingY + lineHeight * 0.8;
  const strokeWidth = Math.max(1, fontSize * 0.08);

  const tspans = lines.map((l, i) => {
    const dy = i === 0 ? 0 : lineHeight;
    return `<tspan x="${videoW / 2}" dy="${dy}">${escapeXml(l)}</tspan>`;
  }).join('');

  return (
    `<svg width="${videoW}" height="${videoH}" viewBox="0 0 ${videoW} ${videoH}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><style>@font-face { font-family: 'NotoSansJP'; src: url(data:font/otf;base64,${fontBase64}) format('opentype'); }</style></defs>` +
    `<rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${rectW.toFixed(1)}" height="${rectH}" rx="4" fill="rgba(0,0,0,0.55)"/>` +
    `<text x="${videoW / 2}" y="${textY.toFixed(1)}" text-anchor="middle" ` +
    `font-family="NotoSansJP, sans-serif" font-size="${fontSize}" font-weight="600" ` +
    `fill="white" stroke="black" stroke-width="${strokeWidth.toFixed(2)}" paint-order="stroke fill">` +
    `${tspans}</text>` +
    `</svg>`
  );
}
```

- [ ] **Step 4: tsconfig.node.json の include に追加**

`tsconfig.node.json` の `include` に追加（前タスクで追加済の subtitleWrap の隣）:

```json
    "src/main/export/subtitleSvg.ts",
```

- [ ] **Step 5: 実行して pass を確認**

```
npx vitest run test/subtitleSvg.test.ts
npm run typecheck
```
Expected: 全件パス、typecheck エラーなし。

- [ ] **Step 6: コミット**

```
git add src/main/export/subtitleSvg.ts test/subtitleSvg.test.ts tsconfig.node.json
git commit -m "feat(export): add subtitleSvg renderer with base64-embedded font"
```

---

## Task 10: main/export/subtitleFrames.ts — sharp で PNG 生成

**Files:**
- Create: `src/main/export/subtitleFrames.ts`

- [ ] **Step 1: 実装**

`src/main/export/subtitleFrames.ts`:

```typescript
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { subtitleSvg } from './subtitleSvg';
import { type PreviewSlot } from '../../shared/previewTimeline';

export interface GenerateSubtitleFrameInput {
  slot: PreviewSlot;
  text: string;
  videoW: number;
  videoH: number;
  fontBase64: string;
  outDir: string;
  signal?: AbortSignal;
}

export interface SubtitleFrameOutput {
  pngPath: string;
  durationSec: number;
}

/**
 * スロットの字幕 PNG を 1枚生成する。
 * 表示すべきものが無いとき（空テキスト or 区間長 0）は null。
 * durationSec はプレビューの visibleDuration と同じ式: clipDuration > 0 ? clipDuration : videoSpan。
 */
export async function generateSubtitleFrameForSlot(
  input: GenerateSubtitleFrameInput,
): Promise<SubtitleFrameOutput | null> {
  if (input.text.trim() === '') return null;
  const videoSpan = Math.max(0, input.slot.videoEnd - input.slot.videoStart);
  const durationSec = input.slot.clipDuration > 0 ? input.slot.clipDuration : videoSpan;
  if (durationSec <= 0) return null;
  const svg = subtitleSvg({
    text: input.text,
    videoW: input.videoW,
    videoH: input.videoH,
    fontBase64: input.fontBase64,
  });
  if (svg === null) return null;
  if (input.signal?.aborted) return null;
  await fs.mkdir(input.outDir, { recursive: true });
  const pngPath = path.join(input.outDir, 'subtitle.png');
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(pngPath);
  return { pngPath, durationSec };
}
```

- [ ] **Step 2: typecheck 通過確認**

```
npm run typecheck
```
Expected: エラーなし。

> 単体テストは sharp 実行を含むため省略（exportService のモックテストでカバー）。

- [ ] **Step 3: コミット**

```
git add src/main/export/subtitleFrames.ts
git commit -m "feat(export): generate per-slot subtitle PNG via sharp"
```

---

## Task 11: ffargs.ts の segmentVideoArgs に subtitle を追加

**Files:**
- Modify: `src/main/export/ffargs.ts`
- Modify: `test/ffargs.test.ts`

- [ ] **Step 1: テストを追加（既存ファイル末尾に append）**

`test/ffargs.test.ts` の末尾、`describe('segmentVideoArgs', ...)` 直後または末尾に追加（既存テスト構造に合わせる）:

```typescript
describe('segmentVideoArgs with subtitle', () => {
  it('adds subtitle overlay with -loop 1 input and enable=lt(t,dur)', () => {
    const args = segmentVideoArgs({
      rawPath: 'raw.webm', slot, outPath: 'v.mp4', fps: 30,
      subtitle: { pngPath: 'sub.png', durationSec: 4.5 },
    });
    expect(args).toContain('-loop');
    expect(args).toContain('sub.png');
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('overlay=0:0:enable=');
    expect(fc).toContain("lt(t,4.500)");
    expect(args).toContain('[vout]');
  });

  it('combines ripple and subtitle in a single filter chain', () => {
    const args = segmentVideoArgs({
      rawPath: 'raw.webm', slot, outPath: 'v.mp4', fps: 30,
      ripple: { pattern: 'rip/%05d.png', fps: 30 },
      subtitle: { pngPath: 'sub.png', durationSec: 2 },
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[vbase][1:v] overlay=shortest=1');
    expect(fc).toMatch(/\[v[a-z0-9]+\]\[2:v\] overlay=0:0:enable='lt\(t,2\.000\)'/);
    expect(args).toContain('[vout]');
  });

  it('uses -vf path (no filter_complex) when neither ripple nor subtitle is provided', () => {
    const args = segmentVideoArgs({ rawPath: 'raw.webm', slot, outPath: 'v.mp4', fps: 30 });
    expect(args).toContain('-vf');
    expect(args).not.toContain('-filter_complex');
  });
});
```

- [ ] **Step 2: fail を確認**

```
npx vitest run test/ffargs.test.ts
```
Expected: subtitle 系テストが fail（segmentVideoArgs に subtitle 引数が無い）。

- [ ] **Step 3: segmentVideoArgs を更新**

`src/main/export/ffargs.ts` の `segmentVideoArgs` を以下に置き換える:

```typescript
/** raw 映像のスロット区間を切り出し、末尾フレームを slotDuration までフリーズして均一H.264で出力。
 *  ripple/subtitle 指定時は overlay フィルタチェーンに乗せる。 */
export function segmentVideoArgs(input: {
  rawPath: string;
  slot: PreviewSlot;
  outPath: string;
  fps: number;
  ripple?: { pattern: string; fps: number };
  subtitle?: { pngPath: string; durationSec: number };
}): string[] {
  const { rawPath, slot, outPath, fps, ripple, subtitle } = input;
  const videoSpan = Math.max(0, slot.videoEnd - slot.videoStart);
  const freeze = Math.max(0, slot.slotDuration - videoSpan);
  const tpadChain = `tpad=stop_mode=clone:stop_duration=${freeze},fps=${fps},setpts=PTS-STARTPTS`;

  if (!ripple && !subtitle) {
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

  // filter_complex モード
  const inputs: string[] = [
    '-ss', String(slot.videoStart),
    '-t', String(videoSpan),
    '-i', rawPath,
  ];
  let nextIdx = 1;
  let rippleIdx: number | null = null;
  let subtitleIdx: number | null = null;
  if (ripple) {
    inputs.push('-framerate', String(ripple.fps), '-i', ripple.pattern);
    rippleIdx = nextIdx++;
  }
  if (subtitle) {
    inputs.push('-loop', '1', '-i', subtitle.pngPath);
    subtitleIdx = nextIdx++;
  }

  const chain: string[] = [`[0:v] ${tpadChain} [vbase]`];
  let lastLabel = 'vbase';
  if (rippleIdx !== null) {
    chain.push(`[${lastLabel}][${rippleIdx}:v] overlay=shortest=1 [vrip]`);
    lastLabel = 'vrip';
  }
  if (subtitleIdx !== null) {
    const dur = subtitle!.durationSec.toFixed(3);
    chain.push(`[${lastLabel}][${subtitleIdx}:v] overlay=0:0:enable='lt(t,${dur})' [vsub]`);
    lastLabel = 'vsub';
  }
  // 最終出力ラベルは [vout] に統一する（既存テストと一貫）
  chain[chain.length - 1] = chain[chain.length - 1].replace(/\[v(rip|sub)\]$/, '[vout]');

  return [
    '-y',
    ...inputs,
    '-filter_complex', chain.join('; '),
    '-map', '[vout]',
    '-an',
    ...VIDEO_ENCODE,
    outPath,
  ];
}
```

- [ ] **Step 4: 実行して pass を確認**

```
npx vitest run test/ffargs.test.ts
```
Expected: 全件パス（既存の ripple のみケースも `[vout]` を期待していたので、最後ラベルを `[vout]` に置換するロジックで通る）。

- [ ] **Step 5: typecheck**

```
npm run typecheck
```
Expected: エラーなし。

- [ ] **Step 6: コミット**

```
git add src/main/export/ffargs.ts test/ffargs.test.ts
git commit -m "feat(export): extend segmentVideoArgs with subtitle overlay, combinable with ripple"
```

---

## Task 12: exportService.ts に subtitle 統合

**Files:**
- Modify: `src/main/export/exportService.ts`
- Modify: `src/main/ipc/export.ts`
- Modify: `test/exportService.test.ts`

- [ ] **Step 1: テストを更新（既存 + 新規ケース）**

`test/exportService.test.ts` を以下のように変更:

既存 `runExport(...)` の呼出しに `showSubtitles: false` を渡し、その他のテストでも明示的に false を渡すか、または true で subtitle 生成モックを設定する。

具体的には、既存の `it('probes fps + resolution + clip durations, ...')` のブロック内の `runExport({...})` 呼出しに以下を追加:

```typescript
      showSubtitles: false,
```

同様に既存テストすべてに `showSubtitles: false` を追加（subtitle 統合の前後で挙動を変えない）。

ファイル末尾、`describe('runExport', () => { ... })` 内に新規テストを追加:

```typescript
  it('calls generateSubtitleFrame for each segment with text when showSubtitles=true', async () => {
    const subCalls: Array<{ slotId: string; text: string }> = [];
    await runExport({
      segments: [
        { ...seg('seg-001', 1, 3, 'tts/seg-001.wav'), correctedText: 'hello' },
        { ...seg('seg-002', 3, 6, null), correctedText: '' },
      ],
      projectDir,
      outPath: path.join(projectDir, 'out.mp4'),
      tmpDir,
      credit: 'VOICEVOX',
      showSubtitles: true,
      runFfmpeg: async () => {},
      runProbe: async (args) => {
        const s = args.join(' ');
        if (s.includes('r_frame_rate')) return '30/1';
        if (s.includes('width,height')) return '1920,1080';
        return '2.0';
      },
      generateSubtitleFrame: async (input) => {
        subCalls.push({ slotId: input.slot.segmentId, text: input.text });
        if (input.text.trim() === '') return null;
        return { pngPath: '/tmp/sub.png', durationSec: input.slot.clipDuration || 1 };
      },
    });

    expect(subCalls.length).toBe(2);
    expect(subCalls[0]).toEqual({ slotId: 'seg-001', text: 'hello' });
    expect(subCalls[1]).toEqual({ slotId: 'seg-002', text: '' });
  });

  it('skips generateSubtitleFrame entirely when showSubtitles=false', async () => {
    const subCalls: number[] = [];
    await runExport({
      segments: [{ ...seg('seg-001', 1, 3, 'tts/seg-001.wav'), correctedText: 'hello' }],
      projectDir,
      outPath: path.join(projectDir, 'out.mp4'),
      tmpDir,
      credit: 'VOICEVOX',
      showSubtitles: false,
      runFfmpeg: async () => {},
      runProbe: async (args) => {
        const s = args.join(' ');
        if (s.includes('r_frame_rate')) return '30/1';
        if (s.includes('width,height')) return '1920,1080';
        return '2.0';
      },
      generateSubtitleFrame: async () => { subCalls.push(1); return null; },
    });
    expect(subCalls.length).toBe(0);
  });
```

- [ ] **Step 2: 実行して fail を確認**

```
npx vitest run test/exportService.test.ts
```
Expected: 新規テストが fail（`ExportOptions.showSubtitles`/`generateSubtitleFrame` 未定義、`runExport` 統合未実装）。

- [ ] **Step 3: ExportOptions と runExport を更新**

`src/main/export/exportService.ts` の import に追加:

```typescript
import { generateSubtitleFrameForSlot, type GenerateSubtitleFrameInput, type SubtitleFrameOutput } from './subtitleFrames';
import { loadSubtitleFontBase64 } from './fontPaths';
```

`ExportOptions` インターフェースに追加:

```typescript
export interface ExportOptions {
  segments: Segment[];
  projectDir: string;
  outPath: string;
  tmpDir: string;
  credit: string;
  showSubtitles: boolean;
  runFfmpeg: (args: string[]) => Promise<void>;
  runProbe: (args: string[]) => Promise<string>;
  generateRippleFrames?: (
    input: GenerateRippleFramesInput,
  ) => Promise<{ pattern: string; fps: number } | null>;
  generateSubtitleFrame?: (
    input: GenerateSubtitleFrameInput,
  ) => Promise<SubtitleFrameOutput | null>;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}
```

`runExport` 本体、`const generate = opts.generateRippleFrames ?? generateRippleFramesForSlot;` の直後に追加:

```typescript
  const generateSubtitle = opts.generateSubtitleFrame ?? generateSubtitleFrameForSlot;
  const fontBase64 = opts.showSubtitles ? await loadSubtitleFontBase64() : '';
```

スロットループ内、`segmentVideoArgs(...)` 呼出しの直前に subtitle 生成を挿入:

```typescript
    let subtitle: { pngPath: string; durationSec: number } | undefined;
    if (opts.showSubtitles && segment) {
      const text = (segment.correctedText.trim() || segment.originalText.trim());
      const out = await generateSubtitle({
        slot,
        text,
        videoW,
        videoH,
        fontBase64,
        outDir: path.join(opts.tmpDir, `${slot.segmentId}_subtitle`),
        signal: opts.signal,
      });
      if (out !== null) subtitle = out;
    }
```

`segmentVideoArgs(...)` 呼出しを更新:

```typescript
    await opts.runFfmpeg(segmentVideoArgs({
      rawPath: raw, slot, outPath: vOut, fps,
      ripple: ripple ?? undefined,
      subtitle,
    }));
```

- [ ] **Step 4: ipc/export.ts に showSubtitles を渡す**

`src/main/ipc/export.ts` の `runExport({...})` 呼出しに以下を追加:

```typescript
        showSubtitles: project.settings.showSubtitles,
```

- [ ] **Step 5: 実行して pass を確認**

```
npx vitest run test/exportService.test.ts
npm test
npm run typecheck
```
Expected: 全件パス。

- [ ] **Step 6: コミット**

```
git add src/main/export/exportService.ts src/main/ipc/export.ts test/exportService.test.ts
git commit -m "feat(export): integrate per-slot subtitle PNG into runExport gated by showSubtitles"
```

---

## Task 13: build + 全テスト + smoke 確認

**Files:** なし（検証のみ）

- [ ] **Step 1: typecheck**

```
npm run typecheck
```
Expected: エラーなし。

- [ ] **Step 2: 全テスト実行**

```
npm test
```
Expected: 全件パス。subtitleSelect/wrap/svg + ffargs + exportService + validateProject + localeKeys 等が全て通る。

- [ ] **Step 3: ビルド**

```
npm run build
```
Expected: エラーなし。

- [ ] **Step 4: smoke 用ログを記録**

`docs/superpowers/plans/2026-05-29-subtitles.md` 末尾に「実装完了サマリ」セクションを追加し、各タスクのコミットハッシュ、テスト件数、build 成否を箇条書きで記録する。

- [ ] **Step 5: コミット**

```
git add docs/superpowers/plans/2026-05-29-subtitles.md
git commit -m "docs: record subtitles implementation completion summary"
```

---

## Task 14: 手動 E2E（実機 Windows）

**Files:** なし（手動検証）

> このタスクは AI ではなくユーザーが実機で確認する。AI は手順とチェックリストを提示し、結果を memory に書き戻す。

- [ ] **Step 1: dev で起動**

```
npm run dev
```

- [ ] **Step 2: チェックリスト**

- [ ] プロジェクトを開く → 文字起こし → セグメントに `correctedText` が入る
- [ ] 元音声モードで再生 → 字幕が `[videoStart, videoEnd]` で表示／消える
- [ ] TTS生成 → TTSモードに自動切替 → 字幕が TTS 読み上げ中だけ表示、フリーズ・tail で消える
- [ ] ツールバーの「字幕」チェックを OFF → プレビュー字幕が消える
- [ ] 同じ状態で書き出し → MP4 を別プレイヤーで開き、字幕なしを確認
- [ ] チェックを ON に戻して再書き出し → MP4 を別プレイヤーで開き、Noto Sans JP の字幕が表示されることを確認
- [ ] 長文（例: 補正テキストを100文字以上にする）で書き出し → 3行で折返し、4行目以降「…」になる

- [ ] **Step 3: 不具合があれば issue 化、または直接修正してこのプランに追記**

- [ ] **Step 4: master に push（ユーザー判断）**

---

## 実装順サマリ

1. types + validateProject — 基盤
2. subtitleSelect.ts — 純関数（共有）
3. ttsPreview onSlotProgress — コントローラ拡張
4. PreviewPlayer 字幕 overlay — レンダラ
5. EditorLayout トグル + 配線 + reducer SET_SETTINGS — UI
6. subtitleWrap.ts — 純関数（main）
7. Noto Sans JP 同梱 — 静的資源
8. fontPaths.ts — フォント解決
9. subtitleSvg.ts — SVG 生成
10. subtitleFrames.ts — sharp I/O
11. ffargs.ts segmentVideoArgs subtitle — ffmpeg 引数
12. exportService.ts + ipc — 配線
13. ビルド + 全テスト
14. 手動 E2E
