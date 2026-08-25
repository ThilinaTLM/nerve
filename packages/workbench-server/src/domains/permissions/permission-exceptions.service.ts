import { createHash } from "node:crypto";
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
    ...(scope === "project"
      ? {
          sourceDigest: createHash("sha256")
            .update(
              JSON.stringify({
                effect: exception.effect,
                tool: exception.tool,
                rule: exception.rule,
              }),
            )
            .digest("hex"),
        }
      : {}),
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

function sameRule(left: PermissionRule, right: PermissionRule): boolean {
  return (
    left.id === right.id &&
    left.effect === right.effect &&
    left.toolName === right.toolName &&
    left.matcherKind === right.matcherKind &&
    left.pattern === right.pattern &&
    left.sourceDigest === right.sourceDigest &&
    left.enabled === right.enabled
  );
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
      const timestamp = new Date().toISOString();
      // This protocol mutation is an explicit trust decision. The canonical
      // copy is a hash-equivalent trust record; later file edits stop matching.
      await this.storage.canonicalStore.replacePermissionRules(
        "project",
        projectId,
        saved.exceptions.map((exception) =>
          toRule(exception, "project", projectId, timestamp),
        ),
      );
      await this.events.publish("project.permissions.updated", {
        projectId,
        permissions: saved,
      });
      return saved;
    });
  }

  async effectiveRules(projectId: string): Promise<PermissionRule[]> {
    this.getProject(projectId);
    const now = new Date().toISOString();
    const userRules = this.storage.settings.permissions.exceptions.map(
      (exception) => toRule(exception, "user", undefined, now),
    );
    const requested = (await this.projects.get(projectId)).exceptions.map(
      (exception) => toRule(exception, "project", projectId, now),
    );
    const trusted = (
      await this.storage.canonicalStore.listPermissionRules(projectId)
    ).filter((rule) => rule.scope === "project");
    const effectiveProject = requested.filter(
      (rule) =>
        rule.effect === "deny" ||
        trusted.some((candidate) => sameRule(rule, candidate)),
    );
    // User deny rules are evaluated first by the policy layer and cannot be
    // displaced by project allows.
    return [...userRules, ...effectiveProject];
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
