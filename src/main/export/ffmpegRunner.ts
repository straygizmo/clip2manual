import { spawn } from 'node:child_process';

/** ffmpeg を実行する。非0終了で reject（stderr 末尾付き）。 */
export function runFfmpeg(ffmpegPath: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    let tail = '';
    child.stderr.on('data', (c: Buffer) => { tail = (tail + c.toString()).slice(-2000); });
    child.on('error', (e) => { signal?.removeEventListener('abort', onAbort); reject(e); });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${tail}`));
    });
  });
}

/** ffprobe を実行し stdout を返す。 */
export function runProbe(ffprobePath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, args, { windowsHide: true });
    let out = '';
    let tail = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { tail = (tail + c.toString()).slice(-1000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`ffprobe exited with code ${code}\n${tail}`));
    });
  });
}
