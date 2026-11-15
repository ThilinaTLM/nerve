import {
  ExtensionError,
  method,
  nonEmptyString,
  parseOptions,
  type ExtensionContext,
} from "@nervekit/extension-api";
import { providerFor } from "./providers/index.js";
import type { SearchResponse } from "./providers/provider.js";

/** The setting that selects the account, and with its kind the provider. */
export const SEARCH_ACCOUNT_FIELD = "searchAccount";
const SNIPPET_MAX_CHARS = 300;

/** Bound the per-result snippet so structured results stay small. */
export function snippet(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return undefined;
  return normalized.length <= SNIPPET_MAX_CHARS
    ? normalized
    : `${normalized.slice(0, SNIPPET_MAX_CHARS - 1)}…`;
}

/** Runs the search on the provider of the selected account's kind. */
async function runSearch(
  ctx: ExtensionContext,
  query: string,
  limit: number,
  includeAnswer: boolean,
): Promise<SearchResponse> {
  const account = await ctx.accounts.selected(SEARCH_ACCOUNT_FIELD);
  if (!account)
    throw new ExtensionError(
      "DENIED",
      "search.web: no search account is selected.",
      {
        fix: "Ask the user to choose one with a saved API key in Settings → Extensions → Web Search.",
      },
    );
  const provider = providerFor(account.kind);
  if (!provider)
    throw new ExtensionError(
      "DENIED",
      `search.web: no search provider for accounts of kind '${account.kind}'.`,
    );
  return await provider.search(ctx, {
    query,
    limit,
    includeAnswer,
    accountField: SEARCH_ACCOUNT_FIELD,
  });
}

export const searchMethods = {
  web: method({
    risk: "network",
    signature:
      "/** Web search; default 5 results (max 20). */ web(query: string | { query: string; limit?: number }): Promise<WebHit[]>",
    // A bound tool passes `max_results`; a script passes `limit`.
    parse: (args) => {
      const options = parseOptions("search.web", args, {
        bare: "query",
        options: ["query", "limit", "max_results"],
      });
      const requested = options.limit ?? options.max_results;
      return {
        query: nonEmptyString(options.query, "query"),
        limit:
          typeof requested === "number" && Number.isFinite(requested)
            ? Math.min(20, Math.max(1, Math.floor(requested)))
            : 5,
      };
    },
    authorize: ({ query }) => ({ targets: [], summary: query }),
    resource: () => "the search provider",
    async run(_session, { query, limit }, ctx: ExtensionContext) {
      const { hits } = await runSearch(ctx, query, limit, false);
      return hits.map((hit) => ({
        title: hit.title,
        url: hit.url,
        snippet: snippet(hit.content) ?? "",
        ...(hit.published ? { published: hit.published } : {}),
      }));
    },
  }),
};

/** What the `web_search` tool returns: the provider's answer (when it has one) and results with their full content. */
export type WebSearchOutput = {
  query: string;
  answer?: string;
  results: { title: string; url: string; content: string }[];
};

/** `web_search`: the same parse, authorization (operation `search.web`) and provider call as `search.web`, with the answer and full content for the agent. */
export const webSearchTool = {
  parse: (args: Record<string, unknown>) => searchMethods.web.parse([args]),
  authorize: ({ query }: { query: string }) => ({
    operation: "search.web",
    targets: [],
    summary: query,
  }),
  async run(
    { query, limit }: { query: string; limit: number },
    ctx: ExtensionContext,
  ): Promise<WebSearchOutput> {
    const { answer, hits } = await runSearch(ctx, query, limit, true);
    return {
      query,
      ...(answer ? { answer } : {}),
      results: hits.map(({ title, url, content }) => ({ title, url, content })),
    };
  },
  /** The text the agent reads, and the links the transcript lists (snippets bounded). */
  present(output: WebSearchOutput): {
    text: string;
    value: unknown;
    details: { query: string; answer?: string };
  } {
    const lines: string[] = [];
    if (output.answer) lines.push(`**Answer:** ${output.answer}`, "");
    for (const result of output.results)
      lines.push(`### ${result.title}`, result.url, "", result.content, "");
    return {
      text: lines.join("\n").trimEnd(),
      details: {
        query: output.query,
        ...(output.answer ? { answer: output.answer } : {}),
      },
      value: output.results.map((result) => ({
        title: result.title,
        url: result.url,
        ...(snippet(result.content)
          ? { snippet: snippet(result.content) }
          : {}),
      })),
    };
  },
};
