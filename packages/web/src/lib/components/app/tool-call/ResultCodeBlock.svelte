<script lang="ts">
  import { highlightCodeCached } from "../../../highlight";
  import { trimTextPreview } from "../../../utils/text-preview";

  type Props = {
    code: string;
    language?: string;
    maxHeight?: string;
  };
  let { code, language, maxHeight: _maxHeight = "18rem" }: Props = $props();
  void _maxHeight;

  let html = $state<string | undefined>(undefined);
  let htmlSignature = $state<string | undefined>(undefined);
  let unavailableSignature = $state<string | undefined>(undefined);
  const preview = $derived(trimTextPreview(code));
  const signature = $derived(`${language ?? ""}\0${preview.text}`);

  $effect(() => {
    const currentSignature = signature;
    if (htmlSignature === currentSignature || unavailableSignature === currentSignature) return;

    const result = highlightCodeCached(preview.text, language);
    if (typeof result === "string") {
      html = result;
      htmlSignature = currentSignature;
      unavailableSignature = undefined;
      return;
    }
    if (!result) {
      unavailableSignature = currentSignature;
      return;
    }

    let cancelled = false;
    void result.then((highlighted) => {
      if (cancelled || signature !== currentSignature) return;
      if (highlighted) {
        html = highlighted;
        htmlSignature = currentSignature;
        unavailableSignature = undefined;
      } else {
        unavailableSignature = currentSignature;
      }
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if html && htmlSignature === signature}
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
    font-size: var(--text-xs);
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
    font-size: var(--text-xs);
  }

  .code-block :global(span) {
    color: var(--shiki-light, inherit);
  }

  :global(.dark) .code-block :global(span) {
    color: var(--shiki-dark, inherit);
  }
</style>
