# 録画後ステッパー UI 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 録画後エディタの上部ツールバーを 4 ステップのチップ列＋アクティブステップ操作パネルに置換し、「文字起こし → 編集 → 音声生成 → 書き出し」の導線を可視化する。

**Architecture:** ステップ状態の派生を純関数 `stepperState.ts` に切り出し、`StepperToolbar.tsx` で UI を組む。`EditorLayout.tsx` の上部ブロック (行 213–298) のみ置換し、reducer / IPC / Inspector / TimelineToolbar / 既存ハンドラには手を加えない。

**Tech Stack:** React 18 + TypeScript / Tailwind v4 + shadcn (Button/Separator/Select/Slider) / lucide-react / i18next / Vitest（純関数のみ、`environment: 'node'` のためコンポーネントテストは追加しない）

**Spec:** `docs/superpowers/specs/2026-05-30-post-recording-stepper-design.md`

---

## ファイル構成

**新規:**
- `src/renderer/editor/stepperState.ts` — `StepStatus` 型と `deriveStepStatuses` / `activeStep` 純関数
- `src/renderer/editor/StepperToolbar.tsx` — 2 段ツールバーコンポーネント
- `test/stepperState.test.ts` — 派生関数のシナリオテスト

**変更:**
- `src/renderer/editor/EditorLayout.tsx` — 上部ツールバー (`行 213–298`) を `<StepperToolbar ... />` に置換。`grid-rows-[48px_1fr_auto]` → `grid-rows-[88px_1fr_auto]`
- `src/shared/i18n/locales/ja.json` / `en.json` — ステッパー用の i18n キーを追加

**変更しない:** `editorReducer.ts`, `Inspector.tsx`, `TimelineToolbar.tsx`, `PreviewPlayer.tsx`, `Timeline.tsx`, preload, IPC

---

## Task 1: ステップ派生関数の型と最小実装

**Files:**
- Create: `src/renderer/editor/stepperState.ts`
- Test:   `test/stepperState.test.ts`

- [ ] **Step 1: 失敗テストを書く（segments 空 = 全部 step 1 active、それ以外は locked）**

ファイル `test/stepperState.test.ts` を新規作成し、以下を書く:

```ts
import { describe, it, expect } from 'vitest';
import { deriveStepStatuses, activeStep } from '../src/renderer/editor/stepperState';
import { type Segment } from '../src/shared/types';

const seg = (over: Partial<Segment> = {}): Segment => ({
  id: 's1', videoStart: 0, videoEnd: 1, originalText: '', correctedText: '',
  ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true, ...over,
});

const idleTx = { status: 'idle' as const, error: null };
const idleTts = { status: 'idle' as const, error: null };
const idleExp = { status: 'idle' as const };

describe('deriveStepStatuses', () => {
  it('initial state: only step 1 is active, steps 2-4 are locked', () => {
    const r = deriveStepStatuses({
      segments: [], transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r).toEqual(['active', 'locked', 'locked', 'locked']);
  });
});

describe('activeStep', () => {
  it('returns 1 when only step 1 is active', () => {
    expect(activeStep(['active', 'locked', 'locked', 'locked'])).toBe(1);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/stepperState.test.ts`
Expected: FAIL — module 'src/renderer/editor/stepperState' not found

- [ ] **Step 3: 最小実装を書く**

ファイル `src/renderer/editor/stepperState.ts` を新規作成:

