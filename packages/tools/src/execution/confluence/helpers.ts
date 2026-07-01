import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { ToolExecutionError } from "../common/tool-error.js";
import { resolveToolPath } from "../filesystem/path.js";
import {
  type ConfluenceConnection,
  confluenceRequest,
  pathSegment,
} from "./client.js";
import {
  asRecord,
  summarizeConfluenceSpace,
  valuesFromConfluenceList,
} from "./format.js";

export type ConfluencePageRow = Record<string, unknown> & {
  id?: string;
  title?: string;
  spaceId?: string;
  spaceKey?: string;
  parentId?: string;
  status?: string;
  version?: { number?: number; message?: string };
  body?: { representation?: string; value?: string };
};

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Expected an array of strings.");
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function enumString<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export async function resolveSpaceId(
  connection: ConfluenceConnection,
  options: { spaceId?: string; spaceKey?: string; signal?: AbortSignal },
): Promise<{ spaceId: string; spaceKey?: string }> {
  if (options.spaceId) {
    return { spaceId: options.spaceId, spaceKey: options.spaceKey };
  }
  const spaceKey = options.spaceKey ?? connection.defaultSpaceKey;
  if (!spaceKey) {
    throw new ToolExecutionError(
      "CONFLUENCE_SPACE_REQUIRED",
      "space_id or space_key is required because no default Confluence space key is configured.",
    );
  }
  const response = await confluenceRequest(connection, {
    path: "/spaces",
    query: { keys: [spaceKey], limit: 1 },
    signal: options.signal,
  });
  const spaces = valuesFromConfluenceList(response).flatMap((space) => {
    const summary = summarizeConfluenceSpace(space);
    return summary ? [summary] : [];
  });
  const match = spaces.find((space) => space.key === spaceKey) ?? spaces[0];
  if (!match) {
    throw new ToolExecutionError(
      "CONFLUENCE_SPACE_NOT_FOUND",
      `No Confluence space matched key "${spaceKey}".`,
    );
  }
  return { spaceId: match.id, spaceKey: match.key ?? spaceKey };
}

export async function readSinglePageRow(
  cwd: string,
  pageFile: unknown,
): Promise<{ row: ConfluencePageRow; path: string }> {
  const { rows, path } = await readPageRowsFromPath(cwd, pageFile);
  if (rows.length === 0) {
    throw new ToolExecutionError(
      "CONFLUENCE_PAGE_FILE_EMPTY",
      `No page rows found in ${path}.`,
    );
  }
  if (rows.length > 1) {
    throw new ToolExecutionError(
      "CONFLUENCE_PAGE_FILE_AMBIGUOUS",
      `Expected one page row in ${path}, found ${rows.length}. Use confluence_publish_pages for multi-row files.`,
    );
  }
  return { row: rows[0], path };
}

export async function readPageRowsFromPath(
  cwd: string,
  input: unknown,
): Promise<{ rows: ConfluencePageRow[]; path: string }> {
  const path = resolveToolPath(cwd, input);
  const stats = await stat(path);
  if (stats.isDirectory()) {
    return readPageRowsFromResolvedPath(join(path, "manifest.json"));
  }
  return readPageRowsFromResolvedPath(path);
}

async function readPageRowsFromResolvedPath(
  path: string,
): Promise<{ rows: ConfluencePageRow[]; path: string }> {
  const name = basename(path);
  if (name === "manifest.json") {
    const text = await readFile(path, "utf8");
    const manifest = parseJsonRecord(text, path);
    const pagesJsonlPath = optionalString(manifest.pagesJsonlPath);
    const jsonlPath = pagesJsonlPath ?? join(dirname(path), "pages.jsonl");
    return readJsonlRows(jsonlPath);
  }
  if (extname(path).toLowerCase() === ".jsonl") return readJsonlRows(path);
  const text = await readFile(path, "utf8");
  const record = parseJsonRecord(text, path);
  if (record.schemaVersion === "nerve.confluence.download.v1") {
    const pagesJsonlPath = optionalString(record.pagesJsonlPath);
    return readJsonlRows(pagesJsonlPath ?? join(dirname(path), "pages.jsonl"));
  }
  return { rows: [record as ConfluencePageRow], path };
}

async function readJsonlRows(
  path: string,
): Promise<{ rows: ConfluencePageRow[]; path: string }> {
  const text = await readFile(path, "utf8");
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line, index) =>
        parseJsonRecord(line, `${path}:${index + 1}`) as ConfluencePageRow,
    );
  return { rows, path };
}

function parseJsonRecord(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ToolExecutionError(
      "CONFLUENCE_PAGE_FILE_INVALID_JSON",
      `Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new ToolExecutionError(
      "CONFLUENCE_PAGE_FILE_INVALID",
      `${label} must contain a JSON object.`,
    );
  }
  return record;
}

export function pageRowBody(
  row: ConfluencePageRow,
): { representation: string; value: string } | undefined {
  const body = asRecord(row.body);
  const value = optionalString(body?.value);
  if (!value) return undefined;
  return {
    representation: optionalString(body?.representation) ?? "storage",
    value,
  };
}

export function pageRowVersionNumber(
  row: ConfluencePageRow,
): number | undefined {
  const version = asRecord(row.version);
  const value = version?.number;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : undefined;
}

export async function fetchPageCurrent(
  connection: ConfluenceConnection,
  pageId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return confluenceRequest<Record<string, unknown>>(connection, {
    path: `/pages/${pathSegment(pageId)}`,
    query: { "body-format": "storage" },
    signal,
  });
}
