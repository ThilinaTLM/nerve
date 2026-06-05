import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import { numberArg } from "./common.js";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
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

function timeoutSignal(
  signal: AbortSignal | undefined,
  milliseconds: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function executeWebSearch(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const query = stringArg(args.query, "query");
  const maxResults = maxResultsArg(args.max_results);
  const apiKey =
    (await context.getApiKey?.("tavily")) ?? process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Tavily API key is not configured. Configure provider 'tavily' in Nerve or set TAVILY_API_KEY.",
    );
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: true,
    }),
    signal: timeoutSignal(context.signal, 60_000),
  });

  if (!response.ok) {
    throw new Error(
      `Tavily API error: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as TavilyResponse;
  const results = Array.isArray(data.results) ? data.results : [];

  const lines: string[] = [];
  if (data.answer) lines.push(`**Answer:** ${data.answer}`, "");
  for (const result of results) {
    lines.push(`### ${result.title}`, result.url, "", result.content, "");
  }
  const content = lines.join("\n").trimEnd();

  return {
    content,
    contentBlocks: [{ type: "text", text: content }],
    details: {
      query,
      answer: data.answer,
      results: results.map((result) => ({
        title: result.title,
        url: result.url,
      })),
    },
  };
}
