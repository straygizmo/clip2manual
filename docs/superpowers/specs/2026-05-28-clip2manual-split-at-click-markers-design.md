# タイムラインのクリックマーカーで分割（設計）

- 日付: 2026-05-28
- 対象: タイムラインのクリック行に並ぶクリックマーカー（菱形）を**ダブルクリック**すると、そのクリック時刻 `c.t` を分割点として、当該クリックを含むセグメントを2片に分割する機能を追加する。
- 位置づけ: フェーズ6a（セグメント操作）の小さな拡張。新フェーズとはせず、UX 改善として独立した小さい変更で完結させる。
- 関連: `2026-05-27-clip2manual-phase6a-segment-ops-design.md`（既存 `splitAt` を流用する）、`2026-05-27-clip2manual-phase4-tts-generation-design.md`（短いセグメント単位の TTS による同期改善が本機能の動機）

## 背景と目的

録音時に1回の連続発話で複数のクリック動作（例: 「画面の左上クリック → システムサウンド → デスクトップの左上クリック → 右上クリック … 」）をまとめて喋ると、文字起こしが**1つの長大なセグメント**になる。これを VOICEVOX で TTS 置換すると、合成された音声の流れと、元映像で起きるクリックのタイミングがずれ、書き出した動画では「説明」と「動作」が同期しない。

解決策はセグメントを動作単位に分割すること。既存の「分割（再生ヘッド位置）」ボタンは再生ヘッドを正確に置く操作が必要で、多数のクリックを順に区切るには現実的でない。タイムラインに**既に表示されているクリックマーカーを直接ダブルクリック**できれば、目視で狙って一発で分割できる。

## 確定方針（ブレスト）

- トリガー = **クリックマーカーのダブルクリック**のみ。単一クリックは現状どおり無反応（誤動作防止）。
- 分割位置 = クリック時刻 `c.t` そのもの。既存 `splitAt(segments, id, atTime, newId)` を流用し前後2片へ。
- 分割後の選択 = **後片（新ID）を選択**して即テキスト入力できる状態にする（「このクリックを描写する文を書く」のが直後の典型作業のため）。
- マーカー本体の見た目（菱形 8px）は維持。**当たり判定だけ広げる**（透明 16px ラッパでホバー/ダブルクリックを取りやすくする）。
- ホバーで `cursor-pointer` ＋ `title="ダブルクリックで分割"` を出して発見性を確保。
- 一括「全クリックで分割」は今回は作らない（YAGNI）。個別ダブルクリックで N クリック → N 回操作で十分。
- データ構造・reducer・IPC は変更しない（既存 `SET_SEGMENTS` + `project:updateSegments` をそのまま使う）。

## スコープ

含む:
- `Timeline.tsx`: クリックマーカーに segmentId を持たせ、ダブルクリックハンドラと当たり判定パッドを追加。`onSplitAtClick?: (segmentId, t) => void` を Props で受ける。
- `EditorLayout.tsx`: `Timeline` に `onSplitAtClick` を渡し、`splitAt` を呼んで `applyOps` 相当の更新（`SET_SEGMENTS` ディスパッチ ＋ `updateSegments` 永続化）。
- 軽い単体テスト（`splitAt` 既存テストで十分／本機能特有のロジックなし）。
- 手動 E2E 確認。

含まない（YAGNI／後続）:
- Inspector への一括「全クリックで分割」ボタン
- テキストの自動分配（テキストは現状どおり前片に全文集中、ユーザが手で再分配）
- ドラッグでの境界調整（フェーズ6b領域）
- 単一クリックでマーカー選択／ハイライト
- 分割の Undo（既存にも無いため整合）

## アーキテクチャ

### データフロー

```
ユーザがタイムラインのクリックマーカーをダブルクリック
    ↓ (Timeline は segmentId と c.t を引数に onSplitAtClick を発火)
EditorLayout のハンドラ
    ↓ splitAt(segments, segmentId, c.t, newId)
新しい segments[]（前片＝既存ID、後片＝newId）
    ↓ dispatch({ type: 'SET_SEGMENTS', segments, selectId: newId })
ストア更新（後片が選択される）
    ↓ void window.api.updateSegments(segments)
project.json へ永続化
```

### `splitAt(c.t)` 振る舞いの確認（既存挙動を再掲）

