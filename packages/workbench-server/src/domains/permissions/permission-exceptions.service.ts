import type {
  PermissionException,
  PermissionRule,
  PermissionRuleMatcherKind,
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

function matcherKind(
  exception: PermissionException,
): PermissionRuleMatcherKind {
  if (["read", "edit", "write", "grep", "find", "ls"].includes(exception.tool))
    return "path_glob";
  if (exception.tool === "bash") return "command_glob";
  if (exception.tool === "web_fetch") return "url_glob";
  return "whole_tool";
}

function toRule(
  exception: PermissionException,
  scope: "user" | "project",
  projectId: string | undefined,
  timestamp: string,
): PermissionRule {
  return {
    id: `rule_${scope}_${exception.id.replace(/^exception_/, "")}`.slice(
      0,
      128,
    ),
    scope,
    projectId,
    effect: exception.effect,
    toolName: exception.tool,
    matcherKind: matcherKind(exception),
    pattern: exception.rule,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toException(rule: PermissionRule): PermissionException {
  return {
    id: `exception_${rule.id.replace(/^rule_(?:user|project)_?/, "")}`.slice(
      0,
      128,
    ),
    tool: rule.toolName as PermissionException["tool"],
    effect: rule.effect,
    rule: rule.pattern,
  };
}

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
    return {
      version: 2,
      exceptions: (
        await this.storage.canonicalStore.listPermissionRules(projectId)
      )
        .filter((rule) => rule.scope === "project")
        .map(toException),
    };
  }

  async replaceProject(
    projectId: string,
    permissions: ProjectPermissions,
  ): Promise<ProjectPermissions> {
    this.getProject(projectId);
    return this.exclusive(`project:${projectId}`, async () => {
      const timestamp = new Date().toISOString();
      await this.storage.canonicalStore.replacePermissionRules(
        "project",
        projectId,
        permissions.exceptions.map((exception) =>
          toRule(exception, "project", projectId, timestamp),
        ),
      );
      const saved: ProjectPermissions = {
        version: 2,
        exceptions: permissions.exceptions,
      };
      await this.events.publish("project.permissions.updated", {
        projectId,
        permissions: saved,
      });
      return saved;
    });
  }

  async effectiveRules(projectId: string): Promise<PermissionRule[]> {
    this.getProject(projectId);
    return this.storage.canonicalStore.listPermissionRules(projectId);
  }

  async effective(projectId: string): Promise<PermissionException[]> {
    return deduplicatePermissionExceptions(
      (await this.storage.canonicalStore.listPermissionRules(projectId)).map(
        toException,
      ),
    );
  }

  async add(
    projectId: string,
    scope: DurableExceptionScope,
    exceptions: readonly PermissionException[],
  ): Promise<void> {
    this.getProject(projectId);
    if (scope === "project") {
      await this.exclusive(`project:${projectId}`, async () => {
        const current = await this.project(projectId);
        const permissions: ProjectPermissions = {
          version: 2,
          exceptions: deduplicatePermissionExceptions([
            ...current.exceptions,
            ...exceptions,
          ]),
        };
        const timestamp = new Date().toISOString();
        await this.storage.canonicalStore.replacePermissionRules(
          "project",
          projectId,
          permissions.exceptions.map((exception) =>
            toRule(exception, "project", projectId, timestamp),
          ),
        );
        await this.events.publish("project.permissions.updated", {
          projectId,
          permissions,
        });
      });
      return;
    }
    await this.exclusive("user", async () => {
      const current = (await this.storage.canonicalStore.listPermissionRules())
        .filter((rule) => rule.scope === "user")
        .map(toException);
      const merged = deduplicatePermissionExceptions([
        ...current,
        ...exceptions,
      ]);
      const timestamp = new Date().toISOString();
      await this.storage.canonicalStore.replacePermissionRules(
        "user",
        undefined,
        merged.map((exception) =>
          toRule(exception, "user", undefined, timestamp),
        ),
      );
      const settings = await writeSettings(this.storage, {
        permissions: { exceptions: merged },
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
