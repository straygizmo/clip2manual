import { describe, it, expect } from 'vitest';
import { projectAssetUrl } from '../src/renderer/editor/assetUrl';

describe('projectAssetUrl', () => {
  it('builds a c2m://asset URL containing the rel path', () => {
    const u = projectAssetUrl('assets/raw.webm', 'C:/x/rec-1');
    expect(u.startsWith('c2m://asset/assets/raw.webm?')).toBe(true);
  });

  it('produces distinct URLs for distinct projects (cache-busting)', () => {
    expect(projectAssetUrl('assets/raw.webm', 'C:/x/rec-1')).not.toBe(
      projectAssetUrl('assets/raw.webm', 'C:/x/rec-2'),
    );
  });

  it('is stable for the same project + rel', () => {
    expect(projectAssetUrl('assets/raw.webm', 'C:/x/rec-1')).toBe(
      projectAssetUrl('assets/raw.webm', 'C:/x/rec-1'),
    );
  });

  it('round-trips the project dir in the query (encoded)', () => {
    const dir = 'C:\\Users\\a b\\rec-1';
    expect(projectAssetUrl('assets/raw.webm', dir)).toContain('?p=' + encodeURIComponent(dir));
  });
});