```ts
import { type Segment } from '../../shared/types';

export type StepStatus = 'locked' | 'active' | 'running' | 'done' | 'error';
export type StepStatuses = [StepStatus, StepStatus, StepStatus, StepStatus];

export interface StepInputs {
  segments: Segment[];
  transcription: { status: 'idle' | 'running' | 'error'; error: string | null };
  tts: { status: 'idle' | 'running' | 'error'; error: string | null };
  export: { status: 'idle' | 'running' | 'done' | 'error' };
}

export function deriveStepStatuses(input: StepInputs): StepStatuses {
  const { segments } = input;
  const hasSegments = segments.length > 0;
  if (!hasSegments) return ['active', 'locked', 'locked', 'locked'];
  // 仮実装。後続タスクで本実装に置き換える
  return ['done', 'active', 'active', 'locked'];
}

export function activeStep(s: StepStatuses): 1 | 2 | 3 | 4 {
  const running = s.findIndex((x) => x === 'running');
  if (running >= 0) return (running + 1) as 1 | 2 | 3 | 4;
  const err = s.findIndex((x) => x === 'error');
  if (err >= 0) return (err + 1) as 1 | 2 | 3 | 4;
  const act = s.findIndex((x) => x === 'active');
  if (act >= 0) return (act + 1) as 1 | 2 | 3 | 4;
  return 4;
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test -- test/stepperState.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: コミット**

```powershell
git add src/renderer/editor/stepperState.ts test/stepperState.test.ts
git commit -m "feat(editor): add stepperState scaffolding (step 1 lock + activeStep)"
```

---

## Task 2: ステップ 1（文字起こし）の状態遷移を完成させる

**Files:**
- Modify: `src/renderer/editor/stepperState.ts`
- Modify: `test/stepperState.test.ts`

- [ ] **Step 1: 文字起こしの各状態の失敗テストを追加**

`test/stepperState.test.ts` の `describe('deriveStepStatuses', ...)` ブロックに以下を追加:

```ts
  it('step 1 is running while transcription is running', () => {
    const r = deriveStepStatuses({
      segments: [],
      transcription: { status: 'running', error: null },
      tts: idleTts, export: idleExp,
    });
    expect(r[0]).toBe('running');
  });

  it('step 1 is error when transcription failed', () => {
    const r = deriveStepStatuses({
      segments: [],
      transcription: { status: 'error', error: 'boom' },
      tts: idleTts, export: idleExp,
    });
    expect(r[0]).toBe('error');
  });

  it('step 1 is done when segments exist', () => {
    const r = deriveStepStatuses({
      segments: [seg()],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r[0]).toBe('done');
  });
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/stepperState.test.ts`
Expected: 2 FAIL (running/error)、`done` テストは仮実装のおかげでたまたま通る可能性あり。少なくとも 2 件失敗すれば OK。

- [ ] **Step 3: `deriveStepStatuses` の Step 1 ロジックを本実装に置換**

`src/renderer/editor/stepperState.ts` の `deriveStepStatuses` を以下に置換:

```ts
export function deriveStepStatuses(input: StepInputs): StepStatuses {
  const { segments, transcription } = input;
  const hasSegments = segments.length > 0;

  const s1: StepStatus =
    transcription.status === 'running' ? 'running' :
    transcription.status === 'error'   ? 'error'   :
    hasSegments                        ? 'done'    : 'active';

  if (!hasSegments) return [s1, 'locked', 'locked', 'locked'];
  // 後続タスクで step 2-4 を完成させる
  return [s1, 'active', 'active', 'locked'];
}
```

- [ ] **Step 4: テスト実行で全件 PASS を確認**

Run: `npm test -- test/stepperState.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: コミット**

```powershell
git add src/renderer/editor/stepperState.ts test/stepperState.test.ts
git commit -m "feat(editor): step 1 status derivation (transcription lifecycle)"
```

---

## Task 3: ステップ 2/3/4 の状態遷移を完成させる

**Files:**
- Modify: `src/renderer/editor/stepperState.ts`
- Modify: `test/stepperState.test.ts`

- [ ] **Step 1: シナリオテストを追加**

`test/stepperState.test.ts` の `describe('deriveStepStatuses', ...)` に追加:

```ts
  it('after transcribe, step 2 active and step 3 active, step 4 locked (editing phase)', () => {
    const r = deriveStepStatuses({
      segments: [seg()],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r).toEqual(['done', 'active', 'active', 'locked']);
  });

  it('step 2 done once any segment has ttsAudio (single-segment regenerate)', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' }), seg({ id: 's2' })],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r[1]).toBe('done');
    expect(r[2]).toBe('active');
    expect(r[3]).toBe('locked');
  });

  it('step 3 done & step 4 active when all enabled segments have ttsAudio', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' }), seg({ id: 's2', ttsAudio: 'b.wav' })],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r[2]).toBe('done');
    expect(r[3]).toBe('active');
  });

  it('disabled segments without ttsAudio do not block step 3 completion', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' }), seg({ id: 's2', enabled: false })],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r[2]).toBe('done');
    expect(r[3]).toBe('active');
  });

  it('step 3 running while TTS is running', () => {
    const r = deriveStepStatuses({
      segments: [seg()],
      transcription: idleTx,
      tts: { status: 'running', error: null },
      export: idleExp,
    });
    expect(r[2]).toBe('running');
  });

  it('step 3 error reflected from tts state', () => {
    const r = deriveStepStatuses({
      segments: [seg()],
      transcription: idleTx,
      tts: { status: 'error', error: 'boom' },
      export: idleExp,
    });
    expect(r[2]).toBe('error');
  });

  it('step 4 running while export running', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' })],
      transcription: idleTx, tts: idleTts,
      export: { status: 'running' },
    });
    expect(r[3]).toBe('running');
  });

  it('step 4 done after export completes', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' })],
      transcription: idleTx, tts: idleTts,
      export: { status: 'done' },
    });
    expect(r[3]).toBe('done');
  });

  it('step 4 error when export failed', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' })],
      transcription: idleTx, tts: idleTts,
      export: { status: 'error' },
    });
    expect(r[3]).toBe('error');
  });
```

`describe('activeStep', ...)` に以下を追加:

```ts
  it('prefers running over active (TTS running with editing also active)', () => {
    expect(activeStep(['done', 'active', 'running', 'locked'])).toBe(3);
  });

  it('prefers error over active', () => {
    expect(activeStep(['error', 'active', 'locked', 'locked'])).toBe(1);
  });

  it('falls back to 4 when all done/locked', () => {
    expect(activeStep(['done', 'done', 'done', 'done'])).toBe(4);
  });
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- test/stepperState.test.ts`
Expected: いくつか FAIL（step 2 の done 判定、step 3 の running/error、step 4 全般）

- [ ] **Step 3: `deriveStepStatuses` を完成させる**

`src/renderer/editor/stepperState.ts` を以下に置換:

```ts
import { type Segment } from '../../shared/types';

export type StepStatus = 'locked' | 'active' | 'running' | 'done' | 'error';
export type StepStatuses = [StepStatus, StepStatus, StepStatus, StepStatus];

export interface StepInputs {
  segments: Segment[];
  transcription: { status: 'idle' | 'running' | 'error'; error: string | null };
  tts: { status: 'idle' | 'running' | 'error'; error: string | null };
  export: { status: 'idle' | 'running' | 'done' | 'error' };
}

export function deriveStepStatuses(input: StepInputs): StepStatuses {
  const { segments, transcription, tts, export: ex } = input;
  const hasSegments = segments.length > 0;
  const someHasAudio = segments.some((s) => !!s.ttsAudio);
  const enabled = segments.filter((s) => s.enabled !== false);
  const allEnabledHaveAudio = hasSegments && enabled.length > 0 && enabled.every((s) => !!s.ttsAudio);

  const s1: StepStatus =
    transcription.status === 'running' ? 'running' :
    transcription.status === 'error'   ? 'error'   :
    hasSegments                        ? 'done'    : 'active';

  const s2: StepStatus =
    !hasSegments  ? 'locked' :
    someHasAudio  ? 'done'   : 'active';

  const s3: StepStatus =
    !hasSegments              ? 'locked'  :
    tts.status === 'running'  ? 'running' :
    tts.status === 'error'    ? 'error'   :
    allEnabledHaveAudio       ? 'done'    : 'active';

  const s4: StepStatus =
    !allEnabledHaveAudio      ? 'locked'  :
    ex.status === 'running'   ? 'running' :
    ex.status === 'error'     ? 'error'   :
    ex.status === 'done'      ? 'done'    : 'active';

  return [s1, s2, s3, s4];
}

export function activeStep(s: StepStatuses): 1 | 2 | 3 | 4 {
  const running = s.findIndex((x) => x === 'running');
  if (running >= 0) return (running + 1) as 1 | 2 | 3 | 4;
  const err = s.findIndex((x) => x === 'error');
  if (err >= 0) return (err + 1) as 1 | 2 | 3 | 4;
  const act = s.findIndex((x) => x === 'active');
  if (act >= 0) return (act + 1) as 1 | 2 | 3 | 4;
  return 4;
}
```

- [ ] **Step 4: 全テストが PASS することを確認**

Run: `npm test -- test/stepperState.test.ts`
Expected: PASS（合計 17 件前後）

- [ ] **Step 5: コミット**

```powershell
git add src/renderer/editor/stepperState.ts test/stepperState.test.ts
git commit -m "feat(editor): finish stepperState derivation for steps 2-4"
```

---

## Task 4: i18n キーの追加

**Files:**
- Modify: `src/shared/i18n/locales/ja.json`
- Modify: `src/shared/i18n/locales/en.json`

- [ ] **Step 1: ja.json の `editor` ブロック直後に `stepper` ブロックを挿入**

`src/shared/i18n/locales/ja.json` の `"editor": { ... }` 直後（"inspector" の前）に以下のキーを挿入:

```json
  "stepper": {
    "step1Label": "1. 文字起こし",
    "step2Label": "2. 編集",
    "step3Label": "3. 音声生成",
    "step4Label": "4. 書き出し",
    "step1Run": "文字起こしを実行",
    "step1RunningHint": "{{percent}}% 進行中…",
    "step1DoneHint": "✓ 完了しました。タイムラインで内容を確認・編集してください。",
    "step1RestartNote": "やり直す場合は、ホームから新規プロジェクトを作成してください。",
    "step2Hint": "タイムラインのセグメントをクリックしてテキストを編集できます。完了したら 3. 音声生成へ進んでください。",
    "step3Run": "全セグメント生成",
    "step3RunningHint": "{{percent}}% 進行中…",
    "step3DoneHint": "✓ 全セグメントの音声を生成しました。",
    "step4Run": "MP4 書き出し",
    "step4RunningHint": "{{percent}}% 進行中…",
    "step4DoneHint": "✓ 書き出し完了。",
    "lockedHint": "前のステップを完了させてください。"
  },
```

- [ ] **Step 2: en.json に同じキーを英訳で追加**

`src/shared/i18n/locales/en.json` の同じ位置に挿入:

```json
  "stepper": {
    "step1Label": "1. Transcribe",
    "step2Label": "2. Edit",
    "step3Label": "3. Generate voice",
    "step4Label": "4. Export",
    "step1Run": "Run transcription",
    "step1RunningHint": "{{percent}}% in progress…",
    "step1DoneHint": "✓ Done. Review and edit the segments on the timeline.",
    "step1RestartNote": "To redo, create a new project from the home screen.",
    "step2Hint": "Click a segment on the timeline to edit its text. When done, move on to 3. Generate voice.",
    "step3Run": "Generate all segments",
    "step3RunningHint": "{{percent}}% in progress…",
    "step3DoneHint": "✓ Audio generated for all segments.",
    "step4Run": "Export to MP4",
    "step4RunningHint": "{{percent}}% in progress…",
    "step4DoneHint": "✓ Export complete.",
    "lockedHint": "Complete the previous step first."
  },
```

- [ ] **Step 3: localeKeys テストで ja/en のキー集合と placeholder が揃っていることを確認**

Run: `npm test -- test/localeKeys.test.ts`
Expected: PASS

- [ ] **Step 4: コミット**

```powershell
git add src/shared/i18n/locales/ja.json src/shared/i18n/locales/en.json
git commit -m "feat(i18n): add stepper.* keys for post-recording stepper"
```

---

## Task 5: StepperToolbar コンポーネントの実装

**Files:**
- Create: `src/renderer/editor/StepperToolbar.tsx`

- [ ] **Step 1: コンポーネントの全文を書く**

ファイル `src/renderer/editor/StepperToolbar.tsx` を新規作成:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Segment, type SpeakerOption } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, CircleDot, Download, FileText, Lock, Mic, Subtitles, X,
} from 'lucide-react';
import {
  activeStep, deriveStepStatuses, type StepStatus, type StepStatuses,
} from './stepperState';

