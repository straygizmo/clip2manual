/**
 * テキストを行配列に分割する。
 * 全角・絵文字は 2 cols、それ以外は 1 col とし、maxCols を超えないように 1 グラフェムずつ詰める。
 * maxLines を超えたら最終行末尾を「…」で打切り。
 */
export function wrapJapanese(text: string, maxCols: number, maxLines: number): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
  const graphemes = Array.from(segmenter.segment(trimmed), (s) => s.segment);

  const colWidth = (g: string): number => {
    // ASCII 印字可能範囲は 1、それ以外は全角扱いで 2（絵文字含む）
    const cp = g.codePointAt(0) ?? 0;
    if (cp < 0x7f && g.length === 1) return 1;
    return 2;
  };

  const lines: string[] = [];
  let cur = '';
  let curCols = 0;
  for (const g of graphemes) {
    const w = colWidth(g);
    if (curCols + w > maxCols && cur !== '') {
      lines.push(cur);
      cur = '';
      curCols = 0;
    }
    cur += g;
    curCols += w;
  }
  if (cur !== '') lines.push(cur);

  if (lines.length <= maxLines) return lines;
  const truncated = lines.slice(0, maxLines);
  // 最後の行に「…」を追加（はみ出すなら末尾グラフェムを置換）
  const lastLine = truncated[maxLines - 1];
  const lastGraphemes = Array.from(segmenter.segment(lastLine), (s) => s.segment);
  let cols = 0;
  for (const g of lastGraphemes) cols += colWidth(g);
  if (cols + 1 <= maxCols) {
    truncated[maxLines - 1] = lastLine + '…';
  } else {
    // 末尾グラフェムを「…」と置き換え
    truncated[maxLines - 1] = lastGraphemes.slice(0, -1).join('') + '…';
  }
  return truncated;
}
