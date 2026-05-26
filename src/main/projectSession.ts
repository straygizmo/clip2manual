import { type Project, type Segment } from '../shared/types';
import { saveProject } from './projectStore';

/** main プロセスで「現在開いているプロジェクト」を保持する。 */
export class ProjectSession {
  private dir: string | null = null;
  private project: Project | null = null;

  setCurrent(dir: string, project: Project): void {
    this.dir = dir;
    this.project = project;
  }

  getCurrentProjectDir(): string | null {
    return this.dir;
  }

  getCurrent(): { dir: string; project: Project } {
    if (this.dir === null || this.project === null) {
      throw new Error('No project is currently open');
    }
    return { dir: this.dir, project: this.project };
  }

  /** セグメントを差し替えて project.json に保存する。 */
  async updateSegments(segments: Segment[]): Promise<void> {
    const { dir, project } = this.getCurrent();
    const updated: Project = { ...project, segments };
    this.project = updated;
    await saveProject(dir, updated);
  }
}

/** main プロセス全体で共有するシングルトン。 */
export const projectSession = new ProjectSession();
