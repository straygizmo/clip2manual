import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Project, CURRENT_PROJECT_VERSION } from '../shared/types';

const PROJECT_FILE = 'project.json';
export const ASSET_DIRS = ['assets', 'tts'] as const;

export async function initProjectDir(projectDir: string): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  for (const d of ASSET_DIRS) {
    await fs.mkdir(path.join(projectDir, d), { recursive: true });
  }
}

export async function saveProject(projectDir: string, project: Project): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  const target = path.join(projectDir, PROJECT_FILE);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf8');
  await fs.rename(tmp, target);
}

export async function loadProject(projectDir: string): Promise<Project> {
  const raw = await fs.readFile(path.join(projectDir, PROJECT_FILE), 'utf8');
  const parsed = JSON.parse(raw) as Project;
  if (parsed.version !== CURRENT_PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${parsed.version}`);
  }
  return parsed;
}

export function assetPath(projectDir: string, relative: string): string {
  return path.join(projectDir, relative);
}
