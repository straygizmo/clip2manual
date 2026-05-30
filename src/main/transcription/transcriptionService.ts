// src/main/transcription/transcriptionService.ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type ClickEvent, type Segment, type SegmentVoice } from '../../shared/types';
import { groupTokensIntoPhrases, mapWhisperSegments, type WhisperJson } from './mapSegments';
import { type WhisperRunner } from './whisperRunner';
import { type SilenceInterval, silenceMidsMs } from './silenceDetect';

/** 音声から無音区間を検出するアダプタ（テストでは省略可）。 */
export type SilenceDetector = (
  audioPath: string,
  signal?: AbortSignal,
) => Promise<SilenceInterval[]>;

export interface TranscribeOptions {
  runner: WhisperRunner;
  binPath: string;
  modelPath: string;
  audioPath: string;
  /** 出力 JSON を置くディレクトリ。`<outDir>/transcription.json` を生成する。 */
  outDir: string;
  language: string;
  clicks: ClickEvent[];
  defaultVoice: SegmentVoice;
  /** 無音区間検出。省略時は空（句読点 + gap fallback のみで分割）。 */
  silenceDetector?: SilenceDetector;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** whisper を実行して Segment[] を返す。project.json への保存は呼び出し側が行う。 */
export async function transcribe(opts: TranscribeOptions): Promise<Segment[]> {
  const outBase = path.join(opts.outDir, 'transcription');
  await opts.runner.run({
    binPath: opts.binPath,
    modelPath: opts.modelPath,
    audioPath: opts.audioPath,
    outBase,
    language: opts.language,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });
  const raw = await fs.readFile(`${outBase}.json`, 'utf8');
  const json = JSON.parse(raw) as WhisperJson;

  // 無音区間（あれば）→ 中央時刻リスト。whisper は無音をトークン duration に
  // 吸収しがちなので、外部 VAD なしのヒントとして使う。
  const silences = opts.silenceDetector
    ? await opts.silenceDetector(opts.audioPath, opts.signal)
    : [];
  const mids = silenceMidsMs(silences);

  const phrases = groupTokensIntoPhrases(json.transcription, mids);
  return mapWhisperSegments(phrases, opts.clicks, opts.defaultVoice);
}
