# Capture Source Picker — Design

Status: spec (2026-05-30)

## 目的

Home 画面に「録画対象」を選ぶプルダウンを追加し、特定のディスプレイ／ウィンドウだけを録画対象にできるようにする。クリック座標もその選択に合わせて変換し、対象領域外のクリックは記録しない。

現状の挙動:
- `ScreenRecorder.start()` が `navigator.mediaDevices.getDisplayMedia({video:true})` を呼ぶ
- `setDisplayMediaRequestHandler`（`src/main/index.ts`）が無条件に `desktopCapturer.getSources({types:['screen']})[0]` を返す → 常にプライマリ画面のみ
- `recording:stop`（`src/main/ipc/recording.ts`）が `screen.getPrimaryDisplay()` の bounds を `CaptureGeometry` に詰めて `buildClickLog` に渡す

これを「選択された source の bounds」を使う形に拡張する。

## 非目標

- 録画中のウィンドウ移動への追従。コンテンツ自体は desktopCapturer がウィンドウハンドルを掴むので追従されるが、クリック座標→ウィンドウ内座標の変換は録画開始時の bounds で固定する（仕様）
- 任意 ROI のドラッグ選択
- 自前ウィンドウの録画

## ユーザー体験

Home 画面の録画ボタン横に select 風のプルダウンを置く。

```
─ 画面 ─
  ディスプレイ 1（プライマリ・1920×1080）   ← 既定
  ディスプレイ 2（2560×1440）
─ ウィンドウ ─
  メモ帳 - 無題
  Visual Studio Code - clip2manual
  …
```

- 開いた瞬間に `desktopCapturer.getSources` を取り直す（常時ポーリングはしない）
- シングルモニタなら「画面」セクションは 1 行
- タイトルが空のウィンドウ／clip2manual 自身のウィンドウは除外
- 録画中はプルダウン無効化

## アーキテクチャ

### 影響ファイル

```
新規:
  src/main/native/winBounds.ts          Win32 GetWindowRect（koffi 経由）
  src/main/captureSources.ts            getSources の薄いラッパ + フィルタ + 表示名整形
  src/main/ipc/captureSources.ts        listSources / prepareCapture の IPC
  src/renderer/home/SourcePicker.tsx    プルダウン UI

変更:
  src/main/index.ts                     setDisplayMediaRequestHandler を pending id で分岐
  src/main/ipc/recording.ts             pending bounds を採用、display 限定処理を廃止
  src/renderer/recorder/screenRecorder.ts  start(sourceId) に拡張せず、prepareCapture を
                                        renderer 側で先に呼ぶ前提（recorder は責務不変）
  src/renderer/home/HomeScreen.tsx      SourcePicker を配置し、selectedId を保持
  src/preload/index.ts                  listCaptureSources / prepareCapture を公開
  src/shared/types.ts                   ProjectSource に captureKind/captureLabel を追加
```

`src/shared/coordinateTransform.ts` は型・関数とも変更なし。`CaptureGeometry` の値で吸収する。

### state の所在

| state | 所在 | ライフサイクル |
|---|---|---|
| `selectedSourceId` | `HomeScreen` の `useState` | Home がマウントされている間 |
| `pendingCaptureSourceId` | main プロセスのモジュールローカル変数 | `prepareCapture` でセット → `setDisplayMediaRequestHandler` 発火で消費（1回限り） |
| `pendingCaptureBounds` | main プロセスのモジュールローカル変数 | `prepareCapture` でセット → `recording:stop` で消費 |

`pending*` は録画 1 回分の寿命。stop または失敗で必ずクリアする。

### IPC（preload で公開）

```ts
listCaptureSources(): Promise<CaptureSource[]>
prepareCapture(sourceId: string): Promise<{ ok: true } | { ok: false; reason: string }>
// 既存:
startRecording(): Promise<{ ok: true }>
stopRecording(payload): Promise<{ projectDir: string; clickCount: number }>

type CaptureSource = {
  id: string;                       // 'screen:0:0' or 'window:HWND:…'（desktopCapturer の id を透過）
  kind: 'screen' | 'window';
  label: string;                    // 表示用「ディスプレイ 1（プライマリ・1920×1080）」/ ウィンドウタイトル
  displayId?: number;               // screen のとき Electron Display.id
};
```

### データフロー

```
[Picker open]
  renderer → listCaptureSources
  main:
    desktopCapturer.getSources({ types:['window','screen'] })
    screen.getAllDisplays() で screen 系を Display と display_id で結合
    self ウィンドウ id（mainWindow.getMediaSourceId()）を除外
    タイトル空のウィンドウを除外
    並び順: 画面 → ウィンドウ。画面はプライマリ先頭、ウィンドウは label の locale 比較
    返却（thumbnail は使わない）

[record start]
  renderer onStart:
    1. notifyRecordingStarted()                    （既存）
    2. prepareCapture(selectedSourceId)            （新規）
       main: selectedId に対応する bounds を確定
              screen: getAllDisplays() の bounds × scaleFactor
              window: GetWindowRect(HWND) × Electron の scaleFactor
              IsIconic(HWND) なら拒否
              失敗時は { ok:false, reason } を返す
              成功時 pendingCaptureSourceId / pendingCaptureBounds をセット
    3. 500ms 待機（既存・最小化アニメ）
    4. recorder.start() → getDisplayMedia
       main setDisplayMediaRequestHandler:
         pickById(pendingCaptureSourceId) を返す、無ければ警告ログで sources[0]
         pendingCaptureSourceId を null に
    5. startRecording()                            （既存・ClickHook 起動）
    失敗時は pending* をクリアし notifyRecordingStopped → toast

[record stop]
  既存 stopRecording ペイロードのまま。
  main recording:stop:
    rawEvents = clickHook.stop()
    geometry を pendingCaptureBounds から組み立て:
      displayOriginX = bounds.x * sf
      displayOriginY = bounds.y * sf
      displayWidth   = bounds.w * sf
      displayHeight  = bounds.h * sf
      videoWidth/Height = payload.videoWidth/Height
    （pendingCaptureBounds が null＝prepareCapture 未経由の異常系では
      従来通り getPrimaryDisplay フォールバック、警告ログ）
    buildClickLog: isWithinDisplay で範囲外を自動除外
    pendingCaptureBounds をクリア
    ProjectSource:
      display = geometry（既存フィールド名のまま意味を拡張）
      captureKind = 'screen' | 'window'
      captureLabel = 選択時のラベル
```

