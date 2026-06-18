<script lang="ts">
  import { writeClipboardText } from "$lib/core/clipboard";
  import {
    decorateMarkdownHtml,
    highlightMarkdownHtml,
    renderMarkdown,
  } from "$lib/core/components/markdown-render";
  import {
    parseLocalFileHref,
    resolveDisplayPath,
    splitPathLineSuffix,
  } from "$lib/core/utils/path-links";

  type Props = {
    text: string;
    trimCodeBlocks?: boolean;
    linkBasePath?: string;
    onOpenFile?: (path: string, line?: number) => void;
    onCopy?: (ok: boolean) => void;
  };

  let {
    text,
    trimCodeBlocks = true,
    linkBasePath,
    onOpenFile,
    onCopy,
  }: Props = $props();
  let html = $state("");

  async function handleClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-copy-code]");
    if (button) {
      const code = button.closest(".code-block")?.querySelector("pre code")?.textContent ?? "";
      if (!code) return;
      try {
        await writeClipboardText(code);
        onCopy?.(true);
      } catch {
        onCopy?.(false);
      }
      return;
    }

    if (!onOpenFile) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    const parsed = parseLocalFileHref(href);
    if (!parsed) return;
    const split = splitPathLineSuffix(parsed);
    const path = linkBasePath ? (resolveDisplayPath(split.path, linkBasePath) ?? split.path) : split.path;
    event.preventDefault();
    onOpenFile(path, split.line);
  }

  function copyButtonHandler(node: HTMLDivElement) {
    node.addEventListener("click", handleClick);
    return {
      destroy() {
        node.removeEventListener("click", handleClick);
      },
    };
  }

  let htmlSource: string | undefined;

  $effect(() => {
    const source = text;
    const signature = `${trimCodeBlocks ? "trim" : "full"}\0${source}`;
    if (htmlSource === signature) return;
    let cancelled = false;
    const rendered = renderMarkdown(source);
    html = decorateMarkdownHtml(rendered, trimCodeBlocks);
    htmlSource = signature;
    highlightMarkdownHtml(rendered, trimCodeBlocks)
      .then((highlighted) => {
        if (!cancelled && source === text) {
          html = highlighted;
          htmlSource = signature;
        }
      })
      .catch(() => {
        if (!cancelled && source === text) {
          html = decorateMarkdownHtml(rendered, trimCodeBlocks);
          htmlSource = signature;
        }
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="markdown" use:copyButtonHandler>{@html html}</div>

<style>
  .markdown {
    min-width: 0;
    max-width: 100%;
    color: color-mix(in oklab, var(--foreground) 92%, transparent);
    font-size: var(--text-sm);
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .markdown :global(:first-child) {
    margin-top: 0;
  }

  .markdown :global(:last-child) {
    margin-bottom: 0;
  }

  .markdown :global(p),
  .markdown :global(ul),
  .markdown :global(ol),
  .markdown :global(blockquote),
  .markdown :global(pre),
  .markdown :global(.table-scroll),
  .markdown :global(.code-block) {
    margin: 0.55rem 0;
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    padding-left: 1.35rem;
  }

  .markdown :global(ul) {
    list-style: disc;
  }

  .markdown :global(ul ul) {
    list-style: circle;
  }

  .markdown :global(ul ul ul) {
    list-style: square;
  }

  .markdown :global(ol) {
    list-style: decimal;
  }

  .markdown :global(ol ol) {
    list-style: lower-alpha;
  }

  .markdown :global(ol ol ol) {
    list-style: lower-roman;
  }

  .markdown :global(li) {
    margin: 0.2rem 0;
    padding-left: 0.15rem;
  }

  .markdown :global(li > p) {
    margin: 0.25rem 0;
  }

  .markdown :global(li > ul),
  .markdown :global(li > ol) {
    margin: 0.25rem 0;
  }

  .markdown :global(.contains-task-list) {
    list-style: none;
    padding-left: 0.2rem;
  }

  .markdown :global(.task-list-item) {
    display: flex;
    gap: 0.45rem;
    align-items: flex-start;
    padding-left: 0;
  }

  .markdown :global(.task-list-item > input[type="checkbox"]) {
    flex: 0 0 auto;
    width: 0.85rem;
    height: 0.85rem;
    margin: 0.22rem 0 0;
    accent-color: var(--primary);
  }

  .markdown :global(a) {
    color: var(--primary);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--primary) 50%, transparent);
    text-underline-offset: 0.18em;
  }

  .markdown :global(code) {
    display: inline;
    border-radius: 0.2rem;
    background: color-mix(in oklab, var(--muted) 60%, transparent);
    color: var(--foreground);
    padding: 0 0.25rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .markdown :global(.code-block) {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
  }

  .markdown :global(.code-copy) {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    z-index: 1;
    opacity: 0;
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: 0.25rem;
    background: var(--input);
    color: var(--muted-foreground);
    padding: 0.12rem 0.38rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: opacity 0.12s ease;
  }

  .markdown :global(.code-block:hover .code-copy),
  .markdown :global(.code-copy:focus-visible) {
    opacity: 1;
  }

  .markdown :global(.code-copy:hover) {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--primary);
  }

  .markdown :global(pre) {
    overflow: visible;
    border: 0;
    border-radius: 0;
    background: var(--sidebar) !important;
    margin: 0;
    padding: 0.55rem 0.6rem;
    font-size: var(--text-xs);
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown :global(pre code) {
    display: block;
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
    font-size: inherit;
    white-space: inherit;
    word-break: inherit;
  }

  .markdown :global(.code-block span) {
    color: var(--shiki-light, inherit);
  }

  :global(.dark) .markdown :global(.code-block span) {
    color: var(--shiki-dark, inherit);
  }

  .markdown :global(blockquote) {
    border-left: 2px solid var(--primary);
    padding-left: 0.85rem;
    color: var(--muted-foreground);
  }

  .markdown :global(.table-scroll) {
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
  }

  .markdown :global(table) {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: var(--text-xs);
  }

  .markdown :global(th),
  .markdown :global(td) {
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    padding: 0.45rem 0.55rem;
    text-align: left;
    vertical-align: top;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .markdown :global(th) {
    background: var(--input);
    color: var(--foreground);
  }
</style>
