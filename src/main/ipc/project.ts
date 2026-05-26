// src/main/ipc/project.ts
import { ipcMain, dialog, app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadProject, assetPath } from '../projectStore';
import { projectSession } from '../projectSession';

const recordingsRoot = () => path.join(app.getPath('videos'), 'clip2manual');

async function openDir(projectDir: string) {
  const project = await loadProject(projectDir);
  projectSession.setCurrent(projectDir, project);
  return { projectDir, project };
}

export function registerProjectIpc(): void {
  ipcMain.handle('project:openDialog', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: recordingsRoot(),
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return openDir(res.filePaths[0]);
  });

  ipcMain.handle('project:open', (_e, projectDir: string) => openDir(projectDir));

  ipcMain.handle('project:recent', async () => {
    const root = recordingsRoot();
    let entries: string[] = [];
    try {
      entries = await fs.readdir(root);
    } catch {
      return [];
    }
    const out: { projectDir: string; name: string; createdAt: string }[] = [];
    for (const name of entries) {
      const projectDir = path.join(root, name);
      try {
        const project = await loadProject(projectDir);
        out.push({ projectDir, name: project.meta.name, createdAt: project.meta.createdAt });
      } catch {
        // project.json が無い/壊れているフォルダは無視
      }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  });

  ipcMain.handle('asset:read', async (_e, rel: string) => {
    const { dir } = projectSession.getCurrent();
    const buf = await fs.readFile(assetPath(dir, rel));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('asset:write', async (_e, args: { rel: string; data: ArrayBuffer }) => {
    const { dir } = projectSession.getCurrent();
    await fs.writeFile(assetPath(dir, args.rel), Buffer.from(args.data));
    return { ok: true as const };
  });

  ipcMain.handle('asset:exists', async (_e, rel: string) => {
    const { dir } = projectSession.getCurrent();
    try {
      await fs.access(assetPath(dir, rel));
      return true;
    } catch {
      return false;
    }
  });
}
