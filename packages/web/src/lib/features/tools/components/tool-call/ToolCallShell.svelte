<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ToolCallRecord } from "$lib/api";
  import type { ToolPresentation } from "$lib/features/tools/views/tool-presentation";
  import { trimTextPreview } from "$lib/core/utils/text-preview";
  import { StatusDot } from "$lib/components/ui/status-dot";

  type Props = {
    toolCall: ToolCallRecord;
    presentation: ToolPresentation;
    bodyMode?: "output" | "interactive";
    expanded?: boolean;
    onOpenFile?: (path: string, line?: number) => void;
    children?: Snippet;
  };
  let {
    toolCall,
    presentation,
    bodyMode = "output",
    expanded = $bindable(false),
    onOpenFile,
    children,
  }: Props = $props();

  const arg = $derived(presentation.primaryArg);
  const collapse = $derived(bodyMode === "output" ? presentation.collapse : undefined);
  const showFooter = $derived(presentation.meta.length > 0 || Boolean(collapse));
  const errorPreview = $derived(
    toolCall.error
      ? trimTextPreview(toolCall.error, { headLines: 18, tailLines: 6, maxChars: 6_000 }).text
      : "",
  );
</script>

<article class={`tool-card status-${toolCall.status}`}>
  <div class="tool-header">
    <StatusDot tone={presentation.dotTone} pulse={presentation.dotPulse} size="xs" class="mr-1.5 align-middle" />
    <span class="badge">{presentation.badge}</span>
    {#if arg}
      {#if arg.openPath}
        <button class="arg link" type="button" title={arg.text} onclick={() => onOpenFile?.(arg.openPath!, arg.line)}>{arg.text}</button>
      {:else if arg.href}
        <a class="arg link" href={arg.href} target="_blank" rel="noreferrer noopener" title={arg.text}>{arg.text}</a>
      {:else}
        <span class="arg" title={arg.text}>{arg.text}</span>
      {/if}
    {/if}
  </div>

  {#if toolCall.error}
    <pre class="tool-error">{errorPreview}</pre>
  {/if}

  {#if children}
    <div class="tool-body">{@render children()}</div>
  {/if}

  {#if showFooter}
    <div class="tool-footer">
      {#if presentation.meta.length > 0}
        <div class="chips">
          {#each presentation.meta as item, i (i)}
            <span class={`chip tone-${item.tone ?? "default"}`} class:mono={item.mono}>{item.text}</span>
          {/each}
        </div>
      {/if}
      {#if collapse}
        <button class="more" type="button" onclick={() => (expanded = !expanded)}>
          {expanded ? collapse.collapseLabel : collapse.expandLabel}
        </button>
      {/if}
    </div>
  {/if}
</article>

<style>
  .tool-card {
    display: grid;
    gap: 0.4rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
  }

  /* Inline flow so a long arg wraps flush to the left edge (no hanging indent). */
  .tool-header {
    min-width: 0;
    line-height: 1.5;
  }

  .badge {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 650;
    color: var(--foreground);
  }

  .arg {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    margin-left: 0.5rem;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .arg.link {
    border: 0;
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    padding: 0;
    text-align: left;
    text-decoration: none;
  }

  .arg.link:hover {
    text-decoration: underline;
  }

  .tool-body {
    min-width: 0;
  }

  .tool-error {
    margin: 0;
    border: 1px solid color-mix(in oklab, var(--destructive) 40%, var(--border));
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--destructive);
    padding: 0.48rem 0.58rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tool-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.6rem;
    justify-content: space-between;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .chip {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--muted-foreground);
    padding: 0.05rem 0.4rem;
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: nowrap;
  }

  .chip.mono {
    font-family: var(--font-mono);
  }

  .chip.tone-success {
    color: var(--success);
    border-color: color-mix(in oklab, var(--success) 35%, var(--border));
  }

  .chip.tone-warning {
    color: var(--warning);
    border-color: color-mix(in oklab, var(--warning) 35%, var(--border));
  }

  .chip.tone-error {
    color: var(--destructive);
    border-color: color-mix(in oklab, var(--destructive) 35%, var(--border));
  }

  .chip.tone-info {
    color: var(--info);
    border-color: color-mix(in oklab, var(--info) 35%, var(--border));
  }

  .more {
    flex: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--primary);
    cursor: pointer;
    padding: 0.05rem 0.45rem;
    font-size: var(--text-xs);
    line-height: 1.5;
  }

  .more:hover {
    background: var(--sidebar);
    text-decoration: underline;
  }
</style>