`splitAt(segments, id, atTime=c.t, newId)`:
- 前片: `videoEnd = c.t`、`clicks = clicks.filter((cc) => cc.t < c.t)`、テキスト保持、`ttsAudio = null`
- 後片: `videoStart = c.t`、`clicks = clicks.filter((cc) => cc.t >= c.t)`、テキスト空、`id = newId`、`ttsAudio = null`

**そのクリック本体は `cc.t >= c.t`（特に `==`）の側に入る** → 後片に含まれる。意図と一致（後片が「このクリックの描写」になる）。

`atTime <= videoStart` または `atTime >= videoEnd` の場合は `splitAt` は no-op を返す（既存ガード）。`c.t == videoStart` のクリックは分割不能だが、これは極めて稀（最初のフレームのクリック）。

### Timeline 側の実装方針

`allClicks` を構築する箇所を変えて segmentId を持たせる:

```ts
const allClicks: Array<{ x: number; y: number; t: number; button: number; segmentId: string }> =
  segments.flatMap((s) => s.clicks.map((c) => ({ ...c, segmentId: s.id })));
```

マーカー描画 JSX:

```tsx
<div
  key={`${c.segmentId}-${i}`}
  className="absolute size-4 cursor-pointer"
  style={{ top: ROW_H / 2 - 8, left: `calc(${timeToPercent(c.t, duration)}% - 8px)` }}
  title="ダブルクリックで分割"
  onDoubleClick={(e) => { e.stopPropagation(); onSplitAtClick?.(c.segmentId, c.t); }}
>
  <div className="size-2 rotate-45 bg-click-marker" style={{ margin: '4px' }} />
</div>
```

外側 `size-4`（16px）が当たり判定、内側 `size-2`（8px）が見た目の菱形。中央寄せのため `margin: 4px`。

`onSplitAtClick` が未指定でも動く（任意 Props）。

### EditorLayout のハンドラ

```ts
const onSplitAtClick = (segmentId: string, t: number) => {
  const newId = `seg-${Date.now()}`;
  const next = splitAt(segments, segmentId, t, newId);
  if (next === segments) return; // no-op（境界クリック等）
  dispatch({ type: 'SET_SEGMENTS', segments: next, selectId: newId });
  void window.api.updateSegments(next);
};
```

### 既存 Inspector の分割ボタンとの整合

Inspector の「分割（再生ヘッド位置）」は引き続き `state.currentTime` で `splitAt` を呼ぶ。挙動を本機能と揃えるため、Inspector 側の `selectId` も**新ID（後片）**に変更する（現状は元の id ＝ 前片を選択し続けるが、これは一貫性のため後片選択に揃える）。

修正対象: `src/renderer/editor/Inspector.tsx` の `onSplit`:

```ts
// 修正前
const onSplit = () => applyOps(splitAt(segments, segment.id, state.currentTime, `seg-${Date.now()}`), segment.id);

// 修正後
const onSplit = () => {
  const newId = `seg-${Date.now()}`;
  applyOps(splitAt(segments, segment.id, state.currentTime, newId), newId);
};
```

## テスト

**単体テスト**:
- `segmentOps.test.ts` の既存 `splitAt` テストは無変更で通る。`c.t` 由来かどうかは関数の外の責務なので追加テスト不要。
- 新規ユニットテストは作らない（Timeline は描画＋既存純関数の合成、Inspector は1行の selectId 変更）。

**手動 E2E**:
- 10クリック持つ単一セグメント上でマーカーを1個ずつダブルクリック → 各回1段ずつ分割され、後片が選択され、テキスト入力欄が即編集可能になる。
- マーカーをホバーすると `cursor-pointer` ＋ ツールチップが出る。
- 単一クリックでは何も起きない（既存どおり）。
- カット中（`enabled=false`）セグメントのマーカーをダブルクリックしても分割される（両片の `enabled` を継承）。
- `c.t == videoStart` のマーカー（あれば）は分割不能で no-op、エラーも出ない。
- 分割後、書き出し動画でクリックと TTS が同期する（本機能の本来の目的検証）。

## 非対象（YAGNI／後続フェーズ）

- 「全クリックで分割」一括ボタン
- 分割テキストの自動分配
- 単一クリックでのマーカー選択／ハイライト
- ドラッグでの境界調整（フェーズ6b）
- 分割の Undo

## 未解決事項

なし（インタラクション・データフロー・エッジケース・既存 Inspector との整合いずれも確定）。
