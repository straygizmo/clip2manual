# タイムライン時刻表示＋ズーム 設計（Phase A）

- **日付**: 2026-05-29
- **対象**: タイムラインの時刻表示行追加とズーム操作
- **依存**: 既存 Timeline.tsx / timelineGeometry.ts、PreviewPlayer の `onTime`/`onDuration`
- **状態**: 設計確定。plan はこのあとに作成
- **後続フェーズ**: Phase B（音声トラック長編集 ＝ 無音カット等）— 別 spec

## ゴール

タイムラインで時刻を視覚的に把握でき、フレーム単位の精密編集に必要な拡大表示ができるようにする。

- 時刻ティック行（major + minor）
- Ctrl+ホイール / `+`・`-`・`0` キーでズーム
- 横スクロール（ズーム時）と再生ヘッド追尾（ページ送り型）

## 非ゴール（後フェーズ）

- 音声トラック長編集（無音カット）— Phase B
- 端のドラッグトリム — Phase 6b 既定
- 波形表示 — 必要が出たら別途検討
- ズーム値の永続化（プロジェクトを開き直すと Fit に戻る）
- マウスドラッグでのタイムライン側 pan

## 確定方針

| 観点 | 方針 |
|---|---|
| ズーム入力 | `Ctrl+wheel` と キーボード `+`/`-`/`0`（0=Fit）。Timeline がフォーカス時のみ |
| ズーム係数 | wheel notch 当たり `1.1`、`+`/`-` で `sqrt(2)` |
| ズーム範囲 | min = Fit (= viewport幅 / duration)、max = `400 px/s` |
| ズーム中心 | wheel 時はマウス位置の時刻を固定、`+`/`-` 時はビュー中央 |
| 時刻表示 | `mm:ss`（major のみラベル付き、minor は短い線） |
| ティック間隔 | major は `>= 80 px` を最小として `[0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600]` 秒から選択。minor = major / 5 |
| 描画方式 | CSS スクロール、固定幅 `pxPerSec * duration` の content 内に DOM 絶対配置（Canvas は使わない） |
| 再生ヘッド追尾 | 「ページ送り」型: 右マージン 40px に近付いたら左端へジャンプ。手動スクロールで OFF、`playing` 立ち上がりエッジで ON |
| ズーム値の永続化 | しない（コンポーネント state のみ） |

## アーキテクチャ

```
src/renderer/editor/
  Timeline.tsx              ← 大幅改修（scrollable, ticks, zoom）
  timelineGeometry.ts       ← 新ユーティリティ追加（既存 percent API は段階的に置換）
  EditorLayout.tsx          ← Timeline に playing prop を渡す

src/shared/i18n/locales/
  ja.json, en.json          ← timeline.time キー追加
```

## データモデル

`Timeline.tsx` のローカル state のみ。プロジェクト永続化やリデューサ追加はなし。

```ts
const [pxPerSec, setPxPerSec] = useState<number>(0); // 0 = 未初期化（Fit に初期化）
const [follow, setFollow] = useState(true);
const scrollRef = useRef<HTMLDivElement>(null);
const programmaticScroll = useRef(false);
```

`duration` か viewport 幅が変わったときに `pxPerSec` を Fit で初期化（一度のみ）：

```ts
useLayoutEffect(() => {
  if (pxPerSec === 0 && scrollRef.current && duration > 0) {
    setPxPerSec(scrollRef.current.clientWidth / duration);
  }
}, [duration, pxPerSec]);
```

## 純関数 API（`timelineGeometry.ts`）

新規追加（既存の `timeToPercent` / `segmentRect` は当面残し、Timeline.tsx 内では使わなくなる）：

```ts
export function timeToPx(t: number, pxPerSec: number): number;
export function pxToTime(px: number, pxPerSec: number): number;
export function segmentBox(
  start: number, end: number, pxPerSec: number,
): { left: number; width: number };

export function clampZoom(px: number, fit: number, max: number): number;

/** focus-point ズーム。マウス位置の時刻を保つように scrollLeft を再計算。 */
export function applyZoomAtPoint(input: {
  oldPxPerSec: number;
  newPxPerSec: number;
  scrollLeft: number;
  mouseOffsetPx: number;
}): { pxPerSec: number; scrollLeft: number };

export function pickMajorInterval(pxPerSec: number): number;

export function formatTimeLabel(seconds: number): string;

/** 追尾用。新しい scrollLeft を返す。スクロール不要なら null。 */
export function shouldAutoScroll(input: {
  playheadPx: number;
  viewLeft: number;
  viewWidth: number;
  margin: number;
}): number | null;
```

