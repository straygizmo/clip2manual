# UI tweaks — home recording UX + editor icon/toggle cleanup

Date: 2026-05-30

## Background

ユーザーから次の小粒な改善要望が出た。いずれも既存機能の挙動・見た目を整える性質のもので、新規データモデルやアルゴリズムは伴わない。

ホーム画面:
- 最近の録画ごとにゴミ箱ボタンを表示し、削除可能にする
- 録画開始時にウィンドウを最小化する
- 録画中はタスクバーアイコンに赤いバッジを表示する
- 最小化アイコンをクリックしてウィンドウを元に戻したら自動的に録画を停止する
- デフォルト画面サイズを縦横それぞれ +100px

編集画面:
- 「カット」のハサミアイコンを「分割」に割り当てる
- 「カット」ボタンはトグルスイッチとし、デフォルト「有効」（再生する状態）
- 「次と結合」のアイコンの矢印は右向き

## Non-goals

- recording の中身（録画ストリーム/書き出し）の変更
- セグメント操作ロジック (`segmentOps.ts`) の変更
- mac/Linux 向けのタスクバーバッジ実装（Windows 専用の `setOverlayIcon` のみ。他 OS は no-op）

## Design

### 1. ホーム: 最近の録画にゴミ箱

**UI** (`HomeScreen.tsx`)
- 各 `Card` の右端、日時の右に `Button (variant="ghost", size="icon")` で `Trash2` アイコンを追加
- クリックで `window.confirm(t('home.deleteConfirm', { name }))` を表示し、OK なら `window.api.trashProject(projectDir)` を await し、成功後 `refreshRecent()` を呼ぶ

**Main / IPC** (`src/main/ipc/project.ts`)
- 新規 handler: `project:trash` (引数 `projectDir: string`) → `shell.trashItem(projectDir)` を呼び `{ ok: true }` を返す
- 失敗時は例外をそのまま投げ、renderer 側で alert に表示

**Preload** (`src/preload/index.ts`)
- `trashProject: (projectDir: string) => ipcRenderer.invoke('project:trash', projectDir)`

### 2. ホーム: 録画開始時の最小化 + 赤バッジ + 復帰で自動停止

**Main: ウィンドウ参照を保持** (`src/main/index.ts`)
- `createWindow()` 内で生成した `win` をモジュールローカル変数 `mainWindow` に格納し、`getMainWindow()` をエクスポート

**IPC: 録画状態通知** (`src/main/ipc/window.ts` を新規作成)
- 新規 handler:
  - `window:recordingStarted`: `mainWindow.minimize()` + `mainWindow.setOverlayIcon(redDotIcon, 'recording')` + 1 回だけ `mainWindow.once('restore', () => mainWindow.webContents.send('window:autoStop'))` を登録
  - `window:recordingStopped`: `mainWindow.setOverlayIcon(null, '')`、もし `restore` リスナーがまだ残っていれば `removeAllListeners('restore')` で外す
- `redDotIcon` は `nativeImage.createFromPath(path.join(resourcesPath, 'icons/recording-overlay.png'))`

**新規リソース**
- `resources/icons/recording-overlay.png` (16x16 透過 PNG、赤丸)
- ビルド時に main の `__dirname` から相対参照できる場所に配置する。`electron-vite` のリソース配置に合わせて `resources/` 直下に置く（既に `recording-overlay.png` が無い場合は新規追加）

**Preload**
- `notifyRecordingStarted: () => ipcRenderer.invoke('window:recordingStarted')`
- `notifyRecordingStopped: () => ipcRenderer.invoke('window:recordingStopped')`
- `onWindowAutoStop: (cb: () => void) => { const l = () => cb(); ipcRenderer.on('window:autoStop', l); return () => ipcRenderer.removeListener('window:autoStop', l); }`

**Renderer** (`HomeScreen.tsx`)
- `onStart` の最後で `await window.api.notifyRecordingStarted()`
- `onStop` の冒頭で `await window.api.notifyRecordingStopped()`
- `useEffect` で `recording` 状態が true の間だけ `window.api.onWindowAutoStop(() => onStop())` を登録し、cleanup で解除

**設計の理由**
- recording 状態を main 側に持たせず renderer 主導にしているのは、既存の `recording` state（`HomeScreen` の useState）を唯一の真実の源として保つため
- `restore` イベントは録画中の 1 回限り。録画停止時 / コンポーネントアンマウント時にリスナーを必ず外す

