# フェーズ7ラウンドB（リップル焼き込み）設計

- 日付: 2026-05-28
- 対象: Phase 7a の MVP 書き出し（リタイミング映像＋TTS→MP4）に、クリック点のリップル overlay を**書き出し動画へ焼き込む**機能を追加する。プレビュー（Phase 5）と挙動・見た目を整合させる。
- 位置づけ: ロードマップのフェーズ7「書き出し」のラウンドB。ラウンドAは MVP 書き出しとして既に master 済み（commit `f064578` 系）。
- 関連: `2026-05-27-clip2manual-phase7a-export-design.md`（書き出しパイプライン）、`2026-05-27-clip2manual-phase5-ripple-preview-design.md`（プレビューのリップル）、`2026-05-26-clip2manual-design.md`（全体設計）

## 背景と目的

Phase 5 で導入したクリックリップル（`RippleCanvas` + `rippleOverlay.ts`）は**プレビューのみ**で映像に重ねている。Phase 7a の書き出しは現状リップル無し。マニュアル動画としての完成形は「ナレーション＋クリック点強調」のため、書き出し動画にもリップルを焼き込む必要がある。

本ラウンドはこの焼き込みを実装する。映像自体（raw.webm からの切り出し）と音声（TTS）の組み立てパイプラインは Phase 7a を温存し、**スロットごとに overlay を挿入**する形で最小変更とする。

## 確定方針（ブレスト）

- **忠実度=近似でOK**: 「中心ドット＋拡大フェードリング・0.8秒」という核要素は維持しつつ、SVG ベース描画で実装。色・成長カーブ・ドットは既存定数を流用するが、ピクセル単位の完全一致は要求しない。
- **常にON**（UI トグル無し）。マニュアル動画の本質である以上、書き出しオプションを増やす必要なし。
- **アプローチ=A1+B1**: ① `sharp` で SVG→透明 PNG シーケンスを Node 側で生成、② per-slot ffmpeg 起動に第2入力として渡し `overlay` フィルタを挿入。
- **スロット境界で active リセット**（プレビュー仕様一致）。末尾フリーズ区間にはリップルの残り animation が自然に伸びる。
- **依存追加 = `sharp` のみ**（Windows prebuild あり、ネイティブ追加コンパイル不要）。
- **ロジックは Phase 7a 構造を温存**: concat はストリームコピーのまま、mux も `-c:v copy` のまま。

## スコープ

含む:
- 純関数 `rippleFrames.ts`: `activeRipplesAt` / `rippleSvg`（＋単体テスト）
- I/O 関数 `generateRippleFramesForSlot`: スロットごとに PNG シーケンスを `tmpDir` 配下に生成。クリック無しスロットは null を返し overlay スキップ。
- `ffargs.ts` の `segmentVideoArgs` に optional `ripple?: { pattern, fps }` を追加（無指定時は従来動作）。`-i image2` を第2入力にし `-filter_complex` で overlay。`-ss/-t` の `-i` 前置（Phase 7a 重要バグの再発防止）は維持。
- `ffargs.ts` に `probeResolutionArgs` / `parseResolution` を追加（raw.webm の幅×高さ取得）。
- `exportService.ts`: 各スロットで該当クリック抽出→`generateRippleFramesForSlot`→`segmentVideoArgs` に渡す統合。中断チェックをリップル生成中にも入れる。
- `sharp` を `dependencies` に追加（renderer ではなく main で使うため通常依存）。
- 単体テスト一式（純関数 + ffargs スナップショット + parseResolution）。

含まない（後続/対象外）:
- リップル ON/OFF トグル、配色/期間カスタマイズ
- 出力 fps/品質設定（既存どおり raw fps + libx264 veryfast crf20）
- リップルのスロット境界持ち越し
- UI 変更
- フェーズ6b（端トリム/区間削除）、フェーズ8（ウィザード/インストーラ）

## アーキテクチャ

### データフロー

```
clicks (segment.clicks フラット化) + slots (computePreviewTimeline)
   ↓ (TS pure fn: 各スロットの active ripple plan を構成)
スロットごとの active ripples
   ↓ (sharp: SVG → 透明 PNG)
<tmpDir>/<slotId>_ripple/%05d.png シーケンス（fps=raw.fps）
   ↓ (per-slot ffmpeg: -i raw + -i image2、filter_complex で
       tpad → fps → setpts → overlay)
per-slot 中間 MP4（Phase 7a と同パラメータで均一エンコード）
   ↓ (concat 既存・ストリームコピー / mux 既存)
最終 MP4
```

