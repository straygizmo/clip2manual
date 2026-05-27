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

/** raw 映像のスロット区間を切り出し、末尾フレームを slotDuration までフリーズして均一H.264で出力。 */
export function segmentVideoArgs(input: { rawPath: string; slot: PreviewSlot; outPath: string; fps: number }): string[] {
  const { rawPath, slot, outPath, fps } = input;
  const videoSpan = Math.max(0, slot.videoEnd - slot.videoStart);
  const freeze = Math.max(0, slot.slotDuration - videoSpan);
  return [
    '-y',
    '-ss', String(slot.videoStart),
    '-i', rawPath,
    '-t', String(videoSpan),
    '-vf', `tpad=stop_mode=clone:stop_duration=${freeze},fps=${fps},setpts=PTS-STARTPTS`,
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
