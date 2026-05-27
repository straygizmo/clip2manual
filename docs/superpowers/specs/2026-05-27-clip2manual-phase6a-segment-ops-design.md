# フェーズ6ラウンドA（セグメント操作：カット/結合/分割）設計

- 日付: 2026-05-27
- 対象: タイムライン編集のうち、セグメント単位の操作 — カット（有効/無効トグル）・隣接結合・再生ヘッド位置での分割 — を実装する。プレビュー/書き出しは無効セグメントを除外する。
- 位置づけ: ロードマップのフェーズ6「タイムライン編集」を**複数ラウンドに分割**したその**ラウンドA（セグメント操作）**。端のドラッグトリムと区間選択削除はラウンド6b。
- 関連: `2026-05-27-clip2manual-phase4r2-timed-preview-design.md`・`2026-05-27-clip2manual-phase7a-export-design.md`（どちらも `computePreviewTimeline` を消費）、`2026-05-26-clip2manual-design.md`（全体設計）

## 背景と目的

セグメント（`Segment{ id, videoStart, videoEnd, originalText, correctedText, ttsAudio, voice, clicks, enabled }`）はプレビューと書き出しの両方で `computePreviewTimeline(segments, clipDurations)` を通じて消費される。したがってセグメントリストを編集すれば、プレビューも書き出しも自動的に追従する（連結で「後続を詰める」効果が得られる）。

本ラウンドはセグメント単位の編集操作を追加する。すべて元データ（raw.webm 等）非破壊で、`Segment[]` の純粋変換として表現する。

横断的な考慮点が2つ:
1. **無効（カット）セグメントの除外**: プレビュー/書き出しは `enabled === false` を除外する必要がある（現状は除外していない）。
2. **ttsAudio の無効化**: セグメントのナレーション内容が変わる操作（結合・分割）は、既存 TTS クリップが不整合になるため `ttsAudio` を null にし、ユーザーが再生成する。

## 確定方針（ブレスト）

- 今ラウンド=セグメント操作（カット/結合/分割）。トリム・区間選択削除は6b。
- アーキテクチャ=Approach A: 純関数 `segmentOps.ts` ＋ 汎用 `SET_SEGMENTS` reducer アクション。
- カット=**有効/無効トグル**（非破壊・可逆。ハード削除はしない）。無効セグメントはリスト/タイムラインに残る（グレー表示）が preview/export からは除外。
- 無効除外は **`computePreviewTimeline` 内**でフィルタ（preview/export 共通の単一ソース）。
- 分割の第2片は **correctedText 空**（日本語ナレーションは時間で自動分割できないため）。
- ttsAudio 無効化: 結合・分割→null、カット→保持。

## スコープ

含む:
- 純関数 `segmentOps.ts`: `toggleEnabled` / `mergeWithNext` / `splitAt`（＋単体テスト）
- reducer `SET_SEGMENTS { segments, selectId? }` アクション
- `computePreviewTimeline` が `enabled === false` を除外（preview/export 双方に反映）
- Inspector の操作ボタン（カット/有効化・分割・次と結合）と無効状態表示
- Timeline で無効セグメントのグレー表示
- 変更の永続化（既存 `project:updateSegments` 再利用）

含まない（後続ラウンド/フェーズ）:
- 端のドラッグトリム・タイムラインでの区間選択削除（ラウンド6b）
- セグメントのハード削除（カット＝無効化で代替）
- 複数選択・ドラッグ並べ替え
- 分割時のテキスト自動分割（第2片は空、ユーザーが編集）
- リップル/クリックの個別編集（別途）

## アーキテクチャ

### 純関数 `src/renderer/state/segmentOps.ts`（単体テスト対象）

`Segment[]` を受け取り新しい `Segment[]` を返す純粋変換。`tsconfig.node.json` の include に追加（`editorReducer.ts` と同様、テストが import するため）。

```ts
import { type Segment } from '../../shared/types';

/** 指定セグメントの enabled をトグルする。 */
export function toggleEnabled(segments: Segment[], id: string): Segment[];

/** 指定セグメントを次のセグメントと結合する（最後なら変化なし）。
 *  videoStart=first.videoStart, videoEnd=next.videoEnd, text/clicks を結合、
 *  voice=first、ttsAudio=null、id=first.id。next は除去。 */
export function mergeWithNext(segments: Segment[], id: string): Segment[];

/** 指定セグメントを atTime（videoStart < atTime < videoEnd）で2つに分割する。
 *  範囲外なら変化なし。first=[videoStart, atTime]（テキスト保持）、
 *  second=[atTime, videoEnd]（id=newId, correctedText=''）。clicks は時刻で分配、
 *  両片とも ttsAudio=null。 */
export function splitAt(segments: Segment[], id: string, atTime: number, newId: string): Segment[];
```

