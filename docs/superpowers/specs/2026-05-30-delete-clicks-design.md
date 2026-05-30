# UI からのクリック削除 — 設計

- 日付: 2026-05-30
- 対象: 録画中に記録された誤クリック / 不要なクリックをエディタ UI から取り除く
- 関連: `src/shared/types.ts`, `src/renderer/editor/Timeline.tsx`, `src/renderer/editor/EditorLayout.tsx`, `src/renderer/state/segmentOps.ts`

## 1. 背景と問題

録画中に発生したクリックはすべて `Segment.clicks: ClickEvent[]` に保持され、Timeline の「クリック」行に橙色の ◆ として描画される。これらはプレビューの `RippleCanvas` と書き出しの ripple burn-in に直接使われる。一方、ユーザーが録画中に意図せず行ったクリック（アプリ切替・誤押下・無関係な領域への誤クリックなど）は、現状 UI からは取り除けない。再録画が唯一の手段になっており不便。

## 2. 要件

- エディタ UI でクリックを 1 件ずつ選択し、`Delete` または `Backspace` で削除できる。
- 削除した結果はプロジェクトに保存され、プレビューと書き出しの両方に即時反映される。
- 既存のダブルクリック分割（`onSplitAtClick`）は維持する。
- 既存の reducer / IPC / `Inspector` / `Timeline` の他機能には手を入れない。
- 複数選択・undo・確認ダイアログは作らない（YAGNI）。

## 3. データモデル

`ClickEvent`（`src/shared/types.ts`）は不変。`id` は追加せず、選択キーは `{ segmentId, t, x, y }` の合成で表現する。同一セグメント内に同じ `(t, x, y)` のクリックが共存することは事実上ない（録画器が同時刻に同座標を 2 回記録する余地はない）ため、これで一意。

## 4. UI 仕様

### 4.1 選択

- Timeline のクリック行 ◆ ラッパー `<div>` の `onClick` でその ◆ を選択中にする（`e.stopPropagation()` で行クリックのシーク動作を抑止）。
- 選択中の ◆ は `ring-2 ring-amber-300` でハイライト（セグメントの「再生中」と同じトーン）。

### 4.2 解除

以下のいずれかで選択解除:
- タイムライン本体の余白を単クリック（既存の `onContentClick` 内で `setSelectedClick(null)`）
- `Esc` キー
- `updateSegments` などでセグメントが書き換わった直後（削除を含む）
- プロジェクトクローズ

### 4.3 削除

- 文書編集 / Inspector 入力に focus がない状態で `Delete` または `Backspace` を押下。
- 選択中クリックが該当セグメントの `clicks` 配列から filter で除外され、`window.api.updateSegments(next)` で永続化。
- 削除直後に `setSelectedClick(null)`。

### 4.4 既存振る舞いとの両立

- ◆ のダブルクリックは従来通り `onSplitAtClick(segmentId, t)` を発火。`onClick` と `onDoubleClick` は同居可能（React 内で抑止せずブラウザ既定の遅延判定に任せる）。
- 単クリック中も `stopPropagation` で親行のシークは止める。

## 5. 状態管理

選択状態は **`Timeline.tsx` のローカル `useState`** で持つ（`editorReducer` には追加しない）。

```ts
type SelectedClick = { segmentId: string; t: number; x: number; y: number };
const [selectedClick, setSelectedClick] = useState<SelectedClick | null>(null);
```

クリック削除のハンドラは `EditorLayout` から props として渡す:

```ts
onDeleteClick?: (segmentId: string, t: number, x: number, y: number) => void;
```

`Esc` と `Delete/Backspace` のキー処理は Timeline が既に持つ `handleKeyDown`（`<div tabIndex={0} onKeyDown={handleKeyDown}>` 上の `+/-/0` ズーム実装と同じ場所）に追加する。Timeline がフォーカスを持っている時のみ反応するため、Inspector のテキスト編集中に誤発火する余地がない。

## 6. 純関数化とテスト

クリック削除ロジックは `src/renderer/state/segmentOps.ts` に純関数として追加し、ユニットテストで覆う:

```ts
export interface ClickKey { segmentId: string; t: number; x: number; y: number }
export function deleteClick(segments: Segment[], key: ClickKey): Segment[];
```

- 該当 segmentId 以外は参照透過に通す。
- 該当 segment の `clicks` から `c.t === t && c.x === x && c.y === y` の要素を取り除いた新配列に差し替える。
- 一致するクリックが無い場合は元の `segments` をそのまま返す（参照同一）。

テスト (`test/segmentOps.test.ts` に追加):
- `deleteClick` が指定セグメントから該当クリックのみ取り除く
- 他セグメントの clicks は変化しない
- 該当なしの場合 input と同一参照を返す
- 該当 segmentId が存在しないとき input と同一参照を返す

`EditorLayout` の `onDeleteClick` は `deleteClick(segments, key)` を呼んで `applySegments(next, segmentId)` する薄いラッパー。

## 7. プレビュー / 書き出しへの波及

- `RippleCanvas` は親から渡される `segment.clicks` を直接読むだけなので、配列が縮めば次フレームで自動的にリップルが消える。
- 書き出し時のリップル合成（`src/main/export/rippleFrames.ts`）は `project.segments[*].clicks` をループするだけ。`updateSegments` 経由でプロジェクトファイル（`segments.json`）が書き換わるので、書き出し時には既に削除済みの状態が読み込まれる。

## 8. i18n

新規キー（`ja.json` / `en.json` の `timeline` セクション）:
- `timeline.deleteClickHint` — ◆ の `title` 属性に出すツールチップ追記（"クリック / Delete: 削除"）。既存の `splitOnDoubleClick` と並べる形式にする。

## 9. テスト方針

- 純関数 `deleteClick` を vitest で 4 シナリオ網羅。
- `Timeline.tsx` のコンポーネントテストはこのリポジトリの慣習どおり追加しない。
- 既存の `npm test` 全件 + `npm run typecheck` のグリーン維持。
- E2E（手動）: 録画→クリック行の ◆ を単クリック→`Delete`→消えること / プレビューでリップル出ないこと / プロジェクト再オープン後も消えていること / ダブルクリック分割が壊れていないこと。

## 10. 影響範囲とリスク

- `Timeline.tsx` にキーボードハンドラを足すので、エディタ全体の他のショートカット（タイムラインズーム `+`/`-`/`0`、Ctrl+wheel ズームなど）と衝突しないかを確認。`Delete`/`Backspace`/`Esc` は他で未使用。
- `Backspace` をハンドルすると、Inspector のテキストエリア外フォーカスでブラウザ既定の「履歴戻る」が動く環境があるが、Electron ではアプリ用 BrowserWindow なので影響なし。`preventDefault()` を念のため付けて防御。
- ◆ をシングルクリックで選択しつつダブルクリックで分割を維持するため、◆ の `onClick` は `e.stopPropagation()` で親行のシークを止めるが、`onDoubleClick` は従来通り発火させる。React の `onClick` は dblclick 時に 2 度発火するが、その後 `onDoubleClick` ハンドラ内の `onSplitAtClick` で segments が変わると `useEffect(() => setSelectedClick(null), [segments])` が自動的に選択を解除するので、ステートが残ってもダブルクリック直後にクリアされる。

## 11. YAGNI で意図的に外したもの

- Undo / Redo（編集系全般に未導入の機能を本機能だけのために入れない）
- 確認ダイアログ（Delete は明示的選択後のみ発火するため）
- 複数選択・Shift クリック・ラバーバンド
- ソフトデリート（hidden フラグ）
- ◆ 自体の右クリックメニュー
