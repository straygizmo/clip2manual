import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveWhisper, WhisperNotProvisionedError } from '../src/main/whisperPaths';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-whisper-'));
  delete process.env.C2M_WHISPER_BIN;
  delete process.env.C2M_WHISPER_MODEL;
});
afterEach(async () => {
  delete process.env.C2M_WHISPER_BIN;
  delete process.env.C2M_WHISPER_MODEL;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveWhisper', () => {
  it('throws WhisperNotProvisionedError when no manifest exists', () => {
    expect(() => resolveWhisper({ vendorDir: dir })).toThrow(WhisperNotProvisionedError);
  });

  it('reads bin/model from vendor manifest.json', async () => {
    const bin = path.join(dir, 'whisper-cli.exe');
    const model = path.join(dir, 'ggml-small.bin');
    await fs.writeFile(bin, 'x');
    await fs.writeFile(model, 'x');
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ binPath: bin, modelPath: model }));
    expect(resolveWhisper({ vendorDir: dir })).toEqual({ binPath: bin, modelPath: model });
  });

  it('prefers environment variables over the manifest', async () => {
    const bin = path.join(dir, 'env-bin.exe');
    const model = path.join(dir, 'env-model.bin');
    await fs.writeFile(bin, 'x');
    await fs.writeFile(model, 'x');
    process.env.C2M_WHISPER_BIN = bin;
    process.env.C2M_WHISPER_MODEL = model;
    expect(resolveWhisper({ vendorDir: dir })).toEqual({ binPath: bin, modelPath: model });
  });

  it('throws when a referenced file is missing', async () => {
    await fs.writeFile(path.join(dir, 'manifest.json'),
      JSON.stringify({ binPath: path.join(dir, 'nope.exe'), modelPath: path.join(dir, 'nope.bin') }));
    expect(() => resolveWhisper({ vendorDir: dir })).toThrow(WhisperNotProvisionedError);
  });
});
