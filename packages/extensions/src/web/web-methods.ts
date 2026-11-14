import {
  ExtensionError,
  isArtifactName,
  method,
  nonEmptyString,
  parseOptions,
  type ExtensionContext,
  type ExtensionErrorCode,
} from "@nervekit/extension-api";
import {
  baseContentType,
  extensionFor,
  htmlTitle,
  isHtml,
  isTextType,
  snippet,
} from "./content-types.js";

/** Largest page `web.fetch` downloads (and converts). */
export const MAX_FETCH_BYTES = 8 * 1024 * 1024;
/** Largest file `web.fetch` saves as an artifact. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const FETCH_AS = ["markdown", "text", "json", "file"] as const;
type FetchAs = (typeof FETCH_AS)[number];
const SEARCH_URL = "https://api.tavily.com/search";

function httpCode(status: number): ExtensionErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404 || status === 410) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return status >= 500 ? "SERVER_ERROR" : "BAD_REQUEST";
}

function artifactName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isArtifactName(value))
    throw new ExtensionError(
      "BAD_REQUEST",
      `Invalid artifact name ${JSON.stringify(value)}: use 1-128 letters, digits, spaces, '.', '_' or '-' (no folders, no leading dot).`,
    );
  return value;
}

type TavilyResponse = {
  answer?: string;
  results?: {
    title: string;
    url: string;
    content: string;
    published_date?: string;
  }[];
};

/** The Tavily call behind `web.search` and the `web_search` tool, with the selected account's injected credential. */
async function searchTavily(
  ctx: ExtensionContext,
  query: string,
  limit: number,
  includeAnswer: boolean,
): Promise<TavilyResponse> {
  if (!(await ctx.accounts.selected("searchAccount")))
    throw new ExtensionError(
      "DENIED",
      "web.search: no Tavily account is selected.",
      {
        fix: "Ask the user to choose one with a saved API token in Settings → Extensions → Web; web.fetch still works.",
      },
    );
  const response = await ctx.http.request({
    url: SEARCH_URL,
    method: "POST",
    auth: { account: "searchAccount" },
    body: {
      json: { query, max_results: limit, include_answer: includeAnswer },
    },
    response: "text",
    timeoutMs: 60_000,
  });
  if (!response.ok)
    throw new ExtensionError(
      httpCode(response.status),
      `Tavily API error: ${response.status} ${String(response.body)}`,
    );
  try {
    return JSON.parse(String(response.body)) as TavilyResponse;
  } catch {
    throw new ExtensionError(
      "SERVER_ERROR",
      "Tavily returned a response that is not JSON.",
    );
  }
}

