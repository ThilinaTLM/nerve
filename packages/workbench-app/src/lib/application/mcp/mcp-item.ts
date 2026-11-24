import type { McpScope } from "@nervekit/contracts/mcp";

/**
 * The settings item of one server on the MCP servers page: its scope and name,
 * since a project server and one of the user's can share a name.
 */
export const mcpItemId = (scope: McpScope, name: string) => `${scope}:${name}`;

export function parseMcpItemId(
  id: string,
): { scope: McpScope; name: string } | undefined {
  const at = id.indexOf(":");
  const scope = id.slice(0, at);
  const name = id.slice(at + 1);
  return at > 0 && name && (scope === "user" || scope === "project")
    ? { scope, name }
    : undefined;
}
