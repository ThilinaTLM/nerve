<script lang="ts">
  import { highlightCodeCached } from "@nervekit/shared-ui/core/highlight/highlight";

  let {
    code,
    lang,
    wrap = false,
    class: className = "",
  }: { code: string; lang: string; wrap?: boolean; class?: string } = $props();

  let html = $state<string | undefined>(undefined);
  let htmlCode = $state<string | undefined>(undefined);

  const lines = $derived(code.split("\n"));
  const lineNumberWidth = $derived(`${Math.max(2, String(lines.length).length)}ch`);
  const codeViewStyle = $derived(
    `--line-number-width: ${lineNumberWidth}; counter-reset: code-line 0;`,
  );
  const highlighted = $derived(html !== undefined && htmlCode === code);

  $effect(() => {
    const nextCode = code;
    const result = highlightCodeCached(nextCode, lang);

    if (typeof result === "string") {
      html = result;
      htmlCode = nextCode;
      return;
    }
    if (result === undefined) {
      html = undefined;
      htmlCode = undefined;
      return;
    }

    let cancelled = false;
    void result.then((value) => {
      if (cancelled) return;
      html = value ?? undefined;
      htmlCode = value ? nextCode : undefined;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if highlighted}
  <div class={`code-view ${wrap ? "wrap-lines" : ""} ${className}`} style={codeViewStyle}>
    {@html html}
  </div>
{:else}
  <pre
    class={`code-view plain ${wrap ? "wrap-lines" : ""} ${className}`}
    style={codeViewStyle}
  ><code>{#each lines as line, index (index)}<span class="line">{line}</span>{/each}</code></pre>
{/if}

<style>
  .code-view {
    --line-number-width: 2ch;
    counter-reset: code-line;
    min-width: 100%;
    margin: 0;
    overflow: visible;
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.55;
    tab-size: 2;
  }

  .code-view:not(.wrap-lines) {
    width: max-content;
  }

  .code-view.wrap-lines {
    width: 100%;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .code-view.plain {
    white-space: pre;
  }

  .code-view.plain.wrap-lines {
    white-space: pre-wrap;
  }

  .code-view :global(pre) {
    margin: 0;
    overflow: visible;
    background: transparent !important;
    white-space: pre;
  }

  .code-view.wrap-lines :global(pre) {
    white-space: pre-wrap;
  }

  .code-view :global(code),
  .code-view code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: inherit;
  }

  .code-view :global(.line) {
    display: block;
    min-height: 1.55em;
    padding-right: 1rem;
  }

  .code-view.wrap-lines :global(.line) {
    padding-left: calc(var(--line-number-width) + 1rem);
    overflow-wrap: anywhere;
    text-indent: calc(-1 * (var(--line-number-width) + 1rem));
    white-space: pre-wrap;
  }

  .code-view :global(.line)::before {
    counter-increment: code-line;
    content: counter(code-line);
    position: sticky;
    left: 0;
    display: inline-block;
    width: var(--line-number-width);
    margin-right: 1rem;
    background: var(--background);
    color: color-mix(in oklab, var(--muted-foreground) 58%, transparent);
    text-align: right;
    user-select: none;
  }

  .code-view :global(span) {
    color: var(--shiki-light, inherit);
  }

  :global(.dark) .code-view :global(span) {
    color: var(--shiki-dark, inherit);
  }
</style>
