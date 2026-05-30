// src/main/transcription/silenceDetect.ts
import { spawn } from 'node:child_process';

/** silencedetect の noise 閾値（dB）。これ以下を無音とみなす。 */
export const SILENCE_NOISE_DB = -30;

/** 1 つの無音と認める最短時間（秒）。意識的に作る句間ポーズを拾える程度の値。 */
export const SILENCE_MIN_DUR_SEC = 1.5;

export interface SilenceInterval {
  /** 無音区間の開始（ミリ秒）。 */
  startMs: number;
  /** 無音区間の終了（ミリ秒）。`silence_end` が出ない（音声末尾）なら startMs と同じ。 */
  endMs: number;
}

/**
 * ffmpeg silencedetect の stderr 出力をパースして、無音区間 (秒) の配列を返す。
 * 例:
 *   [silencedetect @ 0x...] silence_start: 1.92
 *   [silencedetect @ 0x...] silence_end: 2.5 | silence_duration: 0.58
 * silence_end が来ないまま EOF した区間は endSec=null。
 */
export function parseSilenceStderr(
  stderr: string,
): Array<{ startSec: number; endSec: number | null }> {
  const startRe = /silence_start:\s*(-?\d+(?:\.\d+)?)/;
  const endRe = /silence_end:\s*(-?\d+(?:\.\d+)?)/;
  const out: Array<{ startSec: number; endSec: number | null }> = [];
  for (const line of stderr.split('\n')) {
    const ms = startRe.exec(line);
    if (ms) {
      out.push({ startSec: parseFloat(ms[1]), endSec: null });
      continue;
    }
    const me = endRe.exec(line);
    if (me && out.length > 0 && out[out.length - 1].endSec === null) {
      out[out.length - 1].endSec = parseFloat(me[1]);
    }
  }
  return out;
}

export interface DetectSilenceOpts {
  ffmpegPath: string;
  audioPath: string;
  /** 無音判定の dB しきい値。省略時 SILENCE_NOISE_DB。 */
  noiseDb?: number;
  /** 無音と認める最短秒数。省略時 SILENCE_MIN_DUR_SEC。 */
  minDurSec?: number;
  signal?: AbortSignal;
}

/** ffmpeg silencedetect を実行し、無音区間 (ミリ秒) の配列を返す。 */
export function detectSilenceMs(opts: DetectSilenceOpts): Promise<SilenceInterval[]> {
  return new Promise((resolve, reject) => {
    const noise = opts.noiseDb ?? SILENCE_NOISE_DB;
    const minDur = opts.minDurSec ?? SILENCE_MIN_DUR_SEC;
    const args = [
      '-hide_banner',
      '-nostats',
      '-i', opts.audioPath,
      '-af', `silencedetect=noise=${noise}dB:d=${minDur}`,
      '-f', 'null',
      '-',
    ];
    const child = spawn(opts.ffmpegPath, args, { windowsHide: true });
    const onAbort = () => child.kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    let stderr = '';
    let stderrTail = '';
    child.stderr.on('data', (c: Buffer) => {
      const s = c.toString();
      stderr += s;
      stderrTail = (stderrTail + s).slice(-2000);
    });
    child.on('error', (e) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (code !== 0) {
        reject(new Error(`ffmpeg silencedetect exit ${code}: ${stderrTail}`));
        return;
      }
      const intervals = parseSilenceStderr(stderr).map(({ startSec, endSec }) => ({
        startMs: Math.round(startSec * 1000),
        endMs: Math.round((endSec ?? startSec) * 1000),
      }));
      resolve(intervals);
    });
  });
}

/** 無音区間配列から「中央時刻 (ms)」の配列を作る（句境界の hint として使う）。 */
export function silenceMidsMs(intervals: SilenceInterval[]): number[] {
  return intervals.map((s) => Math.round((s.startMs + s.endMs) / 2));
}
