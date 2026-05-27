# フェーズ5（クリック強調＝リップルのプレビュー合成）設計

- 日付: 2026-05-27
- 対象: プレビューで、各クリック位置に「リップル（広がって消える輪）」を canvas オーバーレイで合成描画する。元音声/TTS 両モードで動作。
- 位置づけ: ロードマップのフェーズ5「クリック強調のプレビュー合成 + インスペクタ調整」のうち、**リップル描画のみ**を実装する。個々のクリックの有効/無効・位置の手動調整は後続ラウンド。
- 関連: `2026-05-27-clip2manual-phase4r2-timed-preview-design.md`（タイミング付きTTSプレビュー）、`2026-05-26-clip2manual-design.md`（全体設計）

## 背景と目的

録画時に `ClickEvent { x, y（映像ピクセル）, t（映像先頭からの相対秒）, button }` が各セグメントの `clicks` に保存されている。マニュアルでは「どこをクリックしたか」を視覚的に強調したい（`HighlightStyle: 'ripple'`）。本ラウンドはプレビュー上でクリック位置にリップルを重ねて表示する。

既存の検証ツール `tools/verify-clicks.html` が、映像ピクセル座標のクリックを映像に重ねて表示する実装の参照になる（canvas のピクセルバッファを映像の実解像度にし、CSS で映像と同じ矩形に伸縮 → 映像ピクセル座標のまま描ける。レターボックス計算が不要）。

フェーズ4ラウンド2で TTSプレビューは映像を `video.currentTime` で駆動するため、**`video.currentTime` をキーにすればリップルは元音声/TTS どちらのモードでも自動的に正しく発火する**（モード分岐不要）。

## 確定方針（ブレスト）

- 今ラウンド=**リップル描画のみ**（個々のクリックの有効/無効・位置編集は後続。データモデル変更なし）。
- アーキテクチャ=Approach A: `RippleCanvas` コンポーネント + 純関数ヘルパ。
- 座標=canvas を映像実解像度バッファにし CSS で重ねる（`verify-clicks` 方式）。映像ピクセル座標のまま描画。
- タイミング=`video.currentTime` の前進交差でリップルを発火し、各リップルは**実時間（wall-clock）でアニメーションを完走**（フリーズ中に半透明の輪が固まらない）。後方シークで発火集合をリセット。
- 元音声/TTS 両モードで動作。
- リップル外観=広がって消える輪（＋中心の小さな点）。色/継続時間(~0.8s)/最大半径(映像幅比)は調整可能な定数。`'ripple'` のみ。

## スコープ

含む:
- 純関数 `clicksCrossed(clicks, prevT, currT)` / `rippleProgress(elapsed, duration)`
- `RippleCanvas` コンポーネント（canvas オーバーレイ＋rAF描画ループ＋リップル発火/アニメーション）
- `PreviewPlayer` の映像領域を「映像にぴったり重なる相対配置ラッパ」に変更し canvas を重ねる
- 元音声/TTS 両モードでのリップル表示、後方シーク時のリセット

含まない（後続フェーズ）:
- 個々のクリック強調の有効/無効・位置の手動編集（ClickEvent へのフラグ追加・永続化・インスペクタUIが必要）
- リップル以外の強調スタイル、色/サイズ等のユーザー設定UI（定数のみ）
- ボタン種別（左/右/中）での描き分け
- 書き出し（FFmpeg）でのリップル焼き込み＝フェーズ7（本ラウンドのプレビュー描画ロジックを参考に実装予定）

## コンポーネント構成

| ファイル | 責務 |
|---------|------|
| `src/renderer/editor/rippleOverlay.ts`（新規・純関数） | `clicksCrossed` / `rippleProgress` / 定数。単体テスト対象 |
| `src/renderer/editor/RippleCanvas.tsx`（新規） | canvas オーバーレイ。`videoRef` から実解像度・currentTime を読み、rAF でリップルを発火・描画 |
| `src/renderer/editor/PreviewPlayer.tsx`（変更） | 映像＋canvas を `position:relative; display:inline-block` のラッパで重ねる |

### 純関数（`rippleOverlay.ts`）

```ts
export const RIPPLE_DURATION = 0.8;   // 秒（wall-clock）
export const RIPPLE_MAX_RADIUS_RATIO = 1 / 12; // 最大半径 = 映像幅 * これ

/** 映像時刻が prevT→currT に進む間に「交差した」クリック（prevT < t <= currT）を返す。 */
export function clicksCrossed<T extends { t: number }>(clicks: T[], prevT: number, currT: number): T[];

/** 発火からの経過秒に対するリップルの半径係数(0..1)と不透明度(1..0)。完了後は null。 */
export function rippleProgress(elapsed: number, duration?: number): { radius01: number; alpha: number } | null;
```

