<script lang="ts">
  import { toast } from "svelte-sonner";
  import { unified } from "unified";
  import remarkParse from "remark-parse";
  import remarkGfm from "remark-gfm";
  import remarkRehype from "remark-rehype";
  import rehypeSanitize from "rehype-sanitize";
  import rehypeStringify from "rehype-stringify";
  import { highlightCode } from "./highlight";

  type Props = {
    text: string;
  };

  let { text }: Props = $props();
  let html = $state("");

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

  function renderMarkdown(source: string): string {
    try {
      return String(markdownProcessor.processSync(source));
    } catch {
      return escapeHtml(source);
    }
  }

  function languageFromClass(className: string): string {
    return className.match(/language-([\w-]+)/)?.[1] ?? "text";
  }

  function wrapCodeBlock(pre: Element, language: string): Element {
    const shell = document.createElement("div");
    shell.className = "code-block";
    const header = document.createElement("div");
    header.className = "code-block-header";
    const label = document.createElement("span");
    label.textContent = language || "text";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.dataset.copyCode = "";
    button.textContent = "Copy";
    header.append(label, button);
    shell.append(header, pre);
    return shell;
  }

  function wrapPlainCodeBlocks(safeHtml: string): string {
    if (typeof document === "undefined" || !safeHtml.includes("<pre")) return safeHtml;
    const container = document.createElement("div");
    container.innerHTML = safeHtml;
    for (const block of Array.from(container.querySelectorAll("pre > code"))) {
      const className = block.getAttribute("class") ?? "";
      const language = languageFromClass(className);
      const pre = block.parentElement;
      if (pre) pre.replaceWith(wrapCodeBlock(pre.cloneNode(true) as Element, language));
    }
    return container.innerHTML;
  }

  async function highlightCodeBlocks(safeHtml: string): Promise<string> {
    if (typeof document === "undefined" || !safeHtml.includes("<pre")) return safeHtml;
    const container = document.createElement("div");
    container.innerHTML = safeHtml;
    const blocks = Array.from(container.querySelectorAll("pre > code"));
    await Promise.all(
      blocks.map(async (block) => {
        const className = block.getAttribute("class") ?? "";
        const language = languageFromClass(className);
        try {
          const highlighted = await highlightCode(block.textContent ?? "", language);
          if (highlighted) {
            const wrapper = document.createElement("div");
            wrapper.innerHTML = highlighted;
            const highlightedPre = wrapper.firstElementChild;
            if (highlightedPre) block.parentElement?.replaceWith(wrapCodeBlock(highlightedPre, language));
            return;
          }
        } catch {
          // Fall back to the plain pre/code while keeping the Stitch code header.
        }
        const pre = block.parentElement;
        if (pre) pre.replaceWith(wrapCodeBlock(pre.cloneNode(true) as Element, language));
      }),
    );
    return container.innerHTML;
  }

  async function handleClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-copy-code]");
    if (!button) return;
    const code = button.closest(".code-block")?.querySelector("pre code")?.textContent ?? "";
    if (!code) return;
    try {
      await navigator.clipboard?.writeText(code);
      toast.success("Copied code block");
    } catch {
      toast.error("Could not copy code block");
    }
  }

  function copyButtonHandler(node: HTMLDivElement) {
    node.addEventListener("click", handleClick);
    return {
      destroy() {
        node.removeEventListener("click", handleClick);
      },
    };
  }

  $effect(() => {
    const source = text;
    let cancelled = false;
    const rendered = renderMarkdown(source);
    html = wrapPlainCodeBlocks(rendered);
    highlightCodeBlocks(rendered)
      .then((highlighted) => {
        if (!cancelled && source === text) html = highlighted;
      })
      .catch(() => {
        if (!cancelled && source === text) html = wrapPlainCodeBlocks(rendered);
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="markdown" use:copyButtonHandler>{@html html}</div>

<style>
  .markdown {
    color: hsl(var(--foreground) / 0.92);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
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
  .markdown :global(table),
  .markdown :global(.code-block) {
    margin: 0.55rem 0;
  }

  .markdown :global(a) {
    color: hsl(var(--primary));
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, hsl(var(--primary)) 50%, transparent);
    text-underline-offset: 0.18em;
  }

  .markdown :global(code) {
    display: inline;
    border: 1px solid hsl(var(--border) / 0.6);
    border-radius: var(--radius-xs);
    background: hsl(var(--input));
    color: hsl(var(--foreground));
    padding: 0.08rem 0.28rem;
    font-family: var(--font-mono);
    font-size: 0.9em;
  }

  .markdown :global(.code-block) {
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-sm);
    background: hsl(var(--sidebar));
  }

  .markdown :global(.code-block-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-bottom: 1px solid hsl(var(--border));
    background: hsl(var(--secondary));
    padding: 0.32rem 0.6rem;
    color: hsl(var(--muted-foreground));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .markdown :global(.code-copy) {
    border: 1px solid hsl(var(--border) / 0.6);
    border-radius: var(--radius-xs);
    background: hsl(var(--input));
    color: hsl(var(--muted-foreground));
    padding: 0.12rem 0.38rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    cursor: pointer;
  }

  .markdown :global(.code-copy:hover) {
    border-color: hsl(var(--accent));
    background: hsl(var(--accent));
    color: hsl(var(--primary));
  }

  .markdown :global(pre) {
    overflow: auto;
    border: 0;
    border-radius: 0;
    background: hsl(var(--sidebar)) !important;
    margin: 0;
    padding: 0.75rem;
    font-size: var(--text-xs);
    line-height: 1.55;
  }

  .markdown :global(pre code) {
    display: block;
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
  }

  .markdown :global(blockquote) {
    border-left: 2px solid hsl(var(--primary));
    padding-left: 0.85rem;
    color: hsl(var(--muted-foreground));
  }

  .markdown :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
  }

  .markdown :global(th),
  .markdown :global(td) {
    border: 1px solid hsl(var(--border) / 0.6);
    padding: 0.45rem 0.55rem;
    text-align: left;
  }

  .markdown :global(th) {
    background: hsl(var(--input));
    color: hsl(var(--foreground));
  }
</style>
