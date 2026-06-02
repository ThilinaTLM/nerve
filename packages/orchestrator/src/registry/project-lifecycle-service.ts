import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type CreateProjectRequest,
  createId,
  type ProjectRecord,
  type SessionRecord,
} from "@nerve/shared";
import type { EventBus } from "../events.js";
import { HttpError } from "../http/errors.js";
import type { IndexStore } from "../index-store.js";
import type { ProjectRepository } from "../repositories/index.js";

export class ProjectLifecycleService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly projects: Map<string, ProjectRecord>,
    private readonly listSessions: () => SessionRecord[],
    private readonly removeSession: (sessionId: string) => Promise<void>,
  ) {}

  private async canonicalProjectDir(dir: string): Promise<string> {
    const resolved = resolve(dir);
    try {
      return await realpath(resolved);
    } catch {
      return resolved;
    }
  }

  private projectDirKey(dir: string): string {
    const resolved = resolve(dir);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  private async findProjectByDir(
    dir: string,
  ): Promise<ProjectRecord | undefined> {
    const key = this.projectDirKey(dir);
    for (const project of this.projects.values()) {
      const projectDir = await this.canonicalProjectDir(project.dir);
      if (this.projectDirKey(projectDir) === key) return project;
    }
    return undefined;
  }

  async createProject(request: CreateProjectRequest): Promise<ProjectRecord> {
    const dir = await this.canonicalProjectDir(request.dir);
    const existing = await this.findProjectByDir(dir);
    if (existing) return existing;

    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id: createId("proj"),
      name: request.name ?? (basename(dir) || dir),
      dir,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    this.index.upsertProject(project);
    await this.projectRepository.write(project);
    await this.events.publish("project.created", { project });
    return project;
  }

  listProjects(): ProjectRecord[] {
    return [...this.projects.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getProject(projectId: string): ProjectRecord {
    const project = this.projects.get(projectId);
    if (!project)
      throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found.");
    return project;
  }

  async removeProject(projectId: string): Promise<void> {
    this.getProject(projectId);
    for (const session of this.listSessions().filter(
      (candidate) => candidate.projectId === projectId,
    )) {
      await this.removeSession(session.id);
    }
    this.projects.delete(projectId);
    this.index.removeProject(projectId);
    await this.projectRepository.remove(projectId);
    await this.events.publish("project.deleted", { projectId });
  }

  async loadProjects(): Promise<void> {
    for (const project of await this.projectRepository.loadAll()) {
      this.projects.set(project.id, project);
      this.index.upsertProject(project);
    }
  }
}
