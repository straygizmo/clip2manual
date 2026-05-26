import { describe, it, expect } from 'vitest';
import { validateProject, createProject } from '../src/shared/types';

const valid = createProject({
  name: 'rec-1',
  source: {
    video: 'assets/raw.webm',
    narration: 'assets/narration.webm',
    clickLog: 'assets/clicks.json',
    display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
  },
});

describe('validateProject', () => {
  it('returns the project unchanged when valid', () => {
    expect(validateProject(valid)).toBe(valid);
  });

  it('throws on non-object input', () => {
    expect(() => validateProject(null)).toThrow();
    expect(() => validateProject(42)).toThrow();
  });

  it('throws on unsupported version', () => {
    expect(() => validateProject({ ...valid, version: 999 })).toThrow(/version/i);
  });

  it('throws when meta or settings is missing', () => {
    expect(() => validateProject({ ...valid, meta: undefined })).toThrow(/meta/i);
    expect(() => validateProject({ ...valid, settings: undefined })).toThrow(/settings/i);
  });

  it('throws when segments is not an array', () => {
    expect(() => validateProject({ ...valid, segments: {} })).toThrow(/segments/i);
  });
});
