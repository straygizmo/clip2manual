import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const getSources = vi.fn();
  const getAllDisplays = vi.fn();
  const getPrimaryDisplay = vi.fn();
  const getMediaSourceId = vi.fn(() => 'window:999:0');
  const fakeWin = { getMediaSourceId, isDestroyed: () => false };
  return { handlers, getSources, getAllDisplays, getPrimaryDisplay, getMediaSourceId, fakeWin };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
  desktopCapturer: { getSources: (opts: unknown) => h.getSources(opts) },
  screen: {
    getAllDisplays: () => h.getAllDisplays(),
    getPrimaryDisplay: () => h.getPrimaryDisplay(),
  },
}));

vi.mock('../src/main/index', () => ({ getMainWindow: () => h.fakeWin }));

import {
  registerCaptureSourcesIpc,
  takePendingCapture,
  takePendingCaptureSourceId,
  __setBoundsResolverForTest,
} from '../src/main/ipc/captureSources';

const PRIMARY = { id: 100, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25, internal: true, label: '', primary: true } as const;

beforeEach(() => {
  h.handlers.clear();
  h.getSources.mockReset();
  h.getAllDisplays.mockReset();
  h.getPrimaryDisplay.mockReset();
  h.getMediaSourceId.mockClear();
  takePendingCapture(); // clear
  registerCaptureSourcesIpc();
  h.getPrimaryDisplay.mockReturnValue(PRIMARY);
});

describe('capture:listSources', () => {
  it('returns screens + windows, dropping self and blank-title', async () => {
    h.getAllDisplays.mockReturnValue([PRIMARY]);
    h.getSources.mockResolvedValue([
      { id: 'screen:0:0', name: 'X', display_id: '100' },
      { id: 'window:111:0', name: 'Notepad', display_id: '' },
      { id: 'window:999:0', name: 'clip2manual', display_id: '' },
      { id: 'window:222:0', name: '', display_id: '' },
    ]);
    const out = await h.handlers.get('capture:listSources')!(null);
    expect((out as Array<{ id: string }>).map((s) => s.id)).toEqual(['screen:0:0', 'window:111:0']);
  });

  it('falls back to displays-only when getSources rejects', async () => {
    h.getAllDisplays.mockReturnValue([PRIMARY]);
    h.getSources.mockRejectedValue(new Error('fail'));
    const out = await h.handlers.get('capture:listSources')!(null);
    expect((out as Array<{ kind: string }>).every((s) => s.kind === 'screen')).toBe(true);
    expect((out as Array<unknown>).length).toBe(1);
  });
});

describe('capture:prepare (screen)', () => {
  beforeEach(() => { h.getAllDisplays.mockReturnValue([PRIMARY]); });

  it('stores screen bounds in physical px and pending kind', async () => {
    h.getSources.mockResolvedValue([{ id: 'screen:0:0', name: 'X', display_id: '100' }]);
    const res = await h.handlers.get('capture:prepare')!(null, 'screen:0:0');
    expect(res).toEqual({ ok: true });
    const cap = takePendingCapture()!;
    expect(cap.sourceId).toBe('screen:0:0');
    expect(cap.kind).toBe('screen');
    expect(cap.bounds).toEqual({ x: 0, y: 0, w: 1920 * 1.25, h: 1080 * 1.25, scaleFactor: 1.25 });
  });

  it('takePendingCaptureSourceId leaves bounds/label for recording:stop', async () => {
    h.getSources.mockResolvedValue([{ id: 'screen:0:0', name: 'X', display_id: '100' }]);
    await h.handlers.get('capture:prepare')!(null, 'screen:0:0');
    const id1 = takePendingCaptureSourceId();
    expect(id1).toBe('screen:0:0');
    const cap = takePendingCapture()!;
    expect(cap.kind).toBe('screen');
    expect(cap.bounds.w).toBe(1920 * 1.25);
  });
});

describe('capture:prepare (window)', () => {
  beforeEach(() => { h.getAllDisplays.mockReturnValue([PRIMARY]); });

  it('stores window bounds via injected resolver', async () => {
    h.getSources.mockResolvedValue([{ id: 'window:111:0', name: 'Notepad', display_id: '' }]);
    __setBoundsResolverForTest({
      isAvailable: () => true,
      isMinimized: () => false,
      getRect: () => ({ x: 100, y: 200, w: 800, h: 600 }),
      scaleFactorFor: () => 1.0,
    });
    const res = await h.handlers.get('capture:prepare')!(null, 'window:111:0');
    expect(res).toEqual({ ok: true });
    const cap = takePendingCapture()!;
    expect(cap.kind).toBe('window');
    expect(cap.label).toBe('Notepad');
    expect(cap.bounds).toEqual({ x: 100, y: 200, w: 800, h: 600, scaleFactor: 1.0 });
  });

  it('rejects minimized window', async () => {
    h.getSources.mockResolvedValue([{ id: 'window:111:0', name: 'Notepad', display_id: '' }]);
    __setBoundsResolverForTest({
      isAvailable: () => true,
      isMinimized: () => true,
      getRect: () => { throw new Error('should not be called'); },
      scaleFactorFor: () => 1.0,
    });
    const res = await h.handlers.get('capture:prepare')!(null, 'window:111:0');
    expect(res).toEqual({ ok: false, reason: 'minimized' });
    expect(takePendingCapture()).toBeNull();
  });

  it('rejects when winBounds is unavailable', async () => {
    h.getSources.mockResolvedValue([{ id: 'window:111:0', name: 'Notepad', display_id: '' }]);
    __setBoundsResolverForTest({
      isAvailable: () => false,
      isMinimized: () => false,
      getRect: () => ({ x: 0, y: 0, w: 0, h: 0 }),
      scaleFactorFor: () => 1.0,
    });
    const res = await h.handlers.get('capture:prepare')!(null, 'window:111:0');
    expect(res).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('capture:prepare (unknown id)', () => {
  it('returns not-found', async () => {
    h.getAllDisplays.mockReturnValue([PRIMARY]);
    h.getSources.mockResolvedValue([]);
    const res = await h.handlers.get('capture:prepare')!(null, 'window:zzz:0');
    expect(res).toEqual({ ok: false, reason: 'not-found' });
  });
});
