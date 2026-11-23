import { access } from "node:fs/promises";
import type { ConfigurationResource } from "@nervekit/contracts/configuration";
import {
  MCP_CONFIG_FILENAME,
  readMcpConfig,
} from "../../../domains/mcp/mcp-config.js";
import type { ConfigurationResourceProvider } from "../resource-registry.js";

/**
 * The user's `mcp.json`. It is read fresh on every MCP call, so reload equals check; an invalid
 * entry is left out and the others keep working.
 */
export function mcpProvider(options: {
  home: string;
}): ConfigurationResourceProvider {
  async function resources(
    scope: "user" | "project",
    includeActive: boolean,
  ): Promise<ConfigurationResource[]> {
    if (scope !== "user") return [];
    const file = await readMcpConfig(options.home);
    const base = {
      kind: "mcp-servers" as const,
      id: MCP_CONFIG_FILENAME,
      scope: "user" as const,
      path: file.path,
    };
    if (file.problems.length > 0)
      return [
        {
          ...base,
          // Servers that are valid still work; only a file with none of them is out of effect.
          state: file.servers.length > 0 ? "active" : "invalid",
          diagnostics: file.problems.map((message) => ({
            level: "error" as const,
            code: "invalid-value",
            message:
              file.servers.length > 0
                ? `${message}. This entry is ignored; the other servers work.`
                : `${message}.`,
          })),
        },
      ];
    if (!includeActive) return [];
    const exists = await access(file.path).then(
      () => true,
      () => false,
    );
    return exists ? [{ ...base, state: "active", diagnostics: [] }] : [];
  }
  return {
    kinds: ["mcp-servers"],
    list: (context) => resources(context.scope, true),
    check: (context) => resources(context.scope, false),
    reload: (context) => resources(context.scope, false),
  };
}
