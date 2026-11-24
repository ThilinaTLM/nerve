import type {
  ConfigurationResource,
  Diagnostic,
} from "@nervekit/contracts/configuration";
import {
  MCP_SETTINGS_PAGE,
  type CatalogEntry,
  type CatalogFile,
  type McpCatalog,
} from "../../../domains/mcp/mcp-catalog.js";
import { MCP_CONFIG_FILENAME } from "../../../domains/mcp/mcp-config.js";
import {
  approvalDiagnostic,
  type ConfigurationResourceProvider,
  type ResourceContext,
} from "../resource-registry.js";

/**
 * The `mcp.json` of the user and of a project: the file (invalid entries are errors; the valid
 * ones keep working) and each server in it. A server waits for the user's approval of its exact
 * entry (`needs_approval`) or was rejected (`disabled`). Files are read fresh on every MCP call, so
 * reload equals check.
 */
export function mcpProvider(options: {
  catalog: McpCatalog;
}): ConfigurationResourceProvider {
  const file = (
    scope: "user" | "project",
    source: CatalogFile,
  ): ConfigurationResource[] => {
    if (source.problems.length === 0) return [];
    return [
      {
        kind: "mcp-servers",
        id: MCP_CONFIG_FILENAME,
        scope,
        path: source.path,
        // Servers that are valid still work; only a file with none of them is out of effect.
        state: source.servers.length > 0 ? "active" : "invalid",
        diagnostics: source.problems.map(
          (message): Diagnostic => ({
            level: "error",
            code: "invalid-value",
            message:
              source.servers.length > 0
                ? `${message}. This entry is ignored; the other servers work.`
                : `${message}.`,
          }),
        ),
      },
    ];
  };

  const server = (entry: CatalogEntry, path: string): ConfigurationResource => {
    const base = {
      kind: "mcp-servers" as const,
      id: entry.name,
      scope: entry.scope,
      path,
    };
    const approval = {
      kind: "consent" as const,
      where: MCP_SETTINGS_PAGE[entry.scope],
    };
    if (entry.review === "needs_approval")
      return {
        ...base,
        state: "needs_approval",
        approval,
        diagnostics: [approvalDiagnostic(approval)],
      };
    if (entry.review === "rejected")
      return {
        ...base,
        state: "disabled",
        diagnostics: [
          {
            level: "warning",
            code: "rejected",
            message: `The user rejected this entry, so it is not used. They can approve it in ${approval.where}. You cannot approve it; tell the user.`,
          },
        ],
      };
    return { ...base, state: "active", diagnostics: [] };
  };

  async function resources(
    context: ResourceContext,
    includeActive: boolean,
  ): Promise<ConfigurationResource[]> {
    const project =
      context.scope === "project" &&
      context.projectId &&
      context.projectDirectory
        ? {
            projectId: context.projectId,
            projectDirectory: context.projectDirectory,
          }
        : undefined;
    const view = await options.catalog.load(project);
    const source = context.scope === "user" ? view.user : view.project;
    if (!source) return [];
    // Entries of this scope's own file; a project page lists the user's entries under the user scope.
    const found = [
      ...file(context.scope, source),
      ...[...view.active, ...view.waiting]
        .filter((entry) => entry.scope === context.scope)
        .map((entry) => server(entry, source.path)),
    ];
    return includeActive
      ? found
      : found.filter(
          (resource) =>
            resource.state !== "active" || resource.diagnostics.length > 0,
        );
  }

  return {
    kinds: ["mcp-servers"],
    list: (context) => resources(context, true),
    check: (context) => resources(context, false),
    reload: (context) => resources(context, false),
  };
}