interface ExportLike { status: 'idle' | 'running' | 'done' | 'error'; percent: number; message: string }
interface TxLike { status: 'idle' | 'running' | 'error'; error: string | null; percent: number }
interface TtsLike { status: 'idle' | 'running' | 'error'; error: string | null; percent: number }

export interface StepperToolbarProps {
  projectName: string;
  segments: Segment[];
  transcription: TxLike;
  tts: TtsLike;
  exportState: ExportLike;
  showSubtitles: boolean;
  defaultSpeaker: number;
  defaultSpeed: number;
  speakers: SpeakerOption[];

  onHome(): void;
  onTranscribe(): void;
  onCancelTranscription(): void;
  onSetDefaultVoice(v: { speaker: number; speed: number }): void;
  onApplyDefaultToAll(): void;
  onLoadSpeakers(): void;
  onGenerateAll(): void;
  onCancelTts(): void;
  onExport(): void;
  onCancelExport(): void;
  onSetShowSubtitles(v: boolean): void;
}

export function StepperToolbar(props: StepperToolbarProps) {
  const { t } = useTranslation();
  const statuses = deriveStepStatuses({
    segments: props.segments,
    transcription: { status: props.transcription.status, error: props.transcription.error },
    tts: { status: props.tts.status, error: props.tts.error },
    export: { status: props.exportState.status },
  });
  const auto = activeStep(statuses);
  const [override, setOverride] = useState<1 | 2 | 3 | 4 | null>(null);
  const prevAutoRef = useRef<1 | 2 | 3 | 4>(auto);

  // auto が前進したら override を解除（自動追従）
  useEffect(() => {
    if (auto > prevAutoRef.current) setOverride(null);
    prevAutoRef.current = auto;
  }, [auto]);

  const current = override ?? auto;

  return (
    <div className="flex flex-col bg-toolbar text-foreground">
      {/* Row 1: ホーム / プロジェクト名 / チップ列 / 字幕 */}
      <div className="flex h-11 items-center gap-2 px-3">
        <Button variant="ghost" size="sm" onClick={props.onHome}>
          <ArrowLeft className="size-4" />{t('editor.home')}
        </Button>
        <span className="truncate font-semibold">{props.projectName}</span>
        <Separator orientation="vertical" className="h-6" />
        <div className="flex flex-1 items-center justify-center gap-1">
          <StepChip n={1} status={statuses[0]} label={t('stepper.step1Label')}
            disabled={statuses[0] === 'done'} active={current === 1}
            onClick={() => statuses[0] !== 'locked' && statuses[0] !== 'done' && setOverride(1)} />
          <ArrowRight className="size-4 text-muted-foreground" />
          <StepChip n={2} status={statuses[1]} label={t('stepper.step2Label')} active={current === 2}
            onClick={() => statuses[1] !== 'locked' && setOverride(2)} />
          <ArrowRight className="size-4 text-muted-foreground" />
          <StepChip n={3} status={statuses[2]} label={t('stepper.step3Label')} active={current === 3}
            onClick={() => statuses[2] !== 'locked' && setOverride(3)} />
          <ArrowRight className="size-4 text-muted-foreground" />
          <StepChip n={4} status={statuses[3]} label={t('stepper.step4Label')} active={current === 4}
            onClick={() => statuses[3] !== 'locked' && setOverride(4)} />
        </div>
        <label className="flex items-center gap-1 text-xs" title={t('editor.showSubtitlesTooltip')}>
          <Subtitles className="size-4" />
          <input
            type="checkbox"
            checked={props.showSubtitles}
            onChange={(e) => props.onSetShowSubtitles(e.currentTarget.checked)}
            className="size-4"
          />
          {t('editor.showSubtitles')}
        </label>
      </div>

      {/* Row 2: アクティブステップの操作パネル */}
      <div className="flex h-11 items-center gap-2 border-t border-border px-3">
        {current === 1 && <Step1Panel {...props} status={statuses[0]} />}
        {current === 2 && <Step2Panel />}
        {current === 3 && <Step3Panel {...props} status={statuses[2]} />}
        {current === 4 && <Step4Panel {...props} status={statuses[3]} />}
      </div>
    </div>
  );
}

