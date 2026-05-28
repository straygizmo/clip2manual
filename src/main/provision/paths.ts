import { join } from 'node:path';

export type Tool = 'whisper' | 'voicevox' | 'ffmpeg';

/**
 * `<userBase>/<tool>` に manifest があればそれを、無ければ `<cwdBase>/<tool>` を返す（純粋）。
 * manifestExists は注入（テスト容易化）。electron に依存しない。
 */
export function pickVendorDir(
  userBase: string,
  cwdBase: string,
  tool: string,
  manifestExists: (dir: string) => boolean,
): string {
  const userDir = join(userBase, tool);
  if (manifestExists(userDir)) return userDir;
  return join(cwdBase, tool);
}
