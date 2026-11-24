import { createHash } from "node:crypto";
import type { Tool } from "@earendil-works/pi-mcp";
import { ToolExecutionError } from "@nervekit/tools/execution";
import type { McpTool } from "@nervekit/tools/quick-script";
import type { CatalogEntry, CatalogView } from "./mcp-catalog.js";
import type { McpRun } from "./mcp-enablement.js";
import type { ResolvedMcpServer } from "./mcp-config.js";

export type Prepared = {
  entry: CatalogEntry;
  resolved: ResolvedMcpServer;
  projectDirectory: string;
  /** `#generation` when prepared; a later one means approvals may have changed. */
  generation: number;
  /** Connections are shared by this key. */
  key: string;
  /** Where the entry's tools are indexed: a hash of the entry's digest, never of expanded values. */
  indexKey: string;
  redact: (text: string) => string;
};

export const projectOf = (run: McpRun) =>
  run.projectId
    ? { projectId: run.projectId, projectDirectory: run.projectDirectory }
    : undefined;

export const failure = (
  code: "NOT_FOUND" | "SERVER_ERROR" | "FORBIDDEN",
  message: string,
) => new ToolExecutionError(code, message);

/** The same entry of the same file: name, scope, project and content. */
export const sameEntry = (a: CatalogEntry, b: CatalogEntry) =>
  a.name === b.name &&
  a.scope === b.scope &&
  a.projectId === b.projectId &&
  a.digest === b.digest;

export const isApprovedAs = (current: CatalogEntry, entry: CatalogEntry) =>
  sameEntry(current, entry) && current.review === "approved";

/**
 * The tools of an entry are indexed under its digest (which covers the scope), its name and, for a
 * stdio server (whose default directory and roots can change its tools), the project directory.
 * Expanded variables and secrets are not part of it.
 */
export function indexKeyOf(
  entry: CatalogEntry,
  resolved: ResolvedMcpServer,
  projectDirectory: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        entry.name,
        entry.scope,
        entry.projectId ?? null,
        entry.digest,
        resolved.kind === "stdio" ? projectDirectory : "",
      ]),
    )
    .digest("hex");
}

/** No such server: names the ones that exist, or where to add one. */
export function notFound(name: string, view: CatalogView): ToolExecutionError {
  const invalid = [view.user, view.project]
    .flatMap((file) => (file ? file.problems.map((p) => ({ file, p })) : []))
    .find(({ p }) => p.startsWith(`server "${name}"`));
  if (invalid)
    return failure("NOT_FOUND", `MCP server "${name}": ${invalid.p}.`);
  if (view.active.length > 0)
    return failure(
      "NOT_FOUND",
      `No MCP server "${name}". Configured: ${view.active.map((entry) => entry.name).join(", ")}.`,
    );
  const problems = [view.user, view.project].flatMap((file) =>
    file && file.problems.length > 0
      ? [`${file.path} is invalid: ${file.problems.join("; ")}`]
      : [],
  );
  return failure(
    "NOT_FOUND",
    problems.length > 0
      ? `${problems.join(". ")}.`
      : `No MCP servers are configured. Add them to ${view.user.path} (see the configure-nerve skill).`,
  );
}

/** Calls share a connection when the resolved entry is the same; a stdio server also per project (its roots). */
export function keyOf(
  entry: CatalogEntry,
  resolved: ResolvedMcpServer,
  projectDirectory: string,
): string {
  return JSON.stringify([
    entry.name,
    resolved,
    resolved.kind === "stdio" ? projectDirectory : "",
  ]);
}

export function toTool(server: string, tool: Tool): McpTool {
  return {
    server,
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