function StepChip({
  n, status, label, active, disabled, onClick,
}: { n: number; status: StepStatus; label: string; active: boolean; disabled?: boolean; onClick(): void }) {
  const Icon =
    status === 'done'    ? Check       :
    status === 'running' ? CircleDot   :
    status === 'error'   ? CircleAlert :
    status === 'locked'  ? Lock        : CircleDot;
  const color =
    status === 'error'  ? 'text-destructive' :
    status === 'done'   ? 'text-emerald-500' :
    status === 'locked' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === 'locked' || disabled}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
        active ? 'border-primary bg-primary/10' : 'border-border bg-background'
      } ${status === 'locked' || disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-muted'}`}
    >
      <Icon className={`size-3.5 ${color}`} />
      <span className="font-medium">{label}</span>
      <span className="sr-only">step {n} status {status}</span>
    </button>
  );
}

function Step1Panel(p: StepperToolbarProps & { status: StepStatus }) {
  const { t } = useTranslation();
  if (p.status === 'done') {
    return (
      <>
        <FileText className="size-4 text-emerald-500" />
        <span className="text-xs text-muted-foreground">{t('stepper.step1DoneHint')}</span>
        <span className="text-xs text-muted-foreground">{t('stepper.step1RestartNote')}</span>
      </>
    );
  }
  return (
    <>
      <Button size="sm" variant="default" onClick={p.onTranscribe} disabled={p.status === 'running'}>
        <FileText className="size-4" />{t('stepper.step1Run')}
      </Button>
      {p.status === 'running' && (
        <>
          <span className="text-xs text-muted-foreground">
            {t('stepper.step1RunningHint', { percent: p.transcription.percent })}
          </span>
          <Button variant="ghost" size="sm" onClick={p.onCancelTranscription}>
            <X className="size-4" />{t('common.cancel')}
          </Button>
        </>
      )}
      {p.status === 'error' && (
        <span className="text-xs text-destructive">
          {t('editor.transcribeFailed', { message: p.transcription.error })}
        </span>
      )}
    </>
  );
}

