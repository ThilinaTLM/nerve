import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type {
  McpGrantSnapshot,
  McpReference,
  McpScope,
} from "@nervekit/contracts/mcp";
import { toTrustedDigest } from "@nervekit/contracts/core";
import { projectConfigurationRoot } from "../../infrastructure/configuration/scope-paths.js";
import {
  validateMcpServerConfig,
  type McpHttpServerConfig,
  type McpStdioServerConfig,
} from "@earendil-works/pi-mcp";

/**
 * MCP servers: the user's `<home>/config/mcp.json` and a project's `<project>/.nerve/config/mcp.json`,
 * in the `mcpServers` shape other MCP clients share, so an entry can be copied from them. Files
 * are read on every use; there is nothing to reload. An entry runs only after the user approved
 * its exact content (see `mcp-catalog.ts`). Only Nerve's own files are read, never other clients'.
 */

export const MCP_CONFIG_FILENAME = "mcp.json";

export const mcpConfigPath = (home: string) =>
  join(home, "config", MCP_CONFIG_FILENAME);

export const projectMcpConfigPath = (projectDirectory: string) =>
  join(projectConfigurationRoot(projectDirectory), MCP_CONFIG_FILENAME);

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
    // Only the position: the message can quote the text around it, which may hold a token.
    const position = /position \d+(?: \(line \d+ column \d+\))?/.exec(
      (error as Error).message,
    )?.[0];
    return {
      path,
      servers: [],
      problems: [`not valid JSON${position ? ` (at ${position})` : ""}`],
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

/** Reads an `mcp.json`; a missing file has no servers and no problems. `exists` is false then. */
export async function readMcpFile(
  path: string,
): Promise<McpConfigFile & { exists: boolean }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { path, servers: [], problems: [], exists: false };
    return {
      path,
      servers: [],
      problems: [`cannot be read (${(error as Error).message})`],
      exists: true,
    };
  }
  return { ...parseMcpConfig(path, text), exists: true };
}

/** Reads `<home>/config/mcp.json`. */
export const readMcpConfig = (home: string) => readMcpFile(mcpConfigPath(home));

