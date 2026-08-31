import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { optionalString } from "../atlassian/arguments.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import { resolveToolPath } from "../filesystem/path.js";
import { asRecord } from "./format.js";

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

export async function readSinglePageRow(
  cwd: string,
  pageFile: unknown,
): Promise<{ row: ConfluencePageRow; path: string }> {
  const { rows, path } = await readPageRowsFromPath(cwd, pageFile);
  if (rows.length === 0)
    throw new ToolExecutionError(
      "CONFLUENCE_PAGE_FILE_EMPTY",
      `No page rows found in ${path}.`,
    );
  if (rows.length > 1)
    throw new ToolExecutionError(
      "CONFLUENCE_PAGE_FILE_AMBIGUOUS",
      `Expected exactly one page row in ${path}, found ${rows.length}. Bulk page publishing is not supported.`,
    );
  return { row: rows[0], path };
}

export async function readPageRowsFromPath(
  cwd: string,
  input: unknown,
): Promise<{ rows: ConfluencePageRow[]; path: string }> {
  const path = resolveToolPath(cwd, input);
  const stats = await stat(path);
  return readPageRowsFromResolvedPath(
    stats.isDirectory() ? join(path, "manifest.json") : path,
  );
}

async function readPageRowsFromResolvedPath(
  path: string,
): Promise<{ rows: ConfluencePageRow[]; path: string }> {
  if (basename(path) === "manifest.json") {
    const manifest = parseJsonRecord(await readFile(path, "utf8"), path);
    return readJsonlRows(
      optionalString(manifest.pagesJsonlPath) ??
        join(dirname(path), "pages.jsonl"),
    );
  }
  if (extname(path).toLowerCase() === ".jsonl") return readJsonlRows(path);
  const record = parseJsonRecord(await readFile(path, "utf8"), path);
  if (record.schemaVersion === "nerve.confluence.download.v1")
    return readJsonlRows(
      optionalString(record.pagesJsonlPath) ??
        join(dirname(path), "pages.jsonl"),
    );
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
  if (!record)
    throw new ToolExecutionError(
      "CONFLUENCE_PAGE_FILE_INVALID",
      `${label} must contain a JSON object.`,
    );
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
  const value = asRecord(row.version)?.number;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : undefined;
}
