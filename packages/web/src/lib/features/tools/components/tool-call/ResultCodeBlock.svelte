<script lang="ts">
  import { highlightCodeCached } from "$lib/core/highlight/highlight";
  import { trimTextPreview } from "$lib/core/utils/text-preview";

  type Props = {
    code: string;
    language?: string;
    maxHeight?: string;
    trim?: boolean;
    highlight?: boolean;
    wrap?: boolean;
    overflow?: "auto" | "hidden";
  };
  let {
    code,
    language,
    maxHeight = "18rem",
    trim = true,
    highlight = true,
    wrap = true,
    overflow = "auto",
  }: Props = $props();

  let html = $state<string | undefined>(undefined);
  let htmlSignature = $state<string | undefined>(undefined);
  let unavailableSignature = $state<string | undefined>(undefined);
  const preview = $derived(trim ? trimTextPreview(code) : { text: code });
  const signature = $derived(`${language ?? ""}\0${preview.text}`);

  $effect(() => {
    if (!highlight) {
      html = undefined;
      htmlSignature = undefined;
      unavailableSignature = undefined;
      return;
    }

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

{#if highlight && html && htmlSignature === signature}
  <div
    class="code-block"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    style:max-height={maxHeight}
  >
    {@html html}
  </div>
{:else}
  <pre
    class="code-block plain"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    style:max-height={maxHeight}
  >{preview.text}</pre>
{/if}

<style>
  .code-block {
    margin: 0;
    overflow: auto;
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

  .code-block[data-wrap="false"] {
    white-space: pre;
    word-break: normal;
  }

  .code-block[data-wrap="false"] :global(pre) {
    white-space: pre;
    word-break: normal;
  }

  .code-block[data-overflow="hidden"] {
    overflow: hidden;
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
