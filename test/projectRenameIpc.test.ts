import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Project } from '../src/shared/types';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  loadProject: vi.fn(),
  saveProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown) => { h.handlers.set(ch, fn); },
  },
  shell: { trashItem: vi.fn() },
  app: { getPath: () => '/tmp/c2m-fake-videos' },
  dialog: { showOpenDialog: vi.fn() },
}));

vi.mock('../src/main/projectStore', () => ({
  loadProject: h.loadProject,
  saveProject: h.saveProject,
  assetPath: (dir: string, rel: string) => `${dir}/${rel}`,
}));

vi.mock('../src/main/projectSession', () => ({
  projectSession: {
    setCurrent: vi.fn(),
    getCurrent: vi.fn(),
    updateSegments: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

import { registerProjectIpc } from '../src/main/ipc/project';

const makeProject = (name: string): Project => ({
  version: 1,
  meta: {
    name,
    createdAt: '2026-05-30T00:00:00Z',
    source: {
      video: 'assets/video.webm',
      narration: 'assets/narration.webm',
      clickLog: 'assets/clicks.json',
      display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
    },
  },
  settings: {
    highlightStyle: 'ripple',
    timingMode: 'video-follows-audio',
    llm: { provider: 'anthropic', model: 'claude' },
    tts: { defaultSpeaker: 0, defaultSpeed: 1 },
    showSubtitles: false,
  },
  segments: [],
});

describe('project:rename IPC', () => {
  beforeEach(() => {
    h.handlers.clear();
    h.loadProject.mockReset();
    h.saveProject.mockReset();
    h.saveProject.mockResolvedValue(undefined);
    registerProjectIpc();
  });

  it('updates project.meta.name and saves', async () => {
    h.loadProject.mockResolvedValueOnce(makeProject('old'));
    const handler = h.handlers.get('project:rename');
    expect(handler).toBeDefined();
    const result = await handler!(null, '/some/dir', 'new name');
    expect(h.loadProject).toHaveBeenCalledWith('/some/dir');
    expect(h.saveProject).toHaveBeenCalledOnce();
    const [, saved] = h.saveProject.mock.calls[0] as [string, Project];
    expect(saved.meta.name).toBe('new name');
    expect(result).toEqual({ ok: true });
  });

  it('trims whitespace and rejects empty names', async () => {
    h.loadProject.mockResolvedValueOnce(makeProject('old'));
    const handler = h.handlers.get('project:rename')!;
    await expect(handler(null, '/some/dir', '   ')).rejects.toThrow();
    expect(h.saveProject).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from valid names', async () => {
    h.loadProject.mockResolvedValueOnce(makeProject('old'));
    const handler = h.handlers.get('project:rename')!;
    await handler(null, '/some/dir', '  hello  ');
    const [, saved] = h.saveProject.mock.calls[0] as [string, Project];
    expect(saved.meta.name).toBe('hello');
  });
});
