import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteFile } from "../../infrastructure/storage-bootstrap/file-mutations.js";
import { parseMcpConfig } from "./mcp-config.js";

/** An `mcp.json` as a document we can rewrite without losing anything: `mcpServers` and `$schema` only. */
export type McpDocument = {
  schema?: string;
  /** Raw entries in file order, including invalid ones, which a rewrite keeps as they are. */
  servers: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads the file for editing. A missing file is an empty document. A file that is not JSON, not an
 * object, holds fields besides `mcpServers` and `$schema`, or has a malformed `mcpServers` cannot be
 * rewritten without losing content: `problems` says why.
 */
export async function readMcpDocument(
  path: string,
): Promise<{ document: McpDocument; problems: string[] }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { document: { servers: {} }, problems: [] };
    return {
      document: { servers: {} },
      problems: [`cannot be read (${(error as Error).message})`],
    };
  }
  const parsed = parseMcpConfig(path, text);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { document: { servers: {} }, problems: parsed.problems };
  }
  const unknownTopLevel =
    isRecord(raw) &&
    Object.keys(raw).some((key) => key !== "mcpServers" && key !== "$schema");
  if (
    !isRecord(raw) ||
    unknownTopLevel ||
    (raw.mcpServers !== undefined && !isRecord(raw.mcpServers))
  )
    return { document: { servers: {} }, problems: parsed.problems };
  return {
    document: {
      ...(typeof raw.$schema === "string" ? { schema: raw.$schema } : {}),
      servers: isRecord(raw.mcpServers) ? raw.mcpServers : {},
    },
    problems: [],
  };
}

/** Sets an entry, keeping its place (and when renamed, the old entry's place); `previousName` is removed. */
export function withEntry(
  servers: Record<string, unknown>,
  name: string,
  entry: unknown,
  previousName?: string,
): Record<string, unknown> {
  const replaced = previousName ?? name;
  const result: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(servers)) {
    if (key === replaced) {
      result[name] = entry;
      placed = true;
    } else if (key !== name) result[key] = value;
  }
  if (!placed) result[name] = entry;
  return result;
}

export function withoutEntry(
  servers: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(servers).filter(([key]) => key !== name),
  );
}

/** Writes the file atomically, two-space JSON. */
export async function writeMcpDocument(
  path: string,
  document: McpDocument,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = {
    ...(document.schema ? { $schema: document.schema } : {}),
    mcpServers: document.servers,
  };
  await atomicWriteFile(path, `${JSON.stringify(body, null, 2)}\n`, {
    durability: "directory",
  });
}
