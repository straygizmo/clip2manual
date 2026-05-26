import { spawn } from 'node:child_process';
import * as path from 'node:path';

export interface EngineProcess {
  kill(): void;
}

export interface VoicevoxEngineDeps {
  baseUrl: string;
  /** エンジンが応答するか（GET /version）。 */
  probe: () => Promise<boolean>;
  /** エンジンを子プロセスとして起動する。 */
  spawnEngine: () => EngineProcess;
  startTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * VOICEVOX エンジンの遅延起動ライフサイクル。
 * ensureRunning: 既に応答していれば再利用、なければ spawn して /version を準備完了までポーリング。
 */
export class VoicevoxEngine {
  private proc: EngineProcess | null = null;
  constructor(private deps: VoicevoxEngineDeps) {}

  async ensureRunning(): Promise<string> {
    if (await this.deps.probe()) return this.deps.baseUrl;
    if (!this.proc) this.proc = this.deps.spawnEngine();

    const timeout = this.deps.startTimeoutMs ?? 60000;
    const interval = this.deps.pollIntervalMs ?? 500;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await sleep(interval);
      if (await this.deps.probe()) return this.deps.baseUrl;
    }
    throw new Error('VOICEVOX engine did not become ready in time');
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }
}

/** 本番用 deps。run.exe を spawn し、GET /version で health check する。 */
export function defaultEngineDeps(runPath: string, port = 50021): VoicevoxEngineDeps {
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    probe: async () => {
      try {
        const r = await fetch(`${baseUrl}/version`);
        return r.ok;
      } catch {
        return false;
      }
    },
    spawnEngine: () => {
      const child = spawn(runPath, ['--host', '127.0.0.1', '--port', String(port)], {
        cwd: path.dirname(runPath),
        stdio: 'ignore',
      });
      return { kill: () => { child.kill(); } };
    },
  };
}
