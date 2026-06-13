import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type ProjectRecord, projectRecordSchema } from "@nerve/shared";
import {
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

export class ProjectRepository {
  constructor(private readonly storage: InitializedStorage) {}

  projectDir(projectId: string): string {
    return join(this.storage.paths.home, "projects", projectId);
  }

  projectPath(projectId: string): string {
    return join(this.projectDir(projectId), "project.json");
  }

  async loadAll(): Promise<ProjectRecord[]> {
    const root = join(this.storage.paths.home, "projects");
    const projects: ProjectRecord[] = [];
    for (const projectId of await listChildDirs(root)) {
      const parsed = projectRecordSchema.safeParse(
        await readJsonFile<unknown>(this.projectPath(projectId)).catch(
          () => undefined,
        ),
      );
      if (parsed.success) projects.push(parsed.data);
    }
    return projects;
  }

  async write(project: ProjectRecord): Promise<void> {
    await atomicWriteJson(this.projectPath(project.id), project, 0o600);
  }

  async remove(projectId: string): Promise<void> {
    await rm(this.projectDir(projectId), { recursive: true, force: true });
  }
}
