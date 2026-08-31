import type {
  PermissionException,
  LegacyPermissionRule,
  LegacyPermissionRuleMatcherKind,
} from "@nervekit/contracts/permissions";
import type {
  ProjectPermissions,
  ProjectRecord,
} from "@nervekit/contracts/projects";
import { deduplicatePermissionExceptions } from "@nervekit/tools/policy";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import {
  type InitializedStorage,
  writeSettings,
} from "../../infrastructure/storage-bootstrap/index.js";
import type { ProjectPermissionsRepository } from "./project-permissions.repository.js";

function matcherKind(
  exception: PermissionException,
): LegacyPermissionRuleMatcherKind {
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
): LegacyPermissionRule {
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

function toException(rule: LegacyPermissionRule): PermissionException {
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

  async effectiveRules(projectId: string): Promise<LegacyPermissionRule[]> {
    this.getProject(projectId);
    const now = new Date().toISOString();
    const userRules = this.storage.settings.permissions.exceptions.map(
      (exception) => toRule(exception, "user", undefined, now),
    );
    const projectRules = (await this.projects.get(projectId)).exceptions.map(
      (exception) => toRule(exception, "project", projectId, now),
    );
    // Deny precedence and hard constraints remain enforced by the policy layer.
    return [...userRules, ...projectRules];
  }

  async effective(projectId: string): Promise<PermissionException[]> {
    return deduplicatePermissionExceptions(
      (await this.effectiveRules(projectId)).map(toException),
    );
  }

  async add(
    projectId: string,
    scope: DurableExceptionScope,
    exceptions: readonly PermissionException[],
  ): Promise<void> {
    this.getProject(projectId);
    if (scope === "project") {
      const current = await this.project(projectId);
      await this.replaceProject(projectId, {
        version: 2,
        exceptions: deduplicatePermissionExceptions([
          ...current.exceptions,
          ...exceptions,
        ]),
      });
      return;
    }
    await this.exclusive("user", async () => {
      const merged = deduplicatePermissionExceptions([
        ...this.storage.settings.permissions.exceptions,
        ...exceptions,
      ]);
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
