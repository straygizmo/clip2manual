import { describe, it, expect } from 'vitest';
import { VoicevoxEngine, type VoicevoxEngineDeps } from '../src/main/voicevox/engine';

function deps(over: Partial<VoicevoxEngineDeps>): VoicevoxEngineDeps {
  return {
    baseUrl: 'http://127.0.0.1:50021',
    probe: async () => false,
    spawnEngine: () => ({ kill: () => {} }),
    startTimeoutMs: 1000,
    pollIntervalMs: 1,
    sleep: async () => {},
    ...over,
  };
}

describe('VoicevoxEngine.ensureRunning', () => {
  it('reuses an already-running engine without spawning', async () => {
    let spawned = 0;
    const e = new VoicevoxEngine(deps({ probe: async () => true, spawnEngine: () => { spawned++; return { kill: () => {} }; } }));
    expect(await e.ensureRunning()).toBe('http://127.0.0.1:50021');
    expect(spawned).toBe(0);
  });

  it('spawns and polls until ready', async () => {
    let spawned = 0;
    let n = 0;
    const e = new VoicevoxEngine(deps({
      probe: async () => { n++; return n >= 3; }, // 最初の2回false→3回目true
      spawnEngine: () => { spawned++; return { kill: () => {} }; },
    }));
    expect(await e.ensureRunning()).toBe('http://127.0.0.1:50021');
    expect(spawned).toBe(1);
  });

  it('throws if it never becomes ready before timeout', async () => {
    const e = new VoicevoxEngine(deps({ probe: async () => false, startTimeoutMs: 5, pollIntervalMs: 1 }));
    await expect(e.ensureRunning()).rejects.toThrow();
  });

  it('stop kills the spawned process', async () => {
    let killed = 0;
    let n = 0;
    const e = new VoicevoxEngine(deps({
      probe: async () => { n++; return n >= 2; },
      spawnEngine: () => ({ kill: () => { killed++; } }),
    }));
    await e.ensureRunning();
    e.stop();
    expect(killed).toBe(1);
  });
});
