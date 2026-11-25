import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrustedResource } from "@nervekit/contracts/core";
import {
  McpCatalog,
  type McpProject,
  type McpTrustLookup,
} from "../../../src/domains/mcp/mcp-catalog.js";
import { McpSecrets } from "../../../src/domains/mcp/mcp-secrets.js";
import {
  McpServerHub,
  type McpRun,
  type McpServerHubOptions,
} from "../../../src/domains/mcp/mcp-server-hub.js";
import { McpToolIndex } from "../../../src/domains/mcp/mcp-tool-index.js";
import type { SecretProvider } from "../../../src/infrastructure/secrets/index.js";

/** In-memory consent rows keyed like the trusted_resource table. */
export class MemoryTrust implements McpTrustLookup {
  readonly rows = new Map<string, TrustedResource>();
  static key(projectId: string | null, name: string) {
    return `${projectId ?? ""}\0${name}`;
  }
  find(_kind: "mcp_server", projectId: string | null, name: string) {
    return this.rows.get(MemoryTrust.key(projectId, name)) ?? null;
  }
  state(
    kind: "mcp_server",
    projectId: string | null,
    name: string,
    contentDigest: string,
  ) {
    const row = this.find(kind, projectId, name);
    return !row
      ? "needs_review"
      : row.status === "rejected"
        ? "declined"
        : row.contentDigest === contentDigest
          ? "trusted"
          : "needs_review";
  }
  decide(input: {
    projectId: string | null;
    resourceKey: string;
    contentDigest: string;
    status: "trusted" | "rejected";
    [extra: string]: unknown;
  }) {
    const key = MemoryTrust.key(input.projectId, input.resourceKey);
    const row: TrustedResource = {
      id: key,
      kind: "mcp_server",
      projectId: input.projectId,
      resourceKey: input.resourceKey,
      name: null,
      status: input.status,
      contentDigest: input.contentDigest,
      grants: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    this.rows.set(key, row);
    return row;
  }
  delete(id: string) {
    this.rows.delete(id);
  }
}

export class MemorySecrets implements SecretProvider {
  readonly values = new Map<string, string>();
  async get(name: string) {
    return this.values.get(name);
  }
  async set(name: string, value: string) {
    this.values.set(name, value);
  }
  async delete(name: string) {
    this.values.delete(name);
  }
  async list() {
    return [...this.values.keys()].sort();
  }
}

/** A hub over a temporary home, with in-memory consent and secrets. */
export async function createTestMcp(
  options: Partial<
    Pick<McpServerHubOptions, "idleMs" | "transport" | "warn">
  > = {},
) {
  const home = await mkdtemp(join(tmpdir(), "nerve-mcp-"));
  const trust = new MemoryTrust();
  const vault = new MemorySecrets();
  const catalog = new McpCatalog({ home, trust });
  const secrets = new McpSecrets(vault);
  const hub = new McpServerHub({
    version: "0.0.0-test",
    catalog,
    secrets,
    index: new McpToolIndex({ cacheDirectory: join(home, "cache", "mcp") }),
    ...options,
  });
  /** Approves what the files hold now, as Settings does for what it saves. */
  const approveAll = async (project?: McpProject) => {
    const view = await catalog.load(project);
    for (const entry of [...view.active, ...view.waiting, ...view.shadowed])
      trust.decide({
        projectId: entry.scope === "project" ? (entry.projectId ?? null) : null,
        resourceKey: entry.name,
        contentDigest: entry.digest,
        status: "trusted",
      });
  };
  const run = (
    servers?: Record<string, boolean>,
    project?: { projectId: string; projectDirectory: string },
    defaults?: boolean,
  ): McpRun => ({
    ...(project ? { projectId: project.projectId } : {}),
    projectDirectory: project?.projectDirectory ?? home,
    enablement: async () =>
      servers === undefined && defaults === undefined
        ? undefined
        : { servers, defaults },
  });
  return {
    home,
    hub,
    trust,
    vault,
    catalog,
    secrets,
    approveAll,
    run,
    async [Symbol.asyncDispose]() {
      await hub.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}
