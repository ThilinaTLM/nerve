import type {
  ProjectRecord,
  ProjectSupervisionPreferences,
  SupervisionGrant,
} from "@nervekit/contracts";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import {
  type InitializedStorage,
  writeSettings,
} from "../../infrastructure/storage/index.js";
import type { ProjectPermissionsRepository } from "../projects/project-permissions.repository.js";

export type DurableGrantScope = "project" | "global";

export class SupervisionPreferencesService {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly projects: ProjectPermissionsRepository,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly events: StreamLogRegistry,
  ) {}

  async project(projectId: string): Promise<ProjectSupervisionPreferences> {
    this.getProject(projectId);
    return this.projects.get(projectId);
  }

  async replaceProject(
    projectId: string,
    permissions: ProjectSupervisionPreferences,
  ): Promise<ProjectSupervisionPreferences> {
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

  async effective(projectId: string): Promise<SupervisionGrant[]> {
    const project = await this.project(projectId);
    return deduplicateGrants([
      ...this.storage.settings.supervision.grants,
      ...project.grants,
    ]);
  }

  async add(
    projectId: string,
    scope: DurableGrantScope,
    grants: readonly SupervisionGrant[],
  ): Promise<void> {
    this.getProject(projectId);
    if (scope === "project") {
      await this.exclusive(`project:${projectId}`, async () => {
        const current = await this.projects.get(projectId);
        const permissions = await this.projects.replace(projectId, {
          version: 1,
          grants: deduplicateGrants([...current.grants, ...grants]),
        });
        await this.events.publish("project.permissions.updated", {
          projectId,
          permissions,
        });
      });
      return;
    }
    await this.exclusive("global", async () => {
      const settings = await writeSettings(this.storage, {
        supervision: {
          grants: deduplicateGrants([
            ...this.storage.settings.supervision.grants,
            ...grants,
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

export function supervisionGrantKey(grant: SupervisionGrant): string {
  return grant.target === "tool"
    ? `tool:${grant.toolName}:${grant.risk}`
    : `command:${grant.tokens.join("\u0000")}:${grant.risk}`;
}

export function deduplicateGrants(
  grants: readonly SupervisionGrant[],
): SupervisionGrant[] {
  const unique = new Map<string, SupervisionGrant>();
  for (const grant of grants) {
    const key = supervisionGrantKey(grant);
    if (!unique.has(key)) unique.set(key, grant);
  }
  return [...unique.values()];
}
