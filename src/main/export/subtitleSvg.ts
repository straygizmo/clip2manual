import { wrapJapanese, textCols } from './subtitleWrap';

export interface SubtitleSvgInput {
  text: string;
  videoW: number;
  videoH: number;
  fontBase64: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 字幕を映像サイズに合わせた SVG として返す。空テキストなら null。
 * フォントは @font-face で base64 埋込み（fontconfig 非依存）。
 */
export function subtitleSvg(input: SubtitleSvgInput): string | null {
  if (input.text.trim() === '') return null;
  const { videoW, videoH, fontBase64 } = input;
  const fontSize = Math.max(12, Math.round(videoH * 0.045));
  const colCharWidth = fontSize * 0.6;
  const maxCols = Math.max(4, Math.floor((videoW * 0.8) / colCharWidth));
  const lines = wrapJapanese(input.text, maxCols, 3);
  if (lines.length === 0) return null;

  const lineHeight = Math.round(fontSize * 1.3);
  const totalTextH = lineHeight * lines.length;
  const paddingY = Math.round(fontSize * 0.3);
  const paddingX = Math.round(fontSize * 0.6);
  const rectH = totalTextH + paddingY * 2;

  // 行ごとの実 col 幅を colCharWidth に乗算（全角は colCharWidth*2 で換算される）
  const widest = lines.reduce((m, l) => Math.max(m, textCols(l) * colCharWidth), 0);
  const rectW = Math.min(videoW * 0.9, widest + paddingX * 2);

  const rectX = (videoW - rectW) / 2;
  const rectY = Math.round(videoH * 0.85) - rectH;

  const textY = rectY + paddingY + lineHeight * 0.8;
  const strokeWidth = Math.max(1, fontSize * 0.08);

  const tspans = lines.map((l, i) => {
    const dy = i === 0 ? 0 : lineHeight;
    return `<tspan x="${videoW / 2}" dy="${dy}">${escapeXml(l)}</tspan>`;
  }).join('');

  return (
    `<svg width="${videoW}" height="${videoH}" viewBox="0 0 ${videoW} ${videoH}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><style>@font-face { font-family: 'NotoSansJP'; src: url(data:font/otf;base64,${fontBase64}) format('opentype'); }</style></defs>` +
    `<rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${rectW.toFixed(1)}" height="${rectH}" rx="4" fill="rgba(0,0,0,0.55)"/>` +
    `<text x="${videoW / 2}" y="${textY.toFixed(1)}" text-anchor="middle" ` +
    `font-family="NotoSansJP, sans-serif" font-size="${fontSize}" font-weight="600" ` +
    `fill="white" stroke="black" stroke-width="${strokeWidth.toFixed(2)}" paint-order="stroke fill">` +
    `${tspans}</text>` +
    `</svg>`
  );
}