### 描画math（近似版・既存定数流用）

`src/renderer/editor/rippleOverlay.ts` の以下を `src/shared/rippleOverlay.ts`（または同等の共有モジュール）に共通化し、renderer 側と main 側の両方で参照する:
- `RIPPLE_DURATION = 0.8`（秒）
- `RIPPLE_MAX_RADIUS_RATIO = 1/12`

各 active ripple について、スロット相対時刻 `t_slot` での描画パラメータ:
- `elapsed = t_slot - fireTime_slot`
- `0 ≤ elapsed < RIPPLE_DURATION` のとき active、それ以外は描画しない
- `k = elapsed / RIPPLE_DURATION`
- 外周リング: `radius = max(2, k * w * RIPPLE_MAX_RADIUS_RATIO)`、stroke `#ffcf33`、`stroke-width = max(2, w/400)`、`fill="none"`、`opacity = 1 - k`
- 中心ドット: `radius = max(3, w/320)`、fill `#ff5470`、`opacity = 1 - k`

SVG 出力例:

```xml
<svg width="W" height="H" viewBox="0 0 W H" xmlns="http://www.w3.org/2000/svg">
  <circle cx="X" cy="Y" r="R" fill="none" stroke="#ffcf33" stroke-width="LW" opacity="A"/>
  <circle cx="X" cy="Y" r="DR" fill="#ff5470" opacity="A"/>
</svg>
```

active が空のフレームは空 SVG（背景のみ）として書き出す。連続番号維持のため空フレームも PNG を出力する（小サイズの透明 PNG なので I/O コスト軽微）。

### 時刻マッピング（スロット相対・プレビュー仕様一致）

- スロットに属するクリック = `slot.videoStart < c.t && c.t <= slot.videoEnd` を満たすもの（Phase 5 の `clicksCrossed` 半開区間に一致）。
- スロット相対発火時刻: `fireTime_slot = c.t - slot.videoStart`（範囲 `(0, videoSpan]`）。
- 各出力フレーム `n` のスロット時刻: `t_slot = n / fps`、`n ∈ [0, ⌈slotDuration · fps⌉)`。
- 末尾 freeze 区間 `[videoSpan, slotDuration]` のフレームも同じロジックでリップル残響を描画（自然に伸びる）。
- スロット境界では active を持ち越さない（per-slot で生成・終了するため自動的に達成）。

### 新規/変更ファイル

新規:
- `src/main/export/rippleFrames.ts`
  - `activeRipplesAt(clicks: ClickEvent[], slot: PreviewSlot, t_slot: number): ActiveRippleVisual[]`（純関数）
  - `rippleSvg(actives: ActiveRippleVisual[], w: number, h: number): string`（純関数）
  - `generateRippleFramesForSlot(input): Promise<{ pattern: string; fps: number } | null>`（I/O、クリック無しは null）
- `src/shared/rippleOverlay.ts`: 既存 `src/renderer/editor/rippleOverlay.ts` を**そのまま移設**（全関数とも純粋なので shared 化可能）。`src/renderer/editor/rippleOverlay.ts` は新パスから re-export するだけの薄いシムにし、renderer 既存コードの import パスは無変更で済むようにする。

変更:
- `src/main/export/ffargs.ts`
  - `segmentVideoArgs` に optional `ripple?: { pattern: string; fps: number }` を追加。指定時:
    - 第2入力 `-framerate <fps> -i <pattern>` を追加（`-i raw` の後）
    - `-vf` を `-filter_complex` に置換し `[0:v] tpad=...,fps=<fps>,setpts=PTS-STARTPTS [vbase]; [vbase][1:v] overlay=shortest=1 [vout]`
    - `-map "[vout]"` を追加
  - 指定なし時は従来の `-vf` 動作を維持（互換性）。
  - `probeResolutionArgs(file): string[]` と `parseResolution(stdout): { width: number; height: number }` を追加。
- `src/main/export/exportService.ts`
  - 起動時に `probeResolutionArgs` で raw.webm の解像度を取得。
  - 各スロットで `slot.clicks = segments.find(...).clicks.filter(slot 範囲内)` を抽出（または全 clicks フラット化から filter）。
  - 空でなければ `generateRippleFramesForSlot` で PNG seq 生成、結果を `segmentVideoArgs({ ..., ripple })` に渡す。
  - リップル生成中も `signal.aborted` を確認しキャンセル可能に。
- `package.json`: `sharp` を `dependencies` に追加。
- `src/renderer/editor/rippleOverlay.ts`: 共有モジュールから定数を再 export（互換性維持）。