function Step2Panel() {
  const { t } = useTranslation();
  return <span className="text-xs text-muted-foreground">{t('stepper.step2Hint')}</span>;
}

function Step3Panel(p: StepperToolbarProps & { status: StepStatus }) {
  const { t } = useTranslation();
  const busy = p.status === 'running';
  const opts = p.speakers.length > 0
    ? p.speakers
    : [{ speaker: p.defaultSpeaker, label: t('inspector.speakerFallback', { id: p.defaultSpeaker }) }];
  return (
    <>
      <span className="text-xs text-muted-foreground">{t('editor.defaultVoiceLabel')}</span>
      <Select
        value={String(p.defaultSpeaker)}
        onValueChange={(v) => p.onSetDefaultVoice({ speaker: Number(v), speed: p.defaultSpeed })}
        disabled={busy}
        onOpenChange={(o) => { if (o) p.onLoadSpeakers(); }}
      >
        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o.speaker} value={String(o.speaker)}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Slider
        className="w-32"
        min={0.5} max={2} step={0.05}
        value={[p.defaultSpeed]}
        onValueChange={([v]) => p.onSetDefaultVoice({ speaker: p.defaultSpeaker, speed: v })}
        disabled={busy}
      />
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{p.defaultSpeed.toFixed(2)}x</span>
      <Button variant="secondary" size="sm" onClick={p.onApplyDefaultToAll} disabled={busy}>
        {t('editor.applyDefaultToAll')}
      </Button>
      <Separator orientation="vertical" className="h-6" />
      <Button size="sm" onClick={p.onGenerateAll} disabled={busy}>
        <Mic className="size-4" />{t('stepper.step3Run')}
      </Button>
      {busy && (
        <>
          <span className="text-xs text-muted-foreground">
            {t('stepper.step3RunningHint', { percent: p.tts.percent })}
          </span>
          {p.tts.percent === 0 && (
            <span className="text-xs text-muted-foreground">{t('editor.engineStartHint')}</span>
          )}
          <Button variant="ghost" size="sm" onClick={p.onCancelTts}>
            <X className="size-4" />{t('common.cancel')}
          </Button>
        </>
      )}
      {p.status === 'error' && (
        <span className="text-xs text-destructive">
          {t('editor.ttsFailed', { message: p.tts.error })}
        </span>
      )}
      {p.status === 'done' && (
        <span className="text-xs text-muted-foreground">{t('stepper.step3DoneHint')}</span>
      )}
    </>
  );
}

