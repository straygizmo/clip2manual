// 16x16 透過 PNG、中央に赤い丸。setOverlayIcon 用。
// sharp は既に dependencies。実行は一度きりだが、再生成可能にしておく。
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <circle cx="8" cy="8" r="6" fill="#e11d48" stroke="#ffffff" stroke-width="1.5"/>
</svg>`;

const outPath = 'resources/icons/recording-overlay.png';
await mkdir(dirname(outPath), { recursive: true });
const png = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(outPath, png);
console.log('wrote', outPath, png.byteLength, 'bytes');