export const webMethods = {
  fetch: method({
    risk: "network",
    signature:
      '/** GET a URL. Default: HTML as markdown, text as text, JSON parsed; binary or `as: "file"` saves an artifact. */ fetch(url: string | { url: string; as?: "markdown" | "text" | "json" | "file"; name?: string }): Promise<WebPage | FileHandle>',
    parse: (args) => {
      const options = parseOptions("web.fetch", args, {
        bare: "url",
        options: ["url", "as", "name"],
      });
      const as = options.as;
      if (as !== undefined && !FETCH_AS.includes(as as FetchAs))
        throw new ExtensionError(
          "BAD_REQUEST",
          `as must be one of: ${FETCH_AS.join(", ")}.`,
        );
      return {
        url: nonEmptyString(options.url, "url"),
        as: as as FetchAs | undefined,
        name: artifactName(options.name),
      };
    },
    // Checked as the core `web_fetch` tool, so its URL rules and approvals apply.
    authorize: ({ url }) => ({
      toolName: "web_fetch",
      args: { url },
      summary: url,
    }),
    resource: ({ url }) => url,
    async run(_session, { url, as, name }, ctx) {
      const page = await ctx.http
        .request({
          url,
          headers: { accept: "text/html,application/json,text/plain,*/*" },
          response: "bytes",
          maxBytes: MAX_FETCH_BYTES,
          timeoutMs: 60_000,
        })
        .catch((error: unknown) => {
          if (
            error instanceof ExtensionError &&
            error.message.includes("is larger than")
          )
            throw new ExtensionError(
              "BAD_REQUEST",
              `Response exceeds the ${MAX_FETCH_BYTES / (1024 * 1024)} MiB download limit.`,
            );
          throw error;
        });
      if (!page.ok)
        throw new ExtensionError(
          httpCode(page.status),
          `Fetch failed: ${page.status}`,
        );
      const bytes = page.body as Uint8Array;
      const contentType =
        page.headers["content-type"] ?? "application/octet-stream";
      const text = isTextType(contentType);
      if (as === "file" || (as === undefined && !text)) {
        if (bytes.byteLength > MAX_FILE_BYTES)
          throw new ExtensionError(
            "BAD_REQUEST",
            `Response is ${bytes.byteLength} bytes; the limit is ${MAX_FILE_BYTES}.`,
          );
        const written = await ctx.artifacts.write(
          name ??
            (await ctx.artifacts.freshName("web", extensionFor(contentType))),
          bytes,
          baseContentType(contentType) || undefined,
        );
        return written.handle;
      }
      if (!text)
        throw new ExtensionError(
          "BAD_REQUEST",
          `${baseContentType(contentType) || "binary"} content cannot be read as ${as}; use as: "file" to save it.`,
        );
      const source = new TextDecoder().decode(bytes);
      const result = { url: page.url, status: page.status, contentType };
      const kind =
        as ??
        (baseContentType(contentType) === "application/json"
          ? "json"
          : "markdown");
      if (kind === "json") {
        try {
          return { ...result, content: JSON.parse(source) as unknown };
        } catch {
          if (as === "json")
            throw new ExtensionError(
              "BAD_REQUEST",
              `${page.url} did not return valid JSON; use as: "text".`,
            );
          return { ...result, content: source };
        }
      }
      const title = isHtml(contentType) ? htmlTitle(source) : undefined;
      if (kind === "markdown" && isHtml(contentType))
        return {
          ...result,
          ...(title ? { title } : {}),
          content: await ctx.text.htmlToMarkdown(source),
        };
      return { ...result, ...(title ? { title } : {}), content: source };
    },
  }),
  search: method({
    risk: "network",
    signature:
      "/** Web search; default 5 results (max 20). */ search(query: string | { query: string; limit?: number }): Promise<WebHit[]>",
    // A bound tool passes `max_results`; a script passes `limit`.
    parse: (args) => {
      const options = parseOptions("web.search", args, {
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
      const data = await searchTavily(ctx, query, limit, false);
      return (Array.isArray(data.results) ? data.results : []).map((hit) => ({
        title: hit.title,
        url: hit.url,
        snippet: snippet(hit.content) ?? "",
        ...(hit.published_date ? { published: hit.published_date } : {}),
      }));
    },
  }),
};

/** What the `web_search` tool returns: the Tavily answer and results with their full content. */
export type WebSearchOutput = {
  query: string;
  answer?: string;
  results: { title: string; url: string; content: string }[];
};

/** `web_search`: the same parse, authorization (operation `web.search`) and Tavily call as `web.search`, with the answer and full content for the agent. */
export const webSearchTool = {
  parse: (args: Record<string, unknown>) => webMethods.search.parse([args]),
  authorize: ({ query }: { query: string }) => ({
    operation: "web.search",
    targets: [],
    summary: query,
  }),
  async run(
    { query, limit }: { query: string; limit: number },
    ctx: ExtensionContext,
  ): Promise<WebSearchOutput> {
    const data = await searchTavily(ctx, query, limit, true);
    return {
      query,
      ...(data.answer ? { answer: data.answer } : {}),
      results: (Array.isArray(data.results) ? data.results : []).map((hit) => ({
        title: hit.title,
        url: hit.url,
        content: hit.content,
      })),
    };
  },
  /** The text the agent reads, and the links the transcript lists (snippets bounded). */
  present(output: WebSearchOutput): { text: string; value: unknown } {
    const lines: string[] = [];
    if (output.answer) lines.push(`**Answer:** ${output.answer}`, "");
    for (const result of output.results)
      lines.push(`### ${result.title}`, result.url, "", result.content, "");
    return {
      text: lines.join("\n").trimEnd(),
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
