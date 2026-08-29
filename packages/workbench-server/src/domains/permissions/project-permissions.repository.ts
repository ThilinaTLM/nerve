import { join } from "node:path";
import {
  type PermissionRuleConfig,
  legacyPermissionsConfigSchema,
} from "@nervekit/contracts/settings";
import { type ProjectPermissions } from "@nervekit/contracts/projects";
import {
  atomicWriteJson,
  type InitializedStorage,
  readJsonFile,
} from "../../infrastructure/storage-bootstrap/index.js";

const emptyPermissions = (): ProjectPermissions => ({
  version: 2,
  exceptions: [],
});

export class ProjectPermissionsRepository {
  constructor(private readonly storage: InitializedStorage) {}

  async file(projectId: string): Promise<string> {
    const document = await this.storage.canonicalStore.readDocument<unknown>(
      "project",
      "global",
      projectId,
    );
    const data = document?.data as { dir?: unknown } | undefined;
    if (typeof data?.dir !== "string") throw new Error("Project not found.");
    return join(data.dir, ".nerve", "config", "permissions.json");
  }

  async get(projectId: string): Promise<ProjectPermissions> {
    const path = await this.file(projectId);
    const raw = await readJsonFile<unknown>(path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (raw === undefined) return emptyPermissions();
    const config = legacyPermissionsConfigSchema.parse(raw);
    return {
      version: 2,
      exceptions: config.rules
        .filter((rule) => rule.enabled)
        .map((rule) => ({
          id: `exception_${rule.id.replace(/^exception_/, "")}`.slice(0, 128),
          tool: rule.tool as never,
          effect: rule.effect,
          rule: rule.matcher.pattern,
        })),
    };
  }

  async replace(
    projectId: string,
    permissions: ProjectPermissions,
  ): Promise<ProjectPermissions> {
    const rules: PermissionRuleConfig[] = permissions.exceptions.map(
      (exception) => ({
        id: exception.id.replace(/^exception_/, "") || exception.id,
        effect: exception.effect,
        tool: exception.tool,
        matcher: {
          kind: matcherKind(exception.tool),
          pattern: exception.rule,
        },
        enabled: true,
      }),
    );
    await atomicWriteJson(
      await this.file(projectId),
      legacyPermissionsConfigSchema.parse({ version: 1, rules }),
      0o600,
    );
    return { version: 2, exceptions: permissions.exceptions };
  }
}

function matcherKind(tool: string): PermissionRuleConfig["matcher"]["kind"] {
  if (["read", "edit", "write", "grep", "find", "ls"].includes(tool))
    return "path_glob";
  if (tool === "bash") return "command_glob";
  if (tool === "web_fetch") return "url_glob";
  return "whole_tool";
}
