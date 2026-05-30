import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const minimize = vi.fn();
  const setOverlayIcon = vi.fn();
  const send = vi.fn();
  const onRestore = vi.fn();
  const offRestore = vi.fn();
  const fakeWin = {
    minimize,
    setOverlayIcon,
    webContents: { send },
    once: (ev: string, cb: () => void) => { onRestore(ev, cb); },
    removeAllListeners: (ev: string) => { offRestore(ev); },
    isDestroyed: () => false,
  };
  return { handlers, minimize, setOverlayIcon, send, onRestore, offRestore, fakeWin };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
  nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => false })) },
  app: { isPackaged: false, getAppPath: () => '/fake/app' },
}));

vi.mock('../src/main/index', () => ({
  getMainWindow: () => h.fakeWin,
}));

import { registerWindowIpc } from '../src/main/ipc/window';

beforeEach(() => {
  h.handlers.clear();
  h.minimize.mockClear();
  h.setOverlayIcon.mockClear();
  h.send.mockClear();
  h.onRestore.mockClear();
  h.offRestore.mockClear();
  registerWindowIpc();
});

describe('window:recordingStarted', () => {
  it('minimizes the window and sets an overlay icon', async () => {
    await h.handlers.get('window:recordingStarted')!(null);
    expect(h.minimize).toHaveBeenCalledOnce();
    expect(h.setOverlayIcon).toHaveBeenCalledOnce();
    expect(h.setOverlayIcon.mock.calls[0][1]).toBe('recording');
  });

  it('attaches a one-shot restore listener that sends window:autoStop', async () => {
    await h.handlers.get('window:recordingStarted')!(null);
    expect(h.onRestore).toHaveBeenCalledWith('restore', expect.any(Function));
    const cb = h.onRestore.mock.calls[0][1] as () => void;
    cb();
    expect(h.send).toHaveBeenCalledWith('window:autoStop');
  });
});

describe('window:recordingStopped', () => {
  it('clears overlay icon and removes restore listeners', async () => {
    await h.handlers.get('window:recordingStopped')!(null);
    expect(h.setOverlayIcon).toHaveBeenCalledWith(null, '');
    expect(h.offRestore).toHaveBeenCalledWith('restore');
  });
});