function Step4Panel(p: StepperToolbarProps & { status: StepStatus }) {
  const { t } = useTranslation();
  const busy = p.status === 'running';
  return (
    <>
      <Button size="sm" onClick={p.onExport} disabled={busy}>
        <Download className="size-4" />{t('stepper.step4Run')}
      </Button>
      {busy && (
        <>
          <span className="text-xs text-muted-foreground">
            {t('stepper.step4RunningHint', { percent: p.exportState.percent })}
          </span>
          <Button variant="ghost" size="sm" onClick={p.onCancelExport}>
            <X className="size-4" />{t('common.cancel')}
          </Button>
        </>
      )}
      {p.status === 'done' && (
        <span className="text-xs text-emerald-500">{t('stepper.step4DoneHint')}</span>
      )}
      {p.status === 'error' && (
        <span className="text-xs text-destructive">{p.exportState.message}</span>
      )}
    </>
  );
}
```

- [ ] **Step 2: typecheck で構文エラーが無いことを確認**

Run: `npm run typecheck`
Expected: 0 errors（このタスクの後で EditorLayout 側はまだ古いままなので、StepperToolbar.tsx だけ単体で問題なくコンパイルされること）

- [ ] **Step 3: 既存テストが回帰しないことを確認**

Run: `npm test`
Expected: 既存全テスト + Task 1-3 で追加した stepperState テストが PASS

- [ ] **Step 4: コミット**

```powershell
git add src/renderer/editor/StepperToolbar.tsx
git commit -m "feat(editor): add StepperToolbar component"
```

---

## Task 6: EditorLayout を StepperToolbar に置換

**Files:**
- Modify: `src/renderer/editor/EditorLayout.tsx`

- [ ] **Step 1: import を追加**

`src/renderer/editor/EditorLayout.tsx` の `import { Inspector } from './Inspector';` 直後に追加:

```tsx
import { StepperToolbar } from './StepperToolbar';
```

- [ ] **Step 2: TranscriptionState に percent が含まれることを `tx.percent` で参照しているため、props 互換のため TranscriptionState の現状を確認**

`src/renderer/state/editorReducer.ts` の `TranscriptionState`/`TtsState` は既に `percent: number` を持つ。コード変更不要。

- [ ] **Step 3: ルートの `grid-rows` を 88px に拡張し、上部ブロックを StepperToolbar 呼び出しに置換**

`src/renderer/editor/EditorLayout.tsx` の `return (` 直後の以下のブロック:

```tsx
    <div className="grid h-screen grid-rows-[48px_1fr_auto]">
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-2 bg-toolbar px-3 text-foreground">
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'CLOSE_PROJECT' })}>
          <ArrowLeft className="size-4" />{t('editor.home')}
        </Button>
        ...（行 213-298 の全体）...
      </div>
