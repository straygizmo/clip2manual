const PROGRESS_RE = /progress\s*=\s*(\d+)\s*%/;

/** whisper の stderr 行から進捗パーセントを取り出す。該当しなければ null。 */
export function parseProgress(line: string): number | null {
  const m = PROGRESS_RE.exec(line);
  return m ? Number(m[1]) : null;
}
