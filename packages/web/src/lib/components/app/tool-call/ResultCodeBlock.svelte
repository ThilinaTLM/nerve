<script lang="ts">
  import { highlightCode } from "../../../highlight";
  import { trimTextPreview } from "../../../utils/text-preview";

  type Props = {
    code: string;
    language?: string;
    maxHeight?: string;
  };
  let { code, language, maxHeight: _maxHeight = "18rem" }: Props = $props();
  void _maxHeight;

  let html = $state<string | undefined>(undefined);
  const preview = $derived(trimTextPreview(code));

  $effect(() => {
    let cancelled = false;
    html = undefined;
    void highlightCode(preview.text, language).then((result) => {
      if (!cancelled) html = result;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if html}
  <div class="code-block">
    {@html html}
  </div>
{:else}
  <pre class="code-block plain">{preview.text}</pre>
{/if}

<style>
  .code-block {
    margin: 0;
    overflow: visible;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.48rem 0.58rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    line-height: 1.4;
  }

  .code-block.plain {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .code-block :global(pre) {
    margin: 0;
    background: transparent !important;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .code-block :global(code) {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
  }

  :global(.dark) .code-block :global(span) {
    color: var(--shiki-dark, inherit);
  }
</style>
