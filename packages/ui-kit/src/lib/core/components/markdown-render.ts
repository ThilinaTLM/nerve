import { highlightCodeCached } from "@nervekit/ui-kit/core/highlight/highlight";
import { LruCache } from "@nervekit/ui-kit/core/utils/lru-cache";
import { trimTextPreview } from "@nervekit/ui-kit/core/utils/text-preview";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify);

// Content-keyed memoization for the (pure) render products. Re-mounts (tab
// switches, virtual-scroll remounts) and run-completion re-renders reuse work
// instead of re-parsing/re-decorating/re-highlighting unchanged message text.
const MARKDOWN_CACHE_MAX = 400;
const parseCache = new LruCache<string, string>(MARKDOWN_CACHE_MAX);
const decoratedCache = new LruCache<string, string>(MARKDOWN_CACHE_MAX);
const highlightedCache = new LruCache<string, string>(MARKDOWN_CACHE_MAX);
const highlightInflight = new Map<string, Promise<string>>();

function signatureFor(source: string, trimCodeBlocks: boolean): string {
  return `${trimCodeBlocks ? "t" : "f"}\0${source}`;
}

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export type RenderMarkdownOptions = {
  /**
   * When false, bypass the parse cache. Used by the streaming decorate path: an
   * actively streaming message produces a unique string per frame, so caching
   * those transient prefixes would only churn/pollute the LRU.
   */
  cache?: boolean;
};

/** Render markdown source to sanitized HTML (before code-block decoration). */
export function renderMarkdown(
  source: string,
  options: RenderMarkdownOptions = {},
): string {
  const useCache = options.cache ?? true;
  if (useCache) {
    const cached = parseCache.get(source);
    if (cached !== undefined) return cached;
  }
  let html: string;
  try {
    html = String(markdownProcessor.processSync(source));
  } catch {
    html = escapeHtml(source);
  }
  if (useCache) parseCache.set(source, html);
  return html;
}

function languageFromClass(className: string): string {
  return className.match(/language-([\w-]+)/)?.[1] ?? "text";
}

function codeBlockText(block: Element, trimCodeBlocks: boolean): string {
  const source = block.textContent ?? "";
  return trimCodeBlocks ? trimTextPreview(source).text : source;
}

function clonePreWithTrimmedCode(pre: Element, code: string): Element {
  const clone = pre.cloneNode(true) as Element;
  const codeEl = clone.querySelector("code");
  if (codeEl) codeEl.textContent = code;
  else clone.textContent = code;
  return clone;
}

function wrapCodeBlock(pre: Element): Element {
  const shell = document.createElement("div");
  shell.className = "code-block";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-copy";
  button.dataset.copyCode = "";
  button.textContent = "Copy";
  shell.append(button, pre);
  return shell;
}

function wrapPlainCodeBlocks(
  safeHtml: string,
  trimCodeBlocks: boolean,
): string {
  if (typeof document === "undefined" || !safeHtml.includes("<pre"))
    return safeHtml;
  const container = document.createElement("div");
  container.innerHTML = safeHtml;
  for (const block of Array.from(container.querySelectorAll("pre > code"))) {
    const pre = block.parentElement;
    if (pre)
      pre.replaceWith(
        wrapCodeBlock(
          clonePreWithTrimmedCode(pre, codeBlockText(block, trimCodeBlocks)),
        ),
      );
  }
  return container.innerHTML;
}

function wrapTables(safeHtml: string): string {
  if (typeof document === "undefined" || !safeHtml.includes("<table"))
    return safeHtml;
  const container = document.createElement("div");
  container.innerHTML = safeHtml;
  for (const table of Array.from(container.querySelectorAll("table"))) {
    if (table.parentElement?.classList.contains("table-scroll")) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "table-scroll";
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
  return container.innerHTML;
}

async function highlightCodeBlocks(
  safeHtml: string,
  trimCodeBlocks: boolean,
): Promise<string> {
  if (typeof document === "undefined" || !safeHtml.includes("<pre"))
    return safeHtml;
  const container = document.createElement("div");
  container.innerHTML = safeHtml;
  const blocks = Array.from(container.querySelectorAll("pre > code"));
  await Promise.all(
    blocks.map(async (block) => {
      const className = block.getAttribute("class") ?? "";
      const language = languageFromClass(className);
      try {
        const code = codeBlockText(block, trimCodeBlocks);
        const highlighted = await highlightCodeCached(code, language);
        if (highlighted) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = highlighted;
          const highlightedPre = wrapper.firstElementChild;
          if (highlightedPre)
            block.parentElement?.replaceWith(wrapCodeBlock(highlightedPre));
          return;
        }
      } catch {
        // Fall back to the plain pre/code while keeping the Stitch code header.
      }
      const pre = block.parentElement;
      if (pre)
        pre.replaceWith(
          wrapCodeBlock(
            clonePreWithTrimmedCode(pre, codeBlockText(block, trimCodeBlocks)),
          ),
        );
    }),
  );
  return container.innerHTML;
}

/** Decorate rendered HTML with code-block shells + scrollable tables. */
export function decorateMarkdownHtml(
  renderedHtml: string,
  trimCodeBlocks: boolean,
): string {
  return wrapTables(wrapPlainCodeBlocks(renderedHtml, trimCodeBlocks));
}

/** Apply async syntax highlighting and table wrapping to rendered HTML. */
export async function highlightMarkdownHtml(
  renderedHtml: string,
  trimCodeBlocks: boolean,
): Promise<string> {
  return wrapTables(await highlightCodeBlocks(renderedHtml, trimCodeBlocks));
}

/**
 * Cached decorate-only render (parse + code-block/table decoration, no shiki).
 * Use for non-streaming mount/scroll re-renders where the source is finalized.
 */
export function renderDecoratedMarkdown(
  source: string,
  trimCodeBlocks: boolean,
): string {
  const key = signatureFor(source, trimCodeBlocks);
  const cached = decoratedCache.get(key);
  if (cached !== undefined) return cached;
  const html = decorateMarkdownHtml(renderMarkdown(source), trimCodeBlocks);
  decoratedCache.set(key, html);
  return html;
}

/**
 * Return resolved highlighted HTML if it is already cached, else undefined so
 * the caller can render the (cheaper) decorated variant first.
 */
export function getHighlightedMarkdownSync(
  source: string,
  trimCodeBlocks: boolean,
): string | undefined {
  return highlightedCache.get(signatureFor(source, trimCodeBlocks));
}

/**
 * Synchronously return the best finalized render product currently available.
 * This lets virtual rows paint at their real cached height before measurement.
 */
export function renderBestAvailableMarkdown(
  source: string,
  trimCodeBlocks: boolean,
): string {
  return (
    getHighlightedMarkdownSync(source, trimCodeBlocks) ??
    renderDecoratedMarkdown(source, trimCodeBlocks)
  );
}

/**
 * Cached async highlight + table wrapping. De-dupes concurrent calls for the
 * same (source, trim) so repeated mounts share a single shiki pass.
 */
export function renderHighlightedMarkdown(
  source: string,
  trimCodeBlocks: boolean,
): Promise<string> {
  const key = signatureFor(source, trimCodeBlocks);
  const cached = highlightedCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = highlightInflight.get(key);
  if (inflight) return inflight;
  const promise = highlightMarkdownHtml(renderMarkdown(source), trimCodeBlocks)
    .then((html) => {
      highlightedCache.set(key, html);
      highlightInflight.delete(key);
      return html;
    })
    .catch((error) => {
      highlightInflight.delete(key);
      throw error;
    });
  highlightInflight.set(key, promise);
  return promise;
}
