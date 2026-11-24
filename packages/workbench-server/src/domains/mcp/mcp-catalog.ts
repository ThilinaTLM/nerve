import type { McpReviewStatus, McpScope } from "@nervekit/contracts/mcp";
import type { TrustedResource } from "@nervekit/contracts/core";
import {
  mcpConfigPath,
  mcpEntryDigest,
  projectMcpConfigPath,
  readMcpFile,
  type McpConfigFile,
  type McpServerEntry,
} from "./mcp-config.js";

/** Where the user acts on a server of each scope; named in errors the agent reads. */
export const MCP_SETTINGS_PAGE: Record<McpScope, string> = {
  user: "User settings → Connections → MCP servers",
  project: "Project settings → Agent → MCP servers",
};

/** The consent rows (`mcp_server` in the trusted_resource table), by project (null: user) and server name. */
export type McpTrustLookup = {
  find(
    kind: "mcp_server",
    projectId: string | null,
    resourceKey: string,
  ): Pick<TrustedResource, "status" | "contentDigest"> | null;
};

/** One entry of a file, with the user's decision about its exact content. */
export type CatalogEntry = {
  name: string;
  scope: McpScope;
  /** The project of a project entry. */
  projectId?: string;
  server: McpServerEntry;
  /** `sha256:<hex>` of the entry as written and its scope. */
  digest: string;
  review: McpReviewStatus;
};

export type CatalogFile = McpConfigFile & { exists: boolean };

/** What one conversation sees: the files and the entries after precedence. */
export type CatalogView = {
  user: CatalogFile;
  project?: CatalogFile;
  /** The entry each name resolves to, in file order (user names first). */
  active: CatalogEntry[];
  /** Project entries that are pending or rejected while a user entry of the same name is active. */
  waiting: CatalogEntry[];
  /** User entries an approved project entry replaces. */
  shadowed: CatalogEntry[];
};

export type McpProject = { projectId: string; projectDirectory: string };

/**
 * The user's and a project's `mcp.json` after precedence. The same name in both: an approved
 * project entry replaces the user entry whole; while it waits for review (or is rejected) the user
 * entry keeps working. Entries never merge. Read on every call.
 */
export class McpCatalog {
  constructor(
    private readonly options: { home: string; trust: McpTrustLookup },
  ) {}

  review(
    scope: McpScope,
    projectId: string | undefined,
    name: string,
    digest: string,
  ): McpReviewStatus {
    const row = this.options.trust.find(
      "mcp_server",
      scope === "project" ? (projectId ?? null) : null,
      name,
    );
    if (!row || row.contentDigest !== digest) return "needs_approval";
    return row.status === "trusted" ? "approved" : "rejected";
  }

  entry(
    scope: McpScope,
    projectId: string | undefined,
    server: McpServerEntry,
  ): CatalogEntry {
    const digest = mcpEntryDigest(scope, server);
    return {
      name: server.name,
      scope,
      ...(scope === "project" && projectId ? { projectId } : {}),
      server,
      digest,
      review: this.review(scope, projectId, server.name, digest),
    };
  }

  async user(): Promise<CatalogFile> {
    return readMcpFile(mcpConfigPath(this.options.home));
  }

  async load(project?: McpProject): Promise<CatalogView> {
    const user = await this.user();
    const projectFile = project
      ? await readMcpFile(projectMcpConfigPath(project.projectDirectory))
      : undefined;
    const userEntries = user.servers.map((server) =>
      this.entry("user", undefined, server),
    );
    const projectEntries = (projectFile?.servers ?? []).map((server) =>
      this.entry("project", project?.projectId, server),
    );
    const active = new Map<string, CatalogEntry>();
    const waiting: CatalogEntry[] = [];
    const shadowed: CatalogEntry[] = [];
    for (const entry of userEntries) active.set(entry.name, entry);
    for (const entry of projectEntries) {
      const user = active.get(entry.name);
      if (!user) active.set(entry.name, entry);
      else if (entry.review === "approved") {
        shadowed.push(user);
        active.set(entry.name, entry);
      } else waiting.push(entry);
    }
    return {
      user,
      ...(projectFile ? { project: projectFile } : {}),
      active: [...active.values()],
      waiting,
      shadowed,
    };
  }
}
