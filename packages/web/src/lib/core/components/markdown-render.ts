import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { highlightCodeCached } from "$lib/core/highlight/highlight";
import { trimTextPreview } from "$lib/core/utils/text-preview";

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify);

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Render markdown source to sanitized HTML (before code-block decoration). */
export function renderMarkdown(source: string): string {
  try {
    return String(markdownProcessor.processSync(source));
  } catch {
    return escapeHtml(source);
  }
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
