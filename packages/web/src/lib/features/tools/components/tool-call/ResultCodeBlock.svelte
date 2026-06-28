<script lang="ts">
  import { highlightCodeCached } from "$lib/core/highlight/highlight";
  import { trimTextPreview } from "$lib/core/utils/text-preview";

  type Props = {
    code: string;
    language?: string;
    maxHeight?: string;
    fixedRows?: number;
    trim?: boolean;
    highlight?: boolean;
    wrap?: boolean;
    overflow?: "auto" | "hidden";
  };
  let {
    code,
    language,
    maxHeight = "18rem",
    fixedRows,
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
  const hasFixedRows = $derived(fixedRows !== undefined && fixedRows > 0);

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
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    style:max-height={maxHeight}
    style:--code-block-fixed-rows={hasFixedRows ? String(fixedRows) : undefined}
  >
    {@html html}
  </div>
{:else}
  <pre
    class="code-block plain"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    style:max-height={maxHeight}
    style:--code-block-fixed-rows={hasFixedRows ? String(fixedRows) : undefined}
  >{preview.text}</pre>
{/if}

<style>
  .code-block {
    --code-block-padding-y: 0.48rem;
    --code-block-padding-x: 0.58rem;

    box-sizing: border-box;
    margin: 0;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: var(--code-block-padding-y) var(--code-block-padding-x);
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

  .code-block[data-fixed-rows="true"] {
    height: calc((var(--code-block-fixed-rows) * 1lh) + (var(--code-block-padding-y) * 2) + 2px);
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
