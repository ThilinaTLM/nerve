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

  async function highlightCodeBlocks(safeHtml: string): Promise<string> {
    if (typeof document === "undefined" || !safeHtml.includes("<pre")) return safeHtml;
    const container = document.createElement("div");
    container.innerHTML = safeHtml;
    const blocks = Array.from(container.querySelectorAll("pre > code"));
    await Promise.all(
      blocks.map(async (block) => {
        const className = block.getAttribute("class") ?? "";
        const language = languageFromClass(className);
        const highlighted = await highlightCode(block.textContent ?? "", language);
        if (highlighted) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = highlighted;
          const highlightedPre = wrapper.firstElementChild;
          if (highlightedPre) block.parentElement?.replaceWith(wrapCodeBlock(highlightedPre, language));
          return;
        }
        const pre = block.parentElement;
        if (pre) pre.replaceWith(wrapCodeBlock(pre, language));
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
    html = renderMarkdown(source);
    highlightCodeBlocks(html)
      .then((highlighted) => {
        if (!cancelled && source === text) html = highlighted;
      })
      .catch(() => {
        if (!cancelled && source === text) html = renderMarkdown(source);
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="markdown" use:copyButtonHandler>{@html html}</div>

<style>
  .markdown {
    color: var(--color-message-text);
    line-height: 1.5;
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
    margin: 0.5rem 0;
  }

  .markdown :global(a) {
    color: var(--color-accent);
    text-decoration: underline;
    text-decoration-color: color-mix(in oklab, var(--color-accent), transparent 62%);
    text-underline-offset: 0.18em;
  }

  .markdown :global(code) {
    display: inline;
    border: 1px solid var(--color-border-subtle);
    border-radius: 0.42rem;
    background: var(--color-field);
    color: var(--color-code);
    padding: 0.08rem 0.34rem;
    font-size: 0.88em;
  }

  .markdown :global(.code-block) {
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-code-bg);
  }

  .markdown :global(.code-block-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-panel-muted);
    padding: 0.32rem 0.45rem;
    color: var(--color-muted);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .markdown :global(.code-copy) {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-muted);
    padding: 0.12rem 0.35rem;
    font-size: 0.66rem;
    cursor: pointer;
  }

  .markdown :global(.code-copy:hover) {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  .markdown :global(pre) {
    overflow: auto;
    border: 0;
    border-radius: 0;
    background: var(--color-code-bg) !important;
    margin: 0;
    padding: 0.7rem;
  }

  .markdown :global(pre code) {
    display: block;
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
  }

  .markdown :global(blockquote) {
    border-left: 3px solid var(--color-accent);
    padding-left: 1rem;
    color: var(--color-muted);
  }

  .markdown :global(table) {
    width: 100%;
    border-collapse: collapse;
  }

  .markdown :global(th),
  .markdown :global(td) {
    border: 1px solid var(--color-border);
    padding: 0.45rem 0.6rem;
    text-align: left;
  }

  .markdown :global(th) {
    background: var(--color-accent-soft);
    color: var(--color-text);
  }
</style>
