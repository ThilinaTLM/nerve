import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  validateMcpServerConfig,
  type McpHttpServerConfig,
  type McpStdioServerConfig,
} from "@earendil-works/pi-mcp";

/**
 * The user's MCP servers: `<home>/config/mcp.json`, in the `mcpServers` shape other MCP clients
 * share, so an entry can be copied from them. The file is read on every use; there is nothing to
 * reload. Project files are not read: a project's servers would start programs from a repository,
 * which needs a trust decision of its own.
 */

export const MCP_CONFIG_FILENAME = "mcp.json";

export const mcpConfigPath = (home: string) =>
  join(home, "config", MCP_CONFIG_FILENAME);

export type McpServerEntry =
  | { name: string; kind: "stdio"; config: McpStdioServerConfig }
  | { name: string; kind: "http"; config: McpHttpServerConfig };

export type McpConfigFile = {
  path: string;
  /** Valid entries, in file order. */
  servers: McpServerEntry[];
  /** Why the file or an entry is invalid; an invalid entry is left out of `servers`. */
  problems: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Fields this host reads; others are refused so a typo does not silently do nothing. */
const KNOWN_FIELDS = new Set([
  "type",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "enabled",
  "description",
  "timeout",
]);

/** Parses the text of an `mcp.json`. */
export function parseMcpConfig(path: string, text: string): McpConfigFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      path,
      servers: [],
      problems: [`not valid JSON (${(error as Error).message})`],
    };
  }
  if (!isRecord(raw))
    return { path, servers: [], problems: ["must be a JSON object"] };
  const problems: string[] = [];
  for (const key of Object.keys(raw))
    if (key !== "mcpServers" && key !== "$schema")
      problems.push(`unknown field "${key}" (expected "mcpServers")`);
  const entries = raw.mcpServers ?? {};
  if (!isRecord(entries))
    return {
      path,
      servers: [],
      problems: [...problems, "mcpServers must map server names to entries"],
    };
  const servers: McpServerEntry[] = [];
  for (const [name, entry] of Object.entries(entries)) {
    const result = validateMcpServerConfig(name, entry);
    if (result.kind === "invalid") {
      problems.push(result.error);
      continue;
    }
    const unknown = Object.keys(result.config).filter(
      (key) => !KNOWN_FIELDS.has(key),
    );
    if (unknown.length > 0) {
      problems.push(
        `server "${name}": ${unknown.map((key) => `"${key}"`).join(", ")} ${unknown.length === 1 ? "is" : "are"} not supported${unknown.includes("oauth") ? " (OAuth sign-in is not supported yet; pass a token in headers)" : ""}`,
      );
      continue;
    }
    servers.push(
      result.kind === "stdio"
        ? { name, kind: "stdio", config: result.config }
        : { name, kind: "http", config: result.config },
    );
  }
  return { path, servers, problems };
}

/** Reads `<home>/config/mcp.json`; a missing file has no servers and no problems. */
export async function readMcpConfig(home: string): Promise<McpConfigFile> {
  const path = mcpConfigPath(home);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { path, servers: [], problems: [] };
    return {
      path,
      servers: [],
      problems: [`cannot be read (${(error as Error).message})`],
    };
  }
  return parseMcpConfig(path, text);
}

/** `${NAME}` and `${NAME:-default}` from the daemon's environment. */
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function expandVariables(
  value: string,
  env: NodeJS.ProcessEnv,
  missing: Set<string>,
): string {
  return value.replace(VARIABLE, (_, name: string, fallback?: string) => {
    const found = env[name];
    if (found !== undefined && found !== "") return found;
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return "";
  });
}

const expandHome = (path: string) =>
  path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;

/** An entry ready to connect: variables expanded, `cwd` absolute. */
export type ResolvedMcpServer =
  | {
      kind: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd: string;
    }
  | { kind: "http"; url: string; headers: Record<string, string> };

/**
 * Expands `${VAR}` in every string the entry passes on, and resolves a relative `cwd` against the
 * conversation's project directory (also the default). Throws naming the unset variables.
 */
export function resolveMcpServer(
  entry: McpServerEntry,
  projectDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedMcpServer {
  const missing = new Set<string>();
  const expand = (value: string) => expandVariables(value, env, missing);
  const expandAll = (record: Record<string, string> | undefined) =>
    Object.fromEntries(
      Object.entries(record ?? {}).map(([key, value]) => [key, expand(value)]),
    );
  let resolved: ResolvedMcpServer;
  if (entry.kind === "stdio") {
    const cwd = entry.config.cwd
      ? expandHome(expand(entry.config.cwd))
      : projectDirectory;
    resolved = {
      kind: "stdio",
      command: expandHome(expand(entry.config.command)),
      args: (entry.config.args ?? []).map(expand),
      env: expandAll(entry.config.env),
      cwd: isAbsolute(cwd) ? cwd : resolve(projectDirectory, cwd),
    };
  } else {
    resolved = {
      kind: "http",
      url: expand(entry.config.url),
      headers: expandAll(entry.config.headers),
    };
  }
  if (missing.size > 0)
    throw new Error(
      `environment variable${missing.size === 1 ? "" : "s"} ${[...missing].join(", ")} ${missing.size === 1 ? "is" : "are"} not set in Nerve's environment (referenced in mcp.json)`,
    );
  return resolved;
}

/** Whether mcp.json has a valid, enabled server: then the `mcp` namespace is listed in the quick_script description. */
export async function hasEnabledMcpServers(home: string): Promise<boolean> {
  const file = await readMcpConfig(home);
  return file.servers.some((server) => server.config.enabled !== false);
}