`clicksCrossed` は `{ t }` を持つ任意の型に対するジェネリック。描画側は `{ x, y }` も読む。RippleCanvas は既存の `ClickEvent`（`{x,y,t,button}`、button は未使用）の配列を受け取る。

- `clicksCrossed`: `currT > prevT` の前進時に `prevT < t <= currT` のものを返す。後退・据え置き時は呼び出し側でリセット/空。
- `rippleProgress`: `elapsed >= duration` で `null`。それ以外は `radius01 = elapsed/duration`、`alpha = 1 - elapsed/duration`（線形。微調整可）。

### `RippleCanvas.tsx`

- props: `{ videoRef: RefObject<HTMLVideoElement>; clicks: ClickEvent[] }`（既存の共有型。`x,y,t` を使用）。
- マウント時/`loadedmetadata` 後に canvas バッファを `video.videoWidth × video.videoHeight` に設定。
- rAF ループ:
  - `t = video.currentTime`。前フレームの `prevT` を保持。
  - `t >= prevT` なら `clicksCrossed(clicks, prevT, t)` を発火（各 `{x,y, firedAtWall: performance.now()}` を active 配列へ）。`t < prevT - ε`（後方シーク）なら active と発火状態をリセット。
  - active 各リップルについて `elapsed = (now - firedAtWall)/1000`、`rippleProgress` で半径/不透明度を計算、`null` のものは除去。
  - `clearRect` 後、各 active リップルを映像ピクセル座標 `(x,y)` に描画（`radius = radius01 * videoWidth * RIPPLE_MAX_RADIUS_RATIO`）。輪（stroke）＋中心点（fill）。
  - `prevT = t`。
- アンマウントで rAF 解除。

### `PreviewPlayer.tsx` の変更

- 映像中央寄せの flex は維持しつつ、`<video>` を `position:relative; display:inline-block`（`max-width/height:100%`）のラッパで包み、その中に `<RippleCanvas>`（`position:absolute; inset:0; width:100%; height:100%; pointer-events:none`）を重ねる。
- `clicks` は `state`/props のセグメントから `segments.flatMap(s => s.clicks)` で渡す（`{x,y,t}`）。PreviewPlayer は既に `segments` を受け取っている。

## データフロー

`PreviewPlayer` が `segments.flatMap(s => s.clicks)` を `RippleCanvas` に渡す → `RippleCanvas` の rAF が `video.currentTime` を監視 → 前進交差でリップル発火（wall-clock 起点）→ 各リップルを実時間で完走アニメーション → 映像ピクセル座標で canvas に描画（CSS で映像と同矩形に伸縮）。元音声モードは映像が通常再生、TTSモードはコントローラが `video.currentTime` を駆動するため、同一ロジックで両対応。

## エラー処理・エッジ

- クリック0件 → 何も描かない。
- 映像メタ未ロード（`videoWidth===0`）→ バッファ未設定・描画スキップ。
- フリーズ中（TTS、`video.currentTime` 据え置き）→ 交差は発生せず、発火済みリップルは wall-clock で完走して消える（固まった半透明の輪にならない）。
- 後方シーク（元音声でタイムラインクリック）→ active と発火状態をリセットして二重発火を防ぐ。
- 画面外座標 → canvas がクリップ（描画は安全）。
- オーバーレイは `pointer-events:none` で再生コントロールを妨げない。

## テスト

- 単体（Vitest node 環境）:
  - `clicksCrossed`: `prevT < t <= currT` の前進ウィンドウ、境界（`t===currT` を含む・`t===prevT` を含まない）、複数該当、前進なし（currT<=prevT）で空。
  - `rippleProgress`: `elapsed=0`→`{radius01:0, alpha:1}`、中間値、`elapsed>=duration`→`null`。
- 手動E2E（実機GUI）: TTS生成済み・クリックのあるプロジェクトを開く→再生（元音声/TTS両方）→クリック位置に広がって消えるリップルが、クリックの瞬間（その映像フレーム）に表示される。TTSモードでも各セグメントの該当時刻で出る。フリーズ中に輪が固まらない。再生コントロールは妨げられない。
- `RippleCanvas`（canvas/rAF/DOM）と `PreviewPlayer` レイアウトは手動E2Eで検証。

## 完了の定義

- `clicksCrossed` / `rippleProgress` の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機で、元音声/TTS 両モードでクリック位置にリップルが正しいタイミングで表示され、再生コントロールを妨げず、フリーズ中も破綻しない。

## 未解決・先送り

- 個々のクリック強調の有効/無効・位置編集（ClickEvent 拡張＋インスペクタ）。
- リップルの色/サイズ/継続時間のユーザー設定。
- 書き出し時のリップル焼き込み（フェーズ7、本ロジックを参考に PNG シーケンス/アルファ動画として FFmpeg 合成）。
- リップル定数（`RIPPLE_DURATION`/`RIPPLE_MAX_RADIUS_RATIO`/色）の実機での体感調整。
