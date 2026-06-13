import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type CreateProjectRequest,
  createId,
  type ProjectRecord,
} from "@nerve/shared";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { ProjectRepository } from "./project.repository.js";

export class ProjectLifecycleService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly state: RuntimeState,
    private readonly removeConversation: (
      conversationId: string,
    ) => Promise<void>,
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
    for (const project of this.state.projects.values()) {
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
    this.state.projects.set(project.id, project);
    this.index.upsertProject(project);
    await this.projectRepository.write(project);
    await this.events.publish("project.created", { project });
    return project;
  }

  listProjects(): ProjectRecord[] {
    return this.state.listProjects();
  }

  getProject(projectId: string): ProjectRecord {
    return this.state.getProject(projectId);
  }

  async removeProject(projectId: string): Promise<void> {
    this.getProject(projectId);
    for (const conversation of this.state
      .listConversations()
      .filter((candidate) => candidate.projectId === projectId)) {
      await this.removeConversation(conversation.id);
    }
    this.state.projects.delete(projectId);
    this.index.removeProject(projectId);
    await this.projectRepository.remove(projectId);
    await this.events.publish("project.deleted", { projectId });
  }

  async loadProjects(): Promise<void> {
    for (const project of await this.projectRepository.loadAll()) {
      this.state.projects.set(project.id, project);
      this.index.upsertProject(project);
    }
  }
}