/** `${NAME}` and `${NAME:-default}` from the daemon's environment. */
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
/** `${secret:name}` from the credential vault. */
const SECRET = /\$\{secret:([A-Za-z0-9_-]+)\}/g;
/** Either kind, in one regex, so expansion makes a single pass. */
const REFERENCE =
  /\$\{(?:secret:([A-Za-z0-9_-]+)|([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?)\}/g;

/** The values a resolved entry draws on besides its own text. */
export type McpExpansion = {
  env: NodeJS.ProcessEnv;
  /** Secret values by name, fetched from the scope's vault entries; absent: not set. */
  secrets: Readonly<Record<string, string | undefined>>;
};

export type MissingReferences = { env: Set<string>; secrets: Set<string> };

export function expandVariables(
  value: string,
  expansion: McpExpansion,
  missing: MissingReferences,
): string {
  // One pass over the original text: an expanded value is never expanded again.
  return value.replace(
    REFERENCE,
    (
      _,
      secret: string | undefined,
      name: string | undefined,
      fallback: string | undefined,
    ) => {
      if (secret !== undefined) {
        const found = expansion.secrets[secret];
        if (found !== undefined) return found;
        missing.secrets.add(secret);
        return "";
      }
      const found = expansion.env[name!];
      if (found !== undefined && found !== "") return found;
      if (fallback !== undefined) return fallback;
      missing.env.add(name!);
      return "";
    },
  );
}

/** Every `${VAR}` and `${secret:name}` the entry references, with where the value goes. */
export function mcpEntryReferences(
  config: McpServerEntry["config"],
): McpReference[] {
  const found = new Map<string, McpReference>();
  const scan = (value: string, field: McpReference["field"], key?: string) => {
    for (const match of value.matchAll(SECRET))
      found.set(`secret|${match[1]}|${field}|${key ?? ""}`, {
        kind: "secret",
        name: match[1],
        field,
        ...(key ? { key } : {}),
      });
    for (const match of value.matchAll(VARIABLE))
      found.set(`env|${match[1]}|${field}|${key ?? ""}`, {
        kind: "env",
        name: match[1],
        field,
        ...(key ? { key } : {}),
      });
  };
  if ("command" in config) {
    scan(config.command, "command");
    for (const arg of config.args ?? []) scan(arg, "args");
    for (const [key, value] of Object.entries(config.env ?? {}))
      scan(value, "env", key);
    if (config.cwd) scan(config.cwd, "cwd");
  } else {
    scan(config.url, "url");
    for (const [key, value] of Object.entries(config.headers ?? {}))
      scan(value, "headers", key);
  }
  return [...found.values()];
}

/** The names of the secrets an entry references. */
export const mcpEntrySecretNames = (config: McpServerEntry["config"]) => [
  ...new Set(
    mcpEntryReferences(config)
      .filter((reference) => reference.kind === "secret")
      .map((reference) => reference.name),
  ),
];

/** Variables that change what a program runs or where it looks, whatever else the entry says. */
const EXECUTION_VARIABLE =
  /^(PATH|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|LD_.*|DYLD_.*|PYTHON.*|PERL5?LIB|PERL5OPT|RUBY.*|GEM_.*|CLASSPATH|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|BASH_ENV|ENV|SHELL|IFS|HOME|USERPROFILE|PATHEXT|COMSPEC|GIT_SSH.*|GIT_EXEC_PATH|GOFLAGS|GOPATH|CARGO_.*|RUSTC.*|PIP_.*|NPM_CONFIG_.*|UV_.*)$/i;

/** What the user reviews and approves: the command line or URL, the working directory, every environment entry or header as written and where each reference goes. */
export function mcpGrantSnapshot(entry: McpServerEntry): McpGrantSnapshot {
  const references = mcpEntryReferences(entry.config);
  if (entry.kind === "http") {
    const headers = Object.entries(entry.config.headers ?? {}).map(
      ([name, value]) => ({ name, value }),
    );
    return {
      transport: "http",
      url: entry.config.url,
      ...(headers.length ? { headers } : {}),
      references,
    };
  }
  const env = Object.entries(entry.config.env ?? {}).map(([name, value]) => ({
    name,
    value,
    changesExecution: EXECUTION_VARIABLE.test(name),
  }));
  return {
    transport: "stdio",
    command: entry.config.command,
    ...(entry.config.args?.length ? { args: entry.config.args } : {}),
    ...(entry.config.cwd ? { cwd: entry.config.cwd } : {}),
    ...(env.length ? { env } : {}),
    inheritsEnvironment: true,
    references,
  };
}

/** What else to weigh in a review: environment entries as written, the ones that change what runs, the inherited environment. */
export function mcpReviewNotes(grants: McpGrantSnapshot): string[] {
  const notes: string[] = [];
  if (grants.inheritsEnvironment)
    notes.push(
      `Starts \`${grants.command}\` with Nerve's whole environment (every variable Nerve was started with), plus the entries below.`,
    );
  for (const variable of grants.env ?? [])
    notes.push(
      variable.changesExecution
        ? `Sets \`${variable.name}\` to \`${variable.value}\`. This changes what runs or where it looks.`
        : `Sets \`${variable.name}\` to \`${variable.value}\`.`,
    );
  for (const header of grants.headers ?? [])
    notes.push(`Sends header \`${header.name}\`: \`${header.value}\`.`);
  return notes;
}

/** "Sends `TOKEN` to `https://…` in header `Authorization`": what can leave the machine, never a value. */
export function mcpSendsSentences(grants: McpGrantSnapshot): string[] {
  const where = grants.url ?? grants.command ?? "";
  return grants.references.map((reference) => {
    const what = `${reference.kind === "secret" ? "secret" : "environment variable"} \`${reference.name}\``;
    switch (reference.field) {
      case "headers":
        return `Sends ${what} to \`${where}\` in header \`${reference.key}\`.`;
      case "url":
        return `Puts ${what} in the URL \`${where}\`.`;
      case "env":
        return `Passes ${what} to \`${where}\` in environment variable \`${reference.key}\`.`;
      case "args":
        return `Passes ${what} to \`${where}\` as an argument.`;
      case "cwd":
        return `Uses ${what} in the working directory of \`${where}\`.`;
      default:
        return `Uses ${what} in the command \`${where}\`.`;
    }
  });
}

/** Shortest value worth hiding: shorter ones would mangle ordinary text. */
const MIN_REDACTED_LENGTH = 4;

/**
 * A function that replaces the values this entry expanded (secrets as `[secret:name]`, referenced
 * environment variables as `[env:NAME]`, also URL- and JSON-escaped) in text that leaves the host:
 * a server's stderr, an HTTP error body, a failure reason. Values shorter than four characters
 * are not hidden.
 */
export function mcpRedactor(
  config: McpServerEntry["config"],
  expansion: McpExpansion,
): (text: string) => string {
  const replacements: [string, string][] = [];
  for (const reference of mcpEntryReferences(config)) {
    const value =
      reference.kind === "secret"
        ? expansion.secrets[reference.name]
        : expansion.env[reference.name];
    if (value === undefined || value.length < MIN_REDACTED_LENGTH) continue;
    const label =
      reference.kind === "secret"
        ? `[secret:${reference.name}]`
        : `[env:${reference.name}]`;
    for (const form of new Set([
      value,
      encodeURIComponent(value),
      JSON.stringify(value).slice(1, -1),
    ]))
      replacements.push([form, label]);
  }
  replacements.sort(([a], [b]) => b.length - a.length);
  return (text) =>
    replacements.reduce(
      (result, [value, label]) => result.split(value).join(label),
      text,
    );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/**
 * `sha256:<hex>` of the entry as written (canonical JSON; variables and secrets not expanded) and
 * its scope. Changing a value of a variable or secret does not change it; changing the entry does.
 */
export function mcpEntryDigest(scope: McpScope, entry: McpServerEntry): string {
  return toTrustedDigest(
    createHash("sha256")
      .update(canonicalJson({ scope, entry: entry.config }))
      .digest("hex"),
  );
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
  expansion: McpExpansion,
  /** Where the user sets a missing secret, for the error. */
  secretsPage: string,
): ResolvedMcpServer {
  const missing: MissingReferences = { env: new Set(), secrets: new Set() };
  const expand = (value: string) => expandVariables(value, expansion, missing);
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
  const problems: string[] = [];
  if (missing.env.size > 0)
    problems.push(
      `environment variable${missing.env.size === 1 ? "" : "s"} ${[...missing.env].join(", ")} ${missing.env.size === 1 ? "is" : "are"} not set in Nerve's environment (referenced in mcp.json)`,
    );
  if (missing.secrets.size > 0)
    problems.push(
      `secret${missing.secrets.size === 1 ? "" : "s"} ${[...missing.secrets].join(", ")} ${missing.secrets.size === 1 ? "is" : "are"} not set; the user adds ${missing.secrets.size === 1 ? "it" : "them"} in ${secretsPage}`,
    );
  if (problems.length > 0) throw new Error(problems.join("; "));
  return resolved;
}
