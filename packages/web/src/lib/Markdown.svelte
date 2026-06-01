<script lang="ts">
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

  const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify);

  function renderMarkdown(source: string): string {
    try {
      return String(markdownProcessor.processSync(source));
    } catch {
      return source
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }
  }

  const html = $derived(renderMarkdown(text));
</script>

<div class="markdown">{@html html}</div>

<style>
  .markdown {
    color: #dbeafe;
    line-height: 1.6;
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
    margin: 0.75rem 0;
  }

  .markdown :global(a) {
    color: var(--color-accent);
    text-decoration: underline;
    text-decoration-color: rgb(125 211 252 / 36%);
    text-underline-offset: 0.18em;
  }

  .markdown :global(code) {
    display: inline;
    border: 1px solid rgb(125 211 252 / 16%);
    border-radius: 0.4rem;
    background: rgb(2 6 23 / 88%);
    color: #bae6fd;
    padding: 0.08rem 0.34rem;
    font-size: 0.88em;
  }

  .markdown :global(pre) {
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: #020617;
    padding: 1rem;
  }

  .markdown :global(pre code) {
    display: block;
    border: 0;
    background: transparent;
    padding: 0;
    color: #e0f2fe;
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
    background: rgb(125 211 252 / 10%);
    color: #eef2ff;
  }
</style>