```

を、以下に丸ごと置換:

```tsx
    <div className="grid h-screen grid-rows-[88px_1fr_auto]">
      <StepperToolbar
        projectName={project.meta.name}
        segments={segments}
        transcription={{ status: tx.status, error: tx.error, percent: tx.percent }}
        tts={{ status: tts.status, error: tts.error, percent: tts.percent }}
        exportState={exportState}
        showSubtitles={showSubtitles}
        defaultSpeaker={defaultSpeaker}
        defaultSpeed={defaultSpeed}
        speakers={speakers}
        onHome={() => dispatch({ type: 'CLOSE_PROJECT' })}
        onTranscribe={runTranscription}
        onCancelTranscription={() => window.api.cancelTranscription()}
        onSetDefaultVoice={setDefaultVoice}
        onApplyDefaultToAll={applyDefaultToAll}
        onLoadSpeakers={loadSpeakers}
        onGenerateAll={generateAll}
        onCancelTts={() => window.api.cancelTts()}
        onExport={doExport}
        onCancelExport={() => window.api.cancelExport()}
        onSetShowSubtitles={setShowSubtitles}
      />
```

- [ ] **Step 4: 不要になった import を削除**

`EditorLayout.tsx` 上部の import で、置換後に使われなくなった以下を削除:

```tsx
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, FileText, Mic, X, Subtitles } from 'lucide-react';
```

ただし `Button` は本ファイル内のどこかでまだ使われていれば残す。`grep -n "Button\|Select\|Slider\|Separator\|ArrowLeft\|FileText\|Mic\b\|\\bX\\b\|Subtitles" src/renderer/editor/EditorLayout.tsx` で残存利用が無いか確認し、未使用のもののみ削除する。

- [ ] **Step 5: typecheck で 0 エラーを確認**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: 既存テスト全件 PASS を確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: コミット**

```powershell
git add src/renderer/editor/EditorLayout.tsx
git commit -m "feat(editor): replace top toolbar with StepperToolbar"
```

---

## Task 7: 動作確認 (E2E 手動) と最終コミット

**Files:** （変更なし、確認のみ）

- [ ] **Step 1: dev サーバ起動**

Run: `npm run dev`
Expected: Electron アプリが起動

- [ ] **Step 2: ホームから新規録画 → 録画停止 → エディタを開く**

Expected:
- 上部ツールバーが 2 段になっている
- チップ列が「1. 文字起こし ● → 2. 編集 🔒 → 3. 音声生成 🔒 → 4. 書き出し 🔒」
- アクティブパネルに `[文字起こしを実行]` ボタンが表示される

- [ ] **Step 3: `文字起こしを実行` を押す**

Expected:
- Step 1 チップが ● + スピナーで running 表示、`{{percent}}% 進行中…` が出る
- 完了後: Step 1 = ✓ Disabled、Step 2 = ●、Step 3 = ●（locked ではない）、Step 4 = 🔒
- パネルが Step 2 のヒントに自動切替

- [ ] **Step 4: Step 3 チップをクリックし、`全セグメント生成` を押す**

Expected:
- TTS 進行中: Step 3 が running、パネルに進捗 + キャンセル
- 完了後: Step 3 = ✓、Step 4 = ●、パネルが Step 4 ボタンに自動切替
- Step 2 = ✓ になる

- [ ] **Step 5: 既存の Inspector からの単発再生成・タイムライン編集・字幕チェックが従来通り動くことを確認**

Expected: 既存機能は無変化で動作

- [ ] **Step 6: `MP4 書き出し` を押し、保存先を選択して書き出し成功を確認**

Expected:
- Step 4 が running → done
- 成功トースト + 既存メッセージ

- [ ] **Step 7: 失敗系の動作確認（小さい再現）**

文字起こし中に `キャンセル` を押す:
Expected: Step 1 が error 表示、パネルにエラー文。Step 1 チップは押すと「やり直す場合は新規プロジェクト」のヒントが出る（done 後と同じ表示でも可）。

- [ ] **Step 8: 既存テスト + typecheck の最終確認**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 9: 最終コミット（必要であれば修正をまとめる）**

E2E で出た細かい修正があれば `fix(editor): ...` の名前で commit する。問題が無ければスキップ。

---

## DRY/YAGNI チェック

- ステップ派生は 1 箇所（`stepperState.ts`）に集約。コンポーネント側はステータスを受け取って表示するだけ。
- Step 4 の書き出しボタンは TimelineToolbar 側にも残す（仕様通り）。重複は 2 箇所のみで意図的、共通フックの抽出はしない。
- `editorReducer` / IPC / 既存ハンドラには触らない。状態モデルの拡張は YAGNI で避ける。

## ロールバック

すべて UI レイヤの変更で、IPC/ストレージへの影響は無い。ロールバックは Task 1〜6 のコミットを `git revert` するだけ。
