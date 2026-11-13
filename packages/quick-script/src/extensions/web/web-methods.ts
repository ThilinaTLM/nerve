import { isolatedHtmlToMarkdown } from "@nervekit/tools/integrations";
import { ToolExecutionError } from "@nervekit/tools/execution";
import { withTimeoutSignal } from "@nervekit/tools/integrations";
import {
  baseContentType,
  downloadWebResource,
  getExtension,
  isHtml,
  isTextType,
} from "@nervekit/tools/integrations";
import { searchTavily, snippet } from "@nervekit/tools/integrations";
import { codedError, type HostErrorCode } from "../../runtime/errors.js";
import {
  assertArtifactName,
  freshArtifactName,
  MAX_FILE_BYTES,
  writeArtifact,
} from "../../runtime/files/artifacts.js";
import { clampInt, nonEmptyString } from "../../runtime/sdk-args.js";
import {
  defineMethod,
  type SdkEnvironment,
  type SdkMethod,
} from "../../runtime/sdk-types.js";

const SETTINGS = "Settings → Tools → quick_script → Web";
const FETCH_AS = ["markdown", "text", "json", "file"] as const;
type FetchAs = (typeof FETCH_AS)[number];

function requireWeb(name: string, env: SdkEnvironment): void {
  if (!env.context.web?.enabled) {
    throw codedError(
      "DENIED",
      `${name}: web is not available in quick_script. Ask the user to enable Web in ${SETTINGS}.`,
    );
  }
}

function httpCode(status: number): HostErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404 || status === 410) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return status >= 500 ? "SERVER_ERROR" : "BAD_REQUEST";
}

/** Re-codes an HTTP failure of the shared fetch/search clients as a script-visible host code. */
function asHostError(error: unknown): unknown {
  if (
    error instanceof ToolExecutionError &&
    (error.code === "WEB_FETCH_HTTP_ERROR" ||
      error.code === "WEB_SEARCH_HTTP_ERROR") &&
    typeof error.details.status === "number"
  ) {
    return codedError(httpCode(error.details.status), error.message);
  }
  return error;
}

const TITLE_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function htmlTitle(html: string): string | undefined {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  // One pass, so `&amp;lt;` decodes to `&lt;`, not `<`.
  const title = raw
    ?.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => TITLE_ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
  return title || undefined;
}

export const webMethods: SdkMethod[] = [
  defineMethod({
    product: "web",
    path: "fetch",
    risk: "network",
    bare: "url",
    options: ["url", "as", "name"],
    signature:
      '/** GET a URL. Default: HTML as markdown, text as text, JSON parsed; binary or `as: "file"` saves an artifact. */ fetch(url: string | { url: string; as?: "markdown" | "text" | "json" | "file"; name?: string }): Promise<WebPage | FileHandle>',
    parse: (options) => {
      const as = options.as;
      if (as !== undefined && !FETCH_AS.includes(as as FetchAs)) {
        throw new Error(`as must be one of: ${FETCH_AS.join(", ")}.`);
      }
      return {
        url: nonEmptyString(options.url, "url"),
        as: as as FetchAs | undefined,
        name:
          options.name === undefined
            ? undefined
            : assertArtifactName(options.name),
      };
    },
    authorize: ({ url }, env) => {
      requireWeb("web.fetch", env);
      return { toolName: "web_fetch", args: { url }, summary: url };
    },
    resource: ({ url }) => url,
    async run({ url, as, name }, env) {
      let page;
      try {
        page = await downloadWebResource(
          url,
          withTimeoutSignal(env.context.signal, 60_000),
          env.context.webFetchPolicy?.allowPrivateNetwork === true,
        );
      } catch (error) {
        throw asHostError(error);
      }
      const { buffer, contentType } = page;
      const text = isTextType(contentType);
      if (as === "file" || (as === undefined && !text)) {
        if (buffer.byteLength > MAX_FILE_BYTES) {
          throw new Error(
            `Response is ${buffer.byteLength} bytes; the limit is ${MAX_FILE_BYTES}.`,
          );
        }
        return await writeArtifact(
          env,
          name ??
            (await freshArtifactName(env, "web", getExtension(contentType))),
          buffer,
        );
      }
      if (!text) {
        throw new Error(
          `${baseContentType(contentType) || "binary"} content cannot be read as ${as}; use as: "file" to save it.`,
        );
      }
      const source = buffer.toString("utf8");
      const result = {
        url: page.url,
        status: page.status,
        contentType,
      };
      const kind =
        as ??
        (baseContentType(contentType) === "application/json"
          ? "json"
          : "markdown");
      if (kind === "json") {
        try {
          return { ...result, content: JSON.parse(source) as unknown };
        } catch {
          if (as === "json") {
            throw new Error(
              `${page.url} did not return valid JSON; use as: "text".`,
            );
          }
          return { ...result, content: source };
        }
      }
      if (kind === "markdown" && isHtml(contentType)) {
        const title = htmlTitle(source);
        return {
          ...result,
          ...(title ? { title } : {}),
          content: await isolatedHtmlToMarkdown(source, {
            signal: env.context.signal,
          }),
        };
      }
      const title = isHtml(contentType) ? htmlTitle(source) : undefined;
      return { ...result, ...(title ? { title } : {}), content: source };
    },
  }),
  defineMethod({
    product: "web",
    path: "search",
    risk: "network",
    bare: "query",
    options: ["query", "limit"],
    signature:
      "/** Web search; default 5 results (max 20). */ search(query: string | { query: string; limit?: number }): Promise<WebHit[]>",
    parse: (options) => ({
      query: nonEmptyString(options.query, "query"),
      limit: clampInt(options.limit, 5, 1, 20),
    }),
    authorize: ({ query, limit }, env) => {
      requireWeb("web.search", env);
      if (!env.context.web?.search) {
        throw codedError(
          "DENIED",
          `web.search: no Tavily account is selected. Ask the user to choose one with a saved API token in ${SETTINGS}; web.fetch still works.`,
        );
      }
      return {
        toolName: "web_search",
        args: { query, max_results: limit },
        summary: query,
      };
    },
    resource: () => "the search provider",
    async run({ query, limit }, env) {
      const apiKey = await env.context.getApiKey?.("tavily");
      if (!apiKey) {
        throw codedError(
          "DENIED",
          `web.search: the selected Tavily account has no API token. Ask the user to add it in Settings → Integrations → Tavily.`,
        );
      }
      let data;
      try {
        data = await searchTavily({
          apiKey,
          query,
          maxResults: limit,
          includeAnswer: false,
          signal: withTimeoutSignal(env.context.signal, 60_000),
        });
      } catch (error) {
        throw asHostError(error);
      }
      return (Array.isArray(data.results) ? data.results : []).map((hit) => ({
        title: hit.title,
        url: hit.url,
        snippet: snippet(hit.content) ?? "",
        ...(hit.published_date ? { published: hit.published_date } : {}),
      }));
    },
  }),
];
