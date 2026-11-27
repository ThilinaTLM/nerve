import {
  baseContentType,
  downloadWebResource,
  getExtension,
  isHtml,
  isolatedHtmlToMarkdown,
  isTextType,
  withTimeoutSignal,
  ToolExecutionError,
} from "../../../execution/index.js";
import { assertArtifactName } from "@nervekit/extension-api/host";
import { freshArtifactName, writeArtifact } from "../files/artifacts.js";
import { codedError } from "../errors.js";
import { defineMethod } from "../sdk-args.js";
import type { SdkMethod } from "../sdk-types.js";

const FETCH_AS = ["markdown", "text", "json", "file"] as const;
type FetchAs = (typeof FETCH_AS)[number];

const TITLE_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

export function htmlTitle(html: string): string | undefined {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  // One pass, so `&amp;lt;` decodes to `&lt;`, not `<`.
  const title = raw
    ?.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => TITLE_ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
  return title || undefined;
}

/** Fetches the page through the `web_fetch` tool's network policy. An HTTP error status is part of the result, not a failure. */
async function download(url: string, env: Parameters<SdkMethod["prepare"]>[1]) {
  try {
    return await downloadWebResource(
      url,
      withTimeoutSignal(env.context.signal, 60_000),
      env.context.webFetchPolicy?.allowPrivateNetwork === true,
    );
  } catch (error) {
    if (
      error instanceof ToolExecutionError &&
      error.code === "WEB_FETCH_RESPONSE_TOO_LARGE"
    )
      throw codedError("BAD_REQUEST", error.message);
    throw error;
  }
}

export const webMethods: SdkMethod[] = [
  defineMethod({
    product: "web",
    path: "fetch",
    risk: "external_read",
    bare: "url",
    options: ["url", "as", "name"],
    signature:
      '/** GET a URL; an HTTP error status (404, 500…) is returned in `status` with the response body, not thrown. Default: HTML as markdown, text as text, JSON parsed; binary or `as: "file"` saves an artifact. */ fetch(url: string | { url: string; as?: "markdown" | "text" | "json" | "file"; name?: string }): Promise<WebPage | FileHandle>',
    parse: (options) => {
      const { url, as, name } = options;
      if (typeof url !== "string" || url.trim().length === 0)
        throw new Error("url must be a non-empty string.");
      if (as !== undefined && !FETCH_AS.includes(as as FetchAs))
        throw new Error(`as must be one of: ${FETCH_AS.join(", ")}.`);
      return {
        url,
        as: as as FetchAs | undefined,
        name: name === undefined ? undefined : assertArtifactName(name),
      };
    },
    // Checked as the core `web_fetch` tool, so its URL rules and approvals apply.
    authorize: ({ url }) => ({
      toolName: "web_fetch",
      args: { url },
      summary: url,
    }),
    resource: ({ url }) => url,
    async run({ url, as, name }, env) {
      const page = await download(url, env);
      const { contentType, buffer } = page;
      // An error status always comes back as a page (its body is a message, whatever the content type).
      const text = isTextType(contentType) || page.status >= 400;
      if (as === "file" || (as === undefined && !text))
        return await writeArtifact(
          env,
          name ??
            (await freshArtifactName(env, "web", getExtension(contentType))),
          buffer,
        );
      if (!text)
        throw new Error(
          `${baseContentType(contentType) || "binary"} content cannot be read as ${as}; use as: "file" to save it.`,
        );
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
          if (as === "json")
            throw new Error(
              `${page.url} did not return valid JSON; use as: "text".`,
            );
          return { ...result, content: source };
        }
      }
      const title = isHtml(contentType) ? htmlTitle(source) : undefined;
      const content =
        kind === "markdown" && isHtml(contentType)
          ? await isolatedHtmlToMarkdown(source, {
              signal: env.context.signal,
            })
          : source;
      return { ...result, ...(title ? { title } : {}), content };
    },
  }),
];