### setDisplayMediaRequestHandler の競合

`pendingCaptureSourceId` は単一値で常に 1 回限り消費する。録画が連続で並行することは無いので排他は不要。録画中に再度 `getDisplayMedia` が呼ばれた場合（想定外）は sources[0] フォールバック + warn ログでセーフに倒す。

## ライブラリ

- ネイティブ FFI は **koffi** を採用
  - `ffi-napi` は Electron バージョンと prebuild が乖離しやすい
  - koffi は N-API ベースで `electron-rebuild` 不要、メンテ活発
- non-Windows は `winBounds` ロード時に throw。`captureSources` 側で catch してウィンドウ系を一覧から除外（screen 系のみ表示）

```ts
// src/main/native/winBounds.ts
export interface WindowRect { x: number; y: number; w: number; h: number }
export function getWindowRectByHwnd(hwnd: bigint): WindowRect
export function isIconic(hwnd: bigint): boolean
```

HWND は desktopCapturer source id（`window:HWND:…`）からパース。具体的なフォーマットは Electron バージョンに依存するため、id から HWND を抜き出すヘルパも `winBounds.ts` に置き、ユニットテストで固定。

## 型変更

```ts
// src/shared/types.ts
export interface ProjectSource {
  video: string;
  narration: string;
  clickLog: string;
  display: {
    width: number; height: number;
    scaleFactor: number;
    originX: number; originY: number;
  };
  captureKind?: 'screen' | 'window';   // 新規・任意
  captureLabel?: string;               // 新規・任意（UI 表示用）
}
```

既存プロジェクトの読み込みは `captureKind`/`captureLabel` 無しでもそのまま動く。

## エラー処理

| ケース | 振る舞い |
|---|---|
| 対象ウィンドウが録画開始直前に閉じられた | `prepareCapture` が `{ ok:false, reason:'window-not-found' }` → toast、開始しない |
| `GetWindowRect` 失敗（HWND 不正） | 同上 `reason:'bounds-failed'` |
| 最小化中のウィンドウ | `prepareCapture` が `reason:'minimized'` で拒否 |
| `desktopCapturer.getSources` 失敗 | `listCaptureSources` が screen 系の fallback を返し toast 表示 |
| non-Windows | winBounds 不可なので window 系は一覧から除外 |
| koffi ロード失敗 | 同上 |
| `setDisplayMediaRequestHandler` 発火時 pendingId が無い | warn ログ + sources[0] フォールバック |

## テスト計画

ユニット（vitest）:
1. `coordinateTransform.test.ts`: ウィンドウオフセットを与えた `CaptureGeometry` で `osToVideoCoords`/`isWithinDisplay` が領域内外を正しく判定する
2. `captureSources.test.ts`: desktopCapturer / screen をモック
   - screen 系を Display.id で結合し、プライマリ先頭、解像度ラベルが付く
   - 複数モニタ環境で 2 行返る
   - 空タイトルのウィンドウが除外される
   - 自ウィンドウ id が除外される
   - non-Windows モード（winBounds 不在）で window 系が落ちる
3. `ipc/captureSources.test.ts`:
   - `prepareCapture('screen:0:0')` → pendingBounds に Display bounds が入る
   - `prepareCapture('window:…')` → winBounds の戻りが入る
   - 未知 id で `{ ok:false }`
   - 最小化ウィンドウで `{ ok:false, reason:'minimized' }`
4. `winBounds.test.ts`: id パーサ部のみテスト、koffi 部は OS 依存 skip

手動 E2E（Win11 実機）:
1. プルダウンに「ディスプレイ N」「タイトル付きウィンドウ群」が並ぶ
2. プライマリ画面選択で従来同様の録画ができる（リグレッション無し）
3. セカンダリ画面選択でその画面のクリックが正しく ◆ 表示される
4. メモ帳など特定ウィンドウを選び、その中だけクリックして停止 → ◆ がウィンドウ内座標に正しく立つ
5. 録画中にウィンドウをドラッグして以降クリック → ◆ が「開始時の矩形基準」で動く（=ウィンドウ内座標としてはズレる）ことを確認＝今回仕様
6. ウィンドウ外（タスクバー）クリックが clicks.json に出ない

## 後続課題（このスペックの範囲外）

- 録画中のウィンドウ追従（開始時固定ではなく実時間で OS→ウィンドウ内座標を引く）
- ROI ドラッグ選択
- プルダウンへのライブサムネ表示
