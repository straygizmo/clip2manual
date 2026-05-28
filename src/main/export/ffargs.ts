import { type PreviewSlot } from '../../shared/previewTimeline';

/** 全中間クリップを揃えるための共通エンコード設定。 */
const VIDEO_ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
const AUDIO_RATE = '48000';

export function probeDurationArgs(file: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', file];
}

export function parseProbeDuration(stdout: string): number {
  const n = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(n)) throw new Error(`Cannot parse ffprobe duration: ${JSON.stringify(stdout)}`);
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
  throw new Error(`Cannot parse ffprobe fps: ${JSON.stringify(stdout)}`);
}

export function probeResolutionArgs(file: string): string[] {
  return ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=,:p=0', file];
}

export function parseResolution(stdout: string): { width: number; height: number } {
  const s = stdout.trim();
  const m = s.match(/^(\d+)\s*,\s*(\d+)$/);
  if (!m) throw new Error(`Cannot parse ffprobe resolution: ${JSON.stringify(stdout)}`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Bad resolution: ${JSON.stringify(stdout)}`);
  }
  return { width, height };
}

/** raw 映像のスロット区間を切り出し、末尾フレームを slotDuration までフリーズして均一H.264で出力。
 *  ripple 指定時は image2 を第2入力にして overlay を挿入する。 */
export function segmentVideoArgs(input: {
  rawPath: string;
  slot: PreviewSlot;
  outPath: string;
  fps: number;
  ripple?: { pattern: string; fps: number };
}): string[] {
  const { rawPath, slot, outPath, fps, ripple } = input;
  const videoSpan = Math.max(0, slot.videoEnd - slot.videoStart);
  const freeze = Math.max(0, slot.slotDuration - videoSpan);
  const tpadChain = `tpad=stop_mode=clone:stop_duration=${freeze},fps=${fps},setpts=PTS-STARTPTS`;
  // -ss/-t は -i より前（入力オプション）に置く。こうすると入力が videoSpan で EOF になり、
  // tpad が末尾フレームをクローンできる。-t を -i より後（出力オプション）にすると tpad が
  // EOF を受け取れずフリーズが発生しない。
  if (ripple) {
    return [
      '-y',
      '-ss', String(slot.videoStart),
      '-t', String(videoSpan),
      '-i', rawPath,
      '-framerate', String(ripple.fps),
      '-i', ripple.pattern,
      '-filter_complex', `[0:v] ${tpadChain} [vbase]; [vbase][1:v] overlay=shortest=1 [vout]`,
      '-map', '[vout]',
      '-an',
      ...VIDEO_ENCODE,
      outPath,
    ];
  }
  return [
    '-y',
    '-ss', String(slot.videoStart),
    '-t', String(videoSpan),
    '-i', rawPath,
    '-vf', tpadChain,
    '-an',
    ...VIDEO_ENCODE,
    outPath,
  ];
}

/** スロットの音声 = TTSクリップ→無音 pad で slotDuration、無ければ slotDuration の無音。均一PCM。 */
export function segmentAudioArgs(input: { clipPath: string | null; slotDuration: number; outPath: string }): string[] {
  const { clipPath, slotDuration, outPath } = input;
  if (clipPath) {
    return [
      '-y',
      '-i', clipPath,
      '-af', 'apad',
      '-t', String(slotDuration),
      '-c:a', 'pcm_s16le', '-ar', AUDIO_RATE, '-ac', '2',
      outPath,
    ];
  }
  return [
    '-y',
    '-f', 'lavfi',
    '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
    '-t', String(slotDuration),
    '-c:a', 'pcm_s16le',
    outPath,
  ];
}

/** concat デマルチプレクサ（同一パラメータの中間クリップをストリームコピーで連結）。 */
export function concatArgs(input: { listFile: string; outPath: string }): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', input.listFile, '-c', 'copy', input.outPath];
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