### FFmpeg フィルタグラフ詳細

リップル有り（per-slot）:
```
ffmpeg -y
  -ss <slot.videoStart> -t <videoSpan> -i raw.webm
  -framerate <fps> -i <slotId>_ripple/%05d.png
  -filter_complex "[0:v] tpad=stop_mode=clone:stop_duration=<freeze>,fps=<fps>,setpts=PTS-STARTPTS [vbase]; [vbase][1:v] overlay=shortest=1 [vout]"
  -map "[vout]"
  -an
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p
  <slotOut>.mp4
```

ポイント:
- `-ss <start>` / `-t <span>` は **`-i raw.webm` の前**（入力オプション）に置く。Phase 7a の重要バグ修正と同じ理由: tpad が入力 EOF を受け取り末尾フレームをクローンできるようにするため。
- `overlay=shortest=1` で PNG シーケンスと tpad 出力の短い方で停止（両方とも slotDuration × fps の長さに揃う）。
- 概念上は両方が同 fps で同じフレーム数。PNG seq 側は `-framerate` のみ指定し（再エンコードしない）、ピクセル一致でアルファ合成。
- リップル無しスロット（クリック空）は従来の単一入力 `-vf` パス。

### `sharp` 利用

- Buffer 化した SVG 文字列 → PNG: `sharp(Buffer.from(svgString)).png({ compressionLevel: 9 }).toFile(filepath)`。
- 解像度は raw.webm のもの（ffprobe で取得）。SVG の `viewBox` を映像座標系に合わせる（拡縮なし、1:1）。
- 同一スロット内のフレームは逐次（非並列）で書き出して I/O を予測可能に。並列化はスロット間（既存のスロットループに任せる）。

## テスト

**Vitest 単体テスト**（純関数・I/O 無し）:
- `activeRipplesAt`:
  - クリックがスロット外（前後）→ 空配列
  - `t_slot = fireTime_slot`（境界）→ `elapsed = 0` で active（描画される）
  - `t_slot = fireTime_slot + 0.4`（中間）→ `k = 0.5`, `alpha = 0.5`
  - `t_slot = fireTime_slot + 0.8` ちょうど → 期限切れ（active でない）
  - 複数クリック同時 active（位相ずれ）
  - フリーズ区間（`t_slot > videoSpan` だが `elapsed < 0.8`）でも active 継続
- `rippleSvg`:
  - active 0 件 → `<circle>` 0 件、有効な SVG 文字列
  - active n 件 → `<circle>` 2n 件（リング＋ドット）、座標/半径/不透明度/色を構造的に確認
  - 異常入力（NaN 座標など）はスローまたはスキップ（明示）
- `segmentVideoArgs`:
  - `ripple` 無指定: 既存スナップショット（`-vf` 形式、`-ss/-t` が `-i` の前）
  - `ripple` 指定: `-i image2` が2番目、`-filter_complex` に切替、`-map "[vout]"` 付与、`-ss/-t` は依然 `-i raw` の前
- `parseResolution`: `1920,1080`、空白/改行混入、`,` 区切り不正の異常系
- `parseProbeDuration`/`parseFps`: Phase 7a の既存テストは変更なし

**手動 E2E**（要・実機）:
- クリック付きプロジェクトで書き出し
- 出力 MP4 をプレーヤーで確認:
  - リップルが期待の位置・タイミングで現れる（プレビューと一致する程度）
  - リップルがフリーズ区間に伸びることがある（音声が長い時）
  - リップルがスロット境界をまたがない
- クリック無しセグメントのみの書き出し: 従来パスで成功し overlay 無し
- キャンセル: リップル生成途中でも中断し tmp 残らない

## エラー処理・進捗

- `sharp` の解決失敗・SVG ラスタライズ失敗 → exportService が即時 reject、UI に表示（既存の書き出し失敗表示パス）。
- 進捗計算は Phase 7a の `total = slots + 2 + 1` を維持（リップル生成はスロット tick 内で完結）。スロット内をさらに細分しないが、長尺スロットで進捗が止まって見える場合は future work。
- 中断: `signal.aborted` をスロットループ内、リップル生成ループ内、両方でチェック。中断時は tmpDir を既存ロジックで削除。
- 中間ファイル: PNG seq は `tmpDir/<slotId>_ripple/` 配下。書き出し終了/失敗/キャンセル時に既存の tmpDir 削除でまとめて掃除。

## 未解決事項

なし（描画math・統合点・依存・テスト粒度すべて確定済み）。実装計画フェーズでタスク分割する。
