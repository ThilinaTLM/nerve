import type { McpTool } from "./mcp-port.js";

/** What `tools.search` returns: enough to write the call; `tools.get` has the full schema. */
export type McpToolMatch = {
  server: string;
  name: string;
  title?: string;
  /** The description's first sentence, at most 200 characters. */
  summary: string;
  /** The input schema on one line, e.g. `owner: string, repo: string, body?: string`. */
  arguments: string;
};

export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;
const SUMMARY_MAX = 200;
const ARGUMENTS_MAX = 400;
const MAX_DEPTH = 2;
const MAX_ENUM = 6;

/** Lowercase words of a name: split on separators and camelCase (`createIssue` → create, issue). */
export function words(text: string): string[] {
  return text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** `weight` for an exact word, 60% of it for a prefix, 0 when no word matches. */
function fieldScore(
  fieldWords: string[],
  word: string,
  weight: number,
): number {
  if (fieldWords.includes(word)) return weight;
  if (fieldWords.some((candidate) => candidate.startsWith(word)))
    return Math.round(weight * 0.6);
  return 0;
}

const NAME_WEIGHT = 100;
const TITLE_WEIGHT = 50;
const SERVER_WEIGHT = 20;
const DESCRIPTION_WEIGHT = 10;

/**
 * Score of a tool for a query, or 0 when some query word matches nowhere. A word scores its best
 * field: name above title above description, an exact word above a prefix.
 */
export function scoreTool(tool: McpTool, queryWords: string[]): number {
  const name = words(tool.name);
  const title = words(tool.title ?? tool.annotations?.title ?? "");
  const server = words(tool.server);
  const description = words(tool.description ?? "");
  let total = 0;
  for (const word of queryWords) {
    const best = Math.max(
      fieldScore(name, word, NAME_WEIGHT),
      fieldScore(title, word, TITLE_WEIGHT),
      fieldScore(server, word, SERVER_WEIGHT),
      fieldScore(description, word, DESCRIPTION_WEIGHT),
    );
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Tools matching every word of `query`, best first; ties by server, then tool name. */
export function rankTools(tools: McpTool[], query: string): McpTool[] {
  const queryWords = words(query);
  if (queryWords.length === 0) return [];
  return tools
    .map((tool) => ({ tool, score: scoreTool(tool, queryWords) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        compare(a.tool.server, b.tool.server) ||
        compare(a.tool.name, b.tool.name),
    )
    .map((entry) => entry.tool);
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function summarize(description: string | undefined): string {
  const flat = (description ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "(no description)";
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  return sentence.length > SUMMARY_MAX
    ? `${sentence.slice(0, SUMMARY_MAX - 1).trimEnd()}…`
    : sentence;
}

type Schema = Record<string, unknown>;
const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const key = (name: string) =>
  /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);

function renderProperties(schema: Schema, depth: number): string {
  const properties = isSchema(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as unknown[]) : [],
  );
  return Object.entries(properties)
    .map(
      ([name, property]) =>
        `${key(name)}${required.has(name) ? "" : "?"}: ${renderType(property, depth)}`,
    )
    .join(", ");
}

function union(parts: string[], separator = " | "): string {
  return [...new Set(parts)].join(separator);
}

function renderType(schema: unknown, depth: number): string {
  if (!isSchema(schema)) return "unknown";
  if (Array.isArray(schema.enum)) {
    const values = (schema.enum as unknown[]).map((value) =>
      JSON.stringify(value),
    );
    return values.length > MAX_ENUM
      ? `${values.slice(0, MAX_ENUM).join(" | ")} | …`
      : values.join(" | ") || "never";
  }
  if ("const" in schema) return JSON.stringify(schema.const) ?? "unknown";
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const options = schema[keyword];
    if (Array.isArray(options) && options.length > 0)
      return union(options.map((option) => renderType(option, depth)));
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0)
    return union(
      schema.allOf.map((option) => renderType(option, depth)),
      " & ",
    );
  if (Array.isArray(schema.type))
    return union(
      schema.type.map((type) => renderType({ ...schema, type }, depth)),
    );
  switch (schema.type) {
    case "array": {
      const item = renderType(schema.items, depth);
      return /[|&]/.test(item) && !/^[{(]/.test(item)
        ? `(${item})[]`
        : `${item}[]`;
    }
    case "object":
      return renderObject(schema, depth);
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "null":
      return schema.type;
  }
  if (isSchema(schema.properties)) return renderObject(schema, depth);
  return typeof schema.$ref === "string" ? "object" : "unknown";
}

function renderObject(schema: Schema, depth: number): string {
  if (
    !isSchema(schema.properties) ||
    Object.keys(schema.properties).length === 0
  )
    return "object";
  if (depth >= MAX_DEPTH) return "object";
  return `{ ${renderProperties(schema, depth + 1)} }`;
}

/** One-line rendering of an input schema: `owner: string, repo: string, body?: string`. */
export function renderArguments(inputSchema: Record<string, unknown>): string {
  const line = renderProperties(inputSchema, 0);
  return line.length > ARGUMENTS_MAX
    ? `${line.slice(0, ARGUMENTS_MAX - 1).trimEnd()}…`
    : line;
}

export function toMatch(tool: McpTool): McpToolMatch {
  const title = tool.title ?? tool.annotations?.title;
  return {
    server: tool.server,
    name: tool.name,
    ...(title ? { title } : {}),
    summary: summarize(tool.description),
    arguments: renderArguments(tool.inputSchema),
  };
}
