import { highlightCodeCached } from "@nervekit/ui-kit/highlighting/highlight";
import { isMermaidLanguage } from "../mermaid/mermaid-render.js";
import { LruCache } from "@nervekit/ui-kit/collections/lru-cache";
import { trimTextPreview } from "@nervekit/ui-kit/display/text-preview";
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkBreaks from "remark-breaks";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { FRONTMATTER_CLASS, remarkFrontmatterTable } from "./frontmatter.js";

/** Source-level syntax options; each combination has its own processor and cache keys. */
export type MarkdownSyntax = {
  /** Convert Markdown soft line endings into semantic hard breaks. */
  preserveLineBreaks?: boolean;
  /** Render a leading YAML frontmatter block as metadata (file previews). */
  frontmatter?: boolean;
};

const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    table: [
      ...(defaultSchema.attributes?.table ?? []),
      ["className", FRONTMATTER_CLASS],
    ],
    th: [...(defaultSchema.attributes?.th ?? []), ["scope", "row"]],
  },
};

function createMarkdownProcessor({
  preserveLineBreaks,
  frontmatter,
}: MarkdownSyntax) {
  const processor = unified().use(remarkParse).use(remarkGfm);
  if (frontmatter) processor.use(remarkFrontmatter).use(remarkFrontmatterTable);
  if (preserveLineBreaks) processor.use(remarkBreaks);
  return processor
    .use(remarkRehype)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);
}

const processors = new Map<
  string,
  ReturnType<typeof createMarkdownProcessor>
>();

function syntaxKey({ preserveLineBreaks, frontmatter }: MarkdownSyntax) {
  return `${preserveLineBreaks ? "breaks" : "standard"}${frontmatter ? "+fm" : ""}`;
}

function processorFor(syntax: MarkdownSyntax) {
  const key = syntaxKey(syntax);
  let processor = processors.get(key);
  if (!processor) {
    processor = createMarkdownProcessor(syntax);
    processors.set(key, processor);
  }
  return processor;
}

// Content-keyed memoization for the (pure) render products. Re-mounts (tab
// switches, virtual-scroll remounts) and run-completion re-renders reuse work
// instead of re-parsing/re-decorating/re-highlighting unchanged message text.
const MARKDOWN_CACHE_MAX = 400;
const parseCache = new LruCache<string, string>(MARKDOWN_CACHE_MAX);
const decoratedCache = new LruCache<string, string>(MARKDOWN_CACHE_MAX);
const highlightedCache = new LruCache<string, string>(MARKDOWN_CACHE_MAX);
const highlightInflight = new Map<string, Promise<string>>();

function sourceSignatureFor(source: string, syntax: MarkdownSyntax): string {
  return `${syntaxKey(syntax)}\0${source}`;
}

function signatureFor(
  source: string,
  trimCodeBlocks: boolean,
  syntax: MarkdownSyntax,
): string {
  return `${trimCodeBlocks ? "t" : "f"}\0${sourceSignatureFor(source, syntax)}`;
}

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export type RenderMarkdownOptions = MarkdownSyntax & {
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
  const { cache: useCache = true, ...syntax } = options;
  const key = sourceSignatureFor(source, syntax);
  if (useCache) {
    const cached = parseCache.get(key);
    if (cached !== undefined) return cached;
  }
  let html: string;
  try {
    html = String(processorFor(syntax).processSync(source));
  } catch {
    html = escapeHtml(source);
  }
  if (useCache) parseCache.set(key, html);
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
  const button = document.createElement("span");
  button.className = "code-copy";
  button.dataset.copyCode = "";
  shell.append(button, pre);
  return shell;
}

function wrapMermaidBlock(pre: Element): Element {
  const shell = document.createElement("div");
  shell.className = "mermaid-block h-80 min-h-64 max-h-96";
  shell.dataset.mermaidDiagram = "";
  shell.setAttribute("aria-label", "Mermaid diagram");
  shell.append(pre.cloneNode(true));
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
    if (!pre) continue;
    const language = languageFromClass(block.getAttribute("class") ?? "");
    if (isMermaidLanguage(language)) {
      pre.replaceWith(wrapMermaidBlock(pre));
      continue;
    }
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
      if (isMermaidLanguage(language)) {
        const pre = block.parentElement;
        if (pre) pre.replaceWith(wrapMermaidBlock(pre));
        return;
      }
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
  syntax: MarkdownSyntax = {},
): string {
  const key = signatureFor(source, trimCodeBlocks, syntax);
  const cached = decoratedCache.get(key);
  if (cached !== undefined) return cached;
  const html = decorateMarkdownHtml(
    renderMarkdown(source, syntax),
    trimCodeBlocks,
  );
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
  syntax: MarkdownSyntax = {},
): string | undefined {
  return highlightedCache.get(signatureFor(source, trimCodeBlocks, syntax));
}

/**
 * Synchronously return the best finalized render product currently available.
 * This lets virtual rows paint at their real cached height before measurement.
 */
export function renderBestAvailableMarkdown(
  source: string,
  trimCodeBlocks: boolean,
  syntax: MarkdownSyntax = {},
): string {
  return (
    getHighlightedMarkdownSync(source, trimCodeBlocks, syntax) ??
    renderDecoratedMarkdown(source, trimCodeBlocks, syntax)
  );
}

/**
 * Cached async highlight + table wrapping. De-dupes concurrent calls for the
 * same (source, trim) so repeated mounts share a single shiki pass.
 */
export function renderHighlightedMarkdown(
  source: string,
  trimCodeBlocks: boolean,
  syntax: MarkdownSyntax = {},
): Promise<string> {
  const key = signatureFor(source, trimCodeBlocks, syntax);
  const cached = highlightedCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = highlightInflight.get(key);
  if (inflight) return inflight;
  const promise = highlightMarkdownHtml(
    renderMarkdown(source, syntax),
    trimCodeBlocks,
  )
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
