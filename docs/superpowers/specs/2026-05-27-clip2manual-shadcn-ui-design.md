# shadcn UI 全面ダークリデザイン設計

- 日付: 2026-05-27
- 対象: レンダラー UI を Tailwind v4 + shadcn/ui ベースに刷新し、「プロNLE風ダーク」テーマで全面リデザインする。ロジック（reducer / IPC / segmentOps / previewTimeline 等）は一切変更しない、純粋な表示層の入れ替え。
- 位置づけ: フェーズ番号外の横断的UIリフレッシュ。**Phase 6（セグメント編集）を master にマージし切ってから着手**し、master 起点の新ブランチで進める（同一ファイル — EditorLayout / Inspector / Timeline — を大きく触るためコンフリクト回避）。
- 関連: `2026-05-26-clip2manual-design.md`（全体設計）、`2026-05-27-clip2manual-phase6a-segment-ops-design.md`（直前の編集対象ファイルが重なる）

## 背景と目的

現状のレンダラーは **全コンポーネントがインライン `style={{}}` のみ**で構築されている（CSS ファイル・CSS モジュール・Tailwind・コンポーネントライブラリは一切なし）。`main.tsx` はグローバル CSS を import していない。プレーンな HTML の `<button>` / `<select>` / `<input type=range>` / `<textarea>` が使われ、ツールバーは濃グレー（#2a2a2a）、インスペクタは明色という不統一な見た目になっている。

目的は、見た目を「かっこよく」する全面リデザイン。動画編集アプリとしてプレビュー映像が映え、社内・非技術者にも扱いやすい **プロNLE風ダーク** に統一する。shadcn/ui を採用し、アクセシビリティと部品の完成度を担保する。

## 確定方針（ブレスト）

- **範囲 = 全面リデザイン**（配色・余白・パネル質感まで作り直す。コントロール置換だけでは終わらせない）。
- **テーマ = プロNLE風ダーク**（背景 #1e1e1e〜#2a2a2a のグレー階調、テキスト #e0e0e0、アクセント青 #3b82f6、映像が映える黒系プレビュー）。**ダーク固定**（ライト切替トグルは作らない。ただし将来追加可能な CSS 変数構造にする）。
- **土台 = Tailwind v4 + shadcn（Viteプラグイン方式）**。`@tailwindcss/vite` プラグイン、CSS-first 設定（`tailwind.config.js` を作らない）。electron-vite の renderer と相性が良く設定ファイル最小。
- **進行順 = Phase 6 を先に完了**してから、master 起点の新ブランチでリデザイン。
- **レイアウト構成（3ゾーン: ツールバー / プレビュー+インスペクタ / タイムライン）は維持**し、質感のみ刷新（パネルの再アーキテクチャはしない）。
- **ロジック無変更**。reducer / IPC / segmentOps / previewTimeline / RippleCanvas 描画はそのまま。

## スコープ

含む:
- 土台セットアップ（依存追加、vite/tsconfig エイリアス、グローバル CSS + テーマトークン、shadcn 初期化）
- NLEダークのテーマトークン定義（CSS 変数）
- HTML コントロール → shadcn 部品への全置換
- 4 画面（HomeScreen / EditorLayout ツールバー / Inspector / Timeline）と PreviewPlayer コンテナの再スタイル
- 残インラインスタイルの除去と最終仕上げ

含まない（後続フェーズ / 別作業）:
- ライト/ダーク切替トグル
- パネル構成の再アーキテクチャ（ゾーン分割の変更）
- 新機能（設定パネル⚙ は Phase 8。ツールバーは既存アクションの見た目刷新のみ）
- ロジック変更（reducer / IPC / segmentOps / previewTimeline / RippleCanvas 描画）
- タイムラインの新インタラクション（トリム等は Phase 6b）

## アーキテクチャ

### ① 土台セットアップ

- **依存追加**: `tailwindcss@^4`, `@tailwindcss/vite`, `lucide-react`（アイコン）, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`。shadcn 部品が使う Radix プリミティブは `npx shadcn add <component>` 時に都度追加される。これらは renderer 同梱（バンドル）でよく、`externalizeDepsPlugin` の対象外。`uiohook-napi` のようなネイティブ依存とは扱いが異なる。
- **`electron.vite.config.ts`**: renderer の `plugins` に `tailwindcss()` を追加。`renderer.resolve.alias` に `@` → `resolve(__dirname, 'src/renderer')` を追加。
- **`tsconfig.web.json`**: `compilerOptions.paths` に `"@/*": ["src/renderer/*"]` を追加（`baseUrl` は base 側で `.` 設定済み）。
- **`src/renderer/index.css`**（新規）: 先頭に `@import "tailwindcss";` と `@import "tw-animate-css";`。`@theme`（または `@layer base` の `:root`）で NLEダーク配色の CSS 変数を定義。`main.tsx` の先頭で `import './index.css'`。
- **`components.json`**（新規・プロジェクトルート）: shadcn 設定。`tsx: true`, `rsc: false`, スタイル既定、`tailwind.css` = `src/renderer/index.css`、`aliases.components` = `@/components`、`aliases.utils` = `@/lib/utils`。
- **`src/renderer/lib/utils.ts`**（新規）: `cn()` ヘルパ（clsx + tailwind-merge）。
- 部品は `src/renderer/components/ui/` に配置される。

### ② テーマトークン（プロNLEダーク・ダーク固定）

CSS 変数で一元管理する。値はダーク固定だが、将来 `.light` クラス等を追加できる構造にする。
- shadcn 標準トークン: `--background #1e1e1e` / `--foreground #e0e0e0` / `--card #252525` / `--card-foreground` / `--popover` / `--primary #3b82f6`（青アクセント）/ `--primary-foreground` / `--secondary` / `--muted` / `--muted-foreground` / `--accent` / `--destructive` / `--border #3a3a3a` / `--input` / `--ring`、`--radius`。
- エディタ専用トークン: ツールバー背景（濃グレー #2a2a2a）、タイムラインのトラック地・セグメント色（有効 / カット = グレーアウト / 選択 / 再生中）、再生ヘッド = 青。

