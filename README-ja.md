# clip2manual

[English](./README.md) | **日本語**

ナレーション付き画面録画を「見やすいマニュアル動画」に変換するデスクトップアプリ。

録画から書き出しまでをワンアプリで完結させ、社内・チームのマニュアル動画制作を非技術者でも回せるようにすることを目的としています。

## 主な機能

- **画面録画**: アプリ自身で画面・マイク音声・クリックログを同時記録
- **クリック強調**: クリック位置に波紋（リップル）を重ねて視聴者の視線を誘導
- **文字起こし**: ローカル `whisper.cpp` で逐次認識
- **テキスト編集**: タイムライン上のセグメント単位で原稿を修正
- **TTS差し替え**: VOICEVOX でナレーションを再生成（話者選択可）
- **タイミング合わせ**: 音声長に映像を合わせ、フリーズ保持＋末尾小休止で自然に調整
- **タイムライン編集**: 分割／結合／削除／トリム／指定区間カット
- **書き出し**: FFmpeg で MP4 にエクスポート（リップル焼き込み付き）

## 技術スタック

- Electron + TypeScript + React
- electron-vite / Vitest
- Tailwind CSS v4 + shadcn/ui（ダーク基調のプロ向け NLE UI）
- whisper.cpp（同梱）／ VOICEVOX ／ FFmpeg
- LLM 補正はクラウドプロバイダ抽象化（Anthropic / OpenAI / Azure 切替）

## セットアップ

```sh
npm install
npm run setup:whisper    # whisper.cpp バイナリ＋モデルをダウンロード
npm run setup:voicevox   # VOICEVOX エンジンをダウンロード
npm run setup:ffmpeg     # FFmpeg バイナリをダウンロード
```

初回起動時にはアプリ内プロビジョニング画面からも上記の依存をセットアップできます。

## 開発

```sh
npm run dev          # 開発モードで起動
npm run typecheck    # 型チェック
npm run test         # Vitest 実行
npm run build        # 本番ビルド
npm start            # ビルド済みアプリのプレビュー
```

## プロジェクト構成

```
src/
  main/         Electron メインプロセス（録画・IPC・whisper/voicevox/ffmpeg 連携・書き出し）
  preload/      レンダラーへのブリッジ
  renderer/     React UI（ホーム / レコーダ / エディタ / タイムライン）
  shared/       型定義・ユーティリティ共有
scripts/        依存バイナリのセットアップスクリプト
docs/           設計仕様（フェーズごとの spec / plan）
vendor/         同梱バイナリの配置先
```

## 実装状況

全8フェーズで段階的に開発しています。フェーズごとの詳細仕様は `docs/superpowers/specs/` を参照。

`master` にマージ済み:

- [x] Phase 1 — 録画基盤
- [x] Phase 2 — 文字起こし＋タイムライン
- [x] Phase 3 — 手動テキスト編集（LLM 補正は後続）
- [x] Phase 4 — VOICEVOX TTS 差し替え＋同期タイミングプレビュー
- [x] Phase 5 — クリックリップルのプレビュー合成
- [x] Phase 6 — タイムライン編集（分割／結合／削除／トリム／指定区間カット）
- [x] Phase 7 — FFmpeg による MP4 書き出し＋リップル焼き込み
- [x] shadcn ベースのプロ向け NLE UI リデザイン
- [x] Phase 8b-1 — アプリ内での依存プロビジョニング（whisper / VOICEVOX / FFmpeg）

未着手・進行中:

- [ ] Phase 3 後続 — クラウド LLM によるスクリプト補正
- [ ] Phase 8 — 初回ウィザード仕上げ／設定画面／インストーラ

## ライセンス・クレジット

- VOICEVOX を利用する場合、生成音声の利用には**話者クレジットの表記**が必要です（VOICEVOX 利用規約に従ってください）。
- whisper.cpp / FFmpeg / VOICEVOX 各バイナリのライセンスはそれぞれの配布元に従います。
