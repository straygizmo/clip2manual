import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initProjectDir, saveProject, loadProject, ASSET_DIRS } from '../src/main/projectStore';
import { createProject, type ProjectSource } from '../src/shared/types';

const source: ProjectSource = {
  video: 'assets/raw.webm',
  narration: 'assets/narration.webm',
  clickLog: 'assets/clicks.json',
  display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
};

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('projectStore', () => {
  it('round-trips a saved project', async () => {
    const project = createProject({ name: 'demo', source, createdAt: '2026-05-26T00:00:00.000Z' });
    await saveProject(dir, project);
    const loaded = await loadProject(dir);
    expect(loaded).toEqual(project);
  });

  it('leaves no temp file after saving', async () => {
    await saveProject(dir, createProject({ name: 'demo', source }));
    const entries = await fs.readdir(dir);
    expect(entries.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(entries).toContain('project.json');
  });

  it('creates the asset directories', async () => {
    await initProjectDir(dir);
    const entries = await fs.readdir(dir);
    for (const d of ASSET_DIRS) expect(entries).toContain(d);
  });

  it('rejects an unknown project version', async () => {
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({ version: 999 }), 'utf8');
    await expect(loadProject(dir)).rejects.toThrow(/version/i);
  });
});
