import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { pickVendorDir } from '../src/main/provision/paths';

const userBase = join('U', 'vendor');
const cwdBase = join('C', 'vendor');

describe('pickVendorDir', () => {
  it('prefers the userData dir when its manifest exists', () => {
    const r = pickVendorDir(userBase, cwdBase, 'whisper', (d) => d === join(userBase, 'whisper'));
    expect(r).toBe(join(userBase, 'whisper'));
  });
  it('falls back to the cwd dir when the userData manifest is absent', () => {
    const r = pickVendorDir(userBase, cwdBase, 'whisper', () => false);
    expect(r).toBe(join(cwdBase, 'whisper'));
  });
});
