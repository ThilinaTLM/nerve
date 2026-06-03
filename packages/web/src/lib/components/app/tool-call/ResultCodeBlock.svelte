<script lang="ts">
  import { highlightCode } from "../../../highlight";

  type Props = {
    code: string;
    language?: string;
    maxHeight?: string;
  };
  let { code, language, maxHeight = "18rem" }: Props = $props();

  let html = $state<string | undefined>(undefined);

  $effect(() => {
    let cancelled = false;
    html = undefined;
    void highlightCode(code, language).then((result) => {
      if (!cancelled) html = result;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if html}
  <div class="code-block" style:max-height={maxHeight}>
    {@html html}
  </div>
{:else}
  <pre class="code-block plain" style:max-height={maxHeight}>{code}</pre>
{/if}

<style>
  .code-block {
    margin: 0;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.5rem 0.6rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .code-block.plain {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .code-block :global(pre) {
    margin: 0;
    background: transparent !important;
    white-space: pre;
  }

  .code-block :global(code) {
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }

  :global(.dark) .code-block :global(span) {
    color: var(--shiki-dark, inherit);
  }
</style>
