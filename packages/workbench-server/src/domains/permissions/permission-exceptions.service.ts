import type {
  PermissionException,
  ProjectPermissions,
  ProjectRecord,
} from "@nervekit/contracts";
import { deduplicatePermissionExceptions } from "@nervekit/tools";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import {
  type InitializedStorage,
  writeSettings,
} from "../../infrastructure/storage/index.js";
import type { ProjectPermissionsRepository } from "./project-permissions.repository.js";

export type DurableExceptionScope = "project" | "user";

export class PermissionExceptionService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly projects: ProjectPermissionsRepository,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly events: StreamLogRegistry,
  ) {}

  async project(projectId: string): Promise<ProjectPermissions> {
    this.getProject(projectId);
    return this.projects.get(projectId);
  }

  async replaceProject(
    projectId: string,
    permissions: ProjectPermissions,
  ): Promise<ProjectPermissions> {
    this.getProject(projectId);
    return this.exclusive(`project:${projectId}`, async () => {
      const saved = await this.projects.replace(projectId, permissions);
      await this.events.publish("project.permissions.updated", {
        projectId,
        permissions: saved,
      });
      return saved;
    });
  }

  async effective(projectId: string): Promise<PermissionException[]> {
    const project = await this.project(projectId);
    return deduplicatePermissionExceptions([
      ...this.storage.settings.permissions.exceptions,
      ...project.exceptions,
    ]);
  }

  async add(
    projectId: string,
    scope: DurableExceptionScope,
    exceptions: readonly PermissionException[],
  ): Promise<void> {
    this.getProject(projectId);
    if (scope === "project") {
      await this.exclusive(`project:${projectId}`, async () => {
        const current = await this.projects.get(projectId);
        const permissions = await this.projects.replace(projectId, {
          version: 2,
          exceptions: deduplicatePermissionExceptions([
            ...current.exceptions,
            ...exceptions,
          ]),
        });
        await this.events.publish("project.permissions.updated", {
          projectId,
          permissions,
        });
      });
      return;
    }
    await this.exclusive("user", async () => {
      const settings = await writeSettings(this.storage, {
        permissions: {
          exceptions: deduplicatePermissionExceptions([
            ...this.storage.settings.permissions.exceptions,
            ...exceptions,
          ]),
        },
      });
      await this.events.publish("settings.updated", { settings });
    });
  }

  private exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    return result.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
  }
}
