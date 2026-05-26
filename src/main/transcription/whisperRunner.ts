// src/main/transcription/whisperRunner.ts
import { spawn } from 'node:child_process';
import { parseProgress } from './progress';

export interface WhisperRunInput {
  binPath: string;
  modelPath: string;
  audioPath: string;
  /** -of に渡す出力ベース。完了後 `${outBase}.json` が生成される。 */
  outBase: string;
  language: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** whisper の実行を抽象化する。テストでは偽実装に差し替える。 */
export interface WhisperRunner {
  run(input: WhisperRunInput): Promise<void>;
}

/** whisper-cli を子プロセスとして実行する本番 runner。 */
export class SpawnWhisperRunner implements WhisperRunner {
  run(input: WhisperRunInput): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', input.modelPath,
        '-f', input.audioPath,
        '-l', input.language,
        '-oj',
        '-of', input.outBase,
        '--print-progress',
      ];
      const child = spawn(input.binPath, args);

      const onAbort = () => child.kill();
      input.signal?.addEventListener('abort', onAbort, { once: true });

      let stderrTail = '';
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrTail = (stderrTail + text).slice(-1000);
        for (const line of text.split('\n')) {
          const pct = parseProgress(line);
          if (pct !== null) input.onProgress?.(pct);
        }
      });

      child.on('error', (err) => {
        input.signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
      child.on('close', (code) => {
        input.signal?.removeEventListener('abort', onAbort);
        if (code === 0) resolve();
        else reject(new Error(`whisper exited with code ${code}\n${stderrTail}`));
      });
    });
  }
}
