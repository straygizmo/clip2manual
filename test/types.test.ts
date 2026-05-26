import { describe, it, expect } from 'vitest';
import { createProject, CURRENT_PROJECT_VERSION, type ProjectSource } from '../src/shared/types';

const source: ProjectSource = {
  video: 'assets/raw.webm',
  narration: 'assets/narration.webm',
  clickLog: 'assets/clicks.json',
  display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
};

describe('createProject', () => {
  it('sets the current version', () => {
    expect(createProject({ name: 'demo', source }).version).toBe(CURRENT_PROJECT_VERSION);
  });

  it('applies default settings and an empty segment list', () => {
    const p = createProject({ name: 'demo', source });
    expect(p.settings.highlightStyle).toBe('ripple');
    expect(p.settings.timingMode).toBe('video-follows-audio');
    expect(p.segments).toEqual([]);
    expect(p.meta.source).toBe(source);
  });

  it('uses the provided createdAt when given', () => {
    const p = createProject({ name: 'demo', source, createdAt: '2026-05-26T00:00:00.000Z' });
    expect(p.meta.createdAt).toBe('2026-05-26T00:00:00.000Z');
  });
});
