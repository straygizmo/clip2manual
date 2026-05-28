import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Segment } from '../../shared/types';
import { type SynthesizeInput } from './ttsClient';
import { tMain } from '../i18n';

/** 起動済みエンジンの baseUrl を返す抽象。 */
export interface TtsEngine {
  ensureRunning(): Promise<string>;
}

/** 合成クライアント抽象（テストで差し替え）。 */
export interface TtsClient {
  synthesize(baseUrl: string, input: SynthesizeInput): Promise<Buffer>;
}

export interface GenerateOptions {
  engine: TtsEngine;
  client: TtsClient;
  /** プロジェクトディレクトリ。`<outDir>/tts/<id>.wav` を書く。 */
  outDir: string;
  segments: Segment[];
  /** 指定時はそのセグメントだけ生成する。 */
  onlyId?: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * 対象セグメントを VOICEVOX で合成し wav を保存、ttsAudio を設定した新しい segments を返す。
 * correctedText が空のセグメントはスキップ（ttsAudio はそのまま）。最初のエラーで停止。
 */
export async function generateTts(opts: GenerateOptions): Promise<Segment[]> {
  const baseUrl = await opts.engine.ensureRunning();
  const ttsDir = path.join(opts.outDir, 'tts');
  await fs.mkdir(ttsDir, { recursive: true });

  const targets = opts.segments.filter(
    (s) => (opts.onlyId ? s.id === opts.onlyId : true) && s.correctedText.trim() !== '',
  );

  const updated = opts.segments.map((s) => ({ ...s }));
  let done = 0;
  for (const s of targets) {
    if (opts.signal?.aborted) throw new Error(tMain('errors.ttsCancelled'));
    const wav = await opts.client.synthesize(baseUrl, {
      text: s.correctedText,
      speaker: s.voice.speaker,
      speed: s.voice.speed,
    });
    const rel = `tts/${s.id}.wav`;
    await fs.writeFile(path.join(opts.outDir, rel), wav);
    const idx = updated.findIndex((u) => u.id === s.id);
    updated[idx] = { ...updated[idx], ttsAudio: rel };
    done += 1;
    opts.onProgress?.(done, targets.length);
  }
  return updated;
}
