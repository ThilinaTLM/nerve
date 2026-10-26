import { readFile } from "node:fs/promises";
import type { CoreStorage } from "@nervekit/conversation-core";
import {
  permissionOverlayDocumentForOriginSchema,
  type PermissionOverlayDocument,
  type PermissionPolicyConfiguration,
  type PermissionRule,
  type ProjectPermissionTrust,
} from "@nervekit/contracts/permissions";
import {
  emptyOverlayDocument,
  loadPermissionOverlay,
  mutatePermissionOverlay,
  overlayDigest,
  trustProjectPermissions,
} from "./permission-overlays.js";
import { listPermissionRuleSets } from "./permission-rule-sets.js";
import {
  ConfigurationScopePaths,
  userConfigurationRoot,
} from "../infrastructure/configuration/scope-paths.js";

export type PermissionRuleTarget = {
  scope: "user" | "project";
  projectId?: string | undefined;
  ruleSetId: string;
};

export interface PermissionConfigurationService {
  get(projectId?: string): Promise<PermissionPolicyConfiguration>;
  saveRule(
    input: PermissionRuleTarget & {
      previousRuleId?: string | undefined;
      rule: PermissionRule;
    },
  ): Promise<PermissionPolicyConfiguration>;
  deleteRule(
    input: PermissionRuleTarget & { ruleId: string },
  ): Promise<PermissionPolicyConfiguration>;
  grantProjectTrust(projectId: string): Promise<PermissionPolicyConfiguration>;
}

type ProjectOverlayState = {
  path: string;
  document: PermissionOverlayDocument;
  trust: ProjectPermissionTrust;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPermissionConfigurationService(options: {
  home: string;
  storage: CoreStorage;
  projectDirectory: (projectId: string) => string | undefined;
  published?(path: string): Promise<void>;
}): PermissionConfigurationService {
  const { home, storage } = options;

  const paths = new ConfigurationScopePaths({
    userConfigPath: userConfigurationRoot(home),
    projectDirectory: options.projectDirectory,
  });
  const userPath = paths.resolve({ scope: "user" }, "permissions.json").path;
  const projectPath = (projectId: string): string =>
    paths.resolve({ scope: "project", projectId }, "permissions.json").path;

  async function readProject(projectId: string): Promise<ProjectOverlayState> {
    const path = projectPath(projectId);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          path,
          document: emptyOverlayDocument(),
          trust: { status: "missing" },
        };
      throw error;
    }
    const digest = overlayDigest(content);
    let document: PermissionOverlayDocument;
    try {
      document = permissionOverlayDocumentForOriginSchema("project").parse(
        JSON.parse(content),
      );
    } catch (error) {
      return {
        path,
        document: emptyOverlayDocument(),
        trust: { status: "invalid", digest, reason: message(error) },
      };
    }
    const record = storage.trustedResources.find(
      "project_permissions",
      projectId,
      path,
    );
    if (record?.status === "trusted" && record.contentDigest === digest)
      return {
        path,
        document,
        trust: {
          status: "trusted",
          digest,
          trustedDigest: record.contentDigest,
          trustedAt: record.updatedAt,
        },
      };
    return {
      path,
      document,
      trust: {
        status: "untrusted",
        digest,
        ...(record?.status === "trusted"
          ? {
              trustedDigest: record.contentDigest,
              trustedAt: record.updatedAt,
              reason: "The file changed after it was trusted.",
            }
          : { reason: "The file has not been trusted." }),
      },
    };
  }

  async function get(
    projectId?: string,
  ): Promise<PermissionPolicyConfiguration> {
    const diagnostics: string[] = [];
    const catalog = await listPermissionRuleSets(home);
    let userOverlays = emptyOverlayDocument();
    try {
      userOverlays = await loadPermissionOverlay("user", userPath);
    } catch (error) {
      diagnostics.push(`User permissions file is invalid: ${message(error)}`);
    }
    const project = projectId ? await readProject(projectId) : undefined;
    if (project?.trust.status === "invalid")
      diagnostics.push(
        `Project permissions file is invalid: ${project.trust.reason ?? ""}`,
      );
    return {
      ruleSets: catalog.map((ruleSet) => ({
        id: ruleSet.id,
        name: ruleSet.name,
        ...(ruleSet.description ? { description: ruleSet.description } : {}),
        source: ruleSet.source,
        enabled: ruleSet.enabled,
        available: true,
      })),
      userOverlays,
      projectOverlays: project?.document ?? emptyOverlayDocument(),
      projectTrust: project?.trust ?? { status: "missing" },
      diagnostics,
    };
  }

  async function writableTarget(target: PermissionRuleTarget): Promise<string> {
    const catalog = await listPermissionRuleSets(home);
    if (!catalog.some((ruleSet) => ruleSet.id === target.ruleSetId))
      throw new Error(`Unknown permission rule set: ${target.ruleSetId}`);
    if (target.scope === "user") return userPath;
    if (!target.projectId)
      throw new Error("A project is required to edit project permissions.");
    const project = await readProject(target.projectId);
    if (project.trust.status === "untrusted")
      throw new Error(
        "Project permissions are not trusted. Review the file and trust it before editing.",
      );
    return project.path;
  }

  async function afterWrite(
    target: PermissionRuleTarget,
    path: string,
  ): Promise<PermissionPolicyConfiguration> {
    if (target.scope === "project" && target.projectId)
      await trustProjectPermissions(storage, target.projectId, path);
    await options.published?.(path);
    return get(target.projectId);
  }

  return {
    get,
    async saveRule(input) {
      const path = await writableTarget(input);
      await mutatePermissionOverlay(input.scope, path, (document) => {
        let overlay = document.overlays.find(
          (item) => item.ruleSetId === input.ruleSetId,
        );
        if (!overlay) {
          overlay = { ruleSetId: input.ruleSetId, rules: [] };
          document.overlays.push(overlay);
        }
        if (input.previousRuleId === undefined) {
          if (overlay.rules.some((rule) => rule.id === input.rule.id))
            throw new Error(
              `A rule with ID "${input.rule.id}" already exists.`,
            );
          overlay.rules.push(input.rule);
          return;
        }
        const index = overlay.rules.findIndex(
          (rule) => rule.id === input.previousRuleId,
        );
        if (index < 0)
          throw new Error(`Rule "${input.previousRuleId}" no longer exists.`);
        overlay.rules[index] = input.rule;
      });
      return afterWrite(input, path);
    },
    async deleteRule(input) {
      const path = await writableTarget(input);
      await mutatePermissionOverlay(input.scope, path, (document) => {
        const overlay = document.overlays.find(
          (item) => item.ruleSetId === input.ruleSetId,
        );
        if (!overlay?.rules.some((rule) => rule.id === input.ruleId))
          throw new Error(`Rule "${input.ruleId}" no longer exists.`);
        overlay.rules = overlay.rules.filter(
          (rule) => rule.id !== input.ruleId,
        );
        if (overlay.rules.length === 0)
          document.overlays = document.overlays.filter(
            (item) => item !== overlay,
          );
      });
      return afterWrite(input, path);
    },
    async grantProjectTrust(projectId) {
      const project = await readProject(projectId);
      if (
        project.trust.status === "missing" ||
        project.trust.status === "invalid"
      )
        throw new Error("There is no valid project permissions file to trust.");
      await trustProjectPermissions(storage, projectId, project.path);
      await options.published?.(project.path);
      return get(projectId);
    },
  };
}
