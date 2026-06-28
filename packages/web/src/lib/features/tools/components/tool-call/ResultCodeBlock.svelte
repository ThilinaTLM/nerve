<script lang="ts">
  import { highlightCodeCached } from "$lib/core/highlight/highlight";
  import { ansiToHtml } from "$lib/core/terminal/ansi";
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
    terminal?: boolean;
    tail?: boolean;
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
    terminal = false,
    tail = false,
  }: Props = $props();

  let html = $state<string | undefined>(undefined);
  let htmlSignature = $state<string | undefined>(undefined);
  let unavailableSignature = $state<string | undefined>(undefined);
  const preview = $derived(trim ? trimTextPreview(code) : { text: code });
  const signature = $derived(`${language ?? ""}\0${preview.text}`);
  const hasFixedRows = $derived(fixedRows !== undefined && fixedRows > 0);
  const terminalHtml = $derived(ansiToHtml(preview.text));

  // Monotonic grow-then-lock sizing for fixed-rows previews. The box height is
  // driven by the visible logical line count (clamped to `fixedRows`) and a
  // high-water mark so it never shrinks while a draft streams. Wrapping changes
  // then only clip/scroll content (overflow hidden + tail) instead of resizing
  // the card, which is what eliminates the streaming jitter.
  const visibleRowCount = $derived.by(() => {
    if (!hasFixedRows) return undefined;
    const text = preview.text;
    const lines = text.length === 0 ? 0 : text.split("\n").length;
    return Math.min(lines, fixedRows as number);
  });
  let maxVisibleRows = $state(0);
  $effect(() => {
    const rows = visibleRowCount ?? 0;
    if (rows > maxVisibleRows) maxVisibleRows = rows;
  });
  const fixedRowsVar = $derived(hasFixedRows ? String(fixedRows) : undefined);
  const visibleRowsVar = $derived(
    hasFixedRows ? String(Math.max(maxVisibleRows, 1)) : undefined,
  );

  $effect(() => {
    if (terminal || !highlight) {
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

{#if terminal}
  <div
    class="code-block terminal-output"
    data-terminal="true"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tail ? "true" : undefined}
    style:max-height={hasFixedRows ? undefined : maxHeight}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  ><div class="code-block__content">{@html terminalHtml}</div></div>
{:else if highlight && html && htmlSignature === signature}
  <div
    class="code-block"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tail ? "true" : undefined}
    style:max-height={hasFixedRows ? undefined : maxHeight}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  ><div class="code-block__content">{@html html}</div></div>
{:else}
  <div
    class="code-block plain"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tail ? "true" : undefined}
    style:max-height={hasFixedRows ? undefined : maxHeight}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  ><pre class="code-block__content">{preview.text}</pre></div>
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

  .code-block__content {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .code-block__content :global(pre) {
    margin: 0;
    background: transparent !important;
    white-space: inherit;
    word-break: inherit;
  }

  .code-block[data-terminal="true"] {
    line-height: 1.22;
  }

  .code-block[data-terminal="true"] .code-block__content {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .code-block[data-wrap="false"] .code-block__content,
  .code-block[data-wrap="false"] .code-block__content :global(pre) {
    white-space: pre;
    word-break: normal;
  }

  .code-block[data-overflow="hidden"] {
    overflow: hidden;
  }

  .code-block[data-fixed-rows="true"] {
    /* Monotonic grow-then-lock: height follows the visible (high-water) row
     * count up to the hard `fixed-rows` cap, so streaming never resizes the
     * card down. The transition smooths the per-line ramp and is neutralized by
     * the global prefers-reduced-motion rule in base.css. */
    height: calc((var(--code-block-visible-rows) * 1lh) + (var(--code-block-padding-y) * 2) + 2px);
    max-height: calc((var(--code-block-fixed-rows) * 1lh) + (var(--code-block-padding-y) * 2) + 2px);
    transition: height 140ms ease-out;
  }

  .code-block[data-tail="true"] {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
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
