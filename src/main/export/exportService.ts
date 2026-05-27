import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Segment } from '../../shared/types';
import { computePreviewTimeline } from '../../shared/previewTimeline';
import {
  probeDurationArgs, parseProbeDuration, probeFpsArgs, parseFps,
  segmentVideoArgs, segmentAudioArgs, concatArgs, muxArgs,
} from './ffargs';

export interface ExportOptions {
  /** 与えられた全 segments をそのまま書き出す（enabled での絞り込みは呼び出し側／フェーズ6の責務）。 */
  segments: Segment[];
  projectDir: string; // assets/raw.webm, tts/<id>.wav がある
  outPath: string;    // 最終 MP4
  tmpDir: string;     // 中間ファイル
  credit: string;     // メタデータ comment
  runFfmpeg: (args: string[]) => Promise<void>;
  runProbe: (args: string[]) => Promise<string>;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** concat リスト用にパスを安全に引用する。 */
function listLine(p: string): string {
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

export async function runExport(opts: ExportOptions): Promise<void> {
  if (opts.segments.length === 0) throw new Error('No segments to export');
  const raw = path.join(opts.projectDir, 'assets/raw.webm');
  await fs.mkdir(opts.tmpDir, { recursive: true });

  const fps = parseFps(await opts.runProbe(probeFpsArgs(raw)));

  const clipDurations = new Map<string, number>();
  for (const s of opts.segments) {
    if (!s.ttsAudio) continue;
    const d = parseProbeDuration(await opts.runProbe(probeDurationArgs(path.join(opts.projectDir, s.ttsAudio))));
    clipDurations.set(s.id, d);
  }

  const slots = computePreviewTimeline(opts.segments, clipDurations);
  const total = slots.length + 3; // segments + 2 concat + 1 mux
  let done = 0;
  const tick = () => { done += 1; opts.onProgress?.(Math.round((done / total) * 100)); };

  const videoParts: string[] = [];
  const audioParts: string[] = [];
  for (const slot of slots) {
    if (opts.signal?.aborted) throw new Error('Export cancelled');
    const vOut = path.join(opts.tmpDir, `${slot.segmentId}.mp4`);
    const aOut = path.join(opts.tmpDir, `${slot.segmentId}.wav`);
    const segment = opts.segments.find((s) => s.id === slot.segmentId);
    const clipPath = segment && segment.ttsAudio ? path.join(opts.projectDir, segment.ttsAudio) : null;
    await opts.runFfmpeg(segmentVideoArgs({ rawPath: raw, slot, outPath: vOut, fps }));
    await opts.runFfmpeg(segmentAudioArgs({ clipPath, slotDuration: slot.slotDuration, outPath: aOut }));
    videoParts.push(vOut);
    audioParts.push(aOut);
    tick();
  }

  const vList = path.join(opts.tmpDir, 'video.txt');
  const aList = path.join(opts.tmpDir, 'audio.txt');
  await fs.writeFile(vList, videoParts.map(listLine).join('\n'), 'utf8');
  await fs.writeFile(aList, audioParts.map(listLine).join('\n'), 'utf8');

  const vConcat = path.join(opts.tmpDir, 'video.mp4');
  const aConcat = path.join(opts.tmpDir, 'audio.wav');
  await opts.runFfmpeg(concatArgs({ listFile: vList, outPath: vConcat }));
  tick();
  await opts.runFfmpeg(concatArgs({ listFile: aList, outPath: aConcat }));
  tick();

  await opts.runFfmpeg(muxArgs({ videoPath: vConcat, audioPath: aConcat, outPath: opts.outPath, comment: opts.credit }));
  tick();
}
