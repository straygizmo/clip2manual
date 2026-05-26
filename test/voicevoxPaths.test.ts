import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveVoicevox, VoicevoxNotProvisionedError } from '../src/main/voicevox/voicevoxPaths';

let dir: string;
beforeEach(async () => {
  delete process.env.C2M_VOICEVOX_RUN;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-vv-'));
});
afterEach(async () => {
  delete process.env.C2M_VOICEVOX_RUN;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveVoicevox', () => {
  it('throws VoicevoxNotProvisionedError when no manifest and no env', () => {
    expect(() => resolveVoicevox({ vendorDir: dir })).toThrow(VoicevoxNotProvisionedError);
  });

  it('resolves from the vendor manifest', async () => {
    const runPath = path.join(dir, 'run.exe');
    await fs.writeFile(runPath, 'x');
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ runPath }));
    expect(resolveVoicevox({ vendorDir: dir })).toEqual({ runPath });
  });

  it('prefers the C2M_VOICEVOX_RUN env override', async () => {
    const runPath = path.join(dir, 'custom-run.exe');
    await fs.writeFile(runPath, 'x');
    process.env.C2M_VOICEVOX_RUN = runPath;
    expect(resolveVoicevox({ vendorDir: dir })).toEqual({ runPath });
  });

  it('throws when the manifest points to a missing file', async () => {
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ runPath: path.join(dir, 'nope.exe') }));
    expect(() => resolveVoicevox({ vendorDir: dir })).toThrow(VoicevoxNotProvisionedError);
  });
});
