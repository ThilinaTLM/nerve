import type { McpServerEntry, McpTarget } from "@nervekit/contracts/mcp";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/** The target of an MCP operation: the user's file or one project's. */
export function mcpTarget(
  scope: "user" | "project",
  projectId: string | undefined,
): McpTarget {
  return scope === "project" && projectId
    ? { scope: "project", projectId }
    : { scope: "user" };
}

export const listMcpServers = (target: McpTarget) =>
  requestWorkbench("mcp.servers.list", { target });

export const saveMcpServer = (input: {
  target: McpTarget;
  name: string;
  entry: McpServerEntry;
  previousName?: string;
  secrets?: Record<string, string>;
  replaceInvalid?: boolean;
}) => requestWorkbench("mcp.servers.save", input);

export const removeMcpServer = (target: McpTarget, name: string) =>
  requestWorkbench("mcp.servers.remove", { target, name });

export const testMcpServer = (target: McpTarget, name: string) =>
  requestWorkbench("mcp.servers.test", { target, name });

export type McpTestResult = Awaited<ReturnType<typeof testMcpServer>>;

export const disconnectMcpServer = (target: McpTarget, name: string) =>
  requestWorkbench("mcp.servers.disconnect", { target, name });
