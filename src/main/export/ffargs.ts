import { tMain } from '../i18n';

/** 全中間/最終出力で揃える共通エンコード設定。 */
const VIDEO_ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
const AUDIO_RATE = '48000';

export function probeDurationArgs(file: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', file];
}

export function parseProbeDuration(stdout: string): number {
  const n = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(n)) throw new Error(tMain('errors.ffprobeParseDuration', { stdout: JSON.stringify(stdout) }));
  return n;
}

export function probeFpsArgs(file: string): string[] {
  return ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'default=nokey=1:noprint_wrappers=1', file];
}

export function parseFps(stdout: string): number {
  const s = stdout.trim();
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (den > 0 && num > 0) return num / den;
  }
  const f = Number.parseFloat(s);
  if (Number.isFinite(f) && f > 0) return f;
  throw new Error(tMain('errors.ffprobeParseFps', { stdout: JSON.stringify(stdout) }));
}

export function probeResolutionArgs(file: string): string[] {
  return ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=,:p=0', file];
}

export function parseResolution(stdout: string): { width: number; height: number } {
  const s = stdout.trim();
  const m = s.match(/^(\d+)\s*,\s*(\d+)$/);
  if (!m) throw new Error(tMain('errors.ffprobeParseResolution', { stdout: JSON.stringify(stdout) }));
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(tMain('errors.ffprobeBadResolution', { stdout: JSON.stringify(stdout) }));
  }
  return { width, height };
}

/**
 * raw.webm 全長をベースに、リップル PNG シーケンスと字幕 PNG 群を時刻条件付きで重ねて
 * 一発で動画を生成する。
 *
 * 入力:
 *   - [0]: raw.webm（VFR）。`fps` フィルタで CFR 化してオーバーレイ整合をとる
 *   - [1..]: 任意で ripple PNG シーケンス（CFR）と subtitle PNG 群（-loop 1）
 *
 * 重要: ループ入力（-loop 1）は無限長なので、それを使う overlay は必ず `shortest=1` を付けて
 * チェーン中間出力が無限化しないようにする。ベース [0:v] は -t で有限化する。
 *
 * subtitle overlay は `enable='between(t,start,end)'` で各 span の有効時刻を指定する。
 */
export function globalVideoArgs(input: {
  rawPath: string;
  totalDuration: number;
  fps: number;
  outPath: string;
  ripple?: { pattern: string; fps: number };
  subtitles?: ReadonlyArray<{ pngPath: string; startSec: number; endSec: number }>;
}): string[] {
  const { rawPath, totalDuration, fps, outPath, ripple, subtitles } = input;
  const subs = subtitles ?? [];
  const hasOverlay = !!ripple || subs.length > 0;

  if (!hasOverlay) {
    return [
      '-y',
      '-t', String(totalDuration),
      '-i', rawPath,
      '-vf', `fps=${fps},setpts=PTS-STARTPTS`,
      '-an',
      ...VIDEO_ENCODE,
      outPath,
    ];
  }

  const inputs: string[] = ['-t', String(totalDuration), '-i', rawPath];
  let nextIdx = 1;
  let rippleIdx: number | null = null;
  if (ripple) {
    inputs.push('-framerate', String(ripple.fps), '-i', ripple.pattern);
    rippleIdx = nextIdx++;
  }
  const subIndices: Array<{ idx: number; startSec: number; endSec: number }> = [];
  for (const sub of subs) {
    inputs.push('-loop', '1', '-i', sub.pngPath);
    subIndices.push({ idx: nextIdx++, startSec: sub.startSec, endSec: sub.endSec });
  }

  const chain: string[] = [`[0:v] fps=${fps},setpts=PTS-STARTPTS [vbase]`];
  let lastLabel = 'vbase';
  if (rippleIdx !== null) {
    chain.push(`[${lastLabel}][${rippleIdx}:v] overlay=shortest=1 [vrip]`);
    lastLabel = 'vrip';
  }
  for (let i = 0; i < subIndices.length; i++) {
    const { idx, startSec, endSec } = subIndices[i];
    const start = startSec.toFixed(3);
    const end = endSec.toFixed(3);
    const outLabel = `vsub${i}`;
    chain.push(`[${lastLabel}][${idx}:v] overlay=0:0:shortest=1:enable='between(t,${start},${end})' [${outLabel}]`);
    lastLabel = outLabel;
  }
  // 最終ラベルは [vout] に統一
  chain[chain.length - 1] = chain[chain.length - 1].replace(/\[v[a-z0-9]+\]$/, '[vout]');

  return [
    '-y',
    ...inputs,
    '-filter_complex', chain.join('; '),
    '-map', '[vout]',
    '-an',
    '-t', String(totalDuration),
    ...VIDEO_ENCODE,
    outPath,
  ];
}

/**
 * 無音ベース + 各 TTS クリップを adelay で時刻シフトして amix する。
 * `normalize=0` を付けることで各 TTS は原音量のまま（amix の自動正規化で小さくしない）。
 * 出力長は `-t totalDuration` で raw.webm 長にクランプする（TTS が末尾を超えても切り捨て）。
 */
export function globalAudioArgs(input: {
  totalDuration: number;
  outPath: string;
  clips: ReadonlyArray<{ delaySec: number; pathAbs: string }>;
}): string[] {
  const { totalDuration, outPath, clips } = input;
  if (clips.length === 0) {
    return [
      '-y',
      '-f', 'lavfi',
      '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
      '-t', String(totalDuration),
      '-c:a', 'pcm_s16le',
      outPath,
    ];
  }
  const inputs: string[] = [
    '-f', 'lavfi',
    '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
  ];
  for (const c of clips) inputs.push('-i', c.pathAbs);

  const chain: string[] = [];
  const mixLabels: string[] = ['[0:a]'];
  for (let i = 0; i < clips.length; i++) {
    const delayMs = Math.max(0, Math.round(clips[i].delaySec * 1000));
    const outLabel = `a${i}`;
    chain.push(
      `[${i + 1}:a] aresample=${AUDIO_RATE},aformat=sample_fmts=s16:channel_layouts=stereo,adelay=${delayMs}|${delayMs} [${outLabel}]`,
    );
    mixLabels.push(`[${outLabel}]`);
  }
  chain.push(`${mixLabels.join('')} amix=inputs=${mixLabels.length}:normalize=0:duration=longest [aout]`);

  return [
    '-y',
    ...inputs,
    '-filter_complex', chain.join('; '),
    '-map', '[aout]',
    '-t', String(totalDuration),
    '-c:a', 'pcm_s16le', '-ar', AUDIO_RATE, '-ac', '2',
    outPath,
  ];
}

/** 映像＋音声を多重化し、メタデータ comment（クレジット）を付けて MP4 出力。 */
export function muxArgs(input: { videoPath: string; audioPath: string; outPath: string; comment: string }): string[] {
  return [
    '-y',
    '-i', input.videoPath,
    '-i', input.audioPath,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-metadata', `comment=${input.comment}`,
    '-movflags', '+faststart',
    '-shortest',
    input.outPath,
  ];
}