## ティック描画

```tsx
const major = pickMajorInterval(pxPerSec);
const minor = major / 5;
const last = Math.floor(duration / minor) * minor;
const ticks: { t: number; major: boolean }[] = [];
for (let t = 0; t <= last + 1e-9; t += minor) {
  const isMajor = Math.abs((t / major) - Math.round(t / major)) < 1e-6;
  ticks.push({ t, major: isMajor });
}
```

ラベルは major のみ、`formatTimeLabel(t)` の結果を `<span>` で重ねる。minor は短い線のみ。

スタイル:
- major: `height: 100%`, `border-left: 1px solid hsl(var(--muted-foreground)/.5)`
- minor: `height: 50%`, `border-left: 1px solid hsl(var(--muted-foreground)/.25)`
- ラベル: 行の下端、`font-size: 10px`、`pointer-events: none`

## ズーム入力ハンドラ

**Ctrl+wheel:**

```tsx
const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
  if (!e.ctrlKey) return; // 通常スクロールは追尾解除のためにそのまま伝播
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const el = scrollRef.current!;
  const mouseOffsetPx = e.clientX - el.getBoundingClientRect().left;
  const fit = el.clientWidth / duration;
  const next = clampZoom(pxPerSec * factor, fit, 400);
  const result = applyZoomAtPoint({
    oldPxPerSec: pxPerSec, newPxPerSec: next,
    scrollLeft: el.scrollLeft, mouseOffsetPx,
  });
  programmaticScroll.current = true;
  setPxPerSec(result.pxPerSec);
  // React の再レンダ後にスクロール位置を反映
  requestAnimationFrame(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = result.scrollLeft;
    programmaticScroll.current = false;
  });
};
```

**キーボード:** Timeline 自身が `tabIndex=0` を持ち、`onKeyDown` で `+`/`-`/`0` を処理。中央でズーム（mouseOffsetPx = viewport幅/2）。

## 再生ヘッド追尾

```tsx
// 追尾実行
useEffect(() => {
  if (!follow || !scrollRef.current) return;
  const el = scrollRef.current;
  const playheadPx = currentTime * pxPerSec;
  const target = shouldAutoScroll({
    playheadPx, viewLeft: el.scrollLeft,
    viewWidth: el.clientWidth, margin: 40,
  });
  if (target !== null) {
    programmaticScroll.current = true;
    el.scrollLeft = target;
    requestAnimationFrame(() => { programmaticScroll.current = false; });
  }
}, [currentTime, pxPerSec, follow]);

// 手動スクロール検出
const handleScroll = () => {
  if (programmaticScroll.current) return;
  setFollow(false);
};

// 再生開始エッジで follow 再開
const prevPlaying = useRef(playing);
useEffect(() => {
  if (playing && !prevPlaying.current) setFollow(true);
  prevPlaying.current = playing;
}, [playing]);
```

`shouldAutoScroll` の実装方針：
- `playheadPx > viewLeft + viewWidth - margin` → 新 `scrollLeft = playheadPx - margin`（ページ送り、右端マージン到達で左に飛ばす）
- `playheadPx < viewLeft` → 新 `scrollLeft = Math.max(0, playheadPx - margin)`（巻き戻し時の追従）
- それ以外 → `null`

## クリック・シーク

スクロール領域内のクリックで seek。座標変換：

```ts
const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left + scrollRef.current!.scrollLeft;
  onSeek(pxToTime(x, pxPerSec));
};
```

クリックマーカーのダブルクリックでの split（既存挙動）はそのまま。

## Timeline の props 変更

```ts
interface Props {
  duration: number;
  currentTime: number;
  segments: Segment[];
  selectedId: string | null;
  playingId: string | null;
  playing: boolean;                        // ← 追加（追尾再開エッジ用）
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onSplitAtClick?: (segmentId: string, t: number) => void;
}
```

`EditorLayout` 側は `<PreviewPlayer>` の `playing` 状態（既存 state）を `Timeline` に渡す。`PreviewPlayer` は元々 `playing` を内部 state にしているので、`onPlayingChange?: (p: boolean) => void` コールバック prop を1つ追加して上位に伝播する。