### 3. ホーム: デフォルト画面サイズ

`src/main/index.ts`:
- `width: 1100 → 1200`
- `height: 720 → 820`

### 4. 編集画面: ハサミ→分割 / カット→Switch / 結合→右矢印

**新規コンポーネント** `src/renderer/components/ui/switch.tsx`
- shadcn 標準の Switch 実装（`@radix-ui/react-switch` ベース）
- 依存追加: `npm i @radix-ui/react-switch`

**`TimelineToolbar.tsx`**
- import を更新:
  - 削除: `Scissors, SplitSquareHorizontal, ArrowDownToLine`
  - 追加: `Scissors, ArrowRightToLine` + `Switch`
- カットボタンを Switch に差し替え:
  ```tsx
  <label className="flex shrink-0 items-center gap-1 text-xs">
    <Switch
      checked={selected ? selected.enabled !== false : true}
      onCheckedChange={() => selected && onToggleCut(selected.id)}
      disabled={!selected || ttsBusy}
    />
    {t('inspector.playSegment')}
  </label>
  ```
  - ON = enabled（再生する）、OFF = カット
- 分割ボタンのアイコン: `SplitSquareHorizontal` → `Scissors`
- 結合ボタンのアイコン: `ArrowDownToLine` → `ArrowRightToLine`

**i18n** (`src/renderer/i18n.ts` の ja/en)
- 新規キー: `inspector.playSegment` (ja: "再生する" / en: "Play")
- 既存の `inspector.cut` / `inspector.enable` は他箇所で使われていれば残し、本ツールバーからは参照を外す

### Files touched

| File | Change |
| --- | --- |
| `src/main/index.ts` | window size 拡大、`mainWindow` 保持 |
| `src/main/ipc/index.ts` | 新規 `registerWindowIpc` を呼び出し |
| `src/main/ipc/window.ts` (new) | recordingStarted / recordingStopped handler、overlay icon、restore リスナー |
| `src/main/ipc/project.ts` | `project:trash` handler |
| `src/preload/index.ts` | trashProject / notifyRecordingStarted / notifyRecordingStopped / onWindowAutoStop |
| `src/renderer/global.d.ts` | 上記 API の型追加 |
| `src/renderer/home/HomeScreen.tsx` | 削除ボタン、録画開始/停止時に main へ通知、autoStop 購読 |
| `src/renderer/editor/TimelineToolbar.tsx` | Switch 化、アイコン入れ替え |
| `src/renderer/components/ui/switch.tsx` (new) | shadcn Switch |
| `src/renderer/i18n.ts` | `home.deleteConfirm`, `inspector.playSegment` |
| `package.json` | `@radix-ui/react-switch` 追加 |
| `resources/icons/recording-overlay.png` (new) | 赤丸 16x16 |

## Tests

**自動テスト**
- `src/main/ipc/__tests__/project.trash.test.ts` (新規): `shell.trashItem` をモックし、handler が正しい引数で呼ぶことを検証
- 既存テスト（segmentOps など）はロジック変更がないためそのままパス
- `TimelineToolbar` の単体テストは元々無いため新規追加はしない（手動 E2E でカバー）

**手動 E2E チェックリスト**
- 録画開始 → ウィンドウが最小化される
- 録画中のタスクバーアイコンに赤いオーバーレイ（Windows）
- タスクバーアイコンクリックでウィンドウが復帰し、同時に自動停止して編集画面に遷移
- ホームに戻り、最近の録画カード右端のゴミ箱をクリック → 確認ダイアログ → OK で OS のゴミ箱に移動、リストから消える
- 起動時のウィンドウサイズが 1200x820
- 編集画面: 分割ボタンがハサミ ✂️、結合ボタンが右矢印 ➡️、カットはトグルスイッチで既定 ON（緑/有効状態）
- カットスイッチを OFF にすると該当セグメントがタイムラインで半透明 (`opacity-35`) になる

## Risks

- `setOverlayIcon` は macOS では何もしない。要望は Windows 前提のため許容。
- `restore` イベントは「最小化からの復帰」以外（タスクバー右クリックメニューからの復帰など）でも発火する。仕様としては「ウィンドウが前面に戻った時点で停止」と解釈して許容。
- `shell.trashItem` はネットワークドライブや特殊フォルダでは失敗する可能性がある。失敗時は alert で通知。
