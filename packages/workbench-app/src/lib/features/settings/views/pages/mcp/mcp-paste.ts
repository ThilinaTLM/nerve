import type { McpServerEntry } from "@nervekit/contracts/mcp";

export type PastedServer = { name?: string; entry: McpServerEntry };

export type McpPasteResult =
  | {
      ok: true;
      servers: PastedServer[];
      /** Fields of other clients' entries that Nerve does not read. */
      ignored: string[];
    }
  | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const looksLikeEntry = (value: Record<string, unknown>) =>
  typeof value.command === "string" || typeof value.url === "string";

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, String(item)]),
  );
}

/** The fields of one pasted entry that Nerve reads; the rest are reported. */
function entryOf(
  raw: Record<string, unknown>,
  ignored: Set<string>,
): McpServerEntry {
  const entry: McpServerEntry = {};
  if (typeof raw.command === "string") entry.command = raw.command;
  else if (typeof raw.url === "string") {
    entry.url = raw.url;
    entry.type = "http";
  }
  if (Array.isArray(raw.args)) entry.args = raw.args.map(String);
  const env = stringRecord(raw.env);
  if (env) entry.env = env;
  if (typeof raw.cwd === "string") entry.cwd = raw.cwd;
  const headers = stringRecord(raw.headers);
  if (headers) entry.headers = headers;
  if (typeof raw.enabled === "boolean") entry.enabled = raw.enabled;
  if (typeof raw.description === "string") entry.description = raw.description;
  if (typeof raw.timeout === "number") entry.timeout = raw.timeout;
  const known = new Set([
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
  for (const key of Object.keys(raw)) if (!known.has(key)) ignored.add(key);
  return entry;
}

function parseLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // A README often shows `"name": { ... }` without the outer braces.
    if (!trimmed.startsWith("{")) return JSON.parse(`{${trimmed}}`);
    throw error;
  }
}

/**
 * Reads what a user pastes: an `mcpServers` snippet as server READMEs show it
 * (with or without the outer braces), a `{ "name": { ... } }` map, or one
 * entry on its own.
 */
export function parseMcpPaste(text: string): McpPasteResult {
  if (!text.trim()) return { ok: false, message: "Paste a JSON snippet." };
  let value: unknown;
  try {
    value = parseLoose(text);
  } catch {
    return { ok: false, message: "That is not valid JSON." };
  }
  if (!isRecord(value))
    return { ok: false, message: "Expected a JSON object." };
  const ignored = new Set<string>();
  if (looksLikeEntry(value))
    return {
      ok: true,
      servers: [{ entry: entryOf(value, ignored) }],
      ignored: [...ignored],
    };
  const map = isRecord(value.mcpServers)
    ? value.mcpServers
    : isRecord(value.servers)
      ? value.servers
      : value;
  const servers = Object.entries(map)
    .filter((pair): pair is [string, Record<string, unknown>] =>
      isRecord(pair[1]),
    )
    .filter(([, raw]) => looksLikeEntry(raw))
    .map(([name, raw]) => ({ name, entry: entryOf(raw, ignored) }));
  if (servers.length === 0)
    return {
      ok: false,
      message:
        'No server found. Paste an "mcpServers" snippet or one entry with a "command" or "url".',
    };
  return { ok: true, servers, ignored: [...ignored] };
}
