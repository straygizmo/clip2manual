import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectSession } from '../src/main/projectSession';
import { createProject, type Project } from '../src/shared/types';
import { saveProject, loadProject } from '../src/main/projectStore';

function makeProject(): Project {
  return createProject({
    name: 'rec-1',
    source: {
      video: 'assets/raw.webm', narration: 'assets/narration.webm', clickLog: 'assets/clicks.json',
      display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
    },
  });
}

describe('ProjectSession', () => {
  let session: ProjectSession;
  beforeEach(() => { session = new ProjectSession(); });

  it('has no current project initially', () => {
    expect(session.getCurrentProjectDir()).toBeNull();
    expect(() => session.getCurrent()).toThrow();
  });

  it('stores and returns the current project', () => {
    const p = makeProject();
    session.setCurrent('/tmp/rec-1', p);
    expect(session.getCurrentProjectDir()).toBe('/tmp/rec-1');
    expect(session.getCurrent().project).toBe(p);
  });

  it('updateSegments writes segments to project.json on disk', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-sess-'));
    const p = makeProject();
    await saveProject(dir, p);
    session.setCurrent(dir, p);

    await session.updateSegments([
      { id: 'seg-001', videoStart: 0, videoEnd: 1, originalText: 'a', correctedText: 'a',
        ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true },
    ]);

    const reloaded = await loadProject(dir);
    expect(reloaded.segments).toHaveLength(1);
    expect(session.getCurrent().project.segments).toHaveLength(1);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
