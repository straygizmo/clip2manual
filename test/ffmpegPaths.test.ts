import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveFfmpeg, FfmpegNotProvisionedError } from '../src/main/ffmpegPaths';

let dir: string;
beforeEach(async () => {
  delete process.env.C2M_FFMPEG;
  delete process.env.C2M_FFPROBE;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-ff-'));
});
afterEach(async () => {
  delete process.env.C2M_FFMPEG;
  delete process.env.C2M_FFPROBE;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveFfmpeg', () => {
  it('throws FfmpegNotProvisionedError when no manifest and no env', () => {
    expect(() => resolveFfmpeg({ vendorDir: dir })).toThrow(FfmpegNotProvisionedError);
  });

  it('resolves from the vendor manifest', async () => {
    const ffmpegPath = path.join(dir, 'ffmpeg.exe');
    const ffprobePath = path.join(dir, 'ffprobe.exe');
    await fs.writeFile(ffmpegPath, 'x');
    await fs.writeFile(ffprobePath, 'x');
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ffmpegPath, ffprobePath }));
    expect(resolveFfmpeg({ vendorDir: dir })).toEqual({ ffmpegPath, ffprobePath });
  });

  it('prefers env overrides', async () => {
    const ffmpegPath = path.join(dir, 'a.exe');
    const ffprobePath = path.join(dir, 'b.exe');
    await fs.writeFile(ffmpegPath, 'x');
    await fs.writeFile(ffprobePath, 'x');
    process.env.C2M_FFMPEG = ffmpegPath;
    process.env.C2M_FFPROBE = ffprobePath;
    expect(resolveFfmpeg({ vendorDir: dir })).toEqual({ ffmpegPath, ffprobePath });
  });

  it('throws when the manifest points to a missing file', async () => {
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ffmpegPath: path.join(dir, 'no.exe'), ffprobePath: path.join(dir, 'no2.exe') }));
    expect(() => resolveFfmpeg({ vendorDir: dir })).toThrow(FfmpegNotProvisionedError);
  });
});
