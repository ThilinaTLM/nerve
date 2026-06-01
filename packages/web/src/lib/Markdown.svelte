<script lang="ts">
  import { codeToHtml } from "shiki";
  import { unified } from "unified";
  import remarkParse from "remark-parse";
  import remarkGfm from "remark-gfm";
  import remarkRehype from "remark-rehype";
  import rehypeSanitize from "rehype-sanitize";
  import rehypeStringify from "rehype-stringify";

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

  async function highlightCodeBlocks(safeHtml: string): Promise<string> {
    if (typeof document === "undefined" || !safeHtml.includes("<pre")) return safeHtml;
    const container = document.createElement("div");
    container.innerHTML = safeHtml;
    const blocks = Array.from(container.querySelectorAll("pre > code"));
    await Promise.all(
      blocks.map(async (block) => {
        const className = block.getAttribute("class") ?? "";
        const language = className.match(/language-([\w-]+)/)?.[1] ?? "text";
        const highlighted = await codeToHtml(block.textContent ?? "", {
          lang: language,
          themes: {
            light: "github-light",
            dark: "night-owl",
          },
          defaultColor: false,
        });
        const wrapper = document.createElement("div");
        wrapper.innerHTML = highlighted;
        block.parentElement?.replaceWith(wrapper.firstElementChild ?? block);
      }),
    );
    return container.innerHTML;
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

<div class="markdown">{@html html}</div>

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
  .markdown :global(table) {
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

  .markdown :global(pre) {
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-code-bg) !important;
    padding: 0.65rem;
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
