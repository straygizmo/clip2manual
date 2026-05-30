import { describe, it, expect, vi, beforeEach } from 'vitest';

// shell.trashItem を観測するためのモック
// vi.mock factories are hoisted; use vi.hoisted to share refs safely.
const { trashItem, handlers } = vi.hoisted(() => ({
  trashItem: vi.fn().mockResolvedValue(undefined),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown) => { handlers.set(ch, fn); },
  },
  shell: { trashItem },
  app: { getPath: () => '/tmp/c2m-fake-videos' },
  dialog: { showOpenDialog: vi.fn() },
}));

// projectSession / loadProject はこのテストでは触らない
vi.mock('../src/main/projectStore', () => ({
  loadProject: vi.fn(),
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

describe('project:trash IPC', () => {
  beforeEach(() => {
    handlers.clear();
    trashItem.mockClear();
    registerProjectIpc();
  });

  it('registers a project:trash handler that calls shell.trashItem with the given dir', async () => {
    const handler = handlers.get('project:trash');
    expect(handler).toBeDefined();
    const result = await handler!(null, '/some/project/dir');
    expect(trashItem).toHaveBeenCalledWith('/some/project/dir');
    expect(result).toEqual({ ok: true });
  });

  it('propagates errors from shell.trashItem', async () => {
    trashItem.mockRejectedValueOnce(new Error('boom'));
    const handler = handlers.get('project:trash')!;
    await expect(handler(null, '/x')).rejects.toThrow('boom');
  });
});