## i18n キー

```jsonc
// ja.json: editor 下ではなく既存 timeline 名前空間に
"timeline": { "video": "...", "segment": "...", "click": "...", "time": "時刻", ... }
// en.json: ..., "time": "Time"
```

## エッジケース

| ケース | 挙動 |
|---|---|
| `duration === 0`（未読込み） | `pxPerSec = 0` のままティック描画 0 件、ズーム入力無効 |
| `viewport` リサイズ | Fit 再計算は **初期化時のみ**。後にユーザーリサイズしても `pxPerSec` は不変（手動 `0` キーで Fit 再適用） |
| `pxPerSec * duration` が極端に大きい（例: 1時間 × 400 = 1,440,000 px） | ブラウザは扱えるが念のため `MAX = 400` で上限化（後で必要なら C: 仮想化を検討） |
| `playing` 中にユーザーがホイールでズーム | `programmaticScroll` フラグでズーム時の `setScrollLeft` を `handleScroll` から保護、`follow` は維持 |
| `playing=false` で右端に居て手動スクロール | follow=false 化（自然な挙動） |
| 再生中に手動スクロール → 再生継続 | follow=false のまま、ヘッドは画面外でも追尾しない |
| 一時停止→再生 | エッジで follow=true、即座に追尾 |

## テスト戦略

純関数を中心に Vitest TDD：

| ファイル | テスト対象 |
|---|---|
| `test/timelineGeometry.test.ts`（既存追加） | `timeToPx`/`pxToTime`/`segmentBox`/`clampZoom`/`applyZoomAtPoint`/`pickMajorInterval`/`formatTimeLabel`/`shouldAutoScroll` |
| `test/localeKeys.test.ts`（既存追加なし） | `timeline.time` キーが ja/en で一致（既存テストが自動カバー） |

**`pickMajorInterval` のテスト例:**
- `pickMajorInterval(800)` → `0.1`（0.1 * 800 = 80 >= 80）
- `pickMajorInterval(10)` → `10`（10 * 10 = 100 >= 80）
- `pickMajorInterval(1)` → `120`（120 * 1 = 120 >= 80。`60 * 1 = 60 < 80` で次へ）
- `pickMajorInterval(0.05)` → `600`（fallback）

**`applyZoomAtPoint` のテスト例:**
- マウス左端 (offset=0) ズーム → `scrollLeft` は元の `scrollLeft` がそのまま時間スケールされた値
- マウス中央 (offset=W/2) ズーム → 中央の時刻が中央に保たれる

**`shouldAutoScroll` のテスト例:**
- 画面内 → `null`
- 右端マージン到達 → `playheadPx - margin`
- 巻き戻し → `max(0, playheadPx - margin)`

**手動E2E:**
- Ctrl+wheel でズームイン → マウス位置の時刻が画面上で動かない
- `+`/`-` でビュー中央を保ったまま拡大/縮小
- `0` で Fit に戻る
- 再生中、playhead が画面右端に達するとページ送り
- 手動スクロールすると追尾停止、再生ボタン再押下で再開
- ズーム最大時に視覚的に詰まらない（実用域）

## 既存テストへの影響

- `test/timelineGeometry.test.ts` の既存 `timeToPercent`/`segmentRect` テストは継続。新 API のテストを追加
- `Timeline` の DOM 構造が変わるが UI 単体テストは無いので影響なし

## 実装順（後続 plan のヒント）

1. `timelineGeometry.ts` の純関数群（TDD）
2. i18n キー追加
3. `Timeline.tsx` を新構造に書き換え（CSS スクロール、ticks、ズームハンドラ、追尾、focus）
4. `PreviewPlayer.tsx` に `onPlayingChange` prop 追加
5. `EditorLayout.tsx` で `playing` state を保持し、Timeline / PreviewPlayer に配線
6. typecheck・全テスト・ビルド・手動E2E

## 関連スペック

- `docs/superpowers/specs/2026-05-26-clip2manual-phase2-design.md` — タイムライン MVP
- `docs/superpowers/specs/2026-05-27-clip2manual-phase4r2-timed-preview-design.md` — TtsPreviewController の `playing` 状態
- `docs/superpowers/specs/2026-05-27-clip2manual-phase6a-segment-ops-design.md` — split-at-click（既存挙動を維持）
