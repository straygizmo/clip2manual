// src/main/transcription/transcriptionService.ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type ClickEvent, type Segment, type SegmentVoice } from '../../shared/types';
import { groupTokensIntoPhrases, mapWhisperSegments, type WhisperJson } from './mapSegments';
import { type WhisperRunner } from './whisperRunner';

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
  // whisper は --max-len 1 でトークン単位の区切りを返すので、句読点で句にまとめ直す。
  const phrases = groupTokensIntoPhrases(json.transcription);
  return mapWhisperSegments(phrases, opts.clicks, opts.defaultVoice);
}