### ③ コンポーネント対応（HTML → shadcn）

| 現状 | 置換後 |
|---|---|
| `<button>` | `Button`（variant: default / secondary / ghost / destructive、size 各種） |
| 話者 `<select>` | `Select` |
| 速度 `<input type=range>` | `Slider` |
| 補正 `<textarea>` | `Textarea` ＋ `Label` |
| 「編集済み」「生成済み」表示 | `Badge` |
| 文字起こし / TTS / 書き出し の % | `Progress` |
| インスペクタ各節 | `Card` / `Separator` |
| 完了 / 失敗の一過性通知 | `sonner`（トースト）。致命的な恒常エラーは破壊色テキスト |
| アイコンボタンの説明 | `Tooltip` |
| インスペクタのスクロール | `ScrollArea` |
| 装飾アイコン | `lucide-react`（Home, Download, Play, Scissors=カット, SplitSquareHorizontal=分割, Merge, RotateCcw=元に戻す 等） |
| `<audio controls>` | ネイティブ維持（shadcn に音声プレーヤー部品なし）。枠だけ整える |

### 画面ごと

- **HomeScreen**: タイトル、録画ボタン（大・primary／録画中は destructive で「停止」）、フォルダから開く（secondary）、最近の録画を Card 行で一覧、ステータス文。
- **EditorLayout ツールバー**: 濃グレーで再構成。左 = ナビ（← ホーム）＋プロジェクト名、中央 = 文字起こし / 既定の声（Select + Slider）/ TTS 生成、右 = 書き出し。アイコン＋ラベル＋Tooltip。進捗は `Progress`、キャンセルは ghost ボタン。
- **Inspector**: カード / 節に整理。Label・Select・Slider・Textarea・Badge を使用。セグメント操作（カット / 分割 / 次と結合）はアイコン付きボタン。無効（カット中）状態の視覚表示。
- **Timeline**: 独自レイアウトは維持（shadcn 部品ではない）。Tailwind トークンで再配色 — トラック地、セグメント塊（有効 / カット / 選択 / 再生中）、青の再生ヘッド。
- **PreviewPlayer / RippleCanvas**: コンテナ / 背景を整え、映像を枠で締める。**RippleCanvas の描画ロジックは一切触らない**。

### ④ ロールアウト（レビュー可能な単位に分割）

1. **土台コミット**: 依存・vite/tsconfig エイリアス・`index.css` テーマ・`components.json`・`lib/utils`・初期 shadcn 部品の導入。**この時点では見た目は現状のまま**（インラインスタイル残置＝視覚的無回帰）。build / typecheck / dev で土台が機能することを確認。
2. **画面ごと変換**: HomeScreen → Inspector → ツールバー → Timeline → Preview の順に、各々を集中したコミットで shadcn 化。
3. 残インラインスタイル除去＋最終仕上げ（配色・余白の統一確認）。

各ステップでロジックは無変更。reducer / IPC / segmentOps はそのまま、純粋に表示層のみ。

## テスト・検証

- 既存 Vitest はロジック専用（segmentOps, ffargs, previewTimeline 等） → 表示層変更の影響を受けない。UI は表示層のため新規ユニットテストは必須化しない。
- **`npm run typecheck` と `npm run build` をクリーンに維持**（特にエイリアス解決 — vite alias と tsconfig paths の一致）。
- 手動 E2E（`npm run dev`）: 各画面が描画され、操作（文字起こし / TTS 生成 / セグメント操作 / 書き出し）が機能し、ダーク配色が統一され、レイアウト崩れがないこと。

### 注意点 / 落とし穴

- **エイリアス二重定義の一致**: electron-vite renderer の `resolve.alias` と `tsconfig.web.json` の `paths` は同じ `@` → `src/renderer` を指す必要がある（片方だけだと dev は通っても typecheck/build で落ちる、またはその逆）。
- **Tailwind v4 の preflight**: base スタイルをリセットするため、ネイティブ `<audio>` / `<video>` の表示・操作が維持されることを確認する。
- **`lucide-react` は renderer 同梱でOK**（externalize 不要。ネイティブ依存ではない）。
- index.html に CSP メタは無いため、Tailwind のスタイル注入・shadcn の CSS 変数は問題なし。

## 未解決事項

- なし（土台・テーマ・進行順・部品対応すべて確定済み）。実装計画フェーズで各画面の変換単位を詳細タスク化する。
