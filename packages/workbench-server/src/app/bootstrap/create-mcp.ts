import { join } from "node:path";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import type { ConversationCore } from "@nervekit/conversation-core";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { McpCatalog } from "../../domains/mcp/mcp-catalog.js";
import { McpSecrets } from "../../domains/mcp/mcp-secrets.js";
import { McpService } from "../../domains/mcp/mcp-service.js";
import { McpServerHub } from "../../domains/mcp/mcp-server-hub.js";
import { McpToolIndex } from "../../domains/mcp/mcp-tool-index.js";
import { version as nerveVersion } from "../version.js";
import type { RuntimeDeps } from "./create-runtime-services.js";

/** The catalog, secrets and connections of MCP servers; consent comes from the (later built) core's trust. */
export function createMcpHub(deps: RuntimeDeps, core: () => ConversationCore) {
  const catalog = new McpCatalog({
    home: deps.storage.paths.home,
    trust: {
      find: (kind, projectId, key) => core().trust.find(kind, projectId, key),
    },
  });
  const secrets = new McpSecrets(deps.secrets);
  const hub = new McpServerHub({
    version: nerveVersion,
    catalog,
    secrets,
    index: new McpToolIndex({
      cacheDirectory: join(deps.storage.paths.home, "cache", "mcp"),
    }),
    warn: (message, context) =>
      void deps.logger.warn(message, { context }).catch(() => undefined),
  });
  return { catalog, secrets, hub };
}

/**
 * The MCP servers defined for each project (user and project files): the names its conversations'
 * settings can switch. Refreshed whenever a project's resources are prepared.
 */
export class McpServerNames {
  readonly #names = new Map<string, string[]>();
  constructor(private readonly catalog: McpCatalog) {}

  async refresh(projectId: string, projectDirectory: string) {
    const view = await this.catalog.load({ projectId, projectDirectory });
    this.#names.set(projectId, [
      ...new Set(
        [...view.user.servers, ...(view.project?.servers ?? [])].map(
          (server) => server.name,
        ),
      ),
    ]);
  }
  get(projectId: string): string[] {
    return this.#names.get(projectId) ?? [];
  }
  /** Part of the resources fingerprint: a changed set makes conversations resolve again. */
  snapshot() {
    return [...this.#names];
  }
}

/** Settings → MCP servers: the operations of the signed-in user. */
export function createMcpService(options: {
  deps: RuntimeDeps;
  parts: ReturnType<typeof createMcpHub>;
  core: () => ConversationCore;
  agentConfiguration: AgentConfigurationService;
  projectDirectory(projectId: string): string | undefined;
  /** Eligible names and resolved settings change with the files and with approvals. */
  invalidate(): void;
}) {
  const { deps, parts, core, agentConfiguration } = options;
  return new McpService({
    catalog: parts.catalog,
    secrets: parts.secrets,
    hub: parts.hub,
    trust: {
      decide: (input) => core().trust.decide(input),
      find: (kind, projectId, key) => core().trust.find(kind, projectId, key),
      delete: (id) => core().trust.delete(id),
    },
    home: deps.storage.paths.home,
    projectDirectory: options.projectDirectory,
    enablement: async (target) => {
      try {
        if (target.scope === "user") {
          const user = await agentConfiguration.ensureLoaded({ scope: "user" });
          if (user.status === "unavailable") return undefined;
          return resolveAgentConfiguration({
            role: "lead",
            user: user.value.document.overrides,
            eligibleMcpServers: (await parts.catalog.user()).servers.map(
              (server) => server.name,
            ),
          }).settings.mcpServers?.servers;
        }
        const defaults = await agentConfiguration.captureDefaults(
          target.projectId,
        );
        return resolveAgentConfiguration({
          role: "lead",
          ...defaults.options,
        }).settings.mcpServers?.servers;
      } catch {
        return undefined;
      }
    },
    changed: (target) => {
      options.invalidate();
      void deps.events
        .publish("mcp.changed", { scope: target })
        .catch((error) => {
          void deps.logger.warn("MCP change notification failed", { error });
        });
    },
  });
}
