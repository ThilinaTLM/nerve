import type {
  WebExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import { withTimeoutSignal } from "../process/abort.js";
import { numberArg } from "../process/arguments.js";
import { buildProcessTextResult } from "../process/process-result.js";

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
  answer?: string;
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function maxResultsArg(value: unknown): number {
  const parsed = numberArg(value, 5);
  return Math.min(20, Math.max(1, parsed));
}

const SNIPPET_MAX_CHARS = 300;

/** Bound the per-result snippet so structured details stay small. */
export function snippet(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return undefined;
  return normalized.length <= SNIPPET_MAX_CHARS
    ? normalized
    : `${normalized.slice(0, SNIPPET_MAX_CHARS - 1)}…`;
}

/** The Tavily search call, shared by `web_search` and the quick_script `web.search`. */
export async function searchTavily(request: {
  apiKey: string;
  query: string;
  maxResults: number;
  includeAnswer: boolean;
  signal: AbortSignal;
}): Promise<TavilyResponse> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: request.apiKey,
      query: request.query,
      max_results: request.maxResults,
      include_answer: request.includeAnswer,
    }),
    signal: request.signal,
  });
  if (!response.ok) {
    throw new ToolExecutionError(
      "WEB_SEARCH_HTTP_ERROR",
      `Tavily API error: ${response.status} ${await response.text()}`,
      { status: response.status },
    );
  }
  return (await response.json()) as TavilyResponse;
}

export async function executeWebSearch(
  args: Record<string, unknown>,
  context: WebExecutionContext,
): Promise<ToolExecutionResult> {
  const query = stringArg(args.query, "query");
  const maxResults = maxResultsArg(args.max_results);
  const apiKey = await context.getApiKey?.("tavily");

  if (!apiKey) {
    throw new Error(
      "Tavily API key is not configured. Configure Web Search in Nerve Settings.",
    );
  }

  const data = await searchTavily({
    apiKey,
    query,
    maxResults,
    includeAnswer: true,
    signal: withTimeoutSignal(context.signal, 60_000),
  });
  const results = Array.isArray(data.results) ? data.results : [];

  const lines: string[] = [];
  if (data.answer) lines.push(`**Answer:** ${data.answer}`, "");
  for (const result of results) {
    lines.push(`### ${result.title}`, result.url, "", result.content, "");
  }
  const content = lines.join("\n").trimEnd();
  const bounded = await buildProcessTextResult({
    text: content,
    outputFilePrefix: "nerve-web-search",
    exitMessagePrefix: "Web search",
    artifactDir: context.artifactDir,
  });

  return {
    ...bounded,
    details: {
      ...(bounded.details ?? {}),
      query,
      answer: data.answer,
      results: results.map((result) => ({
        title: result.title,
        url: result.url,
        content: snippet(result.content),
        score: typeof result.score === "number" ? result.score : undefined,
      })),
    },
  };
}
