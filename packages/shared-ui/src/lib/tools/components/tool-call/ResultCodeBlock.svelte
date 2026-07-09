<script lang="ts">
  import { highlightCodeCached } from "@nervekit/shared-ui/core/highlight/highlight";
  import { ansiToHtml } from "@nervekit/shared-ui/core/terminal/ansi";
  import { trimTextPreview } from "@nervekit/shared-ui/core/utils/text-preview";
  import {
    computedLineHeightPixels,
    contentWidthFromBorderBox,
    nextFixedVisibleRows,
    parseCssPixels,
    visualRowsFromScrollHeight,
  } from "./result-code-block-sizing";

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

  type DiffLineTone = "add" | "delete" | "hunk" | "file" | "context";
  type DiffLine = { text: string; tone: DiffLineTone };

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
  let blockEl = $state<HTMLElement | undefined>(undefined);
  let viewportEl = $state<HTMLElement | undefined>(undefined);
  let contentEl = $state<HTMLElement | undefined>(undefined);
  let measureFrame = $state<number | undefined>(undefined);

  const preview = $derived(trim ? trimTextPreview(code) : { text: code });
  const signature = $derived(`${language ?? ""}\0${preview.text}`);
  const hasFixedRows = $derived(fixedRows !== undefined && fixedRows > 0);
  const terminalHtml = $derived(ansiToHtml(preview.text));
  const isDiff = $derived(
    !terminal && (language ?? "").toLowerCase().trim() === "diff",
  );
  const diffLines = $derived(isDiff ? splitDiffLines(preview.text) : []);

  const logicalRowCount = $derived.by(() => {
    if (!hasFixedRows) return 1;
    const text = preview.text;
    const rows = text.length === 0 ? 1 : text.split("\n").length;
    return Math.min(Math.max(rows, 1), fixedRows as number);
  });

  let maxVisibleRows = $state(0);

  function diffLineTone(line: string): DiffLineTone {
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) {
      return "file";
    }
    if (line.startsWith("+")) return "add";
    if (line.startsWith("-")) return "delete";
    return "context";
  }

  function splitDiffLines(text: string): DiffLine[] {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return normalized.split("\n").map((line) => ({
      text: line,
      tone: diffLineTone(line),
    }));
  }

  function updateVisibleRows(measuredRows?: number): void {
    if (!hasFixedRows || fixedRows === undefined) return;
    maxVisibleRows = nextFixedVisibleRows({
      previousRows: maxVisibleRows,
      measuredRows,
      fallbackRows: logicalRowCount,
      fixedRows,
    });
  }

  function cancelMeasureFrame(): void {
    if (measureFrame === undefined) return;
    cancelAnimationFrame(measureFrame);
    measureFrame = undefined;
  }

  function measureVisualRows(): void {
    measureFrame = undefined;
    if (!hasFixedRows || !blockEl || !viewportEl || !contentEl) return;

    const blockRect = blockEl.getBoundingClientRect();
    const viewportRect = viewportEl.getBoundingClientRect();
    const blockStyle = getComputedStyle(blockEl);
    const contentWidth = viewportRect.width > 0
      ? viewportRect.width
      : contentWidthFromBorderBox({
          borderBoxWidth: blockRect.width,
          paddingLeft: parseCssPixels(blockStyle.paddingLeft),
          paddingRight: parseCssPixels(blockStyle.paddingRight),
          borderLeftWidth: parseCssPixels(blockStyle.borderLeftWidth),
          borderRightWidth: parseCssPixels(blockStyle.borderRightWidth),
        });

    if (contentWidth <= 0) return;

    const contentStyle = getComputedStyle(contentEl);
    const lineHeightPixels = computedLineHeightPixels(
      contentStyle.lineHeight,
      contentStyle.fontSize,
    );
    updateVisibleRows(
      visualRowsFromScrollHeight(contentEl.scrollHeight, lineHeightPixels),
    );
  }

  function scheduleMeasure(): void {
    if (!hasFixedRows) return;
    if (measureFrame !== undefined) return;
    if (typeof requestAnimationFrame === "undefined") {
      measureVisualRows();
      return;
    }
    measureFrame = requestAnimationFrame(measureVisualRows);
  }

  $effect(() => {
    if (!hasFixedRows) {
      maxVisibleRows = 0;
      cancelMeasureFrame();
      return;
    }
    updateVisibleRows();
  });

  $effect(() => {
    // Re-measure after content, highlighting, terminal rendering, or row caps
    // change. Width-driven reflows are handled by the ResizeObserver below.
    const measurementKey = `${preview.text}\0${html ?? ""}\0${terminalHtml}\0${fixedRows ?? ""}`;
    if (!hasFixedRows || measurementKey === undefined) return;
    scheduleMeasure();
  });

  $effect(() => {
    if (
      !hasFixedRows ||
      !blockEl ||
      !viewportEl ||
      !contentEl ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    const observer = new ResizeObserver(() => scheduleMeasure());
    observer.observe(blockEl);
    observer.observe(viewportEl);
    observer.observe(contentEl);
    scheduleMeasure();
    return () => observer.disconnect();
  });

  $effect(() => {
    return () => cancelMeasureFrame();
  });

  const fixedRowsVar = $derived(hasFixedRows ? String(fixedRows) : undefined);
  const visibleRowsVar = $derived(
    hasFixedRows ? String(Math.max(maxVisibleRows, 1)) : undefined,
  );

  $effect(() => {
    if (terminal || !highlight || isDiff) {
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
    bind:this={blockEl}
    class="code-block terminal-output"
    data-terminal="true"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tail ? "true" : undefined}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  ><div
      bind:this={viewportEl}
      class="code-block__viewport"
      style:max-height={hasFixedRows ? undefined : maxHeight}
    ><div bind:this={contentEl} class="code-block__content">{@html terminalHtml}</div></div></div>
{:else if isDiff}
  <div
    bind:this={blockEl}
    class="code-block plain"
    data-language="diff"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tail ? "true" : undefined}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  ><div
      bind:this={viewportEl}
      class="code-block__viewport"
      style:max-height={hasFixedRows ? undefined : maxHeight}
    ><pre bind:this={contentEl} class="code-block__content code-block__content--diff">{#each diffLines as line, index (`${index}:${line.text}`)}<span class="diff-line" data-tone={line.tone}>{line.text}</span>{/each}</pre></div></div>
{:else if highlight && html && htmlSignature === signature}
  <div
    bind:this={blockEl}
    class="code-block"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tail ? "true" : undefined}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  ><div
      bind:this={viewportEl}
      class="code-block__viewport"
      style:max-height={hasFixedRows ? undefined : maxHeight}
    ><div bind:this={contentEl} class="code-block__content">{@html html}</div></div></div>
{:else}
  <div
    bind:this={blockEl}
    class="code-block plain"
    data-wrap={wrap ? "true" : "false"}
    data-overflow={overflow}
    data-fixed-rows={hasFixedRows ? "true" : undefined}
    data-tail={tail ? "true" : undefined}
    style:--code-block-fixed-rows={fixedRowsVar}
    style:--code-block-visible-rows={visibleRowsVar}
  ><div
      bind:this={viewportEl}
      class="code-block__viewport"
      style:max-height={hasFixedRows ? undefined : maxHeight}
    ><pre bind:this={contentEl} class="code-block__content">{preview.text}</pre></div></div>
{/if}

<style>
  .code-block {
    --code-block-padding-y: 10px;
    --code-block-padding-x: 10px;
    --code-block-border-y: 2px;

    box-sizing: border-box;
    margin: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: var(--code-block-padding-y) var(--code-block-padding-x);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .code-block__viewport {
    min-width: 0;
    max-width: 100%;
    overflow: auto;
  }

  .code-block[data-overflow="hidden"] .code-block__viewport {
    overflow: hidden;
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

  .code-block[data-fixed-rows="true"] {
    /* Monotonic grow-then-lock: height follows the rendered visual row count
     * (including wrapping) up to the hard fixed-row cap. The calc explicitly
     * adds the block chrome so the content viewport is exactly N rows tall. */
    height: calc((var(--code-block-visible-rows) * 1lh) + (var(--code-block-padding-y) * 2) + var(--code-block-border-y));
    max-height: calc((var(--code-block-fixed-rows) * 1lh) + (var(--code-block-padding-y) * 2) + var(--code-block-border-y));
    transition: height 140ms ease-out;
  }

  .code-block[data-fixed-rows="true"] .code-block__viewport {
    height: 100%;
    overflow: hidden;
  }

  .code-block[data-tail="true"] .code-block__viewport {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  .code-block :global(code) {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .code-block__content:not(.code-block__content--diff) :global(span) {
    color: var(--shiki-light, inherit);
  }

  :global(.dark) .code-block__content:not(.code-block__content--diff) :global(span) {
    color: var(--shiki-dark, inherit);
  }

  .code-block__content--diff {
    display: block;
  }

  .diff-line {
    display: block;
    min-height: 1lh;
  }

  .diff-line:empty::before {
    content: " ";
  }

  .diff-line[data-tone="add"] {
    color: var(--success);
  }

  .diff-line[data-tone="delete"] {
    color: var(--destructive);
  }

  .diff-line[data-tone="hunk"] {
    color: var(--info);
  }

  .diff-line[data-tone="file"] {
    color: var(--muted-foreground);
  }
</style>