詳細:
- `toggleEnabled`: 該当 id の `enabled` を反転（不変更新）。他は不変。
- `mergeWithNext`: 該当 id の次要素と結合。`correctedText = a.correctedText + b.correctedText`、`originalText = a.originalText + b.originalText`、`clicks = [...a.clicks, ...b.clicks]`、`voice = a.voice`、`enabled = a.enabled`、`ttsAudio = null`、`id = a.id`。最後のセグメントなら元の配列を返す（変化なし）。
- `splitAt`: `atTime <= videoStart || atTime >= videoEnd` なら変化なし。first = `{ ...seg, videoEnd: atTime, clicks: clicks.filter(c => c.t < atTime), ttsAudio: null }`、second = `{ ...seg, id: newId, videoStart: atTime, correctedText: '', clicks: clicks.filter(c => c.t >= atTime), ttsAudio: null }`。first を second に置き換え（配列に2要素挿入）。`newId` は呼び出し側が一意に生成して渡す（純粋・テスト可能）。

### reducer `SET_SEGMENTS`

```ts
| { type: 'SET_SEGMENTS'; segments: Segment[]; selectId?: string }
```
- `state.project.segments` を差し替え、`selectId` 指定時は `selectedSegmentId` を更新（無効/削除で選択が外れた場合の付け替えに使用）。`project` が null なら no-op。

### `computePreviewTimeline` の変更（`src/shared/previewTimeline.ts`）

先頭で `enabled === false` を除外してからスロットを構築する:
```ts
for (const seg of segments) {
  if (seg.enabled === false) continue;
  ...
}
```
これにより preview（`TtsPreviewController`）と export（`exportService`）の両方がカットを尊重する。Timeline はカット表示のため `project.segments`（全件）を引き続き描画する。

### UI

- `Inspector.tsx`（選択中セグメント）にボタン:
  - **カット / 有効化**: `toggleEnabled` → `SET_SEGMENTS` → 永続化。無効時はラベル「有効化」、有効時「カット」。無効中はインスペクタに「カット中（プレビュー/書き出しで除外）」表示。
  - **分割（再生ヘッド位置）**: `state.currentTime` がセグメントの `(videoStart, videoEnd)` 内のときのみ有効。`splitAt(segments, id, currentTime, newId)`。`newId` は `seg-<時刻>` 等で一意生成。分割後は first を選択。
  - **次と結合**: 最後のセグメントでは無効。`mergeWithNext` 後は結合後セグメントを選択。
- `Timeline.tsx`: `enabled === false` のセグメントをグレー/ハッチ表示（再生中/選択ハイライトより視覚的に弱く）。
- 永続化: `SET_SEGMENTS` を dispatch した後、`window.api.updateSegments(newSegments)` で保存（フェーズ3で追加済みの IPC）。

## データフロー

Inspector のボタン → `segmentOps` で新 `Segment[]` を算出 → `SET_SEGMENTS{segments, selectId}` を dispatch（メモリ反映）＋ `window.api.updateSegments(segments)` で永続化。プレビュー/書き出しは次回 `computePreviewTimeline` 実行時に `enabled` を尊重。結合/分割で ttsAudio が null になったセグメントは、フェーズ4の「生成」ボタンで再生成できる。

## エラー処理・エッジ

- 最後のセグメントで「次と結合」→ no-op（ボタン無効化でも二重防御）。
- 再生ヘッドがセグメント外で「分割」→ no-op（ボタン無効化）。境界（atTime==videoStart/videoEnd）も no-op。
- 全セグメントを無効化 → preview/export は空（書き出しは「No segments to export」で失敗）。UI で全無効時は警告してもよい（必須ではない）。
- 選択セグメントが結合/分割で消える/変わる → `SET_SEGMENTS` の `selectId` で妥当な選択に付け替え。
- clicks の時刻 `t` は映像絶対秒。分割の分配・結合の和集合はこの絶対秒のまま（preview のリップルは `video.currentTime` キーなので整合）。

## テスト

- 単体（Vitest node 環境）:
  - `segmentOps`: `toggleEnabled`（対象のみ反転）、`mergeWithNext`（結合フィールド・clicks和集合・ttsAudio null・最後はno-op）、`splitAt`（範囲・clicks分配・第2片テキスト空・両片ttsAudio null・範囲外/境界はno-op・newId採用）。
  - `computePreviewTimeline`: `enabled === false` を除外する（既存テストは enabled:true なので回帰なし）。
  - `editorReducer`: `SET_SEGMENTS`（差し替え＋selectId、project null で no-op）。
- 手動E2E（実機GUI）: セグメント選択→カットでプレビュー/書き出しから除外（再生で飛ばされる・出力に含まれない）→有効化で戻る。分割で2つになり第2片が空・両片未生成、再生成できる。次と結合で1つになり ttsAudio クリア、再生成できる。Timeline で無効がグレー表示。
- `segmentOps` は純粋＝単体テスト、UI は手動E2E。

## 完了の定義

- `segmentOps`・`SET_SEGMENTS`・`computePreviewTimeline`（除外）の単体テストが通り、`npm test`/`npm run typecheck`/`npm run build` が green。
- 実機でカット（除外/復帰）・分割・結合ができ、プレビューと書き出しがカットを尊重し、結合/分割後に再生成できる。

## 未解決・先送り

- 端のドラッグトリム・区間選択削除（6b）。
- 分割時のテキスト分配の改善（現状は第2片空）。
- ハード削除・並べ替え・複数選択。
- 全無効時の書き出しUX（現状はエラー）。
